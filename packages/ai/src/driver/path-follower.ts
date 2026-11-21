import type { CarParams, CarTelemetry, ControlInput } from '@undercut/sim';

/**
 * Follows a given path at low and medium speed: the pit lane and the run into and out of it.
 * The path is a world polyline (x, z) with a speed cap at each point; the follower steers by
 * pure pursuit, brakes on a fixed deceleration curve for the caps ahead (and for a stop at the
 * end, if asked), limits throttle to keep the driven wheels from spinning, and changes gear on
 * engine speed. It produces only a `ControlInput`, like every driver.
 *
 * This is the AI's pit-lane behaviour (and the assisted pit lane a player can choose). It is
 * deliberately plain: the racing line and its speed profile stay the reference driver's job.
 */
export interface FollowerGains {
  /** Pure-pursuit look-ahead: base distance plus seconds of travel, held in [min, max], m. */
  lookBase: number;
  lookTime: number;
  lookMin: number;
  lookMax: number;
  /** Deceleration planned for the speed caps ahead, and for the final stop, m/s². */
  brakeDecel: number;
  stopDecel: number;
  /** Lateral acceleration the speed cap from path curvature allows, m/s². */
  lateralAccel: number;
  /** Pedal gains per m/s of speed error. */
  throttleGain: number;
  brakeGain: number;
  /** Driven-wheel slip ratio above which throttle is reduced. */
  slipLimit: number;
  /** Gear change rpm and the minimum time between changes, s. */
  upshiftRpm: number;
  downshiftRpm: number;
  shiftHold: number;
}

export const FOLLOWER_GAINS: Readonly<FollowerGains> = Object.freeze({
  lookBase: 4,
  lookTime: 0.45,
  lookMin: 6,
  lookMax: 30,
  brakeDecel: 16,
  stopDecel: 6,
  lateralAccel: 18,
  throttleGain: 0.35,
  brakeGain: 0.3,
  slipLimit: 0.12,
  upshiftRpm: 11000,
  downshiftRpm: 6500,
  shiftHold: 0.3,
});

export interface FollowPoint {
  x: number;
  z: number;
  /** Speed cap at this point, m/s (Infinity for none). */
  v: number;
}

export class PathFollower {
  readonly gains: FollowerGains;
  private readonly params: CarParams;
  private x = new Float64Array(0);
  private z = new Float64Array(0);
  private cap = new Float64Array(0);
  /** Cumulative distance at each point. */
  private dist = new Float64Array(0);
  private stopAtEnd = false;
  private hint = 0;
  private throttleCap = 1;
  private shiftTimer = 0;
  private progressValue = 0;

  constructor(params: CarParams, gains: Partial<FollowerGains> = {}) {
    this.params = params;
    this.gains = { ...FOLLOWER_GAINS, ...gains };
  }

  /** Distance along the path of the car's last projection, m. */
  get progress(): number {
    return this.progressValue;
  }

  /** Length of the path, m. */
  get length(): number {
    return this.dist.length > 0 ? this.dist[this.dist.length - 1]! : 0;
  }

