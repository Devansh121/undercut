/**
 * Lightweight browser-side latency, jitter and packet-loss wrapper for `Transport`, enabled only
 * when `?netSim=latencyMs,jitterMs,lossRate[,seed]` is passed in debug/test builds. Lets
 * two-browser Playwright tests exercise online contact and snapshot smoothing under realistic
 * 50–150 ms latency and 1–2 % snapshot loss.
 */
import { createRng } from '@undercut/core';
import type { Connection, Timers, Transport, TransportHandlers } from '@undercut/protocol';

export interface NetSimConfig {
  /** Mean one-way delay added per leg (outgoing and incoming each add half), ms. */
  latencyMs: number;
  /** Uniform half-width of jitter per leg, ms. */
  jitterMs: number;
  /** Probability of dropping an incoming binary snapshot frame (0..0.5). */
  lossRate: number;
  /** Deterministic RNG seed. */
  seed: number;
}

/** Parse `?netSim=latencyMs,jitterMs,lossRate[,seed]` from a URL query string. */
export function parseNetSim(search: string): NetSimConfig | null {
  const raw = new URLSearchParams(search).get('netSim');
  if (!raw) return null;
  const parts = raw.split(',').map((s) => Number(s.trim()));
  const latencyMs = parts[0];
  if (latencyMs === undefined || !Number.isFinite(latencyMs) || latencyMs < 0) return null;
  const jitterMs = parts[1] !== undefined && Number.isFinite(parts[1]) ? Math.max(0, parts[1]) : 0;
  const lossRate =
    parts[2] !== undefined && Number.isFinite(parts[2])
      ? Math.max(0, Math.min(0.5, parts[2]))
      : 0;
  const seed =
    parts[3] !== undefined && Number.isFinite(parts[3]) ? Math.max(1, Math.trunc(parts[3])) : 1337;
  return { latencyMs: Math.min(1000, latencyMs), jitterMs: Math.min(500, jitterMs), lossRate, seed };
}

/**
 * Wrap `inner` with simulated delay, jitter, and snapshot packet loss. Control (text) frames
 * preserve FIFO order and are never dropped (matching TCP over WebSocket); binary snapshot frames
 * may be dropped at `lossRate` and jittered independently.
 */
export function wrapNetSimTransport(
  inner: Transport,
  config: NetSimConfig,
  timers: Timers,
): Transport {
  const rng = createRng(config.seed);
  const legLatency = config.latencyMs / 2;
  const legJitter = config.jitterMs / 2;
  const sampleDelay = (): number => {
    const j = legJitter > 0 ? (rng.next() * 2 - 1) * legJitter : 0;
    return Math.max(0, Math.round(legLatency + j));
  };

  return {
    open(url: string, handlers: TransportHandlers): Connection {
      let closed = false;
      const pending = new Set<unknown>();
      let inTextHorizon = 0;
      let outTextHorizon = 0;

      const schedule = (ms: number, fn: () => void): void => {
        if (closed) return;
        if (ms <= 0) {
          fn();
          return;
        }
        const id = timers.setTimeout(() => {
          pending.delete(id);
          if (!closed) fn();
        }, ms);
        pending.add(id);
      };

      const cancelAll = (): void => {
        for (const id of pending) timers.clearTimeout(id);
        pending.clear();
      };

      const wrappedHandlers: TransportHandlers = {
        onOpen: () => handlers.onOpen(),
        onText: (text) => {
          const now = timers.now();
          const at = Math.max(inTextHorizon, now + sampleDelay());
          inTextHorizon = at;
          schedule(at - now, () => handlers.onText(text));
        },
        onBinary: (data) => {
          if (config.lossRate > 0 && rng.next() < config.lossRate) return;
          const copy = new Uint8Array(data);
          schedule(sampleDelay(), () => handlers.onBinary(copy));
        },
        onClose: (code, reason) => {
          closed = true;
          cancelAll();
          handlers.onClose(code, reason);
        },
      };

      const conn = inner.open(url, wrappedHandlers);
      return {
        sendText(text) {
          const now = timers.now();
          const at = Math.max(outTextHorizon, now + sampleDelay());
          outTextHorizon = at;
          schedule(at - now, () => conn.sendText(text));
        },
        sendBinary(data) {
          const copy = new Uint8Array(data);
          schedule(sampleDelay(), () => conn.sendBinary(copy));
        },
        get bufferedAmount() {
          return conn.bufferedAmount;
        },
        close(code, reason) {
          closed = true;
          cancelAll();
          conn.close(code, reason);
        },
      };
    },
  };
}
