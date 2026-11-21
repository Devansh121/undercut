import { createRng, type Rng } from '@undercut/core';
import {
  CAR_HALF_WIDTH,
  createCarTelemetry,
  type CarParams,
  type CarTelemetry,
  type ControlInput,
} from '@undercut/sim';
import type { DrivingPlan } from '../profile/plan';
import type { Driver, DriverMemory, DriverSkill } from './driver';
import { ReferenceDriver } from './reference';
import type { TrafficCar, TrafficView } from './traffic';

/**
 * How a racing driver drives, each 0 to 1 unless a unit is given. The player-facing difficulty
 * and the spread across a field map onto these.
 */
export interface RaceSkill {
  /** Share of the car's cornering and traction the driver plans with (1: the reference's). */
  pace: number;
  /** Share of the braking the driver plans with (1: the reference's). Lower brakes earlier. */
  braking: number;
  /** 1: no noise in hands, feet and line; 0: the most this model adds. */
  consistency: number;
  /** Lag of hands and feet, s. */
  reaction: number;
  /** Lag of what the driver feels of the tyres (slip, load), s. */
  senseLag: number;
  /** Noise on what the driver feels of the tyres and of where the car is, 0 to 1. */
  senseNoise: number;
  /** How readily the driver goes for a gap and how close it follows. */
  aggression: number;
  /** Seed for everything random in this driver. */
  seed: number;
}

export const DEFAULT_RACE_SKILL: Readonly<RaceSkill> = Object.freeze({
  pace: 1,
  braking: 1,
  consistency: 0.8,
  reaction: 0.03,
  senseLag: 0.03,
  senseNoise: 0.3,
  aggression: 0.5,
  seed: 1,
});

/**
 * The envelope shares and errors of the reference controller underneath a racing driver of
 * `skill`. Pace 1 plans with the reference driver's shares less a racing margin (the driver
 * feels the tyres late and with noise, so it cannot ride the limit as the reference does).
 */
export function driverSkillFor(skill: RaceSkill): DriverSkill {
  const pace = clamp01(skill.pace);
  const braking = clamp01(skill.braking);
  const rough = 1 - clamp01(skill.consistency);
  return {
    envelope: {
      lateral: 0.965 - 0.05 * (1 - pace),
      traction: 0.97 - 0.05 * (1 - pace),
      brake: 0.93 - 0.06 * (1 - braking),
    },
    reaction: Math.max(0, skill.reaction),
    steerNoise: 0.004 * rough,
    pedalNoise: 0.03 * rough,
    lineWander: 0.1 + 0.2 * rough,
    seed: skill.seed >>> 0,
  };
}

/** Car body length and width the driver keeps clear of, m. */
const CAR_LENGTH = 5.6;
const CAR_WIDTH = 2 * CAR_HALF_WIDTH;
/** Centre-to-centre lateral distance held side by side, m: a car's width and some air. */
const SIDE_BY_SIDE = CAR_WIDTH + 0.8;
/** Lateral distance below which a car ahead is in this car's path, m. */
const IN_PATH = CAR_WIDTH + 0.5;
/** Room kept between the body and the track edge, m. */
const EDGE_MARGIN = 0.25;
/** How fast the driver moves across the track, m/s. */
const LATERAL_RATE = 2;
/** Gap control: standstill gap, m, speed gain, 1/s, and the deceleration assumed for safety, m/s². */
const STANDSTILL_GAP = 2;
const GAP_GAIN = 0.8;
const SPEED_GAIN = 3;
const SAFE_DECEL = 15;

const TWO_PI = 2 * Math.PI;
const wrapAngle = (a: number): number => a - TWO_PI * Math.floor((a + Math.PI) / TWO_PI);
function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** Telemetry fields copied as numbers into the perceived view each tick. */
const TELEMETRY = createCarTelemetry();
const SCALAR_KEYS = (Object.keys(TELEMETRY) as (keyof CarTelemetry)[]).filter(
  (k) => typeof TELEMETRY[k] !== 'object',
);

export interface RaceDriverOptions {
  plan: DrivingPlan;
  params: CarParams;
  skill: RaceSkill;
}

