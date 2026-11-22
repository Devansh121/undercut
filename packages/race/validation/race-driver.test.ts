import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RACE_SKILL,
  REFERENCE_SKILL,
  createRaceDriver,
  createReferenceDriver,
  type Driver,
  type RaceSkill,
  type TrafficView,
} from '@undercut/ai';
import { createCarParams, type CarTelemetry, type ControlInput } from '@undercut/sim';
import { MONZA, loadEnvelope, loadLine } from '../../ai/validation/lib/index';
import type { RaceEvent } from '../src/events';
import { AiController } from '../src/session/controllers';
import { RaceSession } from '../src/session/session';
import { entrantsFor, runSession } from './lib/runner';

// The racing driver in closed loop on the real sim at Monza (physics job): a pass, a car being
// lapped under blue flags, and a spin recovery in traffic. Decision-level tests with scripted
// motion are in packages/ai/test/race-driver.test.ts.

const track = MONZA.track();
const line = loadLine(MONZA);
const envelope = loadEnvelope(MONZA);
const params = createCarParams(MONZA.trim);

function racer(skill: Partial<RaceSkill>, seed: number): Driver {
  return createRaceDriver({
    track,
    line,
    envelope,
    params,
    skill: { ...DEFAULT_RACE_SKILL, ...skill, seed },
  });
}

/** A racing driver that never uses more than `cap` throttle: a car far off the pace. */
class Hobbled implements Driver {
  readonly name = 'hobbled';
  constructor(
    private readonly inner: Driver,
    private readonly cap: number,
  ) {}
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
    out.throttle = Math.min(out.throttle, this.cap);
    out.overtake = false;
    return out;
  }
}

function race(drivers: Driver[], laps: number, seed: number): RaceSession {
  const entrants = entrantsFor(drivers.length);
  return new RaceSession({
    track,
    session: { kind: 'race', laps },
    seed,
    params,
    cars: drivers.map((driver, i) => ({
      entrant: entrants[i]!,
      controller: new AiController({ driver, params, reaction: 0.25 + 0.05 * i }),
      ersMode: driver.ersMode,
    })),
  });
}

/**
 * A car that is slow only in corners, the way a new player is: it plans with 60 % of the car's
 * cornering and braking grip and all of its traction, so it is at full speed on the straights.
 * A lap driver: it ignores the traffic, as a player who does not look in the mirrors would.
 */
function cornerSlow(seed: number) {
  return createReferenceDriver({
    track,
    line,
    envelope,
    params,
    skill: {
      ...REFERENCE_SKILL,
      envelope: { lateral: 0.6, brake: 0.6, traction: REFERENCE_SKILL.envelope.traction },
      seed,
    },
  });
}

/**
 * The same car slow only in corners, driven down the middle of the track the way a new player
 * keeps off the kerbs: it holds the centreline (d = 0) instead of the racing line, so a car
 * coming past has to choose a side of it, inside or outside, into every braking zone.
 */
class Centreline implements Driver {
  readonly name = 'centreline';
  constructor(private readonly inner: ReturnType<typeof createReferenceDriver>) {}
  get ersMode() {
    return this.inner.ersMode;
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
    // The line where the car was a tick ago: hold the centreline against it.
    this.inner.offset = -this.inner.last.lineD;
    return this.inner.drive(t, dt, out);
  }
}

function centreSlow(seed: number): Driver {
  return new Centreline(
    createReferenceDriver({
      track,
      line,
      envelope,
      params,
      skill: {
        ...REFERENCE_SKILL,
        envelope: { lateral: 0.6, brake: 0.6, traction: REFERENCE_SKILL.envelope.traction },
        seed,
      },
    }),
  );
}

const flags = (events: readonly RaceEvent[]) =>
  events.filter((e) => e.type === 'flag' && e.flag === 'blue' && e.on);

