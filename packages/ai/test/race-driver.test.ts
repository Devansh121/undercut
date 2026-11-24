import { beforeAll, describe, expect, it } from 'vitest';
import {
  BODY_HALF_WIDTH,
  NEUTRAL_INPUT,
  createCarParams,
  createCarTelemetry,
  type CarTelemetry,
  type ControlInput,
} from '@undercut/sim';
import { createVec3, type Track } from '@undercut/track';
import {
  DEFAULT_RACE_SKILL,
  createRaceDriver,
  createTrafficView,
  pitCarInPath,
  type RaceDriver,
  type RaceSkill,
  type RacingLineData,
  type TrafficView,
} from '../src/index';
import { MONZA, loadEnvelope, loadLine } from '../validation/lib/index';

// Decisions of the racing driver at Monza with the car's motion scripted: the driver's outputs
// (target offset, followed car, acceleration ceiling, pedals) for traffic placed around it. The
// closed-loop versions on the real sim are in packages/race/validation/race-driver.test.ts.

const DT = 1 / 240;
const CAR_LENGTH = 5.6;
const SIDE_BY_SIDE = 2 * BODY_HALF_WIDTH + 0.8;
/** On the main straight (the first chicane starts about 580 m on), and in its braking zone. */
const STRAIGHT = 150;

let track: Track;
let line: RacingLineData;
let envelope: ReturnType<typeof loadEnvelope>;
const params = createCarParams(MONZA.trim);

beforeAll(() => {
  track = MONZA.track();
  line = loadLine(MONZA);
  envelope = loadEnvelope(MONZA);
});

/** A calm driver: no noise, so each decision is the traffic's doing. */
function driver(skill: Partial<RaceSkill> = {}): RaceDriver {
  return createRaceDriver({
    track,
    line,
    envelope,
    params,
    skill: { ...DEFAULT_RACE_SKILL, consistency: 1, senseNoise: 0, ...skill },
  });
}

function lineD(dr: RaceDriver, s: number): number {
  const l = dr.plan.line;
  const u = track.wrap(s) / track.lap.step;
  const i = Math.floor(u) % l.count;
  const j = (i + 1) % l.count;
  return l.d[i]! + (l.d[j]! - l.d[i]!) * (u - Math.floor(u));
}

/** Telemetry of a car at lap (s, d) moving at `v` along the lap. */
function at(s: number, d: number, v: number, yawOffset = 0, gear = 6): CarTelemetry {
  const t = createCarTelemetry();
  const p = track.pointAt(track.wrap(s), d, createVec3());
  const tan = track.tangentAt(track.wrap(s), createVec3());
  t.x = p.x;
  t.z = p.z;
  t.yaw = Math.atan2(-tan.z, tan.x) + yawOffset;
  t.speed = v;
  t.gear = gear;
  t.engineRpm = 10000;
  for (let i = 0; i < 4; i++) t.wheelLoad[i] = 4000;
  return t;
}

interface Car {
  id: number;
  s: number;
  d: number;
  speed: number;
  pitApproach?: boolean;
}

/** A traffic view of `self` with `others`, the race running. */
function view(self: Car, others: Car[], o: Partial<TrafficView> = {}): TrafficView {
  const v = createTrafficView(others.length);
  Object.assign(v.self, self);
  others.forEach((c, k) => Object.assign(v.cars[k]!, c));
  v.count = others.length;
  v.active = true;
  Object.assign(v, o);
  return v;
}

/** One tick: sense, drive, and return the pedals and steering. */
function tick(dr: RaceDriver, self: Car, others: Car[], o: Partial<TrafficView> = {}) {
  const out: ControlInput = { ...NEUTRAL_INPUT };
  dr.sense(view(self, others, o));
  dr.drive(at(self.s, self.d, self.speed), DT, out);
  return out;
}

/**
 * Script both cars for `seconds`: each moves along the lap at its speed; this car follows the
 * offset its driver holds, and takes the speed its acceleration ceiling allows.
 */
function run(dr: RaceDriver, self: Car, others: Car[], seconds: number, each?: () => void) {
  for (let k = 0; k < Math.round(seconds / DT); k++) {
    tick(dr, self, others);
    // Free of traffic the car gathers speed (to a straight's 90 m/s); otherwise as allowed.
    const a = Math.min(dr.last.accelLimit, 5);
    self.speed = Math.min(90, Math.max(0, self.speed + a * DT));
    self.s += self.speed * DT;
    self.d = lineD(dr, self.s) + dr.last.offset;
    for (const c of others) c.s += c.speed * DT;
    each?.();
  }
}