/**
 * A driver that races: the reference controller underneath (the same steering, pedals and
 * gears, the same physics, no grip or speed cheats) on a plan made with this driver's skill,
 * with what a racing driver adds on top.
 *
 * - Perception: the tyres are felt late and with noise (slip, load), and the car's position on
 *   the track is known only to within a drifting error, as the README requires of race AI.
 * - Gap keeping: a car ahead in its path sets a speed it can follow at (a time gap plus a
 *   standstill gap, and never closer than it could brake to the other car's speed).
 * - Lanes: it holds an offset from its racing line. Side by side it keeps a car's width and some
 *   air to the other car, never moving across it, and leaves a car's width at the edge; when
 *   there is no room for both it drops back behind the car ahead of it. Off its line in a
 *   corner it slows for the tighter radius.
 * - Passing: with a pace advantage, or after being held up, it picks a side with room and moves
 *   off line beside the car ahead; it rejoins its line once clear.
 * - Blue flag: it moves off line to the wider side (the race controller also lifts).
 * - Recovery: after a spin it waits for a gap in the traffic, turns back the right way and
 *   rejoins off line before easing back onto it.
 *
 * Seeded and deterministic; `snapshot` carries everything, so a restore continues bit for bit.
 */
export class RaceDriver implements Driver {
  readonly name = 'race';
  readonly plan: DrivingPlan;
  readonly skill: RaceSkill;
  readonly inner: ReferenceDriver;
  private readonly params: CarParams;
  private view: TrafficView | null = null;
  private readonly seen: CarTelemetry = createCarTelemetry();
  private rng: Rng;

  // Memory between ticks.
  private o = 0;
  private passId = -1;
  private passSide = 0;
  private passTime = 0;
  private passBlocked = 0;
  private cooldown = 0;
  private heldTime = 0;
  private recovering = false;
  private rejoinTime = 0;
  private biasX = 0;
  private biasZ = 0;
  private haveSense = false;
  private readonly slip = new Float64Array(4);
  private readonly angle = new Float64Array(4);
  private readonly load = new Float64Array(4);

  /** Diagnostics of the last tick. */
  readonly last = {
    offset: 0,
    target: 0,
    leader: -1,
    gap: Number.POSITIVE_INFINITY,
    accelLimit: Number.POSITIVE_INFINITY,
    passing: -1,
    yielding: false,
    recovering: false,
  };

  constructor(o: RaceDriverOptions) {
    this.plan = o.plan;
    this.skill = { ...o.skill };
    this.params = o.params;
    this.inner = new ReferenceDriver({
      plan: o.plan,
      params: o.params,
      skill: driverSkillFor(o.skill),
    });
    this.rng = createRng((o.skill.seed ^ 0x9e3779b9) >>> 0);
  }

  get ersMode(): ReferenceDriver['ersMode'] {
    return this.inner.ersMode;
  }

  /** The traffic limited the pedals on the last tick (the launch should not override them). */
  get following(): boolean {
    return this.last.accelLimit < 2;
  }

  /** Read the traffic for the next `drive` (the view is read during `drive`, not copied). */
  sense(view: TrafficView): void {
    this.view = view;
  }

  reset(): void {
    this.inner.reset();
    this.rng = createRng((this.skill.seed ^ 0x9e3779b9) >>> 0);
    this.o = 0;
    this.passId = -1;
    this.passSide = 0;
    this.passTime = 0;
    this.passBlocked = 0;
    this.cooldown = 0;
    this.heldTime = 0;
    this.recovering = false;
    this.rejoinTime = 0;
    this.biasX = 0;
    this.biasZ = 0;
    this.haveSense = false;
  }

  snapshot(): DriverMemory {
    const inner = this.inner.snapshot();
    const out: Record<string, number | boolean | readonly number[]> = {};
    for (const [k, v] of Object.entries(inner)) out[`ref.${k}`] = v;
    out.rng = this.rng.getState().slice();
    out.o = this.o;
    out.passId = this.passId;
    out.passSide = this.passSide;
    out.passTime = this.passTime;
    out.passBlocked = this.passBlocked;
    out.cooldown = this.cooldown;
    out.heldTime = this.heldTime;
    out.recovering = this.recovering;
    out.rejoinTime = this.rejoinTime;
    out.biasX = this.biasX;
    out.biasZ = this.biasZ;
    out.haveSense = this.haveSense;
    out.slip = Array.from(this.slip);
    out.angle = Array.from(this.angle);
    out.load = Array.from(this.load);
    return out;
  }

