import {
  SurfaceKind,
  type SurfaceHint,
  type SurfaceSample,
  type SurfaceSampler,
} from '../../src/index';
import { Harness, KMH, MovingAverage, STEP, type Trace } from './harness';
import { SpeedHold, YawRateSteer } from './drivers';

/**
 * Kerb crossings for the contact model: a straight edge along +X with a kerb profile beyond it
 * on the car's left (world −Z), and a car crossing it at a fixed speed and heading, holding its
 * heading. The profiles are the Monza track file's (`packages/track/data/monza.json`): lateral
 * distance beyond the white line (m) against height above the ground plane (m). Beyond an edge
 * the ground falls at 2 % (the track's VERGE_FALL); past the kerb is grass.
 */
export interface KerbProfile {
  name: string;
  points: readonly (readonly [number, number])[];
  /** Lateral range of the raised (sausage) part, if any. */
  high?: readonly [number, number];
}

export const KERB_PROFILES: Readonly<Record<string, KerbProfile>> = Object.freeze({
  flat: {
    name: 'flat',
    points: [
      [0, 0],
      [0.12, 0.035],
      [1.35, 0.05],
      [1.5, 0],
    ],
  },
  exit: {
    name: 'exit',
    points: [
      [0, 0],
      [0.1, 0.02],
      [2.3, 0.03],
      [2.5, 0],
    ],
  },
  chicane: {
    name: 'chicane',
    points: [
      [0, 0],
      [0.12, 0.035],
      [1.4, 0.05],
      [1.6, 0.05],
      [1.75, 0.13],
      [2.05, 0.13],
      [2.2, 0],
    ],
    high: [1.6, 2.2],
  },
});

const VERGE_FALL = 0.02;

/** Ground with one kerb: asphalt for u ≤ 0, the profile over [0, width], grass beyond. */
export class KerbSurface implements SurfaceSampler {
  readonly width: number;
  constructor(readonly profile: KerbProfile) {
    this.width = profile.points[profile.points.length - 1]![0];
  }

  /** Height and lateral slope dh/du at distance u beyond the white line. */
  heightAt(u: number): { h: number; slope: number } {
    if (u <= 0) return { h: 0, slope: 0 };
    let h = -VERGE_FALL * u;
    let slope = -VERGE_FALL;
    const pts = this.profile.points;
    if (u < this.width) {
      let m = 1;
      while (m < pts.length - 1 && pts[m]![0] < u) m++;
      const [u0, h0] = pts[m - 1]!;
      const [u1, h1] = pts[m]!;
      const ds = (h1 - h0) / (u1 - u0);
      h += h0 + ds * (u - u0);
      slope += ds;
    }
    return { h, slope };
  }

  sample(_x: number, z: number, _hint: SurfaceHint, out: SurfaceSample): void {
    const u = -z;
    const { h, slope } = this.heightAt(u);
    // The ground rises toward −Z with slope dh/du, so the normal tilts toward +Z.
    const len = Math.sqrt(1 + slope * slope);
    out.height = h;
    out.normalX = 0;
    out.normalY = 1 / len;
    out.normalZ = slope / len;
    const high = this.profile.high;
    if (u <= 0) {
      out.grip = 1;
      out.drag = 1;
      out.roughness = 0;
      out.kind = SurfaceKind.Asphalt;
    } else if (u < this.width) {
      const raised = high !== undefined && u >= high[0] && u < high[1];
      out.grip = raised ? 0.6 : 0.9;
      out.drag = raised ? 1.5 : 1;
      out.roughness = raised ? 0.06 : 0.012;
      out.kind = SurfaceKind.Kerb;
    } else {
      out.grip = 0.4;
      out.drag = 2;
      out.roughness = 0.03;
      out.kind = SurfaceKind.Grass;
    }
    out.s = Number.NaN;
    out.d = Number.NaN;
  }
}

