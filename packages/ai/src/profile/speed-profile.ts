import { STANDARD_GRAVITY } from '@undercut/sim';
import type { EnvelopeModel, EnvelopeScale } from '../envelope/envelope';
import { FULL_ENVELOPE } from '../envelope/envelope';
import type { LineGeometry } from '../line/geometry';

/**
 * Quasi-steady-state speed profile along a racing line: the fastest speed at every sample that
 * the measured envelope allows, from the classic three steps.
 *
 * 1. Corner limit: the highest speed at which the lateral demand fits the lateral limit.
 * 2. Forward pass: accelerate from every corner limit with what the engine and the tyres allow
 *    (the tyres share their grip with the lateral demand along the combined limit).
 * 3. Backward pass: brake into every corner limit the same way.
 *
 * The ground enters through three terms. Grade adds −g·sinθ along the line. Banking tilts the
 * lateral demand (v²κ·cosφ + g·sinφ in the track plane) and the normal load. Vertical
 * curvature adds v²·κv to the normal load, which reads the load-dependent tables: a crest
 * unloads the tyres, a compression loads them.
 */
export interface ProfileOptions {
  /** Fractions of the envelope to use. Default all of it. */
  scale?: EnvelopeScale;
  /** Per sample: DRS may be open here (qualifying: inside a zone). Default none. */
  drs?: Uint8Array;
  /** Per sample: the MGU-K deploys here at full throttle. Default everywhere. */
  ers?: Uint8Array;
  gravity?: number;
}

export const enum Phase {
  /** Held at the corner limit. */
  Corner = 0,
  /** Accelerating at full throttle (engine- or traction-limited). */
  Throttle = 1,
  /** Braking at the limit. */
  Brake = 2,
}

export interface SpeedProfile {
  /** Speed at each line sample, m/s. */
  readonly v: Float64Array;
  /** Longitudinal acceleration over the segment from sample i to i + 1, m/s². */
  readonly ax: Float64Array;
  /** Lateral demand in the track plane at sample i, m/s² (left positive). */
  readonly ay: Float64Array;
  /** The corner-limit speed at each sample, m/s. */
  readonly limit: Float64Array;
  /** Phase over each segment (see `Phase`). */
  readonly phase: Uint8Array;
  /** Whether DRS is open and the MGU-K deploying over each segment. */
  readonly drsOpen: Uint8Array;
  readonly deploying: Uint8Array;
  /** Time at each sample from sample 0, s, and the lap time. */
  readonly time: Float64Array;
  readonly lapTime: number;
  /** Energy drawn from the store by the MGU-K over the lap, J, and harvested into it. */
  readonly deployEnergy: number;
  readonly harvestEnergy: number;
}

/** Per-sample ground terms, precomputed once per line. */
interface Ground {
  cosPhi: Float64Array;
  sinPhi: Float64Array;
  cosTheta: Float64Array;
  sinTheta: Float64Array;
  kv: Float64Array;
}

const groundCache = new WeakMap<LineGeometry, Ground>();

function groundOf(line: LineGeometry): Ground {
  const cached = groundCache.get(line);
  if (cached) return cached;
  const n = line.count;
  const cosPhi = new Float64Array(n);
  const sinPhi = new Float64Array(n);
  const cosTheta = new Float64Array(n);
  const sinTheta = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const phi = Math.atan(line.tanBank[i]!);
    cosPhi[i] = Math.cos(phi);
    sinPhi[i] = Math.sin(phi);
    const th = Math.atan(line.grade[i]!);
    cosTheta[i] = Math.cos(th);
    sinTheta[i] = Math.sin(th);
  }
  // The elevation is stored to the millimetre, so its second difference over 2 m is noisy:
  // smooth vertical curvature over about 40 m (two box passes) before it reaches the tyres.
  const kv = boxSmooth(boxSmooth(line.verticalCurvature, 10), 10);
  const g: Ground = { cosPhi, sinPhi, cosTheta, sinTheta, kv };
  groundCache.set(line, g);
  return g;
}

function boxSmooth(a: ArrayLike<number>, half: number): Float64Array {
  const n = a.length;
  const out = new Float64Array(n);
  let sum = 0;
  for (let k = -half; k <= half; k++) sum += a[(k + n) % n]!;
  for (let i = 0; i < n; i++) {
    out[i] = sum / (2 * half + 1);
    sum += a[(i + half + 1) % n]! - a[(i - half + n) % n]!;
  }
  return out;
}

