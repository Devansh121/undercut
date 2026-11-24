import { expect, it } from 'vitest';
import { expectCleanRace } from './lib/expect-race';
import { runRace } from './lib/runner';

// Spa with scheduled stops (one each around half distance), twenty cars, five laps. Seed 17
// jammed the pit lane when the pit-lane follower's wheelspin guard kept a high throttle floor
// at speed: 25 watchdog findings, 7 cars stuck, a car facing the wrong way in the lane (review
// of #77). No car may be stuck, and every car finishes on its one stop.
it('spa seed 17, scheduled stops: no stuck cars, every car classified on one stop', () => {
  const run = runRace({ circuit: 'spa', cars: 20, laps: 5, seed: 17 });
  expectCleanRace(run, 5);
  expect(run.result.anomalies).toEqual([]);
  expect(run.result.entries.every((e) => e.status === 'finished' && e.laps === 5)).toBe(true);
  expect(run.result.entries.every((e) => e.pitStops === 1)).toBe(true);
}, 300_000);
