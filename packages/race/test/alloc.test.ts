import { constants, PerformanceObserver } from 'node:perf_hooks';
import v8 from 'node:v8';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { RaceControl } from '../src/control';
import { createFacts } from '../src/facts';
import { RAIL_CIRCUIT, STEP } from './rails';

// Review of #15 item 13: a tick with nothing to report allocates nothing. Twenty cars on rails
// run as a pack at one speed (positions never change) through the 160 m of the rail loop that
// has no timing line, speed trap or DRS line; every system still runs every tick.
//
// The measurement is judged by one function, and the same judge is shown to reject three
// injected faults (second review: the first version of this test read its collection counts
// before the runtime had delivered them, so it could not fail).

const N = 20;
const V = 50;
const L = RAIL_CIRCUIT.length;
const T = RAIL_CIRCUIT.timingLine;

v8.setFlagsFromString('--expose-gc');
const gc = runInNewContext('gc') as (options?: { type?: string; execution?: string }) => void;
const newSpaceUsed = () =>
  v8.getHeapSpaceStatistics().find((s) => s.space_name === 'new_space')?.space_used_size ?? NaN;

interface Window {
  grown: number;
  quiet: number;
  noisy: number;
  t0: number;
  t1: number;
  /** Minor collections inside the window, counted after the runtime delivered them. */
  scavenges: number;
}

/** What an injected fault does on every measured tick (null: nothing). */
type Inject = ((sink: { value: unknown }, k: number) => void) | null;