  /** Follow `points` from the start; stop at the last one when `stopAtEnd`. */
  setPath(points: readonly FollowPoint[], stopAtEnd: boolean): void {
    const n = points.length;
    if (n < 2) throw new RangeError('a path needs two or more points');
    this.x = new Float64Array(n);
    this.z = new Float64Array(n);
    this.cap = new Float64Array(n);
    this.dist = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const p = points[i]!;
      this.x[i] = p.x;
      this.z[i] = p.z;
      this.cap[i] = p.v;
      if (i > 0) {
        this.dist[i] =
          this.dist[i - 1]! + Math.hypot(p.x - points[i - 1]!.x, p.z - points[i - 1]!.z);
      }
    }
    // Curvature caps: three-point curvature at each interior point.
    const g = this.gains;
    for (let i = 1; i < n - 1; i++) {
      const ax = this.x[i]! - this.x[i - 1]!;
      const az = this.z[i]! - this.z[i - 1]!;
      const bx = this.x[i + 1]! - this.x[i]!;
      const bz = this.z[i + 1]! - this.z[i]!;
      const la = Math.hypot(ax, az);
      const lb = Math.hypot(bx, bz);
      if (la < 1e-6 || lb < 1e-6) continue;
      const turn = Math.abs(Math.atan2(ax * bz - az * bx, ax * bx + az * bz));
      const k = (2 * turn) / (la + lb);
      if (k > 1e-6) this.cap[i] = Math.min(this.cap[i]!, Math.sqrt(g.lateralAccel / k));
    }
    this.stopAtEnd = stopAtEnd;
    this.hint = 0;
    this.progressValue = 0;
  }

  /** Forget carried state (after a teleport). */
  reset(): void {
    this.hint = 0;
    this.throttleCap = 1;
    this.shiftTimer = 0;
  }

  /** Distance left to the end of the path, m. */
  remaining(): number {
    return Math.max(0, this.length - this.progressValue);
  }

  drive(tel: CarTelemetry, dt: number, out: ControlInput): ControlInput {
    const g = this.gains;
    const n = this.x.length;
    const v = Math.max(0, tel.speed);
    const u = this.project(tel.x, tel.z);
    this.progressValue = u;
    const total = this.length;

    // ---- Steering: pure pursuit. ----
    const look = Math.min(g.lookMax, Math.max(g.lookMin, g.lookBase + g.lookTime * v));
    const target = Math.min(total, u + look);
    let tx: number;
    let tz: number;
    if (u + look > total && n >= 2) {
      // Past the end: extend the last segment.
      const ex = this.x[n - 1]! - this.x[n - 2]!;
      const ez = this.z[n - 1]! - this.z[n - 2]!;
      const el = Math.hypot(ex, ez) || 1;
      const over = u + look - total;
      tx = this.x[n - 1]! + (ex / el) * over;
      tz = this.z[n - 1]! + (ez / el) * over;
    } else {
      [tx, tz] = this.pointAt(target);
    }
    const dx = tx - tel.x;
    const dz = tz - tel.z;
    const c = Math.cos(tel.yaw);
    const s = Math.sin(tel.yaw);
    const ahead = dx * c - dz * s;
    const left = -dx * s - dz * c;
    const d2 = Math.max(1, ahead * ahead + left * left);
    const curvature = (2 * left) / d2;
    const p = this.params;
    const angle = Math.atan(curvature * p.geometry.wheelbase);
    const steer = Math.max(-1, Math.min(1, angle / p.geometry.maxSteerAngle));

    // ---- Speed target: caps ahead on a braking curve, and the stop. ----
    let vt = Infinity;
    const reach = (v * v) / (2 * g.brakeDecel) + 20;
    for (let i = this.hint; i < n && this.dist[i]! - u <= reach; i++) {
      const ds = Math.max(0, this.dist[i]! - u);
      vt = Math.min(vt, Math.sqrt(this.cap[i]! * this.cap[i]! + 2 * g.brakeDecel * ds));
    }
    let toStop = Infinity;
    if (this.stopAtEnd) {
      toStop = total - u;
      vt = Math.min(vt, Math.sqrt(2 * g.stopDecel * Math.max(0, toStop - 0.1)));
    }

    // ---- Pedals. ----
    let throttle = 0;
    let brake = 0;
    const err = vt - v;
    if (this.stopAtEnd && toStop < 0.4) {
      brake = 1;
    } else if (err > 0) {
      throttle = Math.min(1, g.throttleGain * err + (v < 2 ? 0.15 : 0));
    } else {
      brake = Math.min(1, -g.brakeGain * err);
    }
    // Wheelspin: driven (rear) wheels' slip ratio.
    const slip = Math.max(tel.slipRatio[2] ?? 0, tel.slipRatio[3] ?? 0);
    if (slip > g.slipLimit) this.throttleCap = Math.max(0.05, this.throttleCap - 6 * dt);
    else this.throttleCap = Math.min(1, this.throttleCap + 2 * dt);
    throttle = Math.min(throttle, this.throttleCap);

    // ---- Gears. ----
    let shift: -1 | 0 | 1 = 0;
    this.shiftTimer = Math.max(0, this.shiftTimer - dt);
    if (!tel.shifting && this.shiftTimer === 0) {
      const top = p.gearbox.ratios.length;
      if (tel.gear < 1) shift = 1;
      else if (tel.engineRpm > g.upshiftRpm && throttle > 0.2 && tel.gear < top) shift = 1;
      else if (tel.engineRpm < g.downshiftRpm && tel.gear > 1) shift = -1;
      if (shift !== 0) this.shiftTimer = g.shiftHold;
    }

    out.steer = steer;
    out.throttle = throttle;
    out.brake = brake;
    out.gearShift = shift;
    out.drs = false;
    out.overtake = false;
    out.pitLimiter = false;
    return out;
  }

  /** Distance along the path of the nearest point to (x, z), searched forward from the hint. */
  private project(px: number, pz: number): number {
    const n = this.x.length;
    let best = Infinity;
    let bestU = this.progressValue;
    let bestI = this.hint;
    const from = Math.max(0, this.hint - 4);
    const to = Math.min(n - 1, this.hint + 60);
    for (let i = from; i < to; i++) {
      const ax = this.x[i]!;
      const az = this.z[i]!;
      const bx = this.x[i + 1]! - ax;
      const bz = this.z[i + 1]! - az;
      const l2 = bx * bx + bz * bz;
      const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * bx + (pz - az) * bz) / l2)) : 0;
      const qx = ax + bx * t - px;
      const qz = az + bz * t - pz;
      const d = qx * qx + qz * qz;
      if (d < best) {
        best = d;
        bestI = i;
        bestU = this.dist[i]! + t * (this.dist[i + 1]! - this.dist[i]!);
      }
    }
    this.hint = bestI;
    return bestU;
  }

  private pointAt(u: number): [number, number] {
    const n = this.x.length;
    let i = this.hint;
    while (i + 1 < n - 1 && this.dist[i + 1]! < u) i++;
    while (i > 0 && this.dist[i]! > u) i--;
    const seg = this.dist[i + 1]! - this.dist[i]!;
    const t = seg > 0 ? Math.max(0, Math.min(1, (u - this.dist[i]!) / seg)) : 0;
    return [
      this.x[i]! + (this.x[i + 1]! - this.x[i]!) * t,
      this.z[i]! + (this.z[i + 1]! - this.z[i]!) * t,
    ];
  }
}
