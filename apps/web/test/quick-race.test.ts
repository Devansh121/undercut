import { expect, it } from 'vitest';
import { DriveSession } from '../src/game/session';
import { loadMonza } from './fixtures';
import { NEUTRAL_INPUT } from '@undercut/sim';

it('Quick Race holds twenty cars until lights out and exposes the race event stream', () => {
  const s = new DriveSession({ track: loadMonza(), seed: 1, quickRace: { laps: 1 } });
  expect(s.race.cars).toHaveLength(20);
  expect(s.race.control.phase).toBe('grid');
  expect(s.car.state.vx).toBe(0);
  s.start();
  for (let i = 0; i < 240; i++) s.tick({ ...NEUTRAL_INPUT, throttle: 1 }, 'keyboard');
  expect(s.car.state.vx).toBeCloseTo(0, 2);
  expect(s.race.control.standings()).toHaveLength(20);
  s.scriptedRaceDriver = true;
  for (let i = 0; i < 240 * 12; i++) s.tick(NEUTRAL_INPUT, 'keyboard');
  expect(
    s.raceEvents
      .filter((e) => e.type === 'lights')
      .map((e) => (e.type === 'lights' ? e.count : -1)),
  ).toEqual([1, 2, 3, 4, 5, 0]);
  expect(s.car.state.vx).toBeGreaterThan(10);
}, 20_000);
