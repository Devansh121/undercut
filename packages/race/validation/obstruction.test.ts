import { describe, expect, it } from 'vitest';
import { DEFAULT_RACE_SKILL, createRaceDriver, type Driver, type TrafficView } from '@undercut/ai';
import { createCarParams, type CarTelemetry, type ControlInput } from '@undercut/sim';
import { MONZA, loadEnvelope, loadLine } from '../../ai/validation/lib/index';
import { AiController } from '../src/session/controllers';
import { RaceSession } from '../src/session/session';
import { entrantsFor } from './lib/runner';

// A car stopped in the road (crashed, parked, a player holding the brake) must not stop the
// race: the field gets past it, in a corner as on a straight, without touching it or each
// other, long before the rules retire it as stuck (60 s) and park it out of the race as a ghost.
// Where there is road beside it the cars go round it; where the line sweeps across the road (the
// chicanes) they stop behind it, and the session makes it a ghost for the queue standing still
// behind it. The review's cases were every car queueing behind one car stopped at Ascari until
// all of them retired, then Biassono, Roggia, the first chicane's edge and the turn-one braking
// zone, where the queue stalled for most of a minute and the cars hurt each other.

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
  /** Seconds from reaching 60 m before the spot where the car stopped to 10 m past it, per car. */
  waits: number[];
  /** Cars past it before the rules retired it. */
  pastBeforeRetired: number;
  contactTicks: number;
  allOffTicks: number;
  /** The same, counted only for cars within 150 m of the spot where it stopped. */
  contactTicksNear: number;
  allOffTicksNear: number;
  finished: number;
  /** The car that stopped took the flag too (it drove on). */
  stopperFinished: boolean;
  /** Cars in the race. */
  cars: number;
  /** The stopped car became a ghost for holding up traffic. */
  ghostFormed: boolean;
  /**
   * When it turned solid again while still racing, s after it was released to drive on (null:
   * never, or not released), and how long it was a ghost, s.
   */
  solidAfterRelease: number | null;
  ghostSeconds: number;
  /** Fastest contact the stopped car had, m/s, from the stop on. */
  stopperMaxContact: number;
  /** Spins (pointing over 0.8 rad off the lap's direction), every car, from the stop on. */
  spins: number;
}

