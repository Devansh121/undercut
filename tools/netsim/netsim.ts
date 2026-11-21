/**
 * A network simulator: wraps any Transport and injects latency, jitter, loss,
 * duplication and reordering between a headless client and the real rooms service.
 *
 * WebSockets run over TCP, which never loses, duplicates or reorders. To stay honest
 * about what that means for the game:
 *   - Binary car snapshots are treated as if unreliable: each one is delayed
 *     independently (so jitter reorders them), dropped with probability `loss` and
 *     duplicated with probability `duplicate`. This is the worst a snapshot stream
 *     sees, and what an unreliable transport would do.
 *   - JSON control messages keep TCP's guarantees: they are delivered once and in
 *     order, and loss shows up as head-of-line delay (one retransmission timeout,
 *     `retransmitMs`), not as a missing message.
 */
import type { Rng } from '@undercut/core';
import type { Connection, Timers, Transport, TransportHandlers } from '@undercut/protocol';

export interface NetConditions {
  /** Mean one-way latency, ms. */
  latencyMs: number;
  /** Uniform jitter: each delay is latency +- jitter, ms. */
  jitterMs: number;
  /** Probability a snapshot is dropped (control: delayed by a retransmit instead). */
  loss: number;
  /** Probability a snapshot is delivered twice. */
  duplicate: number;
  /** Extra delay of a "lost" control message, ms. */
  retransmitMs: number;
}

export const NO_IMPAIRMENT: NetConditions = {
  latencyMs: 0,
  jitterMs: 0,
  loss: 0,
  duplicate: 0,
  retransmitMs: 200,
};

export interface NetStats {
  sent: number;
  /** Payload bytes handed to this direction (before loss or duplication). */
  bytes: number;
  delivered: number;
  dropped: number;
  duplicated: number;
  reordered: number;
  /** Most messages in flight at once in this direction. */
  maxInFlight: number;
}

const newStats = (): NetStats => ({
  sent: 0,
  bytes: 0,
  delivered: 0,
  dropped: 0,
  duplicated: 0,
  reordered: 0,
  maxInFlight: 0,
});

/** One direction of a link. */
class Lane {
  readonly stats = newStats();
  private inFlight = 0;
  /** Delivery time of the last control message, to keep them in order. */
  private lastControlAt = 0;
  private lastBinarySeq = -1;
  private readonly controlQueue: { at: number; deliver: () => void }[] = [];
  private seq = 0;

  constructor(
    private readonly conditions: () => NetConditions,
    private readonly rng: Rng,
    private readonly timers: Timers,
  ) {}

  private delay(): number {
    const c = this.conditions();
    return Math.max(0, c.latencyMs + (this.rng.next() * 2 - 1) * c.jitterMs);
  }

  control(deliver: () => void, bytes = 0): void {
    const c = this.conditions();
    this.stats.sent++;
    this.stats.bytes += bytes;
    let d = this.delay();
    if (this.rng.next() < c.loss) d += c.retransmitMs;
    const now = this.timers.now();
    const at = Math.max(now + d, this.lastControlAt);
    this.lastControlAt = at;
    // One FIFO drained by a single timer: separate timers could fire out of order
    // when their delays round differently, and TCP never reorders.
    this.controlQueue.push({ at, deliver });
    this.inFlight++;
    this.stats.maxInFlight = Math.max(this.stats.maxInFlight, this.inFlight);
    if (this.controlQueue.length === 1) this.armControl();
  }

  private armControl(): void {
    const head = this.controlQueue[0];
    if (!head) return;
    this.timers.setTimeout(
      () => {
        const now = this.timers.now();
        while (
          this.controlQueue.length > 0 &&
          (this.controlQueue[0] as { at: number }).at <= now + 0.5
        ) {
          const item = this.controlQueue.shift() as { deliver: () => void };
          this.inFlight--;
          this.stats.delivered++;
          item.deliver();
        }
        this.armControl();
      },
      Math.max(0, head.at - this.timers.now()),
    );
  }

  binary(deliver: () => void, bytes = 0): void {
    const c = this.conditions();
    this.stats.sent++;
    this.stats.bytes += bytes;
    if (this.rng.next() < c.loss) {
      this.stats.dropped++;
      return;
    }
    const seq = this.seq++;
    const copies = this.rng.next() < c.duplicate ? 2 : 1;
    if (copies === 2) this.stats.duplicated++;
    for (let i = 0; i < copies; i++) {
      this.schedule(this.delay(), () => {
        if (seq < this.lastBinarySeq) this.stats.reordered++;
        this.lastBinarySeq = Math.max(this.lastBinarySeq, seq);
        deliver();
      });
    }
  }

  private schedule(ms: number, fn: () => void): void {
    this.inFlight++;
    this.stats.maxInFlight = Math.max(this.stats.maxInFlight, this.inFlight);
    this.timers.setTimeout(() => {
      this.inFlight--;
      this.stats.delivered++;
      fn();
    }, ms);
  }
}

export interface NetsimLink {
  up: NetStats;
  down: NetStats;
}

/** Wrap `inner` so everything through it sees `conditions` (which may change live). */
export class NetsimTransport implements Transport {
  readonly links: NetsimLink[] = [];

  constructor(
    private readonly inner: Transport,
    public conditions: NetConditions,
    private readonly rng: Rng,
    private readonly timers: Timers,
  ) {}

  open(url: string, handlers: TransportHandlers): Connection {
    const cond = () => this.conditions;
    const up = new Lane(cond, this.rng, this.timers);
    const down = new Lane(cond, this.rng, this.timers);
    this.links.push({ up: up.stats, down: down.stats });
    let closed = false;
    const conn = this.inner.open(url, {
      // Open and close travel like control messages, in order with them.
      onOpen: () => down.control(() => !closed && handlers.onOpen()),
      onText: (text) => down.control(() => !closed && handlers.onText(text), text.length),
      onBinary: (data) => down.binary(() => !closed && handlers.onBinary(data), data.byteLength),
      onClose: (code, reason) =>
        down.control(() => {
          if (closed) return;
          closed = true;
          handlers.onClose(code, reason);
        }),
    });
    return {
      sendText: (text) => up.control(() => conn.sendText(text), text.length),
      sendBinary: (data) => up.binary(() => conn.sendBinary(data), data.byteLength),
      get bufferedAmount() {
        return conn.bufferedAmount;
      },
      close: (code, reason) => up.control(() => conn.close(code, reason)),
    };
  }
}
