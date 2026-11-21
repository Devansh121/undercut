import { SurfaceKind } from '@undercut/sim';
import {
  BARRIER_TYPES,
  validateTrackData,
  type BarrierType,
  type CornerData,
  type RunoffKind,
  type Run,
  type Side,
  type TrackData,
} from './data';
import { TrackPath, createPathPoint, createVec3, type PathPoint, type Vec3 } from './path';

/** Lateral fall of the ground beyond the track edge (drainage), metres per metre. */
export const VERGE_FALL = 0.02;

export const LEFT = 0;
export const RIGHT = 1;
export type SideIndex = typeof LEFT | typeof RIGHT;

const RUNOFF_SURFACE: Record<RunoffKind, SurfaceKind> = {
  asphalt: SurfaceKind.RunoffAsphalt,
  grass: SurfaceKind.Grass,
  gravel: SurfaceKind.Gravel,
};

export interface KerbProfile {
  readonly name: string;
  readonly width: number;
  readonly u: Float64Array;
  readonly h: Float64Array;
  /** Raised (sausage) part of the profile, as a range of u; empty when from >= to. */
  readonly highFrom: number;
  readonly highTo: number;
}

/** A position and heading on the ground. Yaw is about +Y; 0 faces +X, positive turns left. */
export interface Pose {
  readonly s: number;
  readonly d: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
}

export interface DrsZone {
  readonly detection: number;
  readonly activation: number;
  readonly end: number;
}

/** A barrier run, as a polyline at the barrier's track-side face. */
export interface Barrier {
  readonly type: BarrierType;
  /** Which edge it guards: the lap's left or right, or the pit lane's garage side. */
  readonly side: Side | 'pit';
  /** x, y, z per vertex (y is the ground height). */
  readonly points: Float64Array;
  /** s of each vertex: lap s, or s_pit for the pit lane. */
  readonly s: Float64Array;
  readonly closed: boolean;
}

/** Ground cross-section at a point: filled in place by `Track.ground`. */
export interface Ground {
  /** World height of the ground. */
  height: number;
  /** Height change per metre of d and per metre along the centreline. */
  slopeD: number;
  slopeS: number;
  kind: SurfaceKind;
  /** True on the raised part of a kerb profile. */
  highKerb: boolean;
  /** Sample index of the lap used for the discrete zone data. */
  sample: number;
}

export function createGround(): Ground {
  return { height: 0, slopeD: 0, slopeS: 0, kind: SurfaceKind.Asphalt, highKerb: false, sample: 0 };
}

function unrun<T, U>(
  runs: readonly Run<T>[],
  n: number,
  map: (v: T) => U,
  into: { [i: number]: U },
): void {
  for (let r = 0; r < runs.length; r++) {
    const [first, v] = runs[r]!;
    const end = r + 1 < runs.length ? runs[r + 1]![0] : n;
    const m = map(v);
    for (let i = first; i < end; i++) into[i] = m;
  }
}

/** The pit lane: an open path in its own (s_pit, d) frame, linked to the lap at both ends. */
export class PitLane {
  readonly path: TrackPath;
  readonly side: Side;
  /** Lap s where the pit lane leaves the track (s_pit = 0) and rejoins it (s_pit = length). */
  readonly entryS: number;
  readonly exitS: number;
  readonly length: number;
  /** Speed limit in m/s between limitStart and limitEnd (s_pit). */
  readonly speedLimit: number;
  readonly limitStart: number;
  readonly limitEnd: number;
  readonly halfWidthLeft: Float64Array;
  readonly halfWidthRight: Float64Array;
  readonly boxes: readonly Pose[];
  readonly garageWall: readonly [number, number];

  constructor(data: TrackData['pit']) {
    this.path = new TrackPath(data.x, data.y, data.z, data.length, false);
    this.side = data.side;
    this.entryS = data.entryS;
    this.exitS = data.exitS;
    this.length = data.length;
    this.speedLimit = data.speedLimit;
    this.limitStart = data.limitStart;
    this.limitEnd = data.limitEnd;
    this.halfWidthLeft = Float64Array.from(data.halfWidthLeft);
    this.halfWidthRight = Float64Array.from(data.halfWidthRight);
    this.garageWall = [data.garageWall[0], data.garageWall[1]];
    const p = createVec3();
    const t = createVec3();
    this.boxes = data.boxes.map((b) => {
      this.path.pointAt(b.s, b.d, p);
      this.path.tangent(b.s, t);
      return { s: b.s, d: b.d, x: p.x, y: p.y, z: p.z, yaw: Math.atan2(-t.z, t.x) };
    });
  }

