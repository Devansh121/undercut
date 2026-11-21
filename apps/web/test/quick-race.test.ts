import { expect, it } from 'vitest';
import { DriveSession } from '../src/game/session';
import { loadMonza } from './fixtures';
import { NEUTRAL_INPUT } from '@undercut/sim';

it('Quick Race holds twenty cars until lights out and exposes the race event stream', () => {
  const track = loadMonza();
  const s = new DriveSession({ track, seed: 1, quickRace: { laps: 1 } });
  expect(s.race.cars).toHaveLength(20);
  expect(s.race.control.phase).toBe('grid');
  expect(s.car.state.vx).toBe(0);
  expect(s.car.pose.x).toBeCloseTo(track.gridSlots[9]!.x, 4);
  expect(s.car.pose.z).toBeCloseTo(track.gridSlots[9]!.z, 4);
  s.start();
  for (let i = 0; i < 240; i++) s.tick({ ...NEUTRAL_INPUT, throttle: 1 }, 'keyboard');
  expect(s.car.state.vx).toBeCloseTo(0, 2);
  expect(s.race.control.standings()).toHaveLength(20);
  expect(s.race.control.standings().find((r) => r.car === 0)?.position).toBe(10);
  s.scriptedRaceDriver = true;
  for (let i = 0; i < 240 * 12; i++) s.tick(NEUTRAL_INPUT, 'keyboard');
  expect(
    s.raceEvents
      .filter((e) => e.type === 'lights')
      .map((e) => (e.type === 'lights' ? e.count : -1)),
  ).toEqual([1, 2, 3, 4, 5, 0]);
  expect(s.car.state.vx).toBeGreaterThan(10);
}, 20_000);

it('Quick Race respects the requested starting grid position', () => {
  const track = loadMonza();
  const back = new DriveSession({
    track,
    seed: 1,
    quickRace: { laps: 1, gridPosition: 20 },
  });
  expect(back.car.pose.x).toBeCloseTo(track.gridSlots[19]!.x, 4);
  expect(back.car.pose.z).toBeCloseTo(track.gridSlots[19]!.z, 4);
  back.start();
  back.tick(NEUTRAL_INPUT, 'keyboard');
  expect(back.race.control.standings().find((r) => r.car === 0)?.position).toBe(20);
});