  restore(m: DriverMemory): void {
    const inner: Record<string, number | boolean | readonly number[]> = {};
    for (const [k, v] of Object.entries(m)) if (k.startsWith('ref.')) inner[k.slice(4)] = v;
    this.inner.restore(inner);
    const num = (k: string): number => {
      const v = m[k];
      if (typeof v !== 'number') throw new Error(`race driver memory: ${k} missing`);
      return v;
    };
    const arr = (k: string, out: Float64Array): void => {
      const v = m[k];
      if (!Array.isArray(v) || v.length !== out.length) {
        throw new Error(`race driver memory: ${k} missing`);
      }
      for (let i = 0; i < out.length; i++) out[i] = v[i] as number;
    };
    const rng = m.rng;
    if (!Array.isArray(rng) || rng.length !== 4) throw new Error('race driver memory: rng missing');
    this.rng.setState([rng[0]!, rng[1]!, rng[2]!, rng[3]!]);
    this.o = num('o');
    this.passId = num('passId');
    this.passSide = num('passSide');
    this.passTime = num('passTime');
    this.passBlocked = num('passBlocked');
    this.cooldown = num('cooldown');
    this.heldTime = num('heldTime');
    this.recovering = m.recovering === true;
    this.rejoinTime = num('rejoinTime');
    this.biasX = num('biasX');
    this.biasZ = num('biasZ');
    this.haveSense = m.haveSense === true;
    arr('slip', this.slip);
    arr('angle', this.angle);
    arr('load', this.load);
  }

  drive(tel: CarTelemetry, dt: number, out: ControlInput): ControlInput {
    const seen = this.perceive(tel, dt);
    const view = this.view;
    this.view = null;
    const inner = this.inner;
    if (view) this.planTraffic(view, tel, dt);
    else {
      this.o = this.approach(this.o, 0, dt);
      inner.accelLimit = Number.POSITIVE_INFINITY;
      this.last.accelLimit = Number.POSITIVE_INFINITY;
      this.last.leader = -1;
    }
    inner.offset = this.o;
    inner.drive(seen, dt, out);
    this.last.offset = this.o;
    if (view) this.recover(view, tel, out);
    return out;
  }

  // ---- Perception ----

  /** What the driver feels and sees of its own car this tick. */
  private perceive(tel: CarTelemetry, dt: number): CarTelemetry {
    const seen = this.seen;
    const src = tel as unknown as Record<string, number | boolean>;
    const dst = seen as unknown as Record<string, number | boolean>;
    for (const k of SCALAR_KEYS) dst[k] = src[k]!;
    seen.wheelAngle.set(tel.wheelAngle);
    seen.wheelSpeed.set(tel.wheelSpeed);
    seen.suspensionTravel.set(tel.suspensionTravel);
    const sk = this.skill;
    const noise = clamp01(sk.senseNoise);
    const tyre = this.params.tyre;
    const a = sk.senseLag > 0 && this.haveSense ? 1 - Math.exp(-dt / sk.senseLag) : 1;
    this.haveSense = true;
    const slipSigma = 0.1 * noise * tyre.peakSlipRatio;
    const angleSigma = 0.1 * noise * Math.atan(tyre.peakSlipTan);
    for (let i = 0; i < 4; i++) {
      this.slip[i] = this.slip[i]! + (tel.slipRatio[i]! - this.slip[i]!) * a;
      this.angle[i] = this.angle[i]! + (tel.slipAngle[i]! - this.angle[i]!) * a;
      this.load[i] = this.load[i]! + (tel.wheelLoad[i]! - this.load[i]!) * a;
      seen.slipRatio[i] = this.slip[i]! + (noise > 0 ? this.gauss() * slipSigma : 0);
      seen.slipAngle[i] = this.angle[i]! + (noise > 0 ? this.gauss() * angleSigma : 0);
      seen.wheelLoad[i] = this.load[i]! * (1 + (noise > 0 ? this.gauss() * 0.05 * noise : 0));
    }
    // Where the car is: a slowly drifting error of up to 0.15 m at full noise.
    if (noise > 0) {
      const amp = 0.15 * noise;
      const k = amp * Math.sqrt(dt);
      this.biasX = Math.max(-amp, Math.min(amp, this.biasX + this.rng.range(-1, 1) * k));
      this.biasZ = Math.max(-amp, Math.min(amp, this.biasZ + this.rng.range(-1, 1) * k));
      seen.x = tel.x + this.biasX;
      seen.z = tel.z + this.biasZ;
    }
    return seen;
  }

  private gauss(): number {
    const r = this.rng;
    return (r.next() + r.next() + r.next() + r.next() - 2) * Math.sqrt(3);
  }

  // ---- Plan sampling ----