describe('race driver on the sim', () => {
  it('a faster car catches a slower one ahead, passes it on track and pulls away', () => {
    // Pole: a car down on power (75 % throttle at most). Second on the grid: the reference pace.
    const s = race([new Hobbled(racer({}, 11), 0.75), racer({ pace: 1, braking: 1 }, 12)], 3, 4);
    const run = runSession(s, { pitLap: null });
    expect(run.result.anomalies).toEqual([]);
    expect(run.result.entries[0]!.car).toBe(1);
    expect(run.racing.overtakes).toBeGreaterThanOrEqual(1);
    expect(run.cars.every((c) => c.longestContact < 0.5 && c.spins === 0)).toBe(true);
  }, 180_000);

  it('a car slow only in corners, on pole, is passed within two laps without contact', () => {
    const s = race([cornerSlow(41), racer({ pace: 1, braking: 1 }, 42)], 3, 7);
    const c = s.control;
    let passedOnLap: number | null = null;
    let contactTicks = 0;
    const laps: number[][] = [[], []];
    while (!s.ended && s.time < 600) {
      for (const e of s.tick()) {
        if (e.type === 'lap') laps[e.car]!.push(e.result.time);
      }
      for (const i of [0, 1]) if (s.worldCar(i).state.carContacts > 0) contactTicks++;
      // Passed: the racing driver a clear car length ahead on the road, once the race is on.
      const green = c.lightsOutAt !== null && s.time > c.lightsOutAt + 5;
      if (passedOnLap === null && green && c.cars[1]!.dist > c.cars[0]!.dist + 8) {
        passedOnLap = c.timer(0).lap;
      }
    }
    // The slow car is far off the pace: its flying lap over 10 s slower than the racing AI's
    // 86.5 s in free air (packages/race/validation/quick-race.test.ts, every seed).
    expect(laps[0]![1]!).toBeGreaterThan(96.5);
    expect(passedOnLap).not.toBeNull();
    expect(passedOnLap!).toBeLessThanOrEqual(2);
    expect(contactTicks).toBe(0);
    expect(s.result().entries[0]!.car).toBe(1);
  }, 300_000);

  it('a centreline car slow in corners, on pole, is passed by a small pack: no contact, all on track', () => {
    // Pole: the slow car down the middle of the road. Behind it, three racing drivers.
    const s = race(
      [centreSlow(51), racer({ pace: 1, braking: 1 }, 52), racer({}, 53), racer({}, 54)],
      4,
      8,
    );
    const c = s.control;
    const n = s.cars.length;
    const passedOnLap: (number | null)[] = new Array(n).fill(null);
    const allOff = new Array<number>(n).fill(0);
    let contactTicks = 0;
    const laps: number[][] = Array.from({ length: n }, () => []);
    while (!s.ended && s.time < 900) {
      for (const e of s.tick()) {
        if (e.type === 'lap') laps[e.car]!.push(e.result.time);
      }
      if (c.lightsOutAt === null || s.time < c.lightsOutAt + 5) continue;
      for (let i = 0; i < n; i++) {
        if (s.worldCar(i).state.carContacts > 0) contactTicks++;
        const f = s.carFacts(i);
        if (i > 0 && f.wheelsOff >= 4 && f.speed > 5) allOff[i]!++;
        if (i > 0 && passedOnLap[i] === null && c.cars[i]!.dist > c.cars[0]!.dist + 8) {
          passedOnLap[i] = c.timer(0).lap;
        }
      }
    }
    // Far off the pace, all of it in the corners.
    expect(laps[0]![1]!).toBeGreaterThan(96.5);
    // The racing driver behind it is by within two laps; the others follow it past.
    expect(passedOnLap[1]).not.toBeNull();
    expect(passedOnLap[1]!).toBeLessThanOrEqual(2);
    expect(passedOnLap.slice(1).every((l) => l !== null)).toBe(true);
    // No touching, and no car past it with four wheels off the road.
    expect(contactTicks).toBe(0);
    expect(allOff.slice(1)).toEqual([0, 0, 0]);
    expect(s.result().entries[0]!.car).not.toBe(0);
  }, 300_000);

  it('a car being lapped is shown the blue flag, moves over and lets the leader by', () => {
    const s = race([racer({ pace: 1, braking: 1 }, 21), new Hobbled(racer({}, 22), 0.3)], 5, 5);
    const run = runSession(s, { pitLap: null });
    const blue = flags(run.events);
    expect(blue.length).toBeGreaterThan(0);
    expect(blue.every((e) => e.type === 'flag' && e.car === 1 && e.by === 0)).toBe(true);
    // Let by within the time allowed: no penalty, and the leader a lap up at the flag.
    expect(run.events.filter((e) => e.type === 'penalty')).toEqual([]);
    const [first, second] = run.result.entries;
    expect(first!.car).toBe(0);
    expect(first!.laps - second!.laps).toBeGreaterThanOrEqual(1);
    expect(run.cars.every((c) => c.longestContact < 0.5)).toBe(true);
    expect(run.result.anomalies).toEqual([]);
  }, 300_000);

  it('a car spun round on the straight waits for the traffic, turns back and rejoins', () => {
    const s = race(
      [racer({}, 31), racer({}, 32), racer({ pace: 0.8 }, 33), racer({ pace: 0.8 }, 34)],
      2,
      6,
    );
    // Run to the second lap, then turn car 3 round on the main straight in front of the others.
    while (s.control.timer(0).lap < 2 && s.time < 400) s.tick();
    const lead = s.carFacts(0).s;
    const at = s.lapPose(lead + 250, 0);
    s.placeCar(3, at.x, at.z, at.yaw + Math.PI, 0);
    let turned: number | null = null;
    let contact = 0;
    const start = s.time;
    while (!s.ended && s.time < start + 300) {
      s.tick();
      const st = s.worldCar(3).state;
      if (st.carContacts > 0) contact++;
      const ok = Math.cos(st.yaw - at.yaw) > 0.9 && st.vx > 10;
      if (turned === null && ok) turned = s.time - start;
    }
    expect(turned).not.toBeNull();
    expect(turned!).toBeLessThan(40);
    expect(contact).toBe(0);
    expect(s.result().entries.every((e) => e.status === 'finished')).toBe(true);
  }, 300_000);

  // The review's stuck cars: one gone round a stopped car into the run-off at walking pace, one
  // back on the road turned toward the edge. Each direction of the multi-point turn is held
  // until its gear is in, so the car never sits between first and neutral.
  it.each([
    ['in the run-off, turned back toward the road', -1, 4, 0.9],
    ['on the road at the edge, turned toward it', 1, -1.5, -0.6],
  ])(
    'a car stopped %s at walking pace gets back to racing',
    (_, side, past, turn) => {
      const s = race([racer({}, 41), racer({}, 42), racer({}, 43)], 2, 6);
      while (s.control.timer(0).lap < 2 && s.time < 400) s.tick();
      // In the turn-one braking zone, 150 m ahead of the leader: past the edge (run-off) or
      // just inside it, pointing across the road.
      const at = s.track.wrap(s.carFacts(0).s + 150);
      const half = s.track.halfWidthAt(at, side > 0 ? 0 : 1);
      const lane = side * (half + past);
      const pose = s.lapPose(at, lane);
      s.placeCar(2, pose.x, pose.z, pose.yaw - side * turn, 2);
      const start = s.time;
      let back: number | null = null;
      while (!s.ended && s.time < start + 300) {
        s.tick();
        const f = s.carFacts(2);
        if (back === null && f.speed > 15 && Math.abs(f.heading) < 0.3 && f.wheelsOff < 4) {
          back = s.time - start;
        }
      }
      expect(back).not.toBeNull();
      expect(back!).toBeLessThan(40);
      expect(s.result().entries.every((e) => e.status === 'finished')).toBe(true);
    },
    300_000,
  );
});
