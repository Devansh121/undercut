import { expect } from 'vitest';
import type { RaceRun } from './runner';

/** What every proof race must show (the Quick Race acceptance). */
export function expectCleanRace(run: RaceRun, laps: number): void {
  const r = run.result;
  // Every car classified or retired for a reason; none stuck.
  expect(r.anomalies).toEqual([]);
  expect(r.entries.every((e) => e.status === 'finished' && e.laps === laps)).toBe(true);
  expect(r.entries.every((e) => e.pitStops === 1)).toBe(true);
  // Turn one survived by at least 18 of 20; nobody past a barrier; no contact that never clears.
  expect(run.cars.filter((c) => c.turnOne === 'clean').length).toBeGreaterThanOrEqual(18);
  expect(run.cars.every((c) => c.beyondBarrier <= 0)).toBe(true);
  expect(run.cars.every((c) => c.longestContact < 5)).toBe(true);
  // Racing, not a procession: cars change places on track and run close.
  expect(run.racing.overtakes).toBeGreaterThan(0);
  expect(run.racing.closestGap).toBeLessThan(0.3);
}