export interface KerbCrossingOptions {
  profile: string;
  /** Road speed, m/s. */
  speed: number;
  /** Lateral speed across the kerb, m/s (sets the heading toward it). */
  lateral: number;
  trim?: 'low' | 'medium' | 'high';
  record?: boolean;
  /**
   * Where to stop: 'over' (default) once the left wheels are 0.3 m past the kerb's outer edge;
   * 'crest' once the left rear wheel reaches the crest (the last point before the profile falls
   * away or a raised part starts), i.e. riding the kerb the way a racing line may use it.
   */
  until?: 'over' | 'crest';
}

/** The crest of a profile: the last point before it falls toward the verge or rises to a sausage. */
export function kerbCrest(p: KerbProfile): number {
  const pts = p.points;
  let crest = pts[pts.length - 1]![0];
  for (let m = pts.length - 1; m > 0; m--) {
    if (pts[m]![1] < pts[m - 1]![1]) crest = pts[m - 1]![0];
    else break;
  }
  return p.high ? Math.min(crest, p.high[0]) : crest;
}

/** Per-wheel summary of a crossing. FL, FR, RL, RR. */
export interface KerbCrossingResult {
  profile: string;
  speed: number;
  lateral: number;
  /** Static-in-motion load per wheel just before the kerb, N. */
  baseLoad: number[];
  maxLoad: number[];
  minLoad: number[];
  /** Time each wheel spent with no load, s. */
  airborne: number[];
  /** Largest carcass damping force, N (absolute). */
  maxDamping: number[];
  /** Largest tick-to-tick load change, N. */
  maxLoadStep: number[];
  maxPlankForce: number;
  minRideFront: number;
  /** Largest yaw-rate and sideslip excursion while crossing, deg/s and deg. */
  maxYawRateDev: number;
  maxSideslip: number;
  /** Largest 50 ms lateral acceleration, g. */
  maxLatG: number;
  trace?: Trace;
}

export const KERB_TRACE_COLUMNS = [
  't',
  'u_fl',
  'load_fl',
  'load_fr',
  'load_rl',
  'load_rr',
  'damp_fl',
  'damp_fr',
  'damp_rl',
  'damp_rr',
  'defl_fl_mm',
  'defl_fr_mm',
  'defl_rl_mm',
  'defl_rr_mm',
  'plank_n',
  'ride_f_mm',
  'ride_r_mm',
  'yaw_rate_dps',
  'sideslip_deg',
  'lat_g',
] as const;

/**
 * Drive across a kerb: start with the left wheels 0.4 m inside the white line, heading toward
 * the kerb so the car crosses at `lateral` m/s, hold speed and heading, and stop once the left
 * wheels are 0.3 m past the kerb's outer edge.
 */
