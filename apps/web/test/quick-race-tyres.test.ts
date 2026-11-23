import { expect, it } from 'vitest';
import { NEUTRAL_INPUT, compoundIndex } from '@undercut/sim';
import { raceStartFuel } from '@undercut/race';
import { DriveSession, TIME_TRIAL_FUEL } from '../src/game/session';
import { loadMonza } from './fixtures';

// A Quick Race models tyres and burns a start load; time trial keeps the reference tyre and the
// light load topped up at the line, as its records were set.

it('a Quick Race fits every car with the starting compound and the start load for its laps', () => {
  const s = new DriveSession({
    track: loadMonza(),
    seed: 1,
    quickRace: { laps: 3, compound: 'soft' },
  });
  const fuel = raceStartFuel(3, 53);
  for (let i = 0; i < 20; i++) {
    const st = s.race.worldCar(i).state;
    expect(st.tyreCompound).toBe(compoundIndex('soft'));
    expect(st.fuelMass).toBeCloseTo(fuel, 9);
  }
  s.start();
  s.scriptedRaceDriver = true;
  for (let i = 0; i < 240 * 30; i++) s.tick(NEUTRAL_INPUT, 'keyboard');
  // Burning, never topped up.
  expect(s.car.state.fuelMass).toBeLessThan(fuel);
  expect(s.car.state.tyreWear[2]).toBeGreaterThan(0);
}, 60_000);

it('time trial keeps the reference tyre and the light, topped-up load', () => {
  const s = new DriveSession({ track: loadMonza(), seed: 1 });
  expect(s.car.state.tyreCompound).toBe(-1);
  expect(s.car.state.fuelMass).toBe(TIME_TRIAL_FUEL);
});
