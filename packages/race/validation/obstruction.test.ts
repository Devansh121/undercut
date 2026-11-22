import { describe, expect, it } from 'vitest';
import { DEFAULT_RACE_SKILL, createRaceDriver, type Driver, type TrafficView } from '@undercut/ai';
import { createCarParams, type CarTelemetry, type ControlInput } from '@undercut/sim';
import { MONZA, loadEnvelope, loadLine } from '../../ai/validation/lib/index';
import { AiController } from '../src/session/controllers';
import { RaceSession } from '../src/session/session';
import { entrantsFor } from './lib/runner';

// A car stopped in the road (crashed, parked, a player holding the brake) must not stop the
// race: the field goes round it, in a corner as on a straight, without touching it or each
// other, long before the rules retire it as stuck (60 s) and park it out of the race as a ghost.
// The review's case was every car queueing behind one car stopped at Ascari until all of them
// retired.

const track = MONZA.track();
const line = loadLine(MONZA);
const envelope = loadEnvelope(MONZA);
const params = createCarParams(MONZA.trim);
const CARS = 12;

/** A racing driver that, once told to, stands on the brakes where it is and stays there. */
class Stopper implements Driver {
  readonly name = 'stopper';
  parked = false;
  constructor(private readonly inner: Driver) {}
  get ersMode() {
    return this.inner.ersMode;
  }
  get following() {
    return this.inner.following === true;
  }
  sense(v: TrafficView): void {
    this.inner.sense?.(v);
  }
  reset(): void {
    this.inner.reset();
  }
  snapshot() {
    return this.inner.snapshot();
  }
  restore(m: ReturnType<Driver['snapshot']>): void {
    this.inner.restore(m);
  }
  drive(t: CarTelemetry, dt: number, out: ControlInput): ControlInput {
    this.inner.drive(t, dt, out);
    if (this.parked) {
      out.throttle = 0;
      out.brake = 1;
      out.steer = 0;
      out.overtake = false;
    }
    return out;
  }
}

interface Outcome {
  /** Seconds from reaching 60 m behind the stopped car to 10 m past it, per car. */
  waits: number[];
  /** Cars past it before the rules retired it. */
  pastBeforeRetired: number;
  contactTicks: number;
  allOffTicks: number;
  finished: number;
}

/** Stop car 0 at lap position (s, d) just before the field gets there; run to the flag. */
function stopIn(s: number, d: number, seed: number): Outcome {
  const stopper = new Stopper(
    createRaceDriver({ track, line, envelope, params, skill: { ...DEFAULT_RACE_SKILL, seed } }),
  );
  const drivers: Driver[] = [stopper];
  for (let i = 1; i < CARS; i++) {
    drivers.push(
      createRaceDriver({
        track,
        line,
        envelope,
        params,
        skill: { ...DEFAULT_RACE_SKILL, seed: seed + i },
      }),
    );
  }
  const entrants = entrantsFor(CARS);
  const session = new RaceSession({
    track,
    session: { kind: 'race', laps: 2 },
    seed,
    params,
    cars: drivers.map((driver, i) => ({
      entrant: entrants[i]!,
      controller: new AiController({ driver, params, reaction: 0.25 + 0.02 * i }),
      ersMode: driver.ersMode,
    })),
  });
  const c = session.control;
  const L = track.length;
  const ahead = (a: number, b: number) => {
    let x = (b - a) % L;
    if (x > L / 2) x -= L;
    else if (x <= -L / 2) x += L;
    return x;
  };
  const near = new Array<number | null>(CARS).fill(null);
  const past = new Array<number | null>(CARS).fill(null);
  let retiredAt: number | null = null;
  let contactTicks = 0;
  let allOffTicks = 0;
  while (!session.ended && session.time < 900) {
    session.tick();
    if (!stopper.parked) {
      // Park it once the field has spread out (a minute in), as the first of the others comes
      // within 400 to 600 m of the spot.
      const coming = drivers.some((_, i) => {
        if (i === 0) return false;
        const g = ahead(session.carFacts(i).s, s);
        return g > 400 && g < 600;
      });
      if (c.phase === 'green' && session.time > 60 && coming) {
        const pose = session.lapPose(s, d);
        session.placeCar(0, pose.x, pose.z, pose.yaw, 0);
        stopper.parked = true;
      }
      continue;
    }
    if (retiredAt === null && c.cars[0]!.status === 'dnf') retiredAt = session.time;
    const s0 = session.carFacts(0).s;
    for (let i = 1; i < CARS; i++) {
      const f = session.carFacts(i);
      const ds = ahead(s0, f.s);
      if (near[i] === null && ds > -60 && ds < 0) near[i] = session.time;
      if (near[i] !== null && past[i] === null && ds > 10 && ds < 200) past[i] = session.time;
      if (f.wheelsOff >= 4 && f.speed > 5) allOffTicks++;
    }
    for (let i = 0; i < CARS; i++) if (session.worldCar(i).state.carContacts > 0) contactTicks++;
  }
  const waits = past.slice(1).map((t, k) => (t !== null ? t - near[k + 1]! : Infinity));
  return {
    waits,
    pastBeforeRetired: past
      .slice(1)
      .filter((t) => t !== null && (retiredAt === null || t < retiredAt)).length,
    contactTicks,
    allOffTicks,
    finished: c.cars.slice(1).filter((x) => x.status === 'finished').length,
  };
}

describe('a car stopped in the road', () => {
  it('at Ascari, on the centreline: the field goes round it, untouched, and finishes', () => {
    const o = stopIn(3679, 0, 61);
    expect(o.pastBeforeRetired).toBe(CARS - 1);
    expect(Math.max(...o.waits)).toBeLessThan(20);
    expect(o.contactTicks).toBe(0);
    expect(o.allOffTicks).toBe(0);
    expect(o.finished).toBe(CARS - 1);
  }, 300_000);

  it('at the first chicane apex, on the line: the field goes round it, untouched, and finishes', () => {
    // s = 610 m: the right-hander's tightest point, the racing line through it at d = 0.1 m.
    const o = stopIn(610, 0.1, 71);
    expect(o.pastBeforeRetired).toBe(CARS - 1);
    expect(Math.max(...o.waits)).toBeLessThan(20);
    expect(o.contactTicks).toBe(0);
    expect(o.allOffTicks).toBe(0);
    expect(o.finished).toBe(CARS - 1);
  }, 300_000);
});
