/// <reference types="node" />
import { constants, PerformanceObserver } from 'node:perf_hooks';
import v8 from 'node:v8';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import {
  FLAT_SURFACE,
  NEUTRAL_INPUT,
  REFERENCE_CAR,
  createCarState,
  createEnvironment,
  fitTyres,
  stepCar,
  updateTyres,
} from '../src/index';

// The tyre update (temperature, wear and grip of each tyre, every step) allocates nothing once
// warm. (The car's own step on the flat test surface is measured elsewhere: its sampler does.) Judged as car-contact-alloc.test.ts judges the contact solver, and the same judge
// is shown to reject injected faults.

v8.setFlagsFromString('--expose-gc');
const gc = runInNewContext('gc') as (options?: { type?: string; execution?: string }) => void;
const newSpaceUsed = () =>
  v8.getHeapSpaceStatistics().find((s) => s.space_name === 'new_space')?.space_used_size ?? NaN;

interface Window {
  grown: number;
  t0: number;
  t1: number;
  scavenges: number;
}

type Inject = ((sink: { value: unknown }, k: number) => void) | null;

async function measure(inject: Inject): Promise<Window[]> {
  const env = createEnvironment();
  const car = createCarState(REFERENCE_CAR, { speed: 40, fuel: 50 });
  fitTyres(car, 'medium');
  // A car cornering, so every tyre has load, slip and force; then only the tyre update runs.
  const input = { ...NEUTRAL_INPUT, throttle: 0.35, steer: 0.18 };
  for (let k = 0; k < 2400; k++) stepCar(car, input, FLAT_SURFACE, 1 / 240, env);
  const sink: { value: unknown } = { value: null };
  const once = (k: number, measuring: boolean) => {
    updateTyres(car, 1 / 240);
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
    windows.push({ grown, t0, t1: performance.now(), scavenges: 0 });
  }
  await new Promise((r) => setTimeout(r, 100));
  observer.disconnect();
  for (const x of windows) x.scavenges = scavenges.filter((t) => t >= x.t0 && t <= x.t1).length;
  void sink.value;
  return windows;
}

/** Only collection-free windows count; the best must stay under 4 kB (2000 updates). */
function verdict(windows: readonly Window[]): { ok: boolean; reason: string } {
  const clean = windows.filter((x) => x.scavenges === 0);
  if (clean.length === 0) {
    return {
      ok: false,
      reason: `a minor collection in every window (${windows.map((x) => x.scavenges).join(', ')})`,
    };
  }
  const best = clean.reduce((a, b) => (b.grown < a.grown ? b : a));
  if (!(best.grown >= 0 && best.grown < 4 * 1024)) {
    return { ok: false, reason: `${best.grown} bytes in 2000 updates (best clean window)` };
  }
  return { ok: true, reason: `${best.grown} bytes in 2000 updates` };
}

describe('tyre condition cost', () => {
  it('the tyre update allocates nothing once warm', async () => {
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
