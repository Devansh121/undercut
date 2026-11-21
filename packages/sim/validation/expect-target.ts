import { expect } from 'vitest';
import { KNOWN_GAPS, TARGETS, gapSlack, outside } from './lib/index';

/** Test name for a target: its label and band, or the recorded gap. */
export function targetName(id: string): string {
  const t = TARGETS[id]!;
  const gap = KNOWN_GAPS[id];
  const base = `${t.label}: ${t.stated} ${t.unit}`;
  return gap ? `${base} (known gap: measured ${gap.measured} ${t.unit})` : base;
}

/**
 * Assert a measured value against its doc target. For a recorded gap, assert that the gap is
 * still there and has not moved: the test goes red when the gap closes or widens, so the
 * Results section and KNOWN_GAPS get updated together.
 */
export function expectTarget(id: string, value: number): void {
  const t = TARGETS[id];
  if (!t) throw new Error(`unknown target ${id}`);
  const gap = KNOWN_GAPS[id];
  if (gap) {
    expect(
      outside(t, value),
      `${id}: the gap has closed (${value.toFixed(3)} is inside ${t.low}–${t.high}); ` +
        'move it from KNOWN_GAPS to passing and update the Results section',
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