  /** True between the speed-limit lines. */
  inSpeedLimit(sPit: number): boolean {
    return sPit >= this.limitStart && sPit <= this.limitEnd;
  }

  halfWidth(sPit: number, side: SideIndex): number {
    return this.path.interpolate(side === LEFT ? this.halfWidthLeft : this.halfWidthRight, sPit);
  }
}

/**
 * The runtime track: the lap's (s, d) frame with widths, banking and lateral zones, the pit
 * lane, timing lines, grid slots, barriers and track limits. Built once from validated data;
 * per-tick queries do not allocate.
 */
export class Track {
  readonly data: TrackData;
  readonly id: string;
  readonly name: string;
  /** Lap length (s range). */
  readonly length: number;
  readonly lap: TrackPath;
  readonly pit: PitLane;
  readonly lineWidth: number;
  readonly bank: Float64Array;
  readonly tanBank: Float64Array;
  /** Per side ([LEFT, RIGHT]) and sample. */
  readonly halfWidth: readonly [Float64Array, Float64Array];
  readonly kerb: readonly [Int16Array, Int16Array];
  readonly inner: readonly [Uint8Array, Uint8Array];
  readonly outer: readonly [Uint8Array, Uint8Array];
  readonly split: readonly [Float64Array, Float64Array];
  readonly barrier: readonly [Float64Array, Float64Array];
  readonly barrierType: readonly [Uint8Array, Uint8Array];
  readonly kerbProfiles: readonly KerbProfile[];
  readonly corners: readonly CornerData[];
  /** Start s of each sector; the first is 0. */
  readonly sectors: Float64Array;
  readonly speedTrap: number;
  readonly drsZones: readonly DrsZone[];
  readonly gridSlots: readonly Pose[];
  readonly barriers: readonly Barrier[];
  /** White-line outer edges (track limits) as closed x, z polylines, one point per sample. */
  readonly trackLimits: readonly [Float64Array, Float64Array];
  /** Per lap sample, a pit-path sample near it when the pit lane runs alongside, else -1. */
  readonly pitNear: Int32Array;
  readonly pitSide: SideIndex;

  private readonly tmp = createVec3();

  static fromJSON(raw: unknown): Track {
    return new Track(validateTrackData(raw));
  }

