import { createRng, type Rng } from '@undercut/core';
import {
  ErsMode,
  brakeCapacity,
  type CarParams,
  type CarTelemetry,
  type ControlInput,
} from '@undercut/sim';
import { createPathPoint, type PathPoint } from '@undercut/track';
import { Phase, type DrivingPlan } from '../profile/plan';
import type { Driver, DriverMemory, DriverSkill } from './driver';
import { lockExcess, spinExcess } from './feel';
import { fullLoadTorque } from '../envelope/shift';

/**
 * The reference driver: follows the plan's racing line and speed profile as closely as the
 * car allows. Four small controllers, each replaceable:
 *
 * - Steering: preview path tracking. The commanded path curvature is the line's curvature a
 *   short time ahead plus lateral- and course-error feedback scheduled with speed (so the error
 *   dynamics are the same second-order response at any speed), turned into a yaw-rate demand
 *   and tracked with kinematic feedforward and PI on the yaw rate.
 * - Pedals: profile acceleration as feedforward plus speed-error feedback, mapped to throttle
 *   through the measured full-throttle acceleration and to brake through the brake hardware's
 *   torque; eased off when the driven wheels spin or a wheel starts to lock, as a driver feels.
 * - Gears: upshift at the engine's best shift point, downshift as the lower gear comes into range.
 * - DRS and ERS: DRS open in the zones until the brakes go on; the overtake button held where
 *   the plan deploys, from the first timing-line crossing.
 */
export interface ReferenceDriverOptions {
  plan: DrivingPlan;
  params: CarParams;
  skill: DriverSkill;
  /** Deploy the MGU-K before the first crossing of the timing line (default false: out-lap). */
  deployBeforeLine?: boolean;
  /** Controller gains; defaults are the reference driver's. */
  gains?: Partial<ControllerGains>;
}

export interface ControllerGains {
  /**
   * Natural frequency of the lateral-error response, rad/s: `lateralOmegaSpeed / v`, held
   * between `lateralOmegaMin` and `lateralOmegaMax` (stiffer at low speed, where the line bends
   * hardest), and its damping ratio.
   */
  lateralOmegaSpeed: number;
  lateralOmegaMin: number;
  lateralOmegaMax: number;
  lateralDamping: number;
  /** How far ahead the line's curvature is read, s. */
  steerPreview: number;
  /** Yaw-rate PI gains (per unit speed). */
  yawKp: number;
  yawKi: number;
  /** How far ahead the speed profile is read, s, and the speed-error gain, 1/s. */
  speedPreview: number;
  speedGain: number;
  /** Downshift when the lower gear lands this far below its own shift point, rpm. */
  downshiftMargin: number;
  /** Front slip angle the steering may use, as a multiple of the tyre's peak slip angle. */
  frontSlipMargin: number;
  /** Throttle kept while the front axle is saturated and the car wants more turn. */
  understeerLift: number;
  /** Brake pedal cap taken away per second per unit of slip past the lock threshold, and regained per second. */
  lockGain: number;
  lockRecover: number;
  /** Throttle taken away per second per unit of rear combined slip past the peak, and regained per second. */
  spinGain: number;
  spinRecover: number;
  /** Sideslip the driver tolerates before backing off, rad, and the rate per rad beyond it. */
  sideslipLimit: number;
  slideGain: number;
  /**
   * Countersteer: road-wheel angle added per radian of sideslip beyond `sideslipLimit`, toward
   * the slide (1 points the front wheels along the car's path), and brake pedal taken away per
   * radian of sideslip beyond the limit (a driver comes off the brake when the rear steps out).
   */
  counterSteer: number;
  slideBrakeRelease: number;
}

export const REFERENCE_GAINS: Readonly<ControllerGains> = Object.freeze({
  lateralOmegaSpeed: 120,
  lateralOmegaMin: 2.5,
  lateralOmegaMax: 4,
  lateralDamping: 0.9,
  steerPreview: 0.12,
  yawKp: 20,
  yawKi: 80,
  speedPreview: 0.2,
  speedGain: 3,
  downshiftMargin: 1500,
  frontSlipMargin: 1.1,
  understeerLift: 0.5,
  lockGain: 150,
  lockRecover: 6,
  spinGain: 20,
  spinRecover: 10,
  sideslipLimit: 0.06,
  slideGain: 60,
  counterSteer: 1,
  slideBrakeRelease: 12,
});