/** A 2-lap race (12 cars unless told) whose car 0 stops on its `Stopper` when told to. */
function build(seed: number, cars = CARS): { session: RaceSession; stopper: Stopper } {
  const stopper = new Stopper(
    createRaceDriver({ track, line, envelope, params, skill: { ...DEFAULT_RACE_SKILL, seed } }),
  );
  const drivers: Driver[] = [stopper];
  for (let i = 1; i < cars; i++) {
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
  const entrants = entrantsFor(cars);
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
  return { session, stopper };
}

/** Signed distance along the lap from a to b, m. */
function ahead(a: number, b: number): number {
  const L = track.length;
  let x = (b - a) % L;
  if (x > L / 2) x -= L;
  else if (x <= -L / 2) x += L;
  return x;
}

/**
 * Park car 0 at lap position (s, d) once the field has spread out (a minute in), as the first of
 * the others comes within 400 to 600 m of the spot. Whether it parked it this tick.
 */
function parkIfComing(session: RaceSession, stopper: Stopper, s: number, d: number): boolean {
  let coming = false;
  for (let i = 1; i < session.cars.length; i++) {
    const g = ahead(session.carFacts(i).s, s);
    if (g > 400 && g < 600) coming = true;
  }
  if (session.control.phase !== 'green' || session.time <= 60 || !coming) return false;
  const pose = session.lapPose(s, d);
  session.placeCar(0, pose.x, pose.z, pose.yaw, 0);
  stopper.parked = true;
  return true;
}

/**
 * Stop car 0 at lap position (s, d) just before the field gets there; run to the flag. With
 * `releaseAfter`, it drives on again after that long stopped (on its racing driver).
 */
function stopIn(s: number, d: number, seed: number, releaseAfter?: number, cars = CARS): Outcome {
  const { session, stopper } = build(seed, cars);
  const c = session.control;
  const n = cars;
  const near = new Array<number | null>(n).fill(null);
  const past = new Array<number | null>(n).fill(null);
  const spinning = new Array<boolean>(n).fill(false);
  let ghostFormed = false;
  let ghostFrom: number | null = null;
  let ghostSeconds = 0;
  let solidAfterRelease: number | null = null;
  let releasedAt: number | null = null;
  let stopperMaxContact = 0;
  let spins = 0;
  let retiredAt: number | null = null;
  let parkedAt: number | null = null;
  let released = false;
  let contactTicks = 0;
  let allOffTicks = 0;
  let contactTicksNear = 0;
  let allOffTicksNear = 0;
  const nearSpot = (car: number) => Math.abs(ahead(s, session.carFacts(car).s)) < 150;
  while (!session.ended && session.time < 900) {
    session.tick();
    if (parkedAt === null) {
      if (parkIfComing(session, stopper, s, d)) parkedAt = session.time;
      continue;
    }
    if (releaseAfter !== undefined && !released && session.time - parkedAt >= releaseAfter) {
      stopper.parked = false;
      released = true;
      releasedAt = session.time;
    }
    if (retiredAt === null && c.cars[0]!.status === 'dnf') retiredAt = session.time;
    if (session.blockingGhost(0)) {
      ghostFormed = true;
      if (ghostFrom === null) ghostFrom = session.time;
    } else if (ghostFrom !== null) {
      ghostSeconds += session.time - ghostFrom;
      ghostFrom = null;
      if (releasedAt !== null && solidAfterRelease === null && c.cars[0]!.status === 'running') {
        solidAfterRelease = session.time - releasedAt;
      }
    }
    stopperMaxContact = Math.max(stopperMaxContact, session.worldCar(0).state.carContactSpeed);
    for (let i = 0; i < n; i++) {
      const off = Math.abs(session.carFacts(i).heading);
      if (off > 0.8 && !spinning[i] && c.cars[i]!.status === 'running') spins++;
      spinning[i] = off > 0.8 ? true : off < 0.3 ? false : spinning[i]!;
    }
    for (let i = 1; i < n; i++) {
      const f = session.carFacts(i);
      // From the spot where it stopped (where it stays, unless it drives on).
      const ds = ahead(s, f.s);
      if (near[i] === null && ds > -60 && ds < 0) near[i] = session.time;
      if (near[i] !== null && past[i] === null && ds > 10 && ds < 200) past[i] = session.time;
      if (f.wheelsOff >= 4 && f.speed > 5) {
        allOffTicks++;
        if (nearSpot(i)) allOffTicksNear++;
      }
    }
    for (let i = 0; i < n; i++) {
      if (session.worldCar(i).state.carContacts === 0) continue;
      contactTicks++;
      if (nearSpot(i)) contactTicksNear++;
    }
  }
  const waits = past.slice(1).map((t, k) => (t !== null ? t - near[k + 1]! : Infinity));
  return {
    waits,
    pastBeforeRetired: past
      .slice(1)
      .filter((t) => t !== null && (retiredAt === null || t < retiredAt)).length,
    contactTicks,
    allOffTicks,
    contactTicksNear,
    allOffTicksNear,
    finished: c.cars.slice(1).filter((x) => x.status === 'finished').length,
    stopperFinished: c.cars[0]!.status === 'finished',
    cars: n,
    ghostFormed,
    solidAfterRelease,
    ghostSeconds: ghostFrom !== null ? ghostSeconds + session.time - ghostFrom : ghostSeconds,
    stopperMaxContact,
    spins,
  };
}

/** Every other car past before the rules retire it, within 20 s, untouched, on the road, home. */
function expectClean(o: Outcome): void {
  expect(o.pastBeforeRetired).toBe(o.cars - 1);
  expect(Math.max(...o.waits)).toBeLessThan(20);
  expect(o.contactTicks).toBe(0);
  expect(o.allOffTicks).toBe(0);
  expect(o.finished).toBe(o.cars - 1);
}

describe('a car stopped in the road', () => {
  it('at Lesmo 2: a mirror check does not trap the field behind the stopped car', () => {
    expectClean(stopIn(2576, 0, 17));
  }, 300_000);

  it('at Ascari, on the centreline: the field goes round it, untouched, and finishes', () => {
    expectClean(stopIn(3679, 0, 61));
  }, 300_000);

  it('at the first chicane apex, on the line: the field gets past it, untouched, and finishes', () => {
    // s = 610 m: the right-hander's tightest point, the racing line through it at d = 0.1 m.
    expectClean(stopIn(610, 0.1, 71));
  }, 300_000);

  it('at the first chicane, on the edge at the apex: the field gets past it, untouched', () => {
    expectClean(stopIn(617, -3.5, 73));
  }, 300_000);

  it('at Biassono, on the line: the field goes round it at speed, untouched', () => {
    expectClean(stopIn(1108, -0.45, 79));
  }, 300_000);

  it('at Roggia, on the line: the field gets past it, untouched', () => {
    expectClean(stopIn(1842, 5.49, 83));
  }, 300_000);

  it('in the turn-one braking zone, on the line: the field goes round it, untouched', () => {
    expectClean(stopIn(500, 1.01, 89));
  }, 300_000);

  it('stopped for 15 s at Biassono and driving on: the train behind gets by, and it rejoins', () => {
    // Once it drives on it races in the train it held up: touches in that race away from the
    // spot (one, 550 m on, at 1.2 m/s) are the racing driver's, not this test's. Round the spot,
    // none.
    const o = stopIn(1108, -0.45, 97, 15);
    expect(o.pastBeforeRetired).toBe(CARS - 1);
    expect(Math.max(...o.waits)).toBeLessThan(20);
    expect(o.contactTicksNear).toBe(0);
    expect(o.allOffTicksNear).toBe(0);
    expect(o.finished).toBe(CARS - 1);
    expect(o.stopperFinished).toBe(true);
  }, 300_000);

  // The review's rear-ends: a ghost that turned solid with a car arriving behind it at racing
  // speed was hit at 19 to 25 m/s. Now it turns solid only with no car closing on it, and the
  // drivers see it as traffic as soon as it moves.
  it.each([1, 29])(
    'stopped 30 s at Roggia and driving on, seed %i: it is a ghost, then solid, untouched',
    (seed) => {
      const o = stopIn(1842, 5.49, seed, 30);
      expect(o.ghostFormed).toBe(true);
      // And solid again while it races on, soon after it drives off: a ghost for good would
      // pass every other check here.
      expect(o.solidAfterRelease).not.toBeNull();
      expect(o.solidAfterRelease!).toBeLessThan(15);
      // (A ghost from soon after it stopped to soon after it drove on: under the 30 s stop
      // plus those 15 s.)
      expect(o.ghostSeconds).toBeGreaterThan(0);
      expect(o.ghostSeconds).toBeLessThan(45);
      expect(o.stopperMaxContact).toBeLessThan(2);
      expect(o.spins).toBe(0);
      expect(o.finished).toBe(CARS - 1);
      expect(o.stopperFinished).toBe(true);
    },
    300_000,
  );

  it('twenty cars, the turn-one braking zone: every car gets past and finishes', () => {
    // The review's retirement: a car gone round at walking pace into the run-off that never
    // got going again.
    const o = stopIn(500, 1.01, 1, undefined, 20);
    expect(o.pastBeforeRetired).toBe(19);
    expect(Math.max(...o.waits)).toBeLessThan(20);
    expect(o.spins).toBe(0);
    expect(o.finished).toBe(19);
  }, 300_000);

  it('a session restored across the change to a ghost goes on bit for bit', () => {
    // The first chicane's edge: the queue stops behind the car, and it becomes a ghost.
    const [s, d, seed] = [617, -3.5, 73];
    const run = (until: (r: RaceSession) => boolean) => {
      const r = build(seed);
      let parked = false;
      while (!until(r.session)) {
        r.session.tick();
        if (!parked) parked = parkIfComing(r.session, r.stopper, s, d);
      }
      return r;
    };
    const first = run((r) => r.ghost(0) || r.time > 300);
    const ghostAt = first.session.time;
    expect(first.session.ghost(0)).toBe(true);
    // Snapshot 2 s before it, restore into a fresh session, and run both 5 s past it.
    const a = run((r) => r.time >= ghostAt - 2);
    const snap = JSON.parse(JSON.stringify(a.session.snapshot())) as ReturnType<
      RaceSession['snapshot']
    >;
    const b = build(seed);
    b.stopper.parked = true;
    b.session.restore(snap);
    let ghostSeen = false;
    while (a.session.time < ghostAt + 5) {
      a.session.tick();
      b.session.tick();
      ghostSeen ||= b.session.ghost(0);
    }
    expect(ghostSeen).toBe(true);
    expect(JSON.stringify(b.session.snapshot())).toBe(JSON.stringify(a.session.snapshot()));
  }, 300_000);
});