  constructor(data: TrackData) {
    this.data = data;
    this.id = data.id;
    this.name = data.name;
    this.length = data.length;
    const c = data.centreline;
    const n = data.sampleCount;
    this.lap = new TrackPath(c.x, c.y, c.z, data.length, true);
    this.pit = new PitLane(data.pit);
    this.lineWidth = data.lineWidth;
    this.bank = Float64Array.from(c.bank);
    this.tanBank = this.bank.map(Math.tan);
    this.halfWidth = [Float64Array.from(c.halfWidthLeft), Float64Array.from(c.halfWidthRight)];
    this.kerbProfiles = data.kerbProfiles.map((p) => ({
      name: p.name,
      width: p.points[p.points.length - 1]![0],
      u: Float64Array.from(p.points.map((q) => q[0])),
      h: Float64Array.from(p.points.map((q) => q[1])),
      highFrom: p.high ? p.high[0] : 0,
      highTo: p.high ? p.high[1] : 0,
    }));
    const names = this.kerbProfiles.map((p) => p.name);
    const sides = [data.sides.left, data.sides.right] as const;
    const mk = <A>(f: () => A): readonly [A, A] => [f(), f()];
    this.kerb = mk(() => new Int16Array(n));
    this.inner = mk(() => new Uint8Array(n));
    this.outer = mk(() => new Uint8Array(n));
    this.barrierType = mk(() => new Uint8Array(n));
    this.split = [Float64Array.from(sides[0].split), Float64Array.from(sides[1].split)];
    this.barrier = [Float64Array.from(sides[0].barrier), Float64Array.from(sides[1].barrier)];
    for (const k of [LEFT, RIGHT] as const) {
      const sd = sides[k];
      unrun(sd.kerb, n, (v) => (v === null ? -1 : names.indexOf(v)), this.kerb[k]);
      unrun(sd.inner, n, (v) => RUNOFF_SURFACE[v], this.inner[k]);
      unrun(sd.outer, n, (v) => RUNOFF_SURFACE[v], this.outer[k]);
      unrun(sd.barrierType, n, (v) => BARRIER_TYPES.indexOf(v), this.barrierType[k]);
    }
    this.corners = data.corners;
    this.sectors = Float64Array.from(data.timing.sectors);
    this.speedTrap = data.timing.speedTrap;
    this.drsZones = data.timing.drs.map((z) => ({ ...z }));
    this.pitSide = data.pit.side === 'left' ? LEFT : RIGHT;

    const p = createVec3();
    const t = createVec3();
    const g = createGround();
    this.gridSlots = data.grid.map((slot) => {
      this.lap.pointAt(slot.s, slot.d, p);
      this.ground(slot.s, slot.d, g);
      this.lap.tangent(slot.s, t);
      return { s: slot.s, d: slot.d, x: p.x, y: g.height, z: p.z, yaw: Math.atan2(-t.z, t.x) };
    });

    this.trackLimits = [new Float64Array(2 * n), new Float64Array(2 * n)];
    for (let i = 0; i < n; i++) {
      for (const k of [LEFT, RIGHT] as const) {
        const d = (k === LEFT ? 1 : -1) * this.halfWidth[k][i]!;
        this.trackLimits[k][2 * i] = this.lap.x[i]! + d * this.lap.nx[i]!;
        this.trackLimits[k][2 * i + 1] = this.lap.z[i]! + d * this.lap.nz[i]!;
      }
    }

    // Which lap samples have the pit lane alongside: project every pit sample onto the lap.
    this.pitNear = new Int32Array(n).fill(-1);
    const pp = this.pit.path;
    const q = createPathPoint();
    const hint = { index: -1 };
    for (let j = 0; j < pp.count; j++) {
      this.lap.project(pp.x[j]!, pp.z[j]!, hint, q);
      const reach = Math.max(this.pit.halfWidthLeft[j]!, this.pit.halfWidthRight[j]!) + 2;
      const i0 = this.lap.sampleIndex(q.s - reach);
      const span = Math.ceil((2 * reach) / this.lap.step);
      for (let k = 0; k <= span; k++) this.pitNear[(i0 + k) % n] = j;
    }

    this.barriers = this.buildBarriers();
  }

  /** s wrapped into [0, length). */
  wrap(s: number): number {
    return this.lap.wrap(s);
  }

  /** Distance travelled forward along the lap from `from` to `to`, in [0, length). */
  forwardDistance(from: number, to: number): number {
    return this.lap.wrap(to - from);
  }

  /** Signed shortest distance along the lap from `from` to `to`, in (-length/2, length/2]. */
  lapDelta(from: number, to: number): number {
    const f = this.forwardDistance(from, to);
    return f > this.length / 2 ? f - this.length : f;
  }

  /** True when moving forward from prevS to curS (less than half a lap) passes the line at lineS. */
  crossed(prevS: number, curS: number, lineS: number): boolean {
    const moved = this.lapDelta(prevS, curS);
    if (moved <= 0) return false;
    const toLine = this.forwardDistance(prevS, lineS);
    return toLine > 0 && toLine <= moved;
  }

  /** Index of the sector containing s. */
  sectorAt(s: number): number {
    const w = this.wrap(s);
    let k = 0;
    while (k + 1 < this.sectors.length && this.sectors[k + 1]! <= w) k++;
    return k;
  }

  /** Index of the DRS zone (activation to end) containing s, or -1. */
  drsZoneAt(s: number): number {
    for (let k = 0; k < this.drsZones.length; k++) {
      const z = this.drsZones[k]!;
      if (this.forwardDistance(z.activation, s) < this.forwardDistance(z.activation, z.end))
        return k;
    }
    return -1;
  }

  positionAt(s: number, out: Vec3): Vec3 {
    return this.lap.position(s, out);
  }