/** Computes speed profiles for one line and envelope; reusable across option sets. */
export class SpeedProfiler {
  readonly line: LineGeometry;
  readonly model: EnvelopeModel;
  private readonly ground: Ground;
  private readonly g: number;

  constructor(line: LineGeometry, model: EnvelopeModel, gravity = STANDARD_GRAVITY) {
    this.line = line;
    this.model = model;
    this.ground = groundOf(line);
    this.g = gravity;
  }

  /** Normal load factor at sample i and speed v. */
  load(i: number, v: number): number {
    const gr = this.ground;
    const k = this.line.curvature[i]!;
    return (
      (this.g * gr.cosTheta[i]! * gr.cosPhi[i]! - v * v * k * gr.sinPhi[i]! + v * v * gr.kv[i]!) /
      STANDARD_GRAVITY
    );
  }

  /** Lateral demand in the track plane, m/s², left positive. */
  lateralDemand(i: number, v: number): number {
    const gr = this.ground;
    return (
      v * v * this.line.curvature[i]! * gr.cosPhi[i]! + this.g * gr.cosTheta[i]! * gr.sinPhi[i]!
    );
  }

  lateralLimit(i: number, v: number, scale: EnvelopeScale): number {
    return this.model.lateral(v, this.load(i, v)) * scale.lateral * this.line.grip[i]!;
  }

  /** Fraction of the lateral limit used at sample i and speed v. */
  lateralUse(i: number, v: number, scale: EnvelopeScale): number {
    const lim = this.lateralLimit(i, v, scale);
    return lim > 0 ? Math.abs(this.lateralDemand(i, v)) / lim : Infinity;
  }

  /** Highest speed at which sample i's lateral demand fits, up to `vtop`. */
  cornerLimit(i: number, vtop: number, scale: EnvelopeScale): number {
    if (this.lateralUse(i, vtop, scale) <= 1) return vtop;
    // Fixed point v² = (limit(v) − sign(κ)·g·sinφ) / (|κ|·cosφ): the limit grows more slowly
    // than v², so the iteration settles from above in a few steps.
    const gr = this.ground;
    const k = this.line.curvature[i]!;
    const ak = Math.abs(k) * gr.cosPhi[i]!;
    const b = (k >= 0 ? 1 : -1) * this.g * gr.cosTheta[i]! * gr.sinPhi[i]!;
    let v = vtop;
    for (let it = 0; it < 12 && ak > 0; it++) {
      const next = Math.sqrt(Math.max(0, this.lateralLimit(i, v, scale) - b) / ak);
      if (Math.abs(next - v) < 1e-4) {
        v = next;
        break;
      }
      v = Math.min(vtop, next);
    }
    if (v > 0.5 && this.lateralUse(i, v, scale) <= 1 + 1e-6) return v;
    // Fall back to a scan and bisection where the iteration did not settle.
    let hi = vtop;
    let lo = vtop;
    const step = 2;
    while (lo > step && this.lateralUse(i, lo, scale) > 1) {
      hi = lo;
      lo -= step;
    }
    if (this.lateralUse(i, lo, scale) > 1) return lo;
    for (let it = 0; it < 30; it++) {
      const mid = 0.5 * (lo + hi);
      if (this.lateralUse(i, mid, scale) <= 1) lo = mid;
      else hi = mid;
    }
    return lo;
  }

  /** Acceleration available at full throttle at sample i, speed v. */
  driveAccel(i: number, v: number, drs: boolean, ers: boolean, scale: EnvelopeScale): number {
    const m = this.model;
    const gr = this.ground;
    const slope = this.g * gr.sinTheta[i]!;
    const engine = m.drive(v, drs, ers) - slope;
    const load = this.load(i, v);
    const left = m.remaining(this.lateralUse(i, v, scale));
    const tyre =
      m.traction(v, load) * scale.traction * this.line.grip[i]! * left - m.drag(v, drs) - slope;
    return engine < tyre ? engine : tyre;
  }

  /** Deceleration available at the braking limit at sample i, speed v (positive). */
  brakeDecel(i: number, v: number, scale: EnvelopeScale): number {
    const m = this.model;
    const gr = this.ground;
    const load = this.load(i, v);
    const left = m.remaining(this.lateralUse(i, v, scale));
    return (
      m.brake(v, load) * scale.brake * this.line.grip[i]! * left +
      m.drag(v, false) +
      this.g * gr.sinTheta[i]!
    );
  }

