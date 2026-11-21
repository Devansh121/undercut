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

const N = 20;
const V = 50;
const L = RAIL_CIRCUIT.length;
const T = RAIL_CIRCUIT.timingLine;

describe('cost', () => {
  it('does not allocate on quiet ticks in steady state', async () => {
    v8.setFlagsFromString('--expose-gc');
    v8.setFlagsFromString('--no-concurrent-recompilation');
    const gc = runInNewContext('gc') as () => void;
    const newSpaceUsed = () =>
      v8.getHeapSpaceStatistics().find((s) => s.space_name === 'new_space')?.space_used_size ?? NaN;
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
        if (e.length === 0) counts[0]! += 1;
        else counts[1]! += 1;
      }
    };
    // Lights out, then five laps so every path is compiled and every buffer exists.
    run(UNTIL_GREEN, 0, 0);
    run(UNTIL_TIME, control.lightsOutAt! + 5 * (L / V), 0);
    // Collect earlier tests' garbage, then settle for two laps (a full collection can throw
    // away optimised code; until it is re-optimised the interpreter boxes numbers).
    gc();
    run(UNTIL_TIME, st[0]! + 2 * (L / V), 0);
    // Measure the quiet stretch on five consecutive laps and keep the best. An allocation in
    // the engine happens on every quiet tick, so it shows in every window; a window that lands
    // while code is being re-tiered (the runtime's business, not the engine's) does not hide it.
    const windows: { grown: number; quiet: number; noisy: number; scavenges: number }[] = [];
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
    for (let w = 0; w < 5; w++) {
      // Into the quiet stretch: the pack's back clear of the sector line at s = 300 (dist 350)
      // and its front short of the one at s = 650 (dist 700).
      run(UNTIL_FRONT_BETWEEN, 505, 520);
      run(UNTIL_FRONT_ABOVE, 560, 0);
      counts.fill(0);
      const t0 = performance.now();
      const before = newSpaceUsed();
      run(UNTIL_FRONT_ABOVE, 690, 0);
      const grown = newSpaceUsed() - before;
      const t1 = performance.now();
      windows.push({
        grown,
        quiet: counts[0]!,
        noisy: counts[1]!,
        scavenges: scavenges.filter((t) => t >= t0 && t <= t1).length,
      });
    }
    v8.setFlagsFromString('--concurrent-recompilation');
    await new Promise((r) => setTimeout(r, 50));
    observer.disconnect();
    for (const x of windows) {
      expect(x.noisy, 'ticks with events in the quiet stretch').toBe(0);
      expect(x.quiet).toBeGreaterThan(500);
    }
    const best = windows.reduce((a, b) => (b.grown < a.grown ? b : a));
    // The heap-statistics call itself accounts for about 2 kB. One boxed number per tick would
    // be 16 bytes a tick, about 10 kB over a window: the bound sits well below that.
    expect(
      best.grown,
      `young-generation bytes in ${best.quiet} quiet ticks (best of five)`,
    ).toBeLessThan(4 * 1024);
    expect(best.scavenges, 'scavenges while ticking').toBe(0);
  });
});
