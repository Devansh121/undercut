import { expect, it } from 'vitest';
import { circuitInfo, plannedStops, raceStartFuel } from '../src';
import { aiSession, runSession, RACE_CIRCUITS } from './lib/runner';

// Full distance at Monza: tyre degradation repays a second stop, so the automatic pit wall plans
// two. Three cars, the playable weekend's rules; every car classified on two stops, the calls
// spread over the field. The watchdog's findings are logged, not asserted: at full-distance fuel
// the drivers leave the road repeatedly (22 findings on this seed, mostly one car off track for
// 10 to 18 s from lap 2), a recorded gap in docs/STATUS.md that is not about the pit wall.
it('monza full distance: the pit wall runs a two-stop race for every car', () => {
  const track = RACE_CIRCUITS.monza.track();
  const info = circuitInfo(track);
  const laps = info.raceLaps;
  const pitLoss = track.pit.length / info.pit.speedLimit + 5;
  expect(plannedStops(laps, info.length / 50, pitLoss)).toBe(2);
  const s = aiSession(
    { kind: 'race', laps, twoCompoundRule: true },
    { cars: 3, seed: 11, tyres: true, startFuel: raceStartFuel(laps, laps) },
  );
  s.pitStrategy = true;
  const run = runSession(s, { pitLap: null, maxTime: 6000 });
  console.warn(
    JSON.stringify({
      simTime: run.simTime,
      calls: s.pitCalls,
      stops: run.result.entries.map((e) => [e.car, e.pitStops, e.compounds]),
      anomalies: run.result.anomalies,
    }),
  );
  expect(s.ended).toBe(true);
  for (const e of run.result.entries) {
    expect(e.status).toBe('finished');
    expect(e.pitStops).toBe(2);
    expect(e.compounds.length).toBeGreaterThanOrEqual(2);
  }
  const stops = s.pitCalls.filter((p) => p.reason !== 'extend');
  expect(stops).toHaveLength(6);
  // Each car's stops near a third and two thirds of the distance (laps 17 to 19 and 35 to 37).
  for (let car = 0; car < 3; car++) {
    const [first, second] = stops.filter((p) => p.car === car).map((p) => p.lap);
    expect(Math.abs(first! - laps / 3)).toBeLessThan(3);
    expect(Math.abs(second! - (2 * laps) / 3)).toBeLessThan(3);
  }
}, 1_500_000);
