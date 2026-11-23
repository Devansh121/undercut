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

describe.each([MONZA, SPA, SINGAPORE])('lap time-loss budget at $id', (setup: CircuitSetup) => {
  let memo: LapBudget | null = null;
  const budget = (): LapBudget => (memo ??= lapBudget(setup, POUHON_G));

  it('accounts for the driven lap and both plans, sector by sector and phase by phase', () => {
    const b = budget();
    for (const which of ['driven', 'plan', 'full'] as const) {
      const total = b.phases[which].flat().reduce((a, x) => a + x, 0);
      expect(Math.abs(total - b.lap[which])).toBeLessThan(0.01);
      b.phases[which].forEach((row, k) => {
        expect(Math.abs(row.reduce((a, x) => a + x, 0) - b.sectors[which][k]!)).toBeLessThan(0.01);
      });
    }
    expect(b.lap.driven).toBeGreaterThan(b.lap.plan);
    expect(b.lap.plan).toBeGreaterThan(b.lap.full);
  });

  it('splits sectors where the lap report times them', () => {
    const b = budget();
    const { result, plan } = referenceLap(setup);
    const report = circuitLapReport(setup.id, result.laps[0]!, plan, setup.controlLine);
    report.sectors.forEach((row, k) => {
      expect(Math.abs(b.sectors.plan[k]! - row.plan)).toBeLessThan(0.005);
      // The driven split reads the trace at the samples; a tick either side of a sector line.
      expect(Math.abs(b.sectors.driven[k]! - row.time)).toBeLessThan(0.02);
    });
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
    ).toBeLessThan(0.01);
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

  it('moves only the phases each term acts in', () => {
    const b = budget();
    const braking = b.sensitivities.find((x) => x.term === 'braking +5 %')!;
    expect(braking.lap).toBeLessThan(0);
    // Braking acts only on the braking limit (the steps between limits move a little too).
    expect(braking.phases[BudgetPhase.Braking]!).toBeLessThan(0.9 * braking.lap + 1e-9);
    for (const ph of [BudgetPhase.Corner, BudgetPhase.Traction, BudgetPhase.Power]) {
      expect(Math.abs(braking.phases[ph]!)).toBeLessThan(0.003);
    }
    expect(b.sensitivities.find((x) => x.term === 'lateral +5 %')!.lap).toBeLessThan(0);
    for (const term of ['no DRS', 'no MGU-K']) {
      expect(b.sensitivities.find((x) => x.term === term)!.lap).toBeGreaterThan(0);
    }
  });
});
