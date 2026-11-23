import { describe, expect, it } from 'vitest';
import { lapBudget, type LapBudget } from './lib/budget';
import { SINGAPORE } from './lib/circuits';

/**
 * The time-loss budget (docs/physics-validation.md 7.10) is bookkeeping over the reference lap:
 * it must account for every second it reports, and each sensitivity must move only the phases
 * its term acts in.
 */
describe('lap time-loss budget', () => {
  let budget: LapBudget;
  it('accounts for the driven lap and both plans, sector by sector and phase by phase', () => {
    budget = lapBudget(SINGAPORE);
    for (const which of ['driven', 'plan', 'full'] as const) {
      const rows = budget.phases[which];
      const total = rows.flat().reduce((a, b) => a + b, 0);
      expect(Math.abs(total - budget.lap[which])).toBeLessThan(0.01);
      rows.forEach((row, k) => {
        const sector = row.reduce((a, b) => a + b, 0);
        expect(Math.abs(sector - budget.sectors[which][k]!)).toBeLessThan(0.01);
      });
    }
    // The driven lap is the reference lap the physics suite asserts.
    expect(budget.lap.driven).toBeGreaterThan(budget.lap.plan);
    expect(budget.lap.plan).toBeGreaterThan(budget.lap.full);
  });

  it('moves only the phases each term acts in', () => {
    const braking = budget.sensitivities.find((x) => x.term === 'braking +5 %')!;
    expect(braking.lap).toBeLessThan(0);
    // Braking acts only while braking (the other phases move by rounding).
    for (const p of [1, 2, 3]) expect(Math.abs(braking.phases[p]!)).toBeLessThan(1e-3);
    const lateral = budget.sensitivities.find((x) => x.term === 'lateral +5 %')!;
    expect(lateral.lap).toBeLessThan(0);
    for (const term of ['no DRS', 'no MGU-K']) {
      expect(budget.sensitivities.find((x) => x.term === term)!.lap).toBeGreaterThan(0);
    }
  });
});