  tangentAt(s: number, out: Vec3): Vec3 {
    return this.lap.tangent(s, out);
  }

  normalAt(s: number, out: Vec3): Vec3 {
    return this.lap.normal(s, out);
  }

  curvatureAt(s: number): number {
    return this.lap.interpolate(this.lap.curvature, s);
  }

  elevationAt(s: number): number {
    return this.lap.interpolate(this.lap.y, s);
  }

  gradeAt(s: number): number {
    return this.lap.interpolate(this.lap.grade, s);
  }

  bankAt(s: number): number {
    return this.lap.interpolate(this.bank, s);
  }

  halfWidthAt(s: number, side: SideIndex): number {
    return this.lap.interpolate(this.halfWidth[side], s);
  }

  /** World point at (s, d) on the ground. */
  pointAt(s: number, d: number, out: Vec3): Vec3 {
    this.lap.pointAt(s, d, out);
    out.y = this.heightAt(s, d);
    return out;
  }

  /** Track coordinates of (x, z) on the lap. `hint.index` is the caller's search state. */
  project(x: number, z: number, hint: { index: number }, out: PathPoint): PathPoint {
    return this.lap.project(x, z, hint, out);
  }

  /** Ground height at (s, d). */
  heightAt(s: number, d: number): number {
    const g = this.groundScratch;
    this.ground(s, d, g);
    return g.height;
  }

  private readonly groundScratch = createGround();

  /**
   * The ground cross-section at (s, d) on the lap: height, slopes and surface kind from the
   * lateral zones (white line, kerb, run-off, barrier). The pit lane is resolved by the surface
   * sampler, which also needs the pit frame.
   *
   * Height: the track is a plane tilted by the bank angle out to its edges; beyond an edge the
   * ground falls away at VERGE_FALL, with the kerb profile added on top. Every piece meets the
   * next at the same height, so the ground is continuous across zone boundaries.
   */
  ground(s: number, d: number, out: Ground): Ground {
    const lap = this.lap;
    const i = lap.sampleIndex(s);
    const side: SideIndex = d >= 0 ? LEFT : RIGHT;
    const sign = side === LEFT ? 1 : -1;
    const a = d * sign;
    const hw = lap.interpolate(this.halfWidth[side], s);
    const tb = lap.interpolate(this.tanBank, s);
    const yc = lap.interpolate(lap.y, s);
    // d(tan bank)/ds from the neighbouring samples, for the along-track slope.
    const j = lap.next(i);
    const dtb = (this.tanBank[j]! - this.tanBank[i]!) / lap.chord[i]!;
    out.sample = i;
    out.highKerb = false;
    if (a <= hw) {
      out.height = yc + d * tb;
      out.slopeD = tb;
      out.slopeS = lap.interpolate(lap.grade, s) + d * dtb;
      out.kind = a > hw - this.lineWidth ? SurfaceKind.Paint : SurfaceKind.Asphalt;
      return out;
    }
    const u = a - hw;
    let h = yc + sign * hw * tb - VERGE_FALL * u;
    let slope = -VERGE_FALL;
    const k = this.kerb[side][i]!;
    let kind: SurfaceKind;
    const kp = k >= 0 ? this.kerbProfiles[k] : undefined;
    if (kp && u < kp.width) {
      // Piecewise-linear profile.
      let m = 1;
      while (m < kp.u.length - 1 && kp.u[m]! < u) m++;
      const u0 = kp.u[m - 1]!;
      const u1 = kp.u[m]!;
      const h0 = kp.h[m - 1]!;
      const h1 = kp.h[m]!;
      const ds = (h1 - h0) / (u1 - u0);
      h += h0 + ds * (u - u0);
      slope += ds;
      kind = SurfaceKind.Kerb;
      out.highKerb = u >= kp.highFrom && u < kp.highTo;
    } else if (a < this.split[side][i]!) {
      kind = this.inner[side][i]! as SurfaceKind;
    } else if (a < this.barrier[side][i]!) {
      kind = this.outer[side][i]! as SurfaceKind;
    } else {
      kind = SurfaceKind.OutOfBounds;
    }
    out.height = h;
    out.slopeD = sign * slope;
    out.slopeS = lap.interpolate(lap.grade, s) + sign * hw * dtb;
    out.kind = kind;
    return out;
  }

