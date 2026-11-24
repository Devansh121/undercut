import { expect, it } from 'vitest';
import { circuitInfo, plannedStops, raceStartFuel } from '../src';
import { aiSession, runSession, RACE_CIRCUITS } from './lib/runner';

// Full distance at Monza: tyre degradation repays a second stop, so the automatic pit wall plans
// two. Three cars, the playable weekend's rules; every car classified on two stops with a
// compound change at each, no stuck cars.
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
  expect(run.result.anomalies).toEqual([]);
  for (const e of run.result.entries) {
    expect(e.status).toBe('finished');
    expect(e.pitStops).toBe(2);
    expect(e.compounds).toEqual(['medium', 'hard', 'medium']);
  }
  expect(s.pitCalls.filter((p) => p.reason !== 'extend')).toHaveLength(6);
}, 1_500_000);
