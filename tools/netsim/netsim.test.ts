import { createRng } from '@undercut/core';
import { describe, expect, it } from 'vitest';
import type { Connection, Timers, Transport, TransportHandlers } from '@undercut/protocol';
import { NO_IMPAIRMENT, NetsimTransport } from './netsim';

class FakeTimers implements Timers {
  t = 0;
  private q: { at: number; fn: () => void; seq: number }[] = [];
  private seq = 0;
  now = () => this.t;
  setTimeout = (fn: () => void, ms: number) => {
    const e = { at: this.t + ms, fn, seq: this.seq++ };
    this.q.push(e);
    return e;
  };
  clearTimeout = (h: unknown) => {
    this.q = this.q.filter((e) => e !== h);
  };
  run(until: number) {
    for (;;) {
      this.q.sort((a, b) => a.at - b.at || a.seq - b.seq);
      const e = this.q[0];
      if (!e || e.at > until) break;
      this.q.shift();
      this.t = e.at;
      e.fn();
    }
    this.t = until;
  }
}

/** An inner transport that echoes every message straight back. */
function echo(): Transport {
  return {
    open(_url: string, h: TransportHandlers): Connection {
      h.onOpen();
      return {
        sendText: (t) => h.onText(t),
        sendBinary: (d) => h.onBinary(d),
        bufferedAmount: 0,
        close: (code) => h.onClose(code ?? 1000, ''),
      };
    },
  };
}

function setup(conditions: Partial<typeof NO_IMPAIRMENT>) {
  const timers = new FakeTimers();
  const net = new NetsimTransport(
    echo(),
    { ...NO_IMPAIRMENT, ...conditions },
    createRng(1),
    timers,
  );
  const texts: { t: number; text: string }[] = [];
  const bins: { t: number; n: number }[] = [];
  const conn = net.open('x', {
    onOpen: () => {},
    onText: (text) => texts.push({ t: timers.t, text }),
    onBinary: (d) => bins.push({ t: timers.t, n: d[0] as number }),
    onClose: () => {},
  });
  return { timers, net, conn, texts, bins };
}

describe('NetsimTransport', () => {
  it('delays each way by the latency', () => {
    const { timers, conn, texts } = setup({ latencyMs: 100 });
    timers.run(1);
    conn.sendText('a');
    timers.run(1000);
    expect(texts).toEqual([{ t: 201, text: 'a' }]);
  });

  it('keeps control messages in order and turns loss into delay', () => {
    const { timers, conn, texts, net } = setup({
      latencyMs: 50,
      jitterMs: 40,
      loss: 0.3,
      retransmitMs: 200,
    });
    for (let i = 0; i < 200; i++) {
      conn.sendText(String(i));
      timers.run(timers.t + 5);
    }
    timers.run(10_000);
    expect(texts.map((x) => Number(x.text))).toEqual(Array.from({ length: 200 }, (_, i) => i));
    expect(net.links[0]!.up.dropped).toBe(0);
    const delays = texts.map((x, i) => x.t - i * 5);
    expect(Math.max(...delays)).toBeGreaterThanOrEqual(200);
  });

  it('drops, duplicates and reorders binary frames at the configured rates', () => {
    const { timers, conn, bins, net } = setup({
      latencyMs: 150,
      jitterMs: 50,
      loss: 0.02,
      duplicate: 0.01,
    });
    const n = 20_000;
    for (let i = 0; i < n; i++) {
      conn.sendBinary(new Uint8Array([i % 256]));
      timers.run(timers.t + 33);
    }
    timers.run(timers.t + 10_000);
    const { up, down } = net.links[0]!;
    const lossRate = (up.dropped + down.dropped) / (2 * n);
    expect(lossRate).toBeGreaterThan(0.015);
    expect(lossRate).toBeLessThan(0.025);
    expect(up.duplicated).toBeGreaterThan(n * 0.005);
    expect(up.reordered + down.reordered).toBeGreaterThan(0);
    // Each frame takes 100..200 ms each way.
    expect(bins.length).toBeGreaterThan(n * 0.95);
    expect(up.maxInFlight).toBeLessThan(10);
  });
});
