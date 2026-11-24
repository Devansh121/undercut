import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { expect, it } from 'vitest';
import { raceStartFuel, type RaceSessionSnapshot } from '../src';
import { aiSession } from './lib/runner';

// The pit-entry incident of the twenty-car, five-lap Monza race on seed 3141 (scheduled stops,
// `pit-entry.soak.test.ts`), replayed from the race state 12 s before it: a saved snapshot
// (`data/pit-entry-3141.snapshot.json.gz`, taken without the fix), 25 s of racing from there.
//
// Car 12 has a stop called and brakes on the racing line from 62 m/s to 18 m/s for the entry;
// car 14, a second behind, pulls right to pass it on the pit side, and car 12 turns across it
// into the lane. Without the pit entrant in the follower's path (`pitCarInPath`, race.ts) the
// two touch, car 12 is turned round in the lane and the car behind hits it (contacts up to
// 9.2 m/s; wrong way, no progress); with it, car 14 follows car 12 to the entry. (With the rest
// of the field retired the two cars no longer meet, so the field stays.)

const ENTRANT = 12;
const FOLLOWER = 14;

it('seed 3141 replay: the car behind a slowing pit entrant follows it in, without contact', () => {
  const snap = JSON.parse(
    gunzipSync(
      readFileSync(new URL('./data/pit-entry-3141.snapshot.json.gz', import.meta.url)),
    ).toString(),
  ) as RaceSessionSnapshot;
  const s = aiSession(
    { kind: 'race', laps: 5 },
    { cars: 20, seed: 3141, tyres: true, startFuel: raceStartFuel(5, 53) },
  );
  s.restore(snap);
  expect(s.control.pitRequested(ENTRANT)).toBe(true);
  let contact = 0;
  let entered = false;
  const begin = s.time;
  while (s.time - begin < 25) {
    for (const e of s.tick())
      if (e.type === 'pit' && e.car === ENTRANT && e.stage === 'entry') entered = true;
    contact = Math.max(
      contact,
      s.worldCar(ENTRANT).state.carContactSpeed,
      s.worldCar(FOLLOWER).state.carContactSpeed,
    );
  }
  expect(entered).toBe(true);
  expect(contact).toBe(0);
  expect(s.result().anomalies.filter((a) => a.car === ENTRANT || a.car === FOLLOWER)).toEqual([]);
}, 60_000);
