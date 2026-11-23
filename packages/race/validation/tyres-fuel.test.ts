import { describe, expect, it } from 'vitest';
import { compoundIndex } from '@undercut/sim';
import { raceStartFuel } from '../src/rules';
import type { RaceSession } from '../src/session/session';
import { aiSession, runRace } from './lib/runner';

// Physics job: tyres and fuel in a race on the real sim. With `tyres` the session fits each
// car's starting compound (the entrant's, else medium) and turns the condition model on; a pit
// stop that changes tyres fits a fresh set of the new compound. With `startFuel` the cars carry
// a start load that burns down: there is no refuelling in the modelled era.

const K = 273.15;
const spec = { kind: 'race' as const, laps: 3 };

/** Ask car 1 in once on lap 1, for hards. */
function askIn(s: RaceSession): void {
  const c = s.control;
  if (c.racing(1) && c.timer(1).lap >= 1 && c.cars[1]!.pitStops === 0 && !c.pitRequested(1)) {
    s.requestPit(1, [{ kind: 'tyres', compound: 'hard' }]);
  }
}

describe('a race with tyres and a start fuel load', () => {
  it('fits the starting compound off the blankets, and nothing without the option', () => {
    const plain = aiSession(spec, { cars: 2, seed: 1 });
    expect(plain.worldCar(0).state.tyreCompound).toBe(-1);
    const s = aiSession(spec, { cars: 2, seed: 1, tyres: true, compound: 'soft' });
    for (let i = 0; i < 2; i++) {
      const st = s.worldCar(i).state;
      expect(st.tyreCompound).toBe(compoundIndex('soft'));
      expect(Array.from(st.tyreTemp)).toEqual([K + 70, K + 70, K + 70, K + 70]);
    }
    expect(s.control.cars[0]!.compound).toBe('soft');
  });

  it('a stop fits a fresh set of the new compound; the start load burns down', () => {
    const s = aiSession(spec, { cars: 3, seed: 4, tyres: true, startFuel: 30 });
    let worn = 0;
    let fitted = false;
    const fuel: number[] = [];
    while (!s.ended && s.time < 600) {
      askIn(s);
      const st = s.worldCar(1).state;
      if (s.control.pitPhase(1) === 'service') worn = Math.max(worn, st.tyreWear[2]!);
      for (const e of s.tick()) {
        if (e.type === 'lap' && e.car === 0) fuel.push(s.worldCar(0).state.fuelMass);
        if (e.type === 'pit' && e.car === 1 && e.stage === 'serviceEnd') {
          fitted = true;
          expect(st.tyreCompound).toBe(compoundIndex('hard'));
          expect(Array.from(st.tyreWear)).toEqual([0, 0, 0, 0]);
          expect(st.tyreTemp[0]).toBe(K + 70);
        }
      }
    }
    expect(fitted).toBe(true);
    // The set that came off had run a lap.
    expect(worn).toBeGreaterThan(0);
    const r = s.result();
    expect(r.entries.find((e) => e.car === 1)!.compounds).toEqual(['medium', 'hard']);
    // No top-up at the line: lighter every lap, from 30 kg.
    expect(fuel.length).toBe(3);
    expect(fuel[0]).toBeLessThan(30);
    expect(fuel[1]).toBeLessThan(fuel[0]!);
    expect(fuel[2]).toBeLessThan(fuel[1]!);
  }, 300_000);

  it('a car put back on the track keeps its tyres and its fuel', () => {
    const s = aiSession(spec, { cars: 2, seed: 2, tyres: true, startFuel: 40 });
    while (s.time < 40) s.tick();
    const st = s.worldCar(0).state;
    const before = {
      compound: st.tyreCompound,
      temp: Array.from(st.tyreTemp),
      wear: Array.from(st.tyreWear),
      fuel: st.fuelMass,
    };
    const pose = s.lapPose(s.carFacts(0).s + 50, 0);
    s.placeCar(0, pose.x, pose.z, pose.yaw, 0);
    expect(st.tyreCompound).toBe(before.compound);
    expect(Array.from(st.tyreTemp)).toEqual(before.temp);
    expect(Array.from(st.tyreWear)).toEqual(before.wear);
    expect(st.fuelMass).toBe(before.fuel);
  }, 120_000);

  it('a restored session continues bit-identically with tyres and fuel', () => {
    const o = { cars: 3, seed: 4, tyres: true, startFuel: 30 } as const;
    const a = aiSession(spec, o);
    while (a.time < 45) a.tick();
    const snap = JSON.parse(JSON.stringify(a.snapshot()));
    const b = aiSession(spec, o);
    b.restore(snap);
    for (let k = 0; k < 240 * 10; k++) {
      a.tick();
      b.tick();
    }
    expect(JSON.stringify(b.snapshot())).toBe(JSON.stringify(a.snapshot()));
  }, 120_000);
});

describe('Quick Race at Monza with tyres and a start load', () => {
  // As the game runs it: twenty cars on mediums off the blankets, the start load for five laps
  // and a lap in hand, the racing drivers easing off to the grip their tyres have; here each
  // also stops once for hards around half distance (the nightly soak runs it without stops).
  it('seed 17: clean start, no spins, no stuck cars, every car classified on two compounds', () => {
    const run = runRace({
      cars: 20,
      laps: 5,
      seed: 17,
      tyres: true,
      startFuel: raceStartFuel(5, 53),
    });
    const r = run.result;
    expect(r.anomalies).toEqual([]);
    expect(r.entries.every((e) => e.status === 'finished' && e.laps === 5)).toBe(true);
    expect(r.entries.every((e) => e.compounds.join() === 'medium,hard')).toBe(true);
    expect(run.cars.filter((c) => c.turnOne === 'clean').length).toBeGreaterThanOrEqual(18);
    expect(run.cars.reduce((n, c) => n + c.spins, 0)).toBe(0);
    expect(run.cars.every((c) => c.beyondBarrier <= 0)).toBe(true);
  }, 300_000);
});