describe('race driver: gap keeping', () => {
  it('follows a slower car in its path and brakes for it when close', () => {
    const dr = driver();
    const me = { id: 0, s: STRAIGHT, d: 0, speed: 80 };
    me.d = lineD(dr, me.s);
    const ahead = { id: 1, s: STRAIGHT + CAR_LENGTH + 8, d: lineD(dr, STRAIGHT + 14), speed: 70 };
    tick(dr, me, [ahead]);
    expect(dr.last.leader).toBe(1);
    expect(dr.last.accelLimit).toBeLessThan(-10);
  });

  it('never closes in on a car ahead that holds its speed, and settles a few tenths behind it', () => {
    const dr = driver({ aggression: 0.5 });
    const me = { id: 0, s: STRAIGHT - 200, d: 0, speed: 85 };
    const ahead = { id: 1, s: STRAIGHT - 150, d: 0, speed: 80 };
    let closest = Infinity;
    // Keep this car from pulling out to pass.
    dr['cooldown'] = 1e9;
    run(dr, me, [ahead], 4, () => {
      ahead.d = lineD(dr, ahead.s);
      closest = Math.min(closest, ahead.s - me.s - CAR_LENGTH);
    });
    const gap = (ahead.s - me.s - CAR_LENGTH) / me.speed;
    expect(closest).toBeGreaterThan(2);
    expect(gap).toBeGreaterThan(0.15);
    expect(gap).toBeLessThan(0.6);
  });

  it('brakes for a car stopping further up the queue before the car ahead does', () => {
    const dr = driver();
    const ld = (x: number) => lineD(dr, x);
    const me = { id: 0, s: STRAIGHT, d: ld(STRAIGHT), speed: 50 };
    // The car ahead still at speed, 20 m up; the one beyond it nearly stopped 45 m up.
    const ahead = { id: 1, s: STRAIGHT + CAR_LENGTH + 20, d: ld(STRAIGHT + 25.6), speed: 50 };
    const beyond = { id: 2, s: STRAIGHT + 2 * CAR_LENGTH + 45, d: ld(STRAIGHT + 56), speed: 5 };
    tick(dr, me, [ahead]);
    const alone = dr.last.accelLimit;
    tick(dr, me, [ahead, beyond]);
    expect(dr.last.leader).toBe(1);
    expect(alone).toBeGreaterThan(0);
    expect(dr.last.accelLimit).toBeLessThan(-10);
  });

  it('ignores a car out of sight ahead', () => {
    const dr = driver();
    const me = { id: 0, s: STRAIGHT, d: lineD(dr, STRAIGHT), speed: 80 };
    const far = { id: 1, s: STRAIGHT + 350, d: lineD(dr, STRAIGHT + 350), speed: 20 };
    tick(dr, me, [far]);
    expect(dr.last.leader).toBe(-1);
    expect(dr.last.accelLimit).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('race driver: passing', () => {
  it('pulls out beside a slower car on a straight, passes it and rejoins its line', () => {
    const dr = driver({ aggression: 0.8 });
    const me = { id: 0, s: STRAIGHT - 350, d: 0, speed: 85 };
    me.d = lineD(dr, me.s);
    const slow = { id: 1, s: STRAIGHT - 325, d: 0, speed: 72 };
    let started = false;
    let minLateral = Infinity;
    run(dr, me, [slow], 7, () => {
      slow.d = lineD(dr, slow.s);
      if (dr.last.passing === 1) started = true;
      if (Math.abs(slow.s - me.s) < CAR_LENGTH) {
        minLateral = Math.min(minLateral, Math.abs(slow.d - me.d));
      }
    });
    expect(started).toBe(true);
    // Past it, never touching on the way (bodies are 2 m wide).
    expect(me.s - slow.s).toBeGreaterThan(CAR_LENGTH);
    expect(minLateral).toBeGreaterThan(2 * BODY_HALF_WIDTH);
    expect(dr.last.passing).toBe(-1);
    // Back toward the line once clear.
    run(dr, me, [slow], 3, () => (slow.d = lineD(dr, slow.s)));
    expect(Math.abs(dr.last.offset)).toBeLessThan(0.5);
  });

  it('pulls away from the grid in the lane it stands in, a move picked on the grid waiting', () => {
    const dr = driver();
    const ld = lineD(dr, STRAIGHT);
    const me = { id: 0, s: STRAIGHT, d: ld + 3, speed: 0 };
    // A move chosen while standing for the lights, its lane already drifted 1.5 m outward.
    dr['passId'] = 1;
    dr['o'] = 4.5;
    tick(dr, me, [{ id: 1, s: STRAIGHT + 8, d: ld + 3, speed: 0 }], { launching: true });
    expect(dr['o']).toBeCloseTo(3, 6);
  });

  it('does not start a pass from the grid (launching)', () => {
    const dr = driver({ aggression: 1 });
    const me = { id: 0, s: STRAIGHT, d: lineD(dr, STRAIGHT), speed: 8 };
    const ahead = { id: 1, s: STRAIGHT + 10, d: lineD(dr, STRAIGHT + 10), speed: 2 };
    for (let k = 0; k < 480; k++) tick(dr, me, [ahead], { launching: true });
    expect(dr.last.passing).toBe(-1);
  });
});

describe('race driver: side by side', () => {
  it('keeps more room to a car alongside while moving across the road', () => {
    // Clearance to the car beside, for this car heading `yaw` off the lap's direction.
    const room = (yaw: number) => {
      const dr = driver();
      const ld = lineD(dr, STRAIGHT);
      const me = { id: 0, s: STRAIGHT, d: ld, speed: 30 };
      const beside = { id: 1, s: STRAIGHT, d: ld + SIDE_BY_SIDE + 0.05, speed: 30 };
      dr.sense(view(me, [beside]));
      dr.drive(at(me.s, me.d, me.speed, yaw), DT, { ...NEUTRAL_INPUT });
      return beside.d - ld - dr.last.target;
    };
    expect(room(0)).toBeGreaterThanOrEqual(SIDE_BY_SIDE - 1e-9);
    // 30 m/s at 0.05 rad is 1.5 m/s across: 0.15 s of seeing and reacting is 0.22 m more.
    expect(room(0.05)).toBeGreaterThanOrEqual(SIDE_BY_SIDE + 0.2);
  });

  it('keeps a car width and some air to a car alongside, moving away from it', () => {
    const dr = driver();
    const me = { id: 0, s: STRAIGHT, d: lineD(dr, STRAIGHT), speed: 80 };
    const beside = { id: 1, s: STRAIGHT, d: me.d + 2.2, speed: 80 };
    tick(dr, me, [beside]);
    expect(beside.d - (lineD(dr, STRAIGHT) + dr.last.target)).toBeGreaterThanOrEqual(
      SIDE_BY_SIDE - 1e-9,
    );
  });

  it('does not squeeze a car alongside on its way back to the line', () => {
    const dr = driver();
    const ld = lineD(dr, STRAIGHT);
    const me = { id: 0, s: STRAIGHT, d: ld - 3.2, speed: 80 };
    dr['o'] = -3.2;
    // A car half a length behind, on the racing line: this one must not move onto it.
    const beside = { id: 1, s: STRAIGHT - 2, d: ld, speed: 80 };
    for (let k = 0; k < 120; k++) tick(dr, me, [beside]);
    expect(ld + dr.last.target).toBeLessThanOrEqual(beside.d - SIDE_BY_SIDE + 1e-9);
  });

  it('drops in behind when there is no room for both and the other car is ahead', () => {
    const dr = driver();
    const ld = lineD(dr, STRAIGHT);
    // This car against the right edge, the other alongside and slightly ahead to its left.
    const edge = -track.halfWidthAt(STRAIGHT, 1) + BODY_HALF_WIDTH + 0.3;
    const me = { id: 0, s: STRAIGHT, d: edge, speed: 80 };
    dr['o'] = edge - ld;
    const beside = { id: 1, s: STRAIGHT + 1.5, d: edge + 2.2, speed: 80 };
    tick(dr, me, [beside]);
    expect(dr.last.yielding).toBe(true);
    expect(dr.last.leader).toBe(1);
    expect(dr.last.accelLimit).toBeLessThan(0);
  });
});

describe('race driver: blue flag', () => {
  it('moves off the line to the wider side when shown the blue flag', () => {
    const dr = driver();
    const me = { id: 0, s: STRAIGHT, d: lineD(dr, STRAIGHT), speed: 70 };
    const lapper = { id: 1, s: STRAIGHT - 40, d: me.d, speed: 85 };
    tick(dr, me, [lapper], { blueFlag: true });
    expect(Math.abs(dr.last.target)).toBeGreaterThan(2);
    tick(dr, me, [lapper], { blueFlag: false });
    expect(Math.abs(dr.last.target)).toBeLessThan(1e-9);
  });
});

describe('race driver: recovery', () => {
  it('turns a car facing the wrong way round on full lock', () => {
    const dr = driver();
    const s = STRAIGHT;
    const out: ControlInput = { ...NEUTRAL_INPUT };
    dr.sense(view({ id: 0, s, d: 0, speed: 0 }, []));
    dr.drive(at(s, 0, 0, Math.PI - 0.2, 1), DT, out);
    expect(dr.last.recovering).toBe(true);
    expect(Math.abs(out.steer)).toBe(1);
  });

  it('waits on the racing surface while a car comes past, then turns', () => {
    const dr = driver();
    const s = STRAIGHT;
    const coming = { id: 1, s: s - 100, d: 0, speed: 80 };
    const out: ControlInput = { ...NEUTRAL_INPUT };
    dr.sense(view({ id: 0, s, d: 0, speed: 0 }, [coming]));
    dr.drive(at(s, 0, 0, Math.PI - 0.2, 1), DT, out);
    expect(out.brake).toBe(1);
    expect(out.throttle).toBe(0);
    // Still waits when a car is passing closely in another lane across the track.
    const passing = { id: 1, s: s - 6, d: 4, speed: 4 };
    dr.sense(view({ id: 0, s, d: 0, speed: 0 }, [passing]));
    dr.drive(at(s, 0, 0, Math.PI - 0.2, 1), DT, out);
    expect(out.brake).toBe(1);
    expect(out.throttle).toBe(0);
    coming.s = s + 50;
    dr.sense(view({ id: 0, s, d: 0, speed: 0 }, [coming]));
    dr.drive(at(s, 0, 0, Math.PI - 0.2, 1), DT, out);
    expect(out.brake).toBe(0);
    expect(Math.abs(out.steer)).toBe(1);
  });

  it('backs away in reverse when stuck facing a barrier', () => {
    const dr = driver();
    const s = STRAIGHT;
    const d = -track.halfWidthAt(s, 1) - 1;
    const out: ControlInput = { ...NEUTRAL_INPUT };
    let reverse = false;
    let gear = 1;
    for (let k = 0; k < 240 * 6; k++) {
      dr.sense(view({ id: 0, s, d, speed: 0 }, []));
      dr.drive(at(s, d, 0, -1.2, gear), DT, out);
      if (out.gearShift < 0) gear = Math.max(-1, gear - 1);
      if (out.gearShift > 0) gear = Math.min(1, gear + 1);
      if (gear < 0) reverse = true;
    }
    expect(reverse).toBe(true);
  });

  it('rejoins off line while a car is coming, then eases back to the line', () => {
    const dr = driver();
    const ld = lineD(dr, STRAIGHT);
    const me = { id: 0, s: STRAIGHT, d: ld - 4, speed: 30 };
    // Facing the right way again after a spin: the driver hands back with a rejoin.
    dr['recovering'] = true;
    const coming = { id: 1, s: STRAIGHT - 60, d: ld - 4, speed: 85 };
    tick(dr, me, [coming]);
    expect(dr.last.recovering).toBe(false);
    for (let k = 0; k < 60; k++) tick(dr, me, [coming]);
    expect(Math.abs(dr.last.offset - -4)).toBeLessThan(0.3);
  });
});

describe('race driver: memory', () => {
  it('restores from a snapshot and drives on bit for bit', () => {
    const a = driver({ senseNoise: 0.5, consistency: 0.5 });
    const me = { id: 0, s: STRAIGHT - 250, d: 0, speed: 85 };
    me.d = lineD(a, me.s);
    const slow = { id: 1, s: STRAIGHT - 225, d: me.d, speed: 72 };
    run(a, me, [slow], 1);
    const snap = JSON.parse(JSON.stringify(a.snapshot())) as ReturnType<RaceDriver['snapshot']>;
    const b = driver({ senseNoise: 0.5, consistency: 0.5 });
    b.restore(snap);
    for (let k = 0; k < 240; k++) {
      const oa = tick(a, { ...me }, [{ ...slow }]);
      const ob = tick(b, { ...me }, [{ ...slow }]);
      expect(ob).toEqual(oa);
      me.s += me.speed * DT;
      slow.s += slow.speed * DT;
    }
  });
});

describe('race driver: two cars level with no room for both', () => {
  // Against the right edge, a car level with this one and half a metre back to its left, the
  // other car with the lower id: at speed both give way (neither turns in on the other). Slowed to a crawl, the car ahead stops waiting for the
  // car behind, or the two follow each other to a standstill (Spa, seed 103: two cars side by
  // side into La Source stood still for 6 s and the field queued behind them).
  function levelPair(speed: number) {
    const dr = driver();
    const edge = -track.halfWidthAt(STRAIGHT, 1) + BODY_HALF_WIDTH + 0.3;
    const ld = lineD(dr, STRAIGHT);
    const me = { id: 1, s: STRAIGHT, d: edge, speed };
    dr['o'] = edge - ld;
    const beside = { id: 0, s: STRAIGHT - 0.5, d: edge + 2.2, speed };
    tick(dr, me, [beside]);
    return dr;
  }

  it('at speed, gives way to the car level with it as well', () => {
    const dr = levelPair(40);
    expect(dr.last.yielding).toBe(true);
    expect(dr.last.leader).toBe(0);
  });

  it('at a crawl, does not follow a car level with it or behind it', () => {
    const dr = levelPair(8);
    expect(dr.last.leader).not.toBe(0);
    expect(dr.last.accelLimit).toBeGreaterThan(0);
  });
});

describe('race driver: closing on a queue', () => {
  // The tail of a queue braking to a crawl in the lane behind a car stopped in the road: the car
  // closing on it must be able to stop behind it with the brakes it really has at the end of the
  // stop. At walking pace the wheels are light and the pedal is held well short of the plan's
  // braking (8–9 m/s² below 10 m/s, measured at Spa's Bus Stop, where queues rear-ended at
  // 5–7 m/s).
  it('closes on the tail of a crawling queue without touching it when its brakes give 8 m/s² there', () => {
    const dr = driver();
    dr['cooldown'] = 1e9;
    // As at the Bus Stop (seed 1, car 5 behind car 3): 28 m/s, 19.75 m behind a car at 22.6 m/s
    // that brakes at 12 m/s² to a crawl.
    const me = { id: 0, s: STRAIGHT - 25.35, d: lineD(dr, STRAIGHT - 25.35), speed: 28 };
    const tail = { id: 1, s: STRAIGHT, d: lineD(dr, STRAIGHT), speed: 22.6 };
    // The car stopped in the road that the queue forms behind, 90 m on (beyond the reach at which
    // it is an obstacle to stop for itself).
    const parked = { id: 2, s: STRAIGHT + 90, d: lineD(dr, STRAIGHT + 90), speed: 0 };
    let closest = Infinity;
    for (let k = 0; k < 240 * 10; k++) {
      tick(dr, me, [tail, parked]);
      // The car's brakes: the plan's braking at speed, no more than 8 m/s² below 10 m/s.
      const floor = me.speed < 10 ? -8 : -14;
      const a = Math.max(floor, Math.min(dr.last.accelLimit, 5));
      me.speed = Math.max(0, me.speed + a * DT);
      me.s += me.speed * DT;
      me.d = lineD(dr, me.s) + dr.last.offset;
      tail.speed = Math.max(1.5, tail.speed - 12 * DT);
      tail.s += tail.speed * DT;
      if (me.s < tail.s && Math.abs(tail.d - me.d) < 2 * BODY_HALF_WIDTH) {
        closest = Math.min(closest, tail.s - me.s - CAR_LENGTH);
      }
    }
    expect(closest).toBeGreaterThan(0.5);
  });
});

describe('race driver: stopped cars on the road', () => {
  it('keeps the walking-pace steering rules after the stopped car turns into an unseen ghost', () => {
    const dr = driver();
    const me = { id: 0, s: 150, d: lineD(dr, 150), speed: 5 };
    tick(dr, me, [{ id: 1, s: 175, d: lineD(dr, 175), speed: 0 }]);
    expect(dr['inner'].holdFrontSlip).toBe(false);
    // Gone from the view (a ghost standing still), the car still crawling: the rules hold.
    tick(dr, me, []);
    expect(dr['inner'].holdFrontSlip).toBe(false);
    // Back above walking pace they end, and stay ended at walking pace after.
    tick(dr, { ...me, speed: 13 }, []);
    tick(dr, me, []);
    expect(dr['inner'].holdFrontSlip).toBe(true);
  });

  it('keeps the obstruction caution ceiling when following a moving leader', () => {
    const dr = driver();
    const me = { id: 0, s: 150, d: lineD(dr, 150), speed: 40 };
    const ahead = { id: 1, s: 210, d: lineD(dr, 210), speed: 40 };
    tick(dr, me, [ahead]);
    expect(dr.last.accelLimit).toBeGreaterThan(0);
    tick(dr, me, [ahead, { id: 2, s: 250, d: 5, speed: 0 }]);
    expect(dr.last.leader).toBe(1);
    expect(dr.last.accelLimit).toBeLessThan(-10);
  });

  it('stays at queue speed until clear of a stopped car in a sweeping chicane', () => {
    const dr = driver();
    const me = { id: 0, s: 670, d: lineD(dr, 670), speed: 20 };
    tick(dr, me, [{ id: 1, s: 650, d: lineD(dr, 650), speed: 0 }]);
    expect(dr.last.accelLimit).toBeLessThan(-10);
  });

  for (const side of [-1, 1]) {
    it(`ignores a stopped car beyond the ${side > 0 ? 'left' : 'right'} road edge`, () => {
      const dr = driver();
      const me = { id: 0, s: 150, d: lineD(dr, 150), speed: 40 };
      const out = tick(dr, me, [{ id: 1, s: 250, d: side * 30, speed: 0 }]);
      expect(dr.last.accelLimit).toBe(Infinity);
      expect(out.brake).toBe(0);
      expect(out.throttle).toBeGreaterThan(0);
    });

    it(`counts a footprint overlapping the ${side > 0 ? 'left' : 'right'} road edge`, () => {
      const dr = driver();
      const me = { id: 0, s: 150, d: lineD(dr, 150), speed: 40 };
      const d = side * (track.halfWidthAt(250, side > 0 ? 0 : 1) + BODY_HALF_WIDTH / 2);
      tick(dr, me, [{ id: 1, s: 250, d, speed: 0 }]);
      expect(dr.last.accelLimit).toBeLessThan(0);
    });
  }

  it('does not enable queue caution for stationary grid traffic during launch', () => {
    const dr = driver();
    const me = { id: 0, s: 150, d: lineD(dr, 150), speed: 40 };
    tick(dr, me, [{ id: 1, s: 250, d: 5, speed: 0 }], { launching: true });
    expect(dr.last.accelLimit).toBe(Infinity);
  });
});

describe('race driver: switchback', () => {
  it('remembers an unsuccessful inside attack for an exit move, including a restore', () => {
    const dr = driver();
    const s =
      Array.from(dr.plan.line.curvature).findIndex((k, i) => i > 150 && Math.abs(k) > 1 / 150) *
      track.lap.step;
    const me = { id: 0, s, d: lineD(dr, s), speed: 35 };
    const ahead = { id: 1, s: s + 10, d: me.d, speed: 35 };
    dr['passId'] = 1;
    dr['passSide'] = 1;
    dr['passCommitted'] = true;
    tick(dr, me, [ahead]);
    expect(dr.snapshot().switchbackId).toBe(1);
    expect(dr.snapshot().switchbackSide).toBe(-1);
    const restored = driver();
    restored.restore(JSON.parse(JSON.stringify(dr.snapshot())));
    expect(restored.snapshot().switchbackId).toBe(1);
    expect(restored.snapshot().switchbackSide).toBe(-1);
  });
});

it('uses straight-line speed headroom in a move while retaining the corner braking limit', () => {
  const dr = driver();
  dr['o'] = 3;
  const s = 0;
  const v = dr.plan.profile.v[0]! + 2;
  expect(dr['offLineLimit'](s, v)).toBeLessThan(0);
  dr['passId'] = 1;
  expect(dr['offLineLimit'](s, v)).toBe(Number.POSITIVE_INFINITY);
  expect(dr['offLineLimit'](450, v)).toBeLessThan(0);
});

describe('race driver: late braking', () => {
  it('does not dive into a braking zone from behind a car it does not overlap', () => {
    const dr = driver();
    // Held up into the first chicane's braking zone, 10 m behind a car braking earlier.
    const s = 420;
    const me = { id: 0, s, d: lineD(dr, s) - 3, speed: 70 };
    const ahead = { id: 1, s: s + 10, d: lineD(dr, s + 10), speed: 50 };
    dr['passId'] = 1;
    dr['passSide'] = -1;
    dr['heldTime'] = 5;
    dr['passDecel'] = 8;
    dr['o'] = -3;
    tick(dr, me, [ahead]);
    expect(dr.snapshot().passCommitted).toBe(false);
    expect(dr.snapshot().passId).toBe(-1);
  });
});

describe('race driver: the opening lap', () => {
  /** In the first chicane's braking zone, short of the turn-in. */
  const BRAKING = 520;
  it('gives up a move into the first corner unless already alongside', () => {
    for (const openingLap of [true, false]) {
      const dr = driver();
      const me = { id: 0, s: BRAKING, d: lineD(dr, BRAKING) - 3, speed: 60 };
      const ahead = { id: 1, s: BRAKING + 8, d: lineD(dr, BRAKING + 8), speed: 55 };
      dr['passId'] = 1;
      dr['passSide'] = -1;
      dr['passCommitted'] = true;
      dr['o'] = -3;
      tick(dr, me, [ahead], { openingLap });
      expect(dr.snapshot().passId).toBe(openingLap ? -1 : 1);
    }
  });
  it('keeps a move into the first corner when already alongside', () => {
    const dr = driver();
    const me = { id: 0, s: BRAKING, d: lineD(dr, BRAKING) - 3, speed: 60 };
    const ahead = { id: 1, s: BRAKING + 2, d: lineD(dr, BRAKING + 2), speed: 55 };
    dr['passId'] = 1;
    dr['passSide'] = -1;
    dr['passCommitted'] = true;
    dr['o'] = -3;
    tick(dr, me, [ahead], { openingLap: true });
    expect(dr.snapshot().passId).toBe(1);
  });
  it('holds its offset from the line while braking on the opening lap, with a car near', () => {
    const hold = (openingLap: boolean, near: boolean) => {
      const dr = driver();
      // Early in the braking zone, where the road leaves room either side of the line.
      dr['o'] = -2.5;
      const me = { id: 0, s: 420, d: lineD(dr, 420) - 2.5, speed: 60 };
      // A car 12 m back on the other side of the line: near, and not in the way.
      const other = { id: 1, s: 408, d: lineD(dr, 408) + 3, speed: 60 };
      for (let k = 0; k < 120; k++) tick(dr, me, near ? [other] : [], { openingLap });
      return dr.snapshot().o as number;
    };
    expect(hold(true, true)).toBeCloseTo(-2.5, 6);
    expect(hold(false, true)).toBeGreaterThan(-2.4);
    // Alone on the road the car takes its line as planned.
    expect(hold(true, false)).toBeGreaterThan(-2.4);
  });
});

describe('race driver: a car slowing for the pit entry', () => {
  it('counts the entrant against the road the follower reaches there, not only where it is now', () => {
    const half = BODY_HALF_WIDTH;
    // On the follower's path at the entrant's s, though more than a car width from its own d.
    expect(pitCarInPath(0, 3.8, 3.5, half, half)).toBe(true);
    // Beside the follower now, wherever the path goes.
    expect(pitCarInPath(0, 1.5, -6, half, half)).toBe(true);
    // Clear of both: already across toward the lane.
    expect(pitCarInPath(0, 6, 3, half, half)).toBe(false);
    expect(pitCarInPath(0, -4, 1, half, half)).toBe(false);
    // A car turned across the road takes more of it.
    expect(pitCarInPath(0, 3.6, 0, half, half)).toBe(false);
    expect(pitCarInPath(0, 3.6, 0, half, half + 1.5)).toBe(true);
  });

  it('follows an entrant 35 m ahead on its path before the lane, which it would not for a car not stopping', () => {
    const entry = track.pit.entryS;
    const leaderOf = (pitApproach: boolean) => {
      const dr = driver();
      const me = { id: 0, s: entry - 40, d: lineD(dr, entry - 40), speed: 70 };
      const s = entry - 5;
      tick(dr, me, [{ id: 1, s, d: lineD(dr, s) + 2, speed: 35, pitApproach }]);
      return dr.last.leader;
    };
    expect(leaderOf(false)).not.toBe(1);
    expect(leaderOf(true)).toBe(1);
  });
});