export function kerbCrossing(o: KerbCrossingOptions): KerbCrossingResult {
  const profile = KERB_PROFILES[o.profile];
  if (!profile) throw new Error(`unknown kerb profile ${o.profile}`);
  const surface = new KerbSurface(profile);
  const h = new Harness({
    trim: o.trim ?? 'low',
    fuel: 10,
    speed: o.speed,
    airDensity: 1.17,
    surface,
  });
  const car = h.car;
  const half = car.model.wheelLeft[0]!;
  const R = car.model.params.tyre.freeRadius;
  // Left front wheel at u = −0.4 m: wheel z = car z − 0.81 (yaw 0), u = −z.
  car.z = half + 0.4;
  const hold = new SpeedHold(o.speed);
  const steer = new YawRateSteer(0);
  // Settle on the flat first, then turn the velocity toward the kerb without yaw.
  for (let k = 0; k < 240; k++) {
    hold.tick(h);
    steer.tick(h);
    h.step();
  }
  car.z = half + 0.4;
  const theta = Math.asin(Math.min(1, o.lateral / o.speed));
  car.yaw = theta;
  car.yawRate = 0;
  car.vy = 0;
  const baseLoad = Array.from(car.load);
  const maxLoad = [...baseLoad];
  const minLoad = [...baseLoad];
  const airborne = [0, 0, 0, 0];
  const maxDamping = [0, 0, 0, 0];
  const maxLoadStep = [0, 0, 0, 0];
  const prev = Array.from(car.load);
  let maxPlank = 0;
  let minRide = Infinity;
  let maxYaw = 0;
  let maxBeta = 0;
  const lat = new MovingAverage(Math.round(0.05 / STEP));
  let maxLat = 0;
  const trace: Trace | undefined = o.record ? { columns: KERB_TRACE_COLUMNS, rows: [] } : undefined;
  const deg = 180 / Math.PI;
  const uFL = (): number =>
    -(car.z - Math.sin(car.yaw) * car.model.params.geometry.wheelbase * 0.5 - half);
  // 'crest': stop as the front-left patch's outer edge reaches the crest.
  const endU =
    o.until === 'crest'
      ? kerbCrest(profile) - car.model.params.tyre.patchWidthFront / 2
      : surface.width + 0.3;
  while (h.time < 30) {
    hold.tick(h);
    steer.targetYawRate = 0;
    steer.tick(h);
    h.step();
    for (let i = 0; i < 4; i++) {
      const f = car.load[i]!;
      maxLoad[i] = Math.max(maxLoad[i]!, f);
      minLoad[i] = Math.min(minLoad[i]!, f);
      if (f <= 0) airborne[i] = airborne[i]! + STEP;
      maxDamping[i] = Math.max(maxDamping[i]!, Math.abs(car.tyreDamping[i]!));
      maxLoadStep[i] = Math.max(maxLoadStep[i]!, Math.abs(f - prev[i]!));
      prev[i] = f;
    }
    maxPlank = Math.max(maxPlank, car.plankForce);
    minRide = Math.min(minRide, car.rideHeightFront);
    maxYaw = Math.max(maxYaw, Math.abs(car.yawRate) * deg);
    const beta = Math.atan2(car.vy, Math.max(car.vx, 1)) * deg;
    maxBeta = Math.max(maxBeta, Math.abs(beta));
    const a = lat.push(h.tel.latG);
    if (lat.full) maxLat = Math.max(maxLat, Math.abs(a));
    const u = uFL();
    if (trace) {
      const defl = [0, 1, 2, 3].map((i) => (car.groundY[i]! + R - car.wheelY[i]!) * 1000);
      trace.rows.push([
        h.time,
        u,
        ...Array.from(car.load),
        ...Array.from(car.tyreDamping),
        ...defl,
        car.plankForce,
        car.rideHeightFront * 1000,
        car.rideHeightRear * 1000,
        car.yawRate * deg,
        beta,
        h.tel.latG,
      ]);
    }
    if (u > endU) break;
  }
  const r: KerbCrossingResult = {
    profile: o.profile,
    speed: o.speed,
    lateral: o.lateral,
    baseLoad,
    maxLoad,
    minLoad,
    airborne,
    maxDamping,
    maxLoadStep,
    maxPlankForce: maxPlank,
    minRideFront: minRide,
    maxYawRateDev: maxYaw,
    maxSideslip: maxBeta,
    maxLatG: maxLat,
  };
  if (trace) r.trace = trace;
  return r;
}

/** The crossings the doc reports: each profile at representative speeds and angles. */
export const KERB_CASES: readonly KerbCrossingOptions[] = [
  { profile: 'flat', speed: 100 * KMH, lateral: 2 },
  { profile: 'flat', speed: 200 * KMH, lateral: 5 },
  { profile: 'exit', speed: 200 * KMH, lateral: 3 },
  { profile: 'exit', speed: 250 * KMH, lateral: 5 },
  { profile: 'chicane', speed: 80 * KMH, lateral: 2 },
  { profile: 'chicane', speed: 120 * KMH, lateral: 4 },
];
