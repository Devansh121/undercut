import { expect } from 'vitest';
import { LAP_GAPS, LAP_TARGETS, gapSlack, outside } from './lib/index';

/** Test name for a lap target: its label and band, or the recorded gap. */
export function lapTargetName(id: string): string {
  const t = LAP_TARGETS[id]!;
  const gap = LAP_GAPS[id];
  const base = `${t.label}: ${t.stated} ${t.unit}`;
  return gap ? `${base} (known gap: measured ${gap.measured} ${t.unit})` : base;
}

/**
 * Assert a measured value against its doc target, as the physics suite does: inside the band,
 * or for a recorded gap, still outside it and within 5 % of the band's half-width of the value
 * recorded (docs/physics-validation.md section 3, rule 2).
 */
export function expectLap(id: string, value: number): void {
  const t = LAP_TARGETS[id];
  if (!t) throw new Error(`unknown target ${id}`);
  const gap = LAP_GAPS[id];
  if (gap) {
    expect(
      outside(t, value),
      `${id}: the gap has closed (${value.toFixed(3)} is inside ${t.low}–${t.high}); ` +
        'move it from LAP_GAPS to passing and update the Results section',
    ).toBeGreaterThan(0);
    expect(
      Math.abs(value - gap.measured),
      `${id}: measured ${value.toFixed(3)}, recorded gap was ${gap.measured}`,
    ).toBeLessThanOrEqual(gapSlack(t));
    return;
  }
  expect(value, `${id}: ${value.toFixed(3)} ${t.unit}, target ${t.stated}`).toBeGreaterThanOrEqual(
    t.low,
  );
  expect(value, `${id}: ${value.toFixed(3)} ${t.unit}, target ${t.stated}`).toBeLessThanOrEqual(
    t.high,
  );
}
