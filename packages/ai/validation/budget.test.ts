import { describe, expect, it } from 'vitest';
import { FULL_ENVELOPE } from '../src/envelope/envelope';
import { SpeedProfiler } from '../src/profile/speed-profile';
import { BudgetPhase, lapBudget, type LapBudget } from './lib/budget';
import { MONZA, SINGAPORE, SPA, type CircuitSetup } from './lib/circuits';
import { circuitLapReport, referenceLap } from './lib/report';
import { CIRCUIT_REFERENCE } from './lib/targets';

/**
 * The time-loss budget (docs/physics-validation.md 7.10) is bookkeeping over the reference lap:
 * it must account for every second it reports, its sectors must be the lap report's sectors, and
 * its phases must name the constraint the physics says binds there. Each expectation below is
 * computed independently of the budget's own sector and phase mapping.
 */
// The Pouhon figure only scales one of the budget's what-ifs; measuring it is not under test.
const POUHON_G = 4.594;
const KMH = 1 / 3.6;
/**
 * Floating-point rounding of a lap's worth of sums: a few thousand additions of segment times
 * under 0.1 s each, on a lap of 80–110 s, accumulate under 1e-11 s; 1e-9 s leaves room.
 */
const ROUNDING = 1e-9;

describe.each([MONZA, SPA, SINGAPORE])('lap time-loss budget at $id', (setup: CircuitSetup) => {
  let memo: LapBudget | null = null;
  const budget = (): LapBudget => (memo ??= lapBudget(setup, POUHON_G));

  it('accounts for the driven lap and both plans, sector by sector and phase by phase', () => {
    const b = budget();
    for (const which of ['driven', 'plan', 'full'] as const) {
      // Every second, to rounding: a few thousand additions of times under 0.1 s.
      const total = b.phases[which].flat().reduce((a, x) => a + x, 0);
      expect(Math.abs(total - b.lap[which])).toBeLessThan(ROUNDING);
      b.phases[which].forEach((row, k) => {
        expect(Math.abs(row.reduce((a, x) => a + x, 0) - b.sectors[which][k]!)).toBeLessThan(
          ROUNDING,
        );
      });
    }
    expect(b.lap.driven).toBeGreaterThan(b.lap.plan);
    expect(b.lap.plan).toBeGreaterThan(b.lap.full);
  });

  it('splits sectors exactly on the timing and sector lines', () => {
    const b = budget();
    const { result, plan } = referenceLap(setup);
    const report = circuitLapReport(setup.id, result.laps[0]!, plan, setup.controlLine);
    // The driven sectors are the lap runner's own crossings (interpolated between ticks).
    report.sectors.forEach((row, k) => {
      expect(Math.abs(b.sectors.driven[k]! - row.time)).toBeLessThan(ROUNDING);
    });
    // The planned sectors: the profile's time at each line, interpolated by distance within the
    // segment the line falls in.
    const track = setup.track();
    const p = plan.profile;
    const n = p.time.length;
    const step = track.lap.step;
    const segTime = (i: number): number => (i + 1 < n ? p.time[i + 1]! : p.lapTime) - p.time[i]!;
    const at = (s: number): number => {
      const x = track.wrap(s);
      const i = Math.min(n - 1, Math.floor(x / step));
      const len = (i + 1 < n ? (i + 1) * step : track.length) - i * step;
      return p.time[i]! + (segTime(i) * (x - i * step)) / len;
    };
    const lines = [setup.controlLine, ...Array.from(track.sectors).slice(1)].sort(
      (a, c) =>
        track.forwardDistance(setup.controlLine, a) - track.forwardDistance(setup.controlLine, c),
    );
    const elapsed = (s: number): number =>
      (((at(s) - at(setup.controlLine)) % p.lapTime) + p.lapTime) % p.lapTime;
    const marks = [0, elapsed(lines[1]!), elapsed(lines[2]!), p.lapTime];
    for (let k = 0; k < 3; k++) {
      expect(Math.abs(b.sectors.plan[k]! - (marks[k + 1]! - marks[k]!))).toBeLessThan(ROUNDING);
      // The lap report rounds each line to the nearest sample: it can differ by at most the
      // time of the segments either side of the two lines.
      const near = (s: number): number => {
        const i = Math.floor(track.wrap(s) / step) % n;
        return segTime(i) + segTime((i + n - 1) % n);
      };
      const bound = near(lines[k]!) + near(lines[(k + 1) % 3]!);
      expect(Math.abs(b.sectors.plan[k]! - report.sectors[k]!.plan)).toBeLessThan(bound);
    }
  });

  it('reconciles the sector gaps with the gap to the pole lap', () => {
    const b = budget();
    const ref = CIRCUIT_REFERENCE[setup.id]!;
    expect(b.published.sectorsAre).toBe(ref.sectorsAre);
    const ideal = ref.sectors.reduce((a, x) => a + x, 0);
    if (ref.sectorsAre === 'pole lap') expect(Math.abs(ideal - ref.reference)).toBeLessThan(1e-9);
    else expect(ref.reference).toBeGreaterThan(ideal);
    const sectorGaps = b.sectors.driven.reduce((a, x, k) => a + x - ref.sectors[k]!, 0);
    expect(
      Math.abs(sectorGaps - b.published.poleOverIdeal - (b.lap.driven - ref.reference)),
    ).toBeLessThan(ROUNDING);
  });

  it('names the constraint the physics says binds', () => {
    const b = budget();
    const p = b.full.profile;
    const n = p.v.length;
    let hardest = 0;
    let fastAccelerating = 0;
    let gripLimited = 0;
    const profiler = new SpeedProfiler(b.full.line, b.full.model);
    for (let i = 0; i < n; i++) {
      if (p.ax[i]! < p.ax[hardest]!) hardest = i;
      // Above 300 km/h the downforce leaves the tyres far more grip than the engine can use.
      if (p.ax[i]! > 0.5 && p.v[i]! > 300 * KMH) {
        fastAccelerating++;
        expect(b.phaseAt[i], `sample ${i}`).toBe(BudgetPhase.Power);
      }
      // Accelerating out of a slow corner while still cornering hard, the grip left over from
      // cornering sets the acceleration: below 150 km/h at 80 % of the lateral grip the
      // combined limit leaves under half the straight-line traction (12–13 m/s² there), well
      // under the full-throttle run (11–13 m/s²). Faster, downforce leaves the tyres more than
      // the engine can use, so the full-throttle run may bind even in a corner.
      if (
        p.ax[i]! > 0.5 &&
        p.v[i]! < 150 * KMH &&
        profiler.lateralUse(i, p.v[i]!, FULL_ENVELOPE) >= 0.8
      ) {
        expect(b.phaseAt[i], `sample ${i}`).not.toBe(BudgetPhase.Power);
        if (b.phaseAt[i] === BudgetPhase.Traction) gripLimited++;
      }
    }
    expect(fastAccelerating).toBeGreaterThan(10);
    expect(b.phaseAt[hardest]).toBe(BudgetPhase.Braking);
    expect(gripLimited).toBeGreaterThan(0);
    // Transitions are the steps between limits: a small share of the lap.
    const transition = b.phases.full.reduce((a, row) => a + row[BudgetPhase.Transition]!, 0);
    expect(transition / b.lap.full).toBeLessThan(0.06);
  });

  it('splits acceleration by the deployment the plan actually had', () => {
    // Where both the engine (with the MGU-K the plan deploys there) and the tyres could set the
    // acceleration, the smaller one binds: read from the envelope itself, at the segment's
    // entry speed, wherever the two differ by more than 2 %.
    const b = budget();
    const p = b.full.profile;
    const m = b.full.model;
    const profiler = new SpeedProfiler(b.full.line, m);
    let checked = 0;
    for (let i = 0; i < p.v.length; i++) {
      const phase = b.phaseAt[i];
      if (phase !== BudgetPhase.Power && phase !== BudgetPhase.Traction) continue;
      const v = p.v[i]!;
      const drs = b.full.drsZone[i] === 1;
      const grade = Math.sin(Math.atan(b.full.line.grade[i]!)) * 9.80665;
      const engine = m.drive(v, drs, b.full.deployMask[i] === 1) - grade;
      const use = profiler.lateralUse(i, v, FULL_ENVELOPE);
      const tyre =
        m.traction(v, profiler.load(i, v)) * b.full.line.grip[i]! * m.remaining(use) -
        m.drag(v, drs) -
        grade;
      if (engine < 0.98 * tyre) expect(phase, `sample ${i}`).toBe(BudgetPhase.Power);
      if (tyre < 0.98 * engine) expect(phase, `sample ${i}`).toBe(BudgetPhase.Traction);
      checked++;
    }
    expect(checked).toBeGreaterThan(100);
    if (setup.id === 'monza') {
      // Review of PR 55: at s = 752.13 m the tyres give 12.08 m/s² and the engine with the
      // MGU-K deploying 13.28 m/s², so the tyres bind (it once read as the full-throttle run).
      const i = Math.round(752.13 / setup.track().lap.step);
      expect(b.phaseAt[i]).toBe(BudgetPhase.Traction);
    }
  });

  it('moves only the phases each term acts in', () => {
    const b = budget();
    const braking = b.sensitivities.find((x) => x.term === 'braking +5 %')!;
    expect(braking.lap).toBeLessThan(0);
    // More braking grip changes the speed only where the braking pass sets it: on the braking
    // limit, and on the first segment after each braking zone, whose entry speed that pass
    // sets (a transition). Every other phase is untouched, to rounding.
    for (const ph of [BudgetPhase.Corner, BudgetPhase.Traction, BudgetPhase.Power]) {
      expect(Math.abs(braking.phases[ph]!)).toBeLessThan(ROUNDING);
    }
    const inBraking =
      braking.phases[BudgetPhase.Braking]! + braking.phases[BudgetPhase.Transition]!;
    expect(Math.abs(inBraking - braking.lap)).toBeLessThan(ROUNDING);
    expect(Math.abs(braking.phases[BudgetPhase.Transition]!)).toBeLessThan(0.001);
    expect(b.sensitivities.find((x) => x.term === 'lateral +5 %')!.lap).toBeLessThan(0);
    for (const term of ['no DRS', 'no MGU-K']) {
      expect(b.sensitivities.find((x) => x.term === term)!.lap).toBeGreaterThan(0);
    }
  });
});