  /** Is (x, z), already projected to the lap at (s, d), on the pit-lane surface? Fills pitPoint. */
  onPitLane(
    x: number,
    z: number,
    s: number,
    d: number,
    pitHint: { index: number },
    out: PathPoint,
  ): boolean {
    const i = this.lap.sampleIndex(s);
    const near = this.pitNear[i]!;
    if (near < 0) return false;
    const side: SideIndex = d >= 0 ? LEFT : RIGHT;
    if (side !== this.pitSide || Math.abs(d) <= this.halfWidth[side][i]!) return false;
    if (pitHint.index < 0) pitHint.index = Math.min(near, this.pit.path.segments - 1);
    this.pit.path.project(x, z, pitHint, out);
    if (out.s < 0 || out.s > this.pit.length) return false;
    const hl = this.pit.path.interpolate(this.pit.halfWidthLeft, out.s);
    const hr = this.pit.path.interpolate(this.pit.halfWidthRight, out.s);
    return out.d <= hl && out.d >= -hr;
  }

  private buildBarriers(): Barrier[] {
    const out: Barrier[] = [];
    const n = this.lap.count;
    const p = this.tmp;
    for (const k of [LEFT, RIGHT] as const) {
      const sign = k === LEFT ? 1 : -1;
      const off = this.barrier[k];
      const type = this.barrierType[k];
      // A new run starts where the type changes or the offset jumps by more than 2 m. A type
      // change keeps the barrier continuous: the old run ends on the first sample of the new one.
      const jump = (i: number): boolean => Math.abs(off[i]! - off[(i + n - 1) % n]!) > 2;
      const breakAt = (i: number): boolean => type[i] !== type[(i + n - 1) % n] || jump(i);
      let start = -1;
      for (let i = 0; i < n && start < 0; i++) if (breakAt(i)) start = i;
      const closed = start < 0;
      if (closed) start = 0;
      let pts: number[] = [];
      let ss: number[] = [];
      let runType = type[start]!;
      const push = (i: number, s: number): void => {
        const o = sign * off[i]!;
        this.lap.pointAt(i * this.lap.step, o, p);
        pts.push(p.x, this.heightAt(i * this.lap.step, o), p.z);
        ss.push(s);
      };
      const flush = (): void => {
        if (ss.length >= 2) {
          out.push({
            type: BARRIER_TYPES[runType]!,
            side: k === LEFT ? 'left' : 'right',
            points: Float64Array.from(pts),
            s: Float64Array.from(ss),
            closed,
          });
        }
        pts = [];
        ss = [];
      };
      let lapOffset = 0;
      for (let m = 0; m <= n; m++) {
        const i = (start + m) % n;
        if (m > 0 && i === 0) lapOffset = this.length;
        const s = lapOffset + i * this.lap.step;
        if (m === n) {
          // Back at the start: close the loop, or end the last run on the first break.
          if (closed || !jump(i)) push(i, s);
          flush();
          break;
        }
        if (m > 0 && breakAt(i)) {
          if (!jump(i)) push(i, s);
          flush();
          runType = type[i]!;
        }
        push(i, s);
      }
    }
    // Garage-side wall of the pit lane.
    const pit = this.pit;
    const gs = pit.side === 'left' ? 1 : -1;
    const [w0, w1] = pit.garageWall;
    const pts: number[] = [];
    const ss: number[] = [];
    const st = pit.path.step;
    const g = this.groundScratch;
    const q = createPathPoint();
    const hint = { index: -1 };
    for (let sp = w0; sp <= w1 + 1e-9; sp += st) {
      const off = gs * (pit.halfWidth(sp, pit.side === 'left' ? LEFT : RIGHT) + 0.5);
      pit.path.pointAt(sp, off, p);
      this.lap.project(p.x, p.z, hint, q);
      this.ground(q.s, q.d, g);
      pts.push(p.x, g.height, p.z);
      ss.push(sp);
    }
    out.push({
      type: 'concrete',
      side: 'pit',
      points: Float64Array.from(pts),
      s: Float64Array.from(ss),
      closed: false,
    });
    return out;
  }
}