const TWO_PI = 2 * Math.PI;

function wrapAngle(a: number): number {
  return a - TWO_PI * Math.floor((a + Math.PI) / TWO_PI);
}

export class ReferenceDriver implements Driver {
  readonly name = 'reference';
  readonly ersMode = ErsMode.None;
  readonly plan: DrivingPlan;
  readonly skill: DriverSkill;
  readonly gains: ControllerGains;
  private readonly params: CarParams;
  private readonly brakeTorque: number;
  private readonly shiftRpm: readonly number[];
  private readonly iceEfficiency: number;
  private readonly deployBeforeLine: boolean;
  private readonly hint = { index: -1 };
  private readonly q: PathPoint = createPathPoint();
  private readonly slipTan = new Float64Array(4);
  private rng: Rng;

  // Memory between ticks.
  private havePrev = false;
  private px = 0;
  private pz = 0;
  private pyaw = 0;
  private prevS = 0;
  private yawIntegral = 0;
  private throttleCap = 1;
  private brakeCap = 1;
  private shiftHold = 0;
  private crossedLine = false;
  private steerOut = 0;
  private throttleOut = 0;
  private brakeOut = 0;
  private wander = 0;

  /** Diagnostics of the last tick: track position, lateral error, target speed. */
  readonly last = {
    s: 0,
    d: 0,
    lineD: 0,
    lateralError: 0,
    courseError: 0,
    curvature: 0,
    lineCurvature: 0,
    yawRate: 0,
    targetSpeed: 0,
    phase: 0,
    brakeCap: 1,
    throttleCap: 1,
    lockExcess: 0,
  };

  constructor(options: ReferenceDriverOptions) {
    this.plan = options.plan;
    this.params = options.params;
    this.skill = options.skill;
    this.gains = { ...REFERENCE_GAINS, ...options.gains };
    this.brakeTorque = brakeCapacity(options.params.brakes);
    this.shiftRpm = options.plan.model.envelope.shiftRpm;
    const eng = options.params.engine;
    this.iceEfficiency = eng.peakPower / (eng.flowMax * eng.fuelEnergy);
    this.deployBeforeLine = options.deployBeforeLine ?? false;
    this.rng = createRng(options.skill.seed);
  }

  reset(): void {
    this.hint.index = -1;
    this.havePrev = false;
    this.yawIntegral = 0;
    this.throttleCap = 1;
    this.brakeCap = 1;
    this.shiftHold = 0;
    this.crossedLine = false;
    this.steerOut = 0;
    this.throttleOut = 0;
    this.brakeOut = 0;
    this.wander = 0;
    this.rng = createRng(this.skill.seed);
  }

  snapshot(): DriverMemory {
    return {
      hint: this.hint.index,
      rng: this.rng.getState().slice(),
      havePrev: this.havePrev,
      px: this.px,
      pz: this.pz,
      pyaw: this.pyaw,
      prevS: this.prevS,
      yawIntegral: this.yawIntegral,
      throttleCap: this.throttleCap,
      brakeCap: this.brakeCap,
      shiftHold: this.shiftHold,
      crossedLine: this.crossedLine,
      steerOut: this.steerOut,
      throttleOut: this.throttleOut,
      brakeOut: this.brakeOut,
      wander: this.wander,
    };
  }

  restore(m: DriverMemory): void {
    const num = (k: string): number => {
      const v = m[k];
      if (typeof v !== 'number') throw new Error(`driver memory: ${k} missing`);
      return v;
    };
    const rng = m.rng;
    if (!Array.isArray(rng) || rng.length !== 4) throw new Error('driver memory: rng missing');
    this.hint.index = num('hint');
    this.rng.setState([rng[0]!, rng[1]!, rng[2]!, rng[3]!]);
    this.havePrev = m.havePrev === true;
    this.px = num('px');
    this.pz = num('pz');
    this.pyaw = num('pyaw');
    this.prevS = num('prevS');
    this.yawIntegral = num('yawIntegral');
    this.throttleCap = num('throttleCap');
    this.brakeCap = num('brakeCap');
    this.shiftHold = num('shiftHold');
    this.crossedLine = m.crossedLine === true;
    this.steerOut = num('steerOut');
    this.throttleOut = num('throttleOut');
    this.brakeOut = num('brakeOut');
    this.wander = num('wander');
  }