  /** Linear interpolation of a per-sample array at lap s (wraps). */
  private at(a: ArrayLike<number>, s: number): number {
    const track = this.plan.track;
    const n = this.plan.line.count;
    const u = track.wrap(s) / track.lap.step;
    const i = Math.floor(u) % n;
    const j = (i + 1) % n;
    const f = u - Math.floor(u);
    return a[i]! + (a[j]! - a[i]!) * f;
  }

  /** Signed distance from `from` to `to` along the lap, in (-L/2, L/2]. */
  private ahead(from: number, to: number): number {
    const L = this.plan.track.length;
    let d = (to - from) % L;
    if (d > L / 2) d -= L;
    else if (d <= -L / 2) d += L;
    return d;
  }

  /** Offset bounds from the line that keep the body inside the track over [s, s + reach]. */
  private bounds(s: number, reach: number, out: { lo: number; hi: number }): void {
    const track = this.plan.track;
    const line = this.plan.line.d;
    const margin = CAR_HALF_WIDTH + EDGE_MARGIN;
    let lo = Number.NEGATIVE_INFINITY;
    let hi = Number.POSITIVE_INFINITY;
    for (let x = 0; x <= reach; x += 6) {
      const sx = s + x;
      const ld = this.at(line, sx);
      const left = this.at(track.halfWidth[0], sx) - margin - ld;
      const right = -(this.at(track.halfWidth[1], sx) - margin) - ld;
      if (left < hi) hi = left;
      if (right > lo) lo = right;
    }
    // The line itself is always allowed (at an apex it runs closer to the edge than this).
    out.lo = Math.min(lo, 0);
    out.hi = Math.max(hi, 0);
  }

  // ---- Traffic ----

  private readonly room = { lo: 0, hi: 0 };
  /** Scratch: cars alongside this tick. */
  private readonly side = Array.from({ length: 24 }, () => ({
    car: null as unknown as TrafficCar,
    ds: 0,
    od: 0,
    left: false,
  }));

