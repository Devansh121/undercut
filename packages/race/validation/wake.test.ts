import { expect, it } from 'vitest';
import { aiSession } from './lib/runner';

it('keeps the opening lap on the measured aero, then gives a following car the tow', () => {
  const session = aiSession({ kind: 'race', laps: 2 }, { cars: 2, seed: 31 });
  while (session.control.phase !== 'green' && session.time < 30) session.tick();
  const line = session.circuit.timingLine;
  for (let i = 0; i < 2; i++) {
    const p = session.lapPose(line - 160 - i * 18, 0);
    session.placeCar(i, p.x, p.z, p.yaw, 70);
  }
  session.tick();
  expect(session.worldCar(1).state.dragScale).toBe(1);
  while (session.control.timer(1).lap < 2 && !session.ended && session.time < 400) session.tick();
  expect(session.control.timer(1).lap).toBeGreaterThanOrEqual(2);
  // Recreate the same physical tow, so the second assertion tests eligibility rather
  // than whether two drivers of different pace happen to remain close for a whole lap.
  for (let i = 0; i < 2; i++) {
    const p = session.lapPose(line - 160 - i * 18, 0);
    session.placeCar(i, p.x, p.z, p.yaw, 70);
  }
  session.tick();
  expect(session.worldCar(1).state.dragScale).toBeLessThan(1);
});

it('withdraws the tow from the field while a stopped car remains on the racing surface', () => {
  const session = aiSession({ kind: 'race', laps: 2 }, { cars: 3, seed: 31 });
  while (session.control.timer(1).lap < 2 && !session.ended && session.time < 400) session.tick();
  expect(session.control.timer(1).lap).toBeGreaterThanOrEqual(2);
  const line = session.circuit.timingLine;
  for (let i = 0; i < 2; i++) {
    const p = session.lapPose(line - 160 - i * 18, 0);
    session.placeCar(i, p.x, p.z, p.yaw, 70);
  }
  const hazard = session.lapPose(line + 500, 0);
  session.placeCar(2, hazard.x, hazard.z, hazard.yaw, 0);
  session.tick();
  expect(session.worldCar(1).state.dragScale).toBe(1);
  session.placeCar(2, hazard.x, hazard.z, hazard.yaw, 70);
  session.tick();
  expect(session.worldCar(1).state.dragScale).toBeLessThan(1);
});
