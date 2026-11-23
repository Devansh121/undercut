import { expect, it } from 'vitest';
import { FULL_RACE_FUEL, raceStartFuel } from '../src/rules';

// No refuelling in the modelled era: a race's fuel is the load it starts with. The game's
// start load is the full-distance load (doc 4.3: about 105 kg over the circuit's race laps)
// scaled to the race's laps, plus one lap in hand.

it('carries fuel for the distance and a lap in hand', () => {
  // Monza, 53 laps: 1.98 kg a lap.
  expect(raceStartFuel(5, 53)).toBeCloseTo((FULL_RACE_FUEL * 6) / 53, 9);
  // Full distance: the full load and one lap more, never past the tank.
  expect(raceStartFuel(53, 53)).toBeCloseTo((FULL_RACE_FUEL * 54) / 53, 9);
  expect(raceStartFuel(200, 53)).toBe(110);
});
