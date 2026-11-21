import { createRng, type Rng } from '@undercut/core';
import { LineCue, Phase, type DrivingPlan } from '@undercut/ai';
import type { CarState } from '@undercut/sim';
import { createPathPoint, type Track } from '@undercut/track';
import type { DeviceKind } from '../../src/actions';
import type { Axes } from '../../src/axis-shaper';
import { steerHelpScale } from '../../src/driver-aids';

/**
 * A human at a keyboard, a gamepad or a phone: what reaches the input layer before any shaping
 * or assist. Not a good driver. It reads the car late (reaction delay), presses keys rather than
 * steering smoothly, and gets every corner a little wrong in its own way: brakes late or early,
 * floors the throttle before the exit, lifts mid-corner, clips the kerbs.
 *
 * It knows the road as a newcomer does: a line and speeds a few per cent under the reference
 * driver's (a plan built from the same racing line with less of the envelope), and nothing about
 * tyre slip. The only feedback it uses is what a player sees: where the car is, which way it is
 * pointing and how fast it is turning.
 *
 * Pure and seeded; allocation-free per tick.
 */
/**
 * How the human steers. Following the line is anticipatory: a driver reads the road ahead
 * (preview) and steers for the bend before it arrives, so the visual-motor delay does not sit
 * inside that loop (preview tracking, as in the human-control literature since McRuer's
 * crossover model). What the delay does hold back is every response to something unexpected:
 * catching a slide and every pedal decision. The line law itself is the reference driver's
 * shape (curvature preview, lateral and heading feedback, yaw-rate damping) with softer gains.
 */
export interface SteerGains {
  /** Lateral-error response, rad/s: `omegaSpeed / v` held in [omegaMin, omegaMax]. */
  omegaSpeed: number;
  omegaMin: number;
  omegaMax: number;
  damping: number;
  /** How far ahead the road's curvature is read, s. */
  preview: number;
  /** Yaw-rate damping, steer per (rad/s) per (1/v). */
  yawKp: number;
  /**
   * Catching a slide, after the reaction delay: road-wheel angle toward the slide per radian
   * of sideslip past `slideSeen` rad (the nose visibly swinging away from the direction of travel).
   */
  counterSteer: number;
  slideSeen: number;
}

export const HUMAN_STEER: Readonly<SteerGains> = Object.freeze({
  omegaSpeed: 80,
  omegaMin: 1.6,
  omegaMax: 3,
  damping: 1,
  preview: 0.15,
  yawKp: 6,
  counterSteer: 1,
  slideSeen: (3 * Math.PI) / 180,
});

/** Nobody holds a line to the centimetre: lateral error under this goes uncorrected, m. */
const LINE_SLACK = 0.5;

export interface HumanTraits {
  /** Visual-motor delay, s: drawn once per run from [min, max]. */
  reaction: readonly [number, number];
  /** Shortest key press or release, s (a finger cannot tap faster). */
  tapMin: number;
  /** Keyboard steering: how far the felt steer may lag the wanted steer before a key goes down. */
  steerBand: number;
  /** Analog steering: noise (steer units, per tick, low-passed) and hand lag, s. */
  stickNoise: number;
  stickLag: number;
  /** Per corner, drawn from [min, max]: braking this many metres late (negative: early). */
  brakeLate: readonly [number, number];
  /** Per corner: full throttle this many metres before the plan's exit. */
  throttleEarly: readonly [number, number];
  /** Per corner: chance of a lift of [0.25, 0.6] s somewhere between turn-in and apex. */
  liftChance: number;
  /** Per corner: chance of cutting [min, max] m further to the inside at the apex. */
  kerbChance: number;
  kerbCut: readonly [number, number];
  /**
   * `clumsy`: per-corner errors above. `marks`: brakes where the driving line turns red, lifts on
   * amber and floors it on green (the disciplined driver; errors off).
   */
  feet: 'clumsy' | 'marks';
  steer: SteerGains;
}

/** The player the owner described: keyboard, late on everything, a bit ragged. */
export const CLUMSY: Readonly<HumanTraits> = Object.freeze({
  reaction: [0.15, 0.25] as const,
  tapMin: 0.06,
  steerBand: 0.02,
  stickNoise: 0.04,
  stickLag: 0.08,
  brakeLate: [-12, 25] as const,
  throttleEarly: [0, 40] as const,
  liftChance: 0.3,
  kerbChance: 0.35,
  kerbCut: [0.4, 1.0] as const,
  feet: 'clumsy',
  steer: HUMAN_STEER,
});