  drive(tel: CarTelemetry, dt: number, out: ControlInput): ControlInput {
    const plan = this.plan;
    const track = plan.track;
    const line = plan.line;
    const prof = plan.profile;
    const g = this.gains;
    const p = this.params;
    const n = line.count;
    const step = track.lap.step;

    // Where am I, and how am I moving?
    const q = track.project(tel.x, tel.z, this.hint, this.q);
    const s = q.s;
    const v = Math.max(tel.speed, 1);
    let yawRate = 0;
    let course = tel.yaw;
    if (this.havePrev) {
      yawRate = wrapAngle(tel.yaw - this.pyaw) / dt;
      const dx = tel.x - this.px;
      const dz = tel.z - this.pz;
      if (dx * dx + dz * dz > 1e-8) course = Math.atan2(-dz, dx);
      if (this.prevS - s > track.length / 2) this.crossedLine = true;
    }
    this.havePrev = true;
    this.px = tel.x;
    this.pz = tel.z;
    this.pyaw = tel.yaw;
    this.prevS = s;

    // Line at the car.
    const u = s / step;
    const i = Math.floor(u) % n;
    const j = (i + 1) % n;
    const f = u - Math.floor(u);
    const lineD = line.d[i]! + (line.d[j]! - line.d[i]!) * f;
    const heading = line.heading[i]! + wrapAngle(line.heading[j]! - line.heading[i]!) * f;

    // ---- Steering ----
    if (this.skill.lineWander > 0) {
      this.wander += this.rng.range(-1, 1) * this.skill.lineWander * Math.sqrt(dt);
      this.wander = Math.max(-this.skill.lineWander, Math.min(this.skill.lineWander, this.wander));
    }
    const e = q.d - lineD - this.wander;
    const ePsi = wrapAngle(course - heading);
    const kAhead = this.sampleAhead(line.curvature, s, v * g.steerPreview);
    const w = Math.max(g.lateralOmegaMin, Math.min(g.lateralOmegaMax, g.lateralOmegaSpeed / v));
    let correction = -(w * w * e) / (v * v) - (2 * g.lateralDamping * w * Math.sin(ePsi)) / v;
    // At walking pace the feedback would ask for more curvature than the car has; keep it sane.
    const maxCorr = 0.05;
    correction = Math.max(-maxCorr, Math.min(maxCorr, correction));
    const kCmd = kAhead + correction;
    const yawTarget = v * kCmd;
    const L = p.geometry.wheelbase;
    const maxSteer = p.geometry.maxSteerAngle;
    const yawErr = yawTarget - yawRate;
    const integral = Math.max(
      -0.5,
      Math.min(0.5, this.yawIntegral + ((g.yawKi * yawErr) / v) * dt),
    );
    let steer = (L * kCmd) / maxSteer + (g.yawKp * yawErr) / v + integral;
    // Past the front tyres' peak slip angle more lock only scrubs: the wheel goes light. Hold
    // the road-wheel angle within the peak of where the front axle is pointing, and do not wind
    // the integrator up against that limit.
    const alphaFront = 0.5 * (tel.slipAngle[0]! + tel.slipAngle[1]!);
    const axleCourse = tel.steerAngle - alphaFront;
    const alphaMax = Math.atan(p.tyre.peakSlipTan) * g.frontSlipMargin;
    const lo = (axleCourse - alphaMax) / maxSteer;
    const hi = (axleCourse + alphaMax) / maxSteer;
    let saturated = false;
    if (steer > hi) {
      steer = hi;
      saturated = yawErr > 0;
    } else if (steer < lo) {
      steer = lo;
      saturated = yawErr < 0;
    }
    // The rear stepping out: steer toward the slide beyond the sideslip the driver accepts, and
    // hold the yaw integrator (it would otherwise wind up against the countersteer).
    const beta = wrapAngle(course - tel.yaw);
    const betaOver = Math.max(0, Math.abs(beta) - g.sideslipLimit);
    if (betaOver > 0) steer += (Math.sign(beta) * g.counterSteer * betaOver) / maxSteer;
    if (!saturated && betaOver === 0) this.yawIntegral = integral;

    // ---- Speed ----
    // Feedforward read a little ahead covers the time the car takes to build deceleration or
    // drive; the feedback holds the speed the profile wants here.
    const vTarget = prof.v[i]! + (prof.v[j]! - prof.v[i]!) * f;
    const aHere = prof.ax[i]! + (prof.ax[j]! - prof.ax[i]!) * f;
    const aAhead = this.sampleAhead(prof.ax, s, v * g.speedPreview);
    // Already under the speed the profile wants a moment ahead: no reason to brake early for
    // it. (Compared with the target ahead, not here: braking early by design leaves the car
    // under the target here at every braking onset.)
    const vAhead = this.sampleAhead(prof.v, s, v * g.speedPreview);
    const aFf = v < vAhead - 1 ? Math.max(aHere, aAhead) : aAhead;
    const aDemand = aFf + g.speedGain * (vTarget - v);
    const drsHere = plan.drsZone[i] === 1 && prof.phase[i] !== Phase.Brake;
    const deployHere = prof.deploying[i] === 1 && (this.crossedLine || this.deployBeforeLine);
    const model = plan.model;
    const drag = model.drag(v, tel.drs > 0.5);
    const full = model.drive(v, tel.drs > 0.5, deployHere);
    let throttle = 0;
    let brake = 0;
    if (aDemand >= -drag) {
      throttle = (aDemand + drag) / Math.max(full + drag, 0.1);
    } else {
      const mass = p.mass.dryMass + tel.fuelMass;
      brake = ((-aDemand - drag) * mass * p.tyre.rollingRadius) / this.brakeTorque;
    }
    throttle = Math.max(0, Math.min(1, throttle));
    brake = Math.max(0, Math.min(1, brake));

    // Feel for wheelspin and lock-up.
    const peak = p.tyre.peakSlipRatio;
    // The rear stepping out: combined slip past the peak, or the car sliding (sideslip).
    const spin = spinExcess(tel.slipRatio, tel.slipAngle, peak, p.tyre.peakSlipTan);
    const sideslip = Math.abs(wrapAngle(course - tel.yaw));
    const slide = sideslip - g.sideslipLimit;
    if (spin > 0 || slide > 0) {
      this.throttleCap -= (g.spinGain * Math.max(spin, 0) + g.slideGain * Math.max(slide, 0)) * dt;
    } else this.throttleCap += g.spinRecover * dt;
    this.throttleCap = Math.max(0, Math.min(1, this.throttleCap));
    for (let k = 0; k < 4; k++) this.slipTan[k] = Math.tan(tel.slipAngle[k]!);
    const lockOver = lockExcess(
      tel.slipRatio,
      tel.wheelLoad,
      peak,
      this.slipTan,
      p.tyre.peakSlipTan,
    );
    if (lockOver > 0) this.brakeCap -= g.lockGain * lockOver * dt;
    else this.brakeCap += g.lockRecover * dt;
    this.brakeCap = Math.max(0, Math.min(1, this.brakeCap));
    throttle = Math.min(throttle, this.throttleCap);
    brake = Math.min(brake, this.brakeCap);
    if (betaOver > 0) brake *= Math.max(0, 1 - g.slideBrakeRelease * betaOver);
    // Sliding with the brakes off: never let engine braking act on the rear (lift-off
    // oversteer). Hold at least the throttle that cancels the engine's drag.
    const sliding = sideslip > g.sideslipLimit;
    if (sliding && brake < 0.02) throttle = Math.max(throttle, this.neutralThrottle(tel.engineRpm));
    // Understeer: the front is at its limit and the car still wants to turn more. Lift off
    // both pedals so the front tyres have their grip for turning.
    if (saturated) {
      throttle *= g.understeerLift;
      brake *= g.understeerLift;
    }

    // ---- Hands and feet: lag and noise (none for the reference driver). ----
    const sk = this.skill;
    if (sk.steerNoise > 0) steer += this.gauss() * sk.steerNoise;
    if (sk.pedalNoise > 0) {
      throttle = Math.max(0, Math.min(1, throttle + this.gauss() * sk.pedalNoise));
      if (brake > 0) brake = Math.max(0, Math.min(1, brake + this.gauss() * sk.pedalNoise));
    }
    if (sk.reaction > 0) {
      const a = 1 - Math.exp(-dt / sk.reaction);
      steer = this.steerOut + (steer - this.steerOut) * a;
      throttle = this.throttleOut + (throttle - this.throttleOut) * a;
      brake = this.brakeOut + (brake - this.brakeOut) * a;
    }
    steer = Math.max(-1, Math.min(1, steer));
    this.steerOut = steer;
    this.throttleOut = throttle;
    this.brakeOut = brake;

    out.steer = steer;
    out.throttle = throttle;
    out.brake = brake;
    out.gearShift = sliding ? 0 : this.gear(tel, throttle);
    out.drs = drsHere && brake < 0.02;
    out.overtake = deployHere && throttle > 0.9;
    out.pitLimiter = false;

    const last = this.last;
    last.s = s;
    last.d = q.d;
    last.lineD = lineD;
    last.lateralError = q.d - lineD;
    last.courseError = ePsi;
    last.curvature = kCmd;
    last.lineCurvature = kAhead;
    last.yawRate = yawRate;
    last.brakeCap = this.brakeCap;
    last.throttleCap = this.throttleCap;
    last.lockExcess = lockOver;
    last.targetSpeed = vTarget;
    last.phase = prof.phase[i]!;
    return out;
  }

