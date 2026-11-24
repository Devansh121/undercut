import { expect, it } from 'vitest';
import { raceStartFuel } from '../src';
import { aiSession } from './lib/runner';

// The automatic pit wall's calls in a running race at Monza (two cars, the playable weekend's
// rules): an undercut on a close car ahead, and a stint extended while the car ahead stops.
// Each scripts only the situation (worn tyres, a rival's stop), never the call. Two-stop
// races are the full-distance soak (`strategy-two-stop.soak.test.ts`).

const LAPS = 8;

function race(seed: number) {
  const s = aiSession(
    { kind: 'race', laps: LAPS, twoCompoundRule: true },
    // Car 1 on pole: car 0, whose stop is planned a lap earlier, follows it.
    { cars: 2, seed, tyres: true, startFuel: raceStartFuel(LAPS, 53), grid: [1, 0] },
  );
  s.pitStrategy = true;
  return s;
}

/** The car behind on the road and the one ahead of it. */
function order(s: ReturnType<typeof race>): { behind: number; ahead: number } {
  const c = s.control.cars;
  return c[0]!.dist < c[1]!.dist ? { behind: 0, ahead: 1 } : { behind: 1, ahead: 0 };
}

/** The lap a car's one planned stop falls on (the pit wall's spread over the field). */
const plannedLap = (car: number) => Math.ceil(LAPS / 2) + (car % 3) - 1;

/** Run until `car` has stopped and left the pit lane, watching contact. */
function throughStop(s: ReturnType<typeof race>, car: number): number {
  let contact = 0;
  const begin = s.time;
  while (s.time - begin < 400) {
    s.tick();
    contact = Math.max(
      contact,
      s.worldCar(0).state.carContactSpeed,
      s.worldCar(1).state.carContactSpeed,
    );
    if (s.control.cars[car]!.pitStops === 1 && s.control.pitPhase(car) === 'none') break;
  }
  return contact;
}

it('undercuts a car close ahead on worn tyres, a lap or more before its planned stop', () => {
  const s = race(7);
  const entry = s.circuit.pit.entryS;
  // Lap 2, well before the pit wall's window: the car behind's tyres are half worn.
  while (s.control.timer(0).lap < 2 || s.control.timer(1).lap < 2 || s.carFacts(0).s > entry - 1500)
    s.tick();
  const { behind, ahead } = order(s);
  expect(behind).toBe(0);
  const gap =
    (s.control.cars[ahead]!.dist - s.control.cars[behind]!.dist) / s.carFacts(behind).speed;
  expect(gap).toBeLessThan(3);
  s.worldCar(behind).state.tyreWear.fill(0.5);
  const contact = throughStop(s, behind);
  expect(s.pitCalls[0]).toMatchObject({ car: behind, lap: 2, reason: 'undercut' });
  expect(2).toBeLessThan(plannedLap(behind));
  expect(s.control.cars[behind]!.compounds).toEqual(['medium', 'hard']);
  expect(s.control.cars[ahead]!.pitStops).toBe(0);
  expect(contact).toBe(0);
  expect(s.result().anomalies).toEqual([]);
}, 120_000);

it('extends a healthy stint by a lap while the car ahead stops, then makes its stop', () => {
  const s = race(7);
  const entry = s.circuit.pit.entryS;
  const behind = 0;
  const ahead = 1;
  const lap = plannedLap(behind);
  expect(lap).toBeLessThan(plannedLap(ahead));
  // The follower's planned lap, before the pit wall's window: the leader is called in.
  while (s.control.timer(behind).lap < lap || s.carFacts(behind).s > entry - 1500) s.tick();
  expect(order(s)).toEqual({ behind, ahead });
  expect(Math.max(...s.worldCar(behind).state.tyreWear)).toBeLessThan(0.3);
  s.requestPit(ahead, [{ kind: 'tyres', compound: 'hard' }]);
  const contact = throughStop(s, behind);
  const calls = s.pitCalls.filter((p) => p.car === behind);
  expect(calls).toEqual([
    expect.objectContaining({ lap, reason: 'extend' }),
    expect.objectContaining({ lap: lap + 1, reason: 'planned' }),
  ]);
  expect(s.control.cars[behind]!.compounds).toEqual(['medium', 'hard']);
  expect(contact).toBe(0);
  expect(s.result().anomalies).toEqual([]);
}, 180_000);