/**
 * Brakes at the marks, flat out at the exit mark, no extra mistakes. Same hands and eyes,
 * reaction drawn per seed like the clumsy driver's.
 */
export const DISCIPLINED: Readonly<HumanTraits> = Object.freeze({
  ...CLUMSY,
  liftChance: 0,
  kerbChance: 0,
  feet: 'marks',
});

/** What the disciplined driver sees: the driving line's cue at the car's position and speed. */
export interface CueSource {
  cueAt(s: number, speed: number): LineCue;
}

const RING = 256;

const TWO_PI = 2 * Math.PI;
function wrapAngle(a: number): number {
  return a - TWO_PI * Math.floor((a + Math.PI) / TWO_PI);
}

interface CornerPlan {
  late: number;
  early: number;
  liftAt: number;
  liftFor: number;
  cut: number;
}

export interface HumanOptions {
  device: DeviceKind;
  traits: HumanTraits;
  /** The plan the human drives to: the racing line and a newcomer's speeds on it. */
  plan: DrivingPlan;
  seed: number;
  /** Steering help level for analog devices (the human aims through it); 0–3. */
  steeringHelp: number;
  cues?: CueSource;
}

/** Diagnostics a spin report reads: what the feet and hands were doing. */
export interface HumanState {
  phase: 'straight' | 'braking' | 'turn-in' | 'mid' | 'exit';
  corner: number;
  lifting: boolean;
}

export class Human {
  readonly options: HumanOptions;
  readonly reaction: number;
  private readonly track: Track;
  private readonly rng: Rng;
  private readonly delayTicks: number;
  private readonly seenSlide = new Float64Array(RING);
  private readonly wantThrottle = new Uint8Array(RING);
  private readonly wantBrake = new Uint8Array(RING);
  private head = 0;
  private corners: CornerPlan[] = [];
  private lap = -1;
  private prevS = -1;
  private key = 0;
  private keyHeld = 0;
  private throttleKey = 0;
  private throttleHeld = 0;
  private brakeKey = 0;
  private brakeHeld = 0;
  private stick = 0;
  private noise = 0;
  private liftLeft = 0;
  private liftDone = -1;
  private readonly hint = { index: -1 };
  private readonly q = createPathPoint();
  readonly state: HumanState = { phase: 'straight', corner: 0, lifting: false };

  constructor(options: HumanOptions) {
    this.options = options;
    this.track = options.plan.track;
    this.rng = createRng(options.seed);
    const [r0, r1] = options.traits.reaction;
    this.reaction = r0 + (r1 - r0) * this.rng.next();
    this.delayTicks = Math.round(this.reaction * 240);
  }

  /**
   * The car was put back on the track: forget everything seen and pressed before (delay
   * buffers, keys, a lift in progress), as a player lets go of everything and starts again.
   * The lap and its mistakes carry on.
   */
  reset(): void {
    this.seenSlide.fill(0);
    this.wantThrottle.fill(0);
    this.wantBrake.fill(0);
    this.head = 0;
    this.key = 0;
    this.keyHeld = 0;
    this.throttleKey = 0;
    this.throttleHeld = 0;
    this.brakeKey = 0;
    this.brakeHeld = 0;
    this.stick = 0;
    this.noise = 0;
    this.liftLeft = 0;
    this.hint.index = -1;
  }

  /** A new lap: a new set of mistakes, one per corner. */
  private newLap(): void {
    const t = this.options.traits;
    const r = this.rng;
    const range = (a: readonly [number, number]): number => a[0] + (a[1] - a[0]) * r.next();
    this.corners = this.track.corners.map(() => {
      const lift = r.next() < t.liftChance;
      const cut = r.next() < t.kerbChance ? range(t.kerbCut) : 0;
      return {
        late: range(t.brakeLate),
        early: range(t.throttleEarly),
        liftAt: lift ? r.next() : -1,
        liftFor: 0.25 + 0.35 * r.next(),
        cut,
      };
    });
    this.lap++;
  }