  /** Engine-limited at sample i and speed v (so the MGU-K adds speed here)? */
  engineLimited(i: number, v: number, drs: boolean, scale: EnvelopeScale): boolean {
    const m = this.model;
    const load = this.load(i, v);
    const left = m.remaining(this.lateralUse(i, v, scale));
    const tyre = m.traction(v, load) * scale.traction * this.line.grip[i]! * left - m.drag(v, drs);
    return m.drive(v, drs, false) < tyre - 1e-3;
  }

  compute(options: ProfileOptions = {}): SpeedProfile {
    const line = this.line;
    const n = line.count;
    const scale = options.scale ?? FULL_ENVELOPE;
    const drs = options.drs ?? new Uint8Array(n);
    const ers = options.ers ?? new Uint8Array(n).fill(1);
    const m = this.model;
    const vtopClosed = m.envelope.topSpeed.closed;
    const vtopOpen = m.envelope.topSpeed.open;
    const limit = new Float64Array(n);
    let i0 = 0;
    for (let i = 0; i < n; i++) {
      limit[i] = this.cornerLimit(i, drs[i] ? vtopOpen : vtopClosed, scale);
      if (limit[i]! < limit[i0]!) i0 = i;
    }
    // Forward pass, two laps from the slowest point so the wrap is settled.
    const vf = new Float64Array(n);
    let v = limit[i0]!;
    for (let k = 0; k < 2 * n; k++) {
      const i = (i0 + k) % n;
      const j = (i + 1) % n;
      v = Math.min(v, limit[i]!);
      vf[i] = v;
      const ds = line.ds[i]!;
      const open = drs[i] === 1;
      const dep = ers[i] === 1;
      const a1 = this.driveAccel(i, v, open, dep, scale);
      const vm = Math.sqrt(Math.max(v * v + a1 * ds, 1));
      const a2 = this.driveAccel(i, vm, open, dep, scale);
      v = Math.min(Math.sqrt(Math.max(v * v + 2 * a2 * ds, 1)), limit[j]!);
    }
    // Backward pass.
    const vb = new Float64Array(n);
    const phase = new Uint8Array(n);
    v = vf[i0]!;
    for (let k = 0; k < 2 * n; k++) {
      const i = (i0 - k + 2 * n) % n;
      const ip = (i - 1 + n) % n; // segment ip → i
      vb[i] = Math.min(v, vf[i]!);
      v = vb[i]!;
      const ds = line.ds[ip]!;
      const b1 = this.brakeDecel(ip, v, scale);
      const vm = Math.sqrt(v * v + b1 * ds);
      const b2 = this.brakeDecel(ip, vm, scale);
      const vBrake = Math.sqrt(v * v + 2 * b2 * ds);
      v = vBrake;
    }
    // Segment quantities, energy and time.
    const ax = new Float64Array(n);
    const ay = new Float64Array(n);
    const time = new Float64Array(n);
    const drsOpen = new Uint8Array(n);
    const deploying = new Uint8Array(n);
    let t = 0;
    let deployEnergy = 0;
    let harvestEnergy = 0;
    const mgukPower = m.envelope.ers.mgukPower;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const ds = line.ds[i]!;
      const v0 = vb[i]!;
      const v1 = vb[j]!;
      ax[i] = (v1 * v1 - v0 * v0) / (2 * ds);
      ay[i] = this.lateralDemand(i, v0);
      const dt = (2 * ds) / (v0 + v1);
      time[i] = t;
      t += dt;
      const vm = 0.5 * (v0 + v1);
      const full = this.driveAccel(i, v0, drs[i] === 1, ers[i] === 1, scale);
      const braking = v1 < vf[j]! - 1e-6 && ax[i]! < 0;
      if (braking) phase[i] = Phase.Brake;
      else if (ax[i]! > 0 && ax[i]! >= 0.97 * full) phase[i] = Phase.Throttle;
      else phase[i] = Phase.Corner;
      drsOpen[i] = drs[i] === 1 && !braking ? 1 : 0;
      if (
        phase[i] === Phase.Throttle &&
        ers[i] === 1 &&
        this.engineLimited(i, v0, drsOpen[i] === 1, scale)
      ) {
        deploying[i] = 1;
        deployEnergy += Math.max(0, mgukPower - m.mguh(vm)) * dt;
      } else if (phase[i] === Phase.Brake) {
        harvestEnergy += m.harvest(vm) * dt;
      }
    }
    return {
      v: vb,
      ax,
      ay,
      limit,
      phase,
      drsOpen,
      deploying,
      time,
      lapTime: t,
      deployEnergy,
      harvestEnergy,
    };
  }
}