  /** Value of a per-sample array at centreline s + ahead (linear interpolation, wraps). */
  private sampleAhead(a: ArrayLike<number>, s: number, ahead: number): number {
    const step = this.plan.track.lap.step;
    const n = this.plan.line.count;
    const u = this.plan.track.wrap(s + ahead) / step;
    const i = Math.floor(u) % n;
    const j = (i + 1) % n;
    const f = u - Math.floor(u);
    return a[i]! + (a[j]! - a[i]!) * f;
  }

  private gear(tel: CarTelemetry, throttle: number): -1 | 0 | 1 {
    if (this.shiftHold > 0) {
      this.shiftHold--;
      return 0;
    }
    if (tel.shifting || tel.gear < 1) return 0;
    const p = this.params;
    const ratios = p.gearbox.ratios;
    const gear = tel.gear;
    // Road speed, not engine speed, decides: a locking rear wheel drags the revs down and
    // would ask for a gear the car cannot take.
    const wheel = Math.max(tel.speed, 0) / p.tyre.rollingRadius;
    const toRpm = 60 / (2 * Math.PI);
    const rpm = ratios[gear - 1]! * wheel * toRpm;
    let req: -1 | 0 | 1 = 0;
    if (gear < ratios.length && rpm > this.shiftRpm[gear - 1]! && throttle > 0.3) req = 1;
    else if (gear > 1) {
      const lower = ratios[gear - 2]! * wheel * toRpm;
      const rearLocking =
        Math.min(tel.slipRatio[2]!, tel.slipRatio[3]!) < -0.5 * p.tyre.peakSlipRatio;
      if (lower < this.shiftRpm[gear - 2]! - this.gains.downshiftMargin && !rearLocking) req = -1;
    }
    if (req !== 0) this.shiftHold = 3;
    return req;
  }

  /** Throttle at which the engine neither drives nor brakes, at `rpm` (from the sim's model). */
  private neutralThrottle(rpm: number): number {
    const eng = this.params.engine;
    const drag = eng.dragTorqueBase + eng.dragTorquePerRpm * rpm;
    const full = fullLoadTorque(this.params, this.iceEfficiency, rpm);
    return full + drag > 0 ? Math.min(1, drag / (full + drag)) : 0;
  }

  private gauss(): number {
    // Sum of uniforms: cheap, bounded, close enough to normal for driver error.
    const r = this.rng;
    return (r.next() + r.next() + r.next() + r.next() - 2) * Math.sqrt(3);
  }
}

/** The reference driver's skill: all of the envelope it can use cleanly, no lag, no errors. */
export const REFERENCE_SKILL: Readonly<DriverSkill> = Object.freeze({
  envelope: Object.freeze({ lateral: 0.98, brake: 0.95, traction: 0.98 }),
  reaction: 0,
  steerNoise: 0,
  pedalNoise: 0,
  lineWander: 0,
  seed: 1,
});