  /**
   * One tick: read the car (as a player sees it) and write the device demand into `out`.
   * `felt` is the steer the car got last tick, which the player feels through their own hands.
   */
  tick(car: CarState, felt: number, dt: number, out: Axes): void {
    const o = this.options;
    const t = o.traits;
    const plan = o.plan;
    const track = this.track;
    const line = plan.line;
    const prof = plan.profile;
    const n = line.count;
    const step = track.lap.step;

    const q = track.project(car.x, car.z, this.hint, this.q);
    const s = q.s;
    if (this.prevS < 0 || this.prevS - s > track.length / 2) this.newLap();
    this.prevS = s;
    const v = Math.max(Math.hypot(car.vx, car.vy), 1);

    // Which corner is next or current, and where in it the car is.
    const ci = this.cornerIndex(s);
    const corner = track.corners[ci]!;
    const cp = this.corners[ci]!;
    const toApex = track.forwardDistance(s, corner.s);
    const pastApex = track.forwardDistance(corner.s, s);
    const inCorner =
      track.forwardDistance(corner.start, s) <= track.forwardDistance(corner.start, corner.end);

    // ---- Where to point the car ----
    const u = s / step;
    const i = Math.floor(u) % n;
    const j = (i + 1) % n;
    const f = u - Math.floor(u);
    // A clumsy apex: the line pulled toward the inside around the apex (kerb strike).
    const nearApex = Math.min(toApex, pastApex);
    const inside = corner.direction === 'left' ? 1 : -1;
    const cut = cp.cut > 0 && nearApex < 40 ? cp.cut * inside * (1 - nearApex / 40) : 0;
    const lineD = line.d[i]! + (line.d[j]! - line.d[i]!) * f + cut;
    const heading = line.heading[i]! + wrapAngle(line.heading[j]! - line.heading[i]!) * f;
    const course = Math.atan2(car.vy, Math.max(car.vx, 0.5));
    const miss = q.d - lineD;
    const e = Math.sign(miss) * Math.max(0, Math.abs(miss) - LINE_SLACK);
    const ePsi = wrapAngle(car.yaw + course - heading);
    const g = t.steer;
    const kAhead = sample(line.curvature, track, s + v * g.preview, n);
    const w = Math.max(g.omegaMin, Math.min(g.omegaMax, g.omegaSpeed / v));
    // Desired rejoin angle sine from lateral error, capped at ~44° so a wide runoff rejoin
    // drives back onto the track instead of overturning past 90°.
    const intercept = Math.max(-0.7, Math.min(0.7, -(w * e) / (2 * g.damping * v)));
    let corr = ((2 * g.damping * w) / v) * (intercept - Math.sin(ePsi));
    corr = Math.max(-0.05, Math.min(0.05, corr));
    const kCmd = kAhead + corr;
    const p = car.model.params;
    const maxSteer = p.geometry.maxSteerAngle;
    const lineSteer =
      (p.geometry.wheelbase * kCmd) / maxSteer + (g.yawKp * (v * kCmd - car.yawRate)) / v;
    const slide = Math.max(0, Math.abs(course) - g.slideSeen);
    const catchSteer = (Math.sign(course) * g.counterSteer * slide) / maxSteer;

    // ---- What the feet want ----
    let brakeWant = 0;
    let throttleWant = 0;
    const vPlan = (at: number): number => sample(prof.v, track, at, n);
    if (t.feet === 'marks' && o.cues) {
      const cue = o.cues.cueAt(s, v);
      brakeWant = cue === LineCue.Brake ? 1 : 0;
      throttleWant = cue === LineCue.Throttle ? 1 : 0;
    } else {
      // Brake when faster than the plan wants a little further on (late) or back (early).
      const target = vPlan(s - cp.late);
      if (v > target + 1) brakeWant = 1;
      else if (v > target - 0.5 && this.brakeKey === 1) brakeWant = 1;
      const phaseHere = prof.phase[Math.floor(track.wrap(s + cp.early) / step) % n]!;
      if (brakeWant === 0) {
        if (phaseHere === Phase.Throttle) throttleWant = 1;
        else if (phaseHere === Phase.Corner) {
          const vt = vPlan(s);
          throttleWant = v < vt - 1 ? 1 : v > vt + 0.5 ? 0 : this.throttleKey;
        }
      }
      // A lift between turn-in and apex, once per corner per lap.
      if (cp.liftAt >= 0 && inCorner && toApex < 200 && this.liftDone !== ci * 1000 + this.lap) {
        const span = track.forwardDistance(corner.start, corner.s);
        const into = track.forwardDistance(corner.start, s);
        if (span > 0 && into / span >= cp.liftAt) {
          this.liftLeft = cp.liftFor;
          this.liftDone = ci * 1000 + this.lap;
        }
      }
    }
    if (this.liftLeft > 0) {
      this.liftLeft -= dt;
      throttleWant = 0;
    }

    // ---- Through the delay: reactions only ----
    const h = this.head;
    this.seenSlide[h] = catchSteer;
    this.wantThrottle[h] = throttleWant;
    this.wantBrake[h] = brakeWant;
    this.head = (h + 1) % RING;
    const d = (h - this.delayTicks + RING) % RING;
    const throttleNow = this.wantThrottle[d]!;
    const brakeNow = this.wantBrake[d]!;
    const steerNow = lineSteer + this.seenSlide[d]!;

    // ---- Hands ----
    if (o.device === 'keyboard') {
      this.keyHeld += dt;
      if (this.keyHeld >= t.tapMin) {
        let next = this.key;
        if (felt < steerNow - t.steerBand) next = steerNow > 0 || felt < 0 ? 1 : 0;
        else if (felt > steerNow + t.steerBand) next = steerNow < 0 || felt > 0 ? -1 : 0;
        else if ((this.key > 0 && felt >= steerNow) || (this.key < 0 && felt <= steerNow)) next = 0;
        // Holding a key away from where the wheel should go: let go first.
        if (next !== this.key) {
          this.key = next;
          this.keyHeld = 0;
        }
      }
      out.steer = this.key;
    } else {
      // The stick is aimed through the steering help: the player learns its gain.
      const scale = steerHelpScale(o.device, o.steeringHelp, car.vx);
      const aim = Math.max(-1, Math.min(1, steerNow / scale));
      const a = 1 - Math.exp(-dt / t.stickLag);
      this.noise += (this.rng.range(-1, 1) * t.stickNoise - this.noise) * 0.05;
      this.stick += (aim - this.stick) * a;
      out.steer = Math.max(-1, Math.min(1, this.stick + this.noise));
    }

    // Feet: digital on keyboard and touch (a thumb on a pedal is all or nothing), analog on a pad.
    this.throttleHeld += dt;
    this.brakeHeld += dt;
    if (this.throttleHeld >= t.tapMin && throttleNow !== this.throttleKey) {
      this.throttleKey = throttleNow;
      this.throttleHeld = 0;
    }
    if (this.brakeHeld >= t.tapMin && brakeNow !== this.brakeKey) {
      this.brakeKey = brakeNow;
      this.brakeHeld = 0;
    }
    out.throttle = this.throttleKey;
    out.brake = this.brakeKey;

    const st = this.state;
    st.corner = corner.number;
    st.lifting = this.liftLeft > 0;
    st.phase =
      this.brakeKey === 1
        ? 'braking'
        : !inCorner
          ? 'straight'
          : toApex < pastApex
            ? toApex > 0.5 * track.forwardDistance(corner.start, corner.s)
              ? 'turn-in'
              : 'mid'
            : 'exit';
  }

  /** Index of the corner the car is in, or the next one ahead. */
  private cornerIndex(s: number): number {
    const cs = this.track.corners;
    let best = 0;
    let bestDist = Infinity;
    for (let k = 0; k < cs.length; k++) {
      const c = cs[k]!;
      const inIt =
        this.track.forwardDistance(c.start, s) <= this.track.forwardDistance(c.start, c.end);
      const dist = inIt ? 0 : this.track.forwardDistance(s, c.start);
      if (dist < bestDist) {
        bestDist = dist;
        best = k;
      }
    }
    return best;
  }
}

/** Value of a per-sample array at centreline `s` (linear interpolation, wraps). */
function sample(a: ArrayLike<number>, track: Track, s: number, n: number): number {
  const u = track.wrap(s) / track.lap.step;
  const i = Math.floor(u) % n;
  const j = (i + 1) % n;
  const f = u - Math.floor(u);
  return a[i]! + (a[j]! - a[i]!) * f;
}