  private planTraffic(view: TrafficView, tel: CarTelemetry, dt: number): void {
    const plan = this.plan;
    const line = plan.line;
    const self = view.self;
    const v = Math.max(0, tel.speed);
    const s0 = self.s;
    const myO = self.d - this.at(line.d, s0);
    const sk = this.skill;
    const aggression = clamp01(sk.aggression);
    this.bounds(s0, 30 + v * 1.2, this.room);
    const oMin = this.room.lo;
    const oMax = this.room.hi;
    const reachAhead = Math.max(80, 40 + v * 3);
    const lookBehind = -(CAR_LENGTH + 2);

    // The car ahead in this car's path, and the cars alongside (or about to be).
    let leader: TrafficCar | null = null;
    let leaderDs = Number.POSITIVE_INFINITY;
    let passCar: TrafficCar | null = null;
    let passDs = 0;
    const side = this.side;
    let ns = 0;
    for (let k = 0; k < view.count; k++) {
      const c = view.cars[k]!;
      const ds = this.ahead(s0, c.s);
      if (c.id === this.passId) {
        passCar = c;
        passDs = ds;
      }
      if (ds > reachAhead || ds < lookBehind) continue;
      const od = c.d - this.at(line.d, c.s);
      const lateral = Math.abs(od - myO);
      const inPath = lateral < IN_PATH || Math.abs(od - this.o) < IN_PATH;
      // Ahead and in the way (or overlapping it already): follow it.
      if (ds > 0 && inPath && !(ds < CAR_LENGTH && lateral >= CAR_WIDTH)) {
        if (ds < leaderDs) {
          leaderDs = ds;
          leader = c;
        }
        continue;
      }
      const closing = Math.max(0, v - c.speed);
      if (ds >= CAR_LENGTH + 1 + closing * 0.6) continue;
      if (ns < side.length) {
        const e = side[ns++]!;
        e.car = c;
        e.ds = ds;
        e.od = od;
        e.left = myO >= od;
      }
    }
    // Lateral room beside them. When there is none for this car, the car further back gives
    // way: drop the rearmost car from the bands until there is room; a car dropped that is ahead
    // of this one is one to fall in behind (followed like a car ahead).
    let lo = oMin;
    let hi = oMax;
    let yieldTo: TrafficCar | null = null;
    let yieldDs = Number.POSITIVE_INFINITY;
    let skipBelow = Number.NEGATIVE_INFINITY;
    for (;;) {
      lo = oMin;
      hi = oMax;
      for (let k = 0; k < ns; k++) {
        const e = side[k]!;
        if (e.ds <= skipBelow) continue;
        if (e.left) lo = Math.max(lo, e.od + SIDE_BY_SIDE);
        else hi = Math.min(hi, e.od - SIDE_BY_SIDE);
      }
      if (lo <= hi) break;
      // The rearmost car still in the bands.
      let rear = -1;
      for (let k = 0; k < ns; k++) {
        const e = side[k]!;
        if (e.ds > skipBelow && (rear < 0 || e.ds < side[rear]!.ds)) rear = k;
      }
      if (rear < 0) break;
      const e = side[rear]!;
      skipBelow = e.ds;
      const aheadOfMe = e.ds > 0 || (e.ds > -1 && e.car.id < self.id);
      if (aheadOfMe && e.ds < yieldDs) {
        yieldDs = e.ds;
        yieldTo = e.car;
      }
    }
    if (lo > hi) {
      lo = oMin;
      hi = oMax;
    }
    if (yieldTo && yieldDs < leaderDs) {
      leader = yieldTo;
      leaderDs = yieldDs;
    }

    // Passing: start, carry on or give up.
    this.cooldown = Math.max(0, this.cooldown - dt);
    const profV = plan.profile.v;
    if (leader && leaderDs - CAR_LENGTH < 25 && v < this.at(profV, s0) - 1) {
      this.heldTime += dt;
    } else this.heldTime = Math.max(0, this.heldTime - 2 * dt);
    let base = 0;
    if (this.passId >= 0) {
      if (!passCar || passDs < -(CAR_LENGTH + 2) || this.passTime > 12) {
        if (passCar && passDs >= -(CAR_LENGTH + 2)) this.cooldown = 4;
        this.passId = -1;
      } else {
        this.passTime += dt;
        const od = passCar.d - this.at(line.d, passCar.s);
        base = od + this.passSide * SIDE_BY_SIDE;
        const fits = this.passSide > 0 ? base <= oMax : base >= oMin;
        this.passBlocked = fits ? 0 : this.passBlocked + dt;
        if (this.passBlocked > 0.6) {
          this.passId = -1;
          this.cooldown = 3;
          base = 0;
        }
      }
    }
    if (this.passId < 0 && leader && this.cooldown <= 0) {
      const gap = leaderDs - CAR_LENGTH;
      const faster = this.at(profV, leader.s) > leader.speed + 3 - 2 * aggression;
      const held = this.heldTime > 3 - 2 * aggression;
      if (gap < 30 && (faster || held)) {
        const od = leader.d - this.at(line.d, leader.s);
        const left = od + SIDE_BY_SIDE <= oMax;
        const right = od - SIDE_BY_SIDE >= oMin;
        let side = 0;
        if (left && right) {
          // The inside of the next corner beyond the car ahead, else the nearer side.
          const k = this.cornerSign(leader.s);
          side = k !== 0 ? k : myO >= od ? 1 : -1;
        } else if (left) side = 1;
        else if (right) side = -1;
        if (side !== 0) {
          this.passId = leader.id;
          this.passSide = side;
          this.passTime = 0;
          this.passBlocked = 0;
          base = od + side * SIDE_BY_SIDE;
        } else this.cooldown = 1;
      }
    }
    if (this.passId < 0 && view.blueFlag) {
      base = oMax >= -oMin ? Math.min(SIDE_BY_SIDE, oMax) : Math.max(-SIDE_BY_SIDE, oMin);
    }
    if (this.rejoinTime > 0) {
      // Just rejoined after a spin: come back to the line only as the traffic allows.
      this.rejoinTime = Math.max(0, this.rejoinTime - dt);
      if (this.carApproaching(view, s0, self.d, 80)) base = myO;
    }

    // The target offset: as close to the base as the cars alongside and the edges allow.
    const target = Math.max(lo, Math.min(hi, base));
    const yielding = yieldTo !== null;
    this.o = this.approach(this.o, target, dt);

    // The pedals: follow the car ahead, drop back when squeezed, slow off line in a corner.
    let limit = Number.POSITIVE_INFINITY;
    if (leader) {
      const gap = leaderDs - CAR_LENGTH;
      const vl = Math.max(0, leader.speed);
      const headway = 0.25 + 0.2 * (1 - aggression);
      const want = STANDSTILL_GAP + v * headway;
      const vSafe = vl + (gap - want) * GAP_GAIN;
      const room = gap - STANDSTILL_GAP;
      const vKin = room > 0 ? Math.sqrt(vl * vl + 2 * SAFE_DECEL * room) : vl - 1;
      let vOk = Math.min(vSafe, vKin);
      // Going round a car that is (nearly) stopped: creep past once the held offset clears it.
      const od = leader.d - this.at(line.d, leader.s);
      if (leader.id === this.passId && Math.abs(od - this.o) >= IN_PATH && gap > 1.5) {
        vOk = Math.max(vOk, Math.min(5, gap));
      }
      limit = SPEED_GAIN * (vOk - v);
    }
    limit = Math.min(limit, this.offLineLimit(s0, v));
    this.inner.accelLimit = limit;

    const last = this.last;
    last.target = target;
    last.leader = leader ? leader.id : -1;
    last.gap = leader ? leaderDs - CAR_LENGTH : Number.POSITIVE_INFINITY;
    last.accelLimit = limit;
    last.passing = this.passId;
    last.yielding = yielding;
  }

