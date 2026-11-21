/// <reference types="node" />
import { constants, PerformanceObserver } from 'node:perf_hooks';
import v8 from 'node:v8';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { REFERENCE_CAR, addCar, createWorld, resolveCarContacts } from '../src/index';

// Car-to-car contact allocates nothing per step once warm: twenty cars packed so that most of
// them overlap, put back to the same overlapping state before every resolve, so every call runs
// the broad phase, the narrow phase and the impulses on many pairs. Judged as in
// packages/race/test/alloc.test.ts, and the same judge is shown to reject injected faults.

const N = 20;
v8.setFlagsFromString('--expose-gc');
const gc = runInNewContext('gc') as (options?: { type?: string; execution?: string }) => void;
const newSpaceUsed = () =>
  v8.getHeapSpaceStatistics().find((s) => s.space_name === 'new_space')?.space_used_size ?? NaN;

interface Window {
  grown: number;
  touching: number;
  t0: number;
  t1: number;
  scavenges: number;
}

type Inject = ((sink: { value: unknown }, k: number) => void) | null;

async function measure(inject: Inject): Promise<Window[]> {
  const world = createWorld({ step: 1 / 240, seed: 1 });
  // Two columns, 4.5 m apart along (cars are 5.6 m long) and 1.7 m across (2 m wide).
  for (let k = 0; k < N; k++) {
    addCar(world, REFERENCE_CAR, { x: 4.5 * (k >> 1), z: 1.7 * (k & 1), speed: 30, fuel: 10 });
  }
  const cars = world.cars;
  const state = new Float64Array(N * 6);
  for (let k = 0; k < N; k++) {
    const s = cars[k]!.state;
    state.set([s.x, s.z, s.yaw, s.vx + (k % 3), s.vy, s.yawRate], k * 6);
  }
  const contacts = world.contacts;
  const sink: { value: unknown } = { value: null };
  const touching = new Int32Array(1);
  const once = (k: number, measuring: boolean) => {
    for (let i = 0; i < N; i++) {
      const s = cars[i]!.state;
      const o = i * 6;
      s.x = state[o]!;
      s.z = state[o + 1]!;
      s.yaw = state[o + 2]!;
      s.vx = state[o + 3]!;
      s.vy = state[o + 4]!;
      s.yawRate = state[o + 5]!;
    }
    resolveCarContacts(cars, contacts);
    touching[0] = contacts.touching;
    if (measuring && inject !== null) inject(sink, k);
  };
  const scavenges: number[] = [];
  const observer = new PerformanceObserver((list) => {
    for (const e of list.getEntries()) {
      if (
        (e as unknown as { detail?: { kind?: number } }).detail?.kind ===
        constants.NODE_PERFORMANCE_GC_MINOR
      ) {
        scavenges.push(e.startTime);
      }
    }
  });
  observer.observe({ entryTypes: ['gc'] });
  for (let k = 0; k < 20000; k++) once(k, false);
  gc();
  for (let k = 0; k < 5000; k++) once(k, false);
  const windows: Window[] = [];
  for (let w = 0; w < 5; w++) {
    const t0 = performance.now();
    const before = newSpaceUsed();
    for (let k = 0; k < 2000; k++) once(k, true);
    const grown = newSpaceUsed() - before;
    windows.push({ grown, touching: touching[0]!, t0, t1: performance.now(), scavenges: 0 });
  }
  await new Promise((r) => setTimeout(r, 100));
  observer.disconnect();
  for (const x of windows) x.scavenges = scavenges.filter((t) => t >= x.t0 && t <= x.t1).length;
  void sink.value;
  return windows;
}

/** Only collection-free windows count; the best must stay under 4 kB (2000 resolves). */
function verdict(windows: readonly Window[]): { ok: boolean; reason: string } {
  for (const x of windows) {
    if (x.touching < 10) return { ok: false, reason: `only ${x.touching} touching pairs` };
  }
  const clean = windows.filter((x) => x.scavenges === 0);
  if (clean.length === 0) {
    return {
      ok: false,
      reason: `a minor collection in every window (${windows.map((x) => x.scavenges).join(', ')})`,
    };
  }
  const best = clean.reduce((a, b) => (b.grown < a.grown ? b : a));
  if (!(best.grown >= 0 && best.grown < 4 * 1024)) {
    return { ok: false, reason: `${best.grown} bytes in 2000 resolves (best clean window)` };
  }
  return { ok: true, reason: `${best.grown} bytes in 2000 resolves of ${best.touching} pairs` };
}

describe('car contact cost', () => {
  it('allocates nothing per resolve once warm', async () => {
    const result = verdict(await measure(null));
    expect(result.ok, result.reason).toBe(true);
  }, 60_000);

  it('the same judgement rejects injected faults (self-check)', async () => {
    const small = verdict(await measure((sink, k) => (sink.value = { k })));
    expect(small.ok, small.reason).toBe(false);
    const collect = verdict(await measure(() => gc({ type: 'minor', execution: 'sync' })));
    expect(collect.ok, collect.reason).toBe(false);
  }, 120_000);
});