/** Twenty rail cars through the quiet stretch on five laps; per-window growth and collections. */
async function measure(inject: Inject): Promise<Window[]> {
  v8.setFlagsFromString('--no-concurrent-recompilation');
  const control = new RaceControl({
    circuit: {
      ...RAIL_CIRCUIT,
      grid: Array.from({ length: N }, (_, i) => ({ s: 990 - 8 * i, d: 0 })),
    },
    session: { kind: 'race', laps: 500 },
    entrants: Array.from({ length: N }, (_, i) => ({ team: i >> 1 })),
    seed: 1,
  });
  const facts = Array.from({ length: N }, () => createFacts());
  const start = Float64Array.from({ length: N }, (_, i) => 40 - 8 * i);
  // The harness keeps its numbers in typed arrays and passes none around, so it allocates
  // nothing itself: [sim time, the pack front's distance into its lap].
  const st = new Float64Array(2);
  const counts = new Int32Array(2); // quiet, noisy
  const measuring = new Int32Array(1);
  const sink: { value: unknown } = { value: null };
  // The step and the clock as locals: an imported binding is a module getter under Vite.
  const step = STEP;
  const clock = { time: 0 };
  const place = () => {
    const out = control.lightsOutAt;
    const u = out === null ? 0 : st[0]! - out;
    for (let i = 0; i < N; i++) {
      const f = facts[i]!;
      const d = start[i]! + V * u;
      f.s = (((T + d) % L) + L) % L;
      f.speed = u > 0 ? V : 0;
    }
    const d0 = start[0]! + V * u;
    st[1] = ((d0 % L) + L) % L;
  };
  place();
  // Tick until a condition holds, checked inline (no closures returning numbers per tick).
  const UNTIL_TIME = 0;
  const UNTIL_FRONT_ABOVE = 1;
  const UNTIL_FRONT_BETWEEN = 2;
  const UNTIL_GREEN = 3;
  const run = (mode: number, a: number, b: number) => {
    for (;;) {
      if (mode === UNTIL_TIME && st[0]! >= a) break;
      if (mode === UNTIL_FRONT_ABOVE && st[1]! > a) break;
      if (mode === UNTIL_FRONT_BETWEEN && st[1]! > a && st[1]! < b) break;
      if (mode === UNTIL_GREEN && control.lightsOutAt !== null) break;
      st[0] = st[0]! + step;
      clock.time = st[0]!;
      place();
      const e = control.tick(clock, facts);
      if (inject !== null && measuring[0] === 1) inject(sink, counts[0]!);
      if (e.length === 0) counts[0]! += 1;
      else counts[1]! += 1;
    }
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
  // Lights out, then five laps so every path is compiled and every buffer exists.
  run(UNTIL_GREEN, 0, 0);
  run(UNTIL_TIME, control.lightsOutAt! + 5 * (L / V), 0);
  // Collect earlier garbage, then settle for two laps (a full collection can throw away
  // optimised code; until it is re-optimised the interpreter boxes numbers).
  gc();
  run(UNTIL_TIME, st[0]! + 2 * (L / V), 0);
  // The quiet stretch on five consecutive laps: the pack's back clear of the sector line at
  // s = 300 (dist 350), its front short of the one at s = 650 (dist 700).
  const windows: Window[] = [];
  for (let w = 0; w < 5; w++) {
    run(UNTIL_FRONT_BETWEEN, 505, 520);
    run(UNTIL_FRONT_ABOVE, 560, 0);
    counts.fill(0);
    measuring[0] = 1;
    const t0 = performance.now();
    const before = newSpaceUsed();
    run(UNTIL_FRONT_ABOVE, 690, 0);
    const grown = newSpaceUsed() - before;
    const t1 = performance.now();
    measuring[0] = 0;
    windows.push({ grown, quiet: counts[0]!, noisy: counts[1]!, t0, t1, scavenges: 0 });
  }
  v8.setFlagsFromString('--concurrent-recompilation');
  // Collection entries are delivered asynchronously: wait for them before counting.
  await new Promise((r) => setTimeout(r, 100));
  observer.disconnect();
  for (const x of windows) x.scavenges = scavenges.filter((t) => t >= x.t0 && t <= x.t1).length;
  void sink.value;
  return windows;
}

/**
 * The judgement. A window in which any collection happened cannot vouch for anything (its
 * growth is meaningless, even negative), so only collection-free windows count, and at least
 * one is needed. The best of those must stay under the bound: the heap-statistics call accounts
 * for about 2 kB, one boxed number per tick would be 16 bytes a tick, about 10 kB a window.
 * An allocation in the engine happens on every quiet tick, so it shows in every window; taking
 * the best only filters a window that lands while the runtime re-tiers code.
 */
function verdict(windows: readonly Window[]): { ok: boolean; reason: string } {
  for (const x of windows) {
    if (x.noisy !== 0)
      return { ok: false, reason: `${x.noisy} ticks with events in a quiet window` };
    if (x.quiet < 500) return { ok: false, reason: `only ${x.quiet} quiet ticks in a window` };
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
    return {
      ok: false,
      reason: `${best.grown} bytes in ${best.quiet} quiet ticks (best clean window)`,
    };
  }
  return { ok: true, reason: `${best.grown} bytes in ${best.quiet} quiet ticks, no collection` };
}

describe('cost', () => {
  it('does not allocate on quiet ticks in steady state', async () => {
    const result = verdict(await measure(null));
    expect(result.ok, result.reason).toBe(true);
  }, 60_000);

  it('the same judgement rejects injected faults (self-check)', async () => {
    // A large array every tick (collections in every window).
    const big = verdict(
      await measure((sink, k) => {
        sink.value = new Array<number>(10000).fill(k);
      }),
    );
    expect(big.ok, big.reason).toBe(false);
    // One small object every tick (no collection needed to see it: growth over the bound).
    const small = verdict(
      await measure((sink, k) => {
        sink.value = { k };
      }),
    );
    expect(small.ok, small.reason).toBe(false);
    // A synchronous minor collection every tick and no allocation: only the counts can see it.
    const collect = verdict(
      await measure(() => {
        gc({ type: 'minor', execution: 'sync' });
      }),
    );
    expect(collect.ok, collect.reason).toBe(false);
    expect(collect.reason).toMatch(/minor collection in every window/);
  }, 120_000);
});