  /** Move the held offset toward `target` at the lateral rate. */
  private approach(o: number, target: number, dt: number): number {
    const step = LATERAL_RATE * dt;
    const d = target - o;
    return d > step ? o + step : d < -step ? o - step : target;
  }

  /** +1 if the next real corner beyond `s` turns left, -1 right, 0 if none within 300 m. */
  private cornerSign(s: number): number {
    const k = this.plan.line.curvature;
    for (let x = 0; x <= 300; x += 6) {
      const c = this.at(k, s + x);
      if (c > 1 / 150) return 1;
      if (c < -1 / 150) return -1;
    }
    return 0;
  }

  /**
   * A ceiling on the acceleration for running off the line: on the inside of a corner the
   * radius is tighter by the offset, so the speed the line allows there scales by
   * sqrt(1 - κ·o), with a small margin for leaving the grip map the line was made on.
   */
  private offLineLimit(s0: number, v: number): number {
    const o = this.o;
    if (Math.abs(o) < 0.3) return Number.POSITIVE_INFINITY;
    const plan = this.plan;
    const reach = 20 + (v * v) / (2 * 20);
    let limit = Number.POSITIVE_INFINITY;
    for (let x = 0; x <= reach; x += 8) {
      const sx = s0 + x;
      const k = this.at(plan.line.curvature, sx);
      const tight = k * o;
      let f = 0.985;
      if (tight > 0) f *= Math.sqrt(Math.max(0.4, 1 - 1.2 * tight));
      const vMax = this.at(plan.profile.v, sx) * f;
      if (v <= vMax) continue;
      const a = x < 1 ? SPEED_GAIN * (vMax - v) : (vMax * vMax - v * v) / (2 * x);
      if (a < limit) limit = a;
    }
    return limit;
  }

  /** A car within `range` m behind, at speed, near this lateral position. */
  private carApproaching(view: TrafficView, s0: number, d: number, range: number): boolean {
    for (let k = 0; k < view.count; k++) {
      const c = view.cars[k]!;
      const ds = this.ahead(s0, c.s);
      if (ds < 0 && ds > -range && c.speed > 15 && Math.abs(c.d - d) < SIDE_BY_SIDE + 1) {
        return true;
      }
    }
    return false;
  }

  // ---- Recovery after a spin ----

  private recover(view: TrafficView, tel: CarTelemetry, out: ControlInput): void {
    const line = this.plan.line;
    const s0 = view.self.s;
    const track = this.plan.track;
    const heading = line.heading[Math.round(track.wrap(s0) / track.lap.step) % line.count]!;
    const err = wrapAngle(tel.yaw - heading);
    const v = tel.speed;
    if (!this.recovering && Math.abs(err) > 1.4 && Math.abs(v) < 12) this.recovering = true;
    if (this.recovering && Math.abs(err) < 0.35 && v > 2) {
      this.recovering = false;
      // Rejoin from where the car is, easing back to the line.
      this.o = view.self.d - this.at(line.d, s0);
      this.rejoinTime = 4;
    }
    this.last.recovering = this.recovering;
    if (!this.recovering) return;
    out.drs = false;
    out.overtake = false;
    out.gearShift = tel.gear < 1 && !tel.shifting ? 1 : 0;
    if (this.carApproaching(view, s0, view.self.d, 150) && Math.abs(err) > 0.8) {
      // Wait for the gap: stopped, out of the way.
      out.steer = 0;
      out.throttle = 0;
      out.brake = 1;
      return;
    }
    out.steer = err > 0 ? -1 : 1;
    out.throttle = v < 4 ? 0.3 : 0;
    out.brake = v > 7 ? 0.4 : 0;
  }
}
