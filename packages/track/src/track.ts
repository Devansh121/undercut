import { SurfaceKind } from '@undercut/sim';
import {
  BARRIER_TYPES,
  validateTrackData,
  type BarrierType,
  type CornerData,
  type EnvironmentData,
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
  /** Length along s over which the profile rises from flat at each end of a kerb run. */
  readonly taper: number;
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
  /** Unit lap tangent, curvature and the offset d at the point, for `groundNormal`. */
  tx: number;
  tz: number;
  curvature: number;
  d: number;
}

export function createGround(): Ground {
  return {
    height: 0,
    slopeD: 0,
    slopeS: 0,
    kind: SurfaceKind.Asphalt,
    highKerb: false,
    sample: 0,
    tx: 1,
    tz: 0,
    curvature: 0,
    d: 0,
  };
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
  /** Pit-lane centreline poses at s_pit = 0 (leaving the lap) and s_pit = length (rejoining). */
  readonly entryPose: Pose;
  readonly exitPose: Pose;
  readonly garageWall: readonly [number, number];

  /**
   * `groundHeight` is the track's ground at a world point: the pit lane has no ground of its
   * own, so poses on it sit on the same surface the sampler reports.
   */
  constructor(data: TrackData['pit'], groundHeight: (x: number, z: number) => number) {
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
    const pose = (s: number, d: number): Pose => {
      this.path.pointAt(s, d, p);
      this.path.tangent(s, t);
      return { s, d, x: p.x, y: groundHeight(p.x, p.z), z: p.z, yaw: Math.atan2(-t.z, t.x) };
    };
    this.boxes = data.boxes.map((b) => pose(b.s, b.d));
    this.entryPose = pose(0, 0);
    this.exitPose = pose(data.length, 0);
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
  /**
   * Per side and sample on a kerb, the lap s where its run starts and ends (sample edges, so a
   * run of samples a..b spans [(a - 0.5) step, (b + 0.5) step)). The end may exceed the lap
   * length when a run crosses the line; a kerb all the way round has an infinite span.
   */
  readonly kerbStart: readonly [Float64Array, Float64Array];
  readonly kerbEnd: readonly [Float64Array, Float64Array];
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
  /**
   * s of the timing (control) line, from which published lap and sector times run. Carried as
   * data: lap timing in the game still runs from s = 0.
   */
  readonly timingLine: number;
  /** Place and event facts for rendering and physics; null for migrated format 2 files. */
  readonly environment: EnvironmentData | null;
  readonly drsZones: readonly DrsZone[];
  readonly gridSlots: readonly Pose[];
  /** On the centreline at the start/finish line, facing the direction of travel. */
  readonly startPose: Pose;
  readonly barriers: readonly Barrier[];
  /** White-line outer edges (track limits) as closed x, z polylines, one point per sample. */
  readonly trackLimits: readonly [Float64Array, Float64Array];
  /**
   * Per side and sample, how far out the (s, d) frame stays one-to-one: short of the centre of
   * curvature of any bend on that side within 24 m. Meshes stop there.
   */
  readonly frameLimit: readonly [Float64Array, Float64Array];
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
    this.lineWidth = data.lineWidth;
    this.timingLine = data.timingLine.s;
    this.environment = data.environment;
    this.bank = Float64Array.from(c.bank);
    this.tanBank = this.bank.map(Math.tan);
    this.halfWidth = [Float64Array.from(c.halfWidthLeft), Float64Array.from(c.halfWidthRight)];
    this.kerbProfiles = data.kerbProfiles.map((p) => ({
      name: p.name,
      width: p.points[p.points.length - 1]![0],
      u: Float64Array.from(p.points.map((q) => q[0])),
      h: Float64Array.from(p.points.map((q) => q[1])),
      taper: p.taper,
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
    this.kerbStart = [new Float64Array(n), new Float64Array(n)];
    this.kerbEnd = [new Float64Array(n), new Float64Array(n)];
    for (const k of [LEFT, RIGHT] as const) {
      const kb = this.kerb[k];
      const step = data.length / n;
      let first = -1;
      for (let i = 0; i < n && first < 0; i++) if (kb[i] !== kb[(i + n - 1) % n]) first = i;
      if (first < 0) {
        this.kerbStart[k].fill(-Infinity);
        this.kerbEnd[k].fill(Infinity);
        continue;
      }
      // Walk the lap once from a run boundary, filling each run's span.
      let m = 0;
      while (m < n) {
        const a = first + m;
        let b = a;
        while (b + 1 < first + n && kb[(b + 1) % n] === kb[a % n]) b++;
        const s0 = (a - 0.5) * step;
        const s1 = (b + 0.5) * step;
        for (let j = a; j <= b; j++) {
          this.kerbStart[k][j % n] = s0;
          this.kerbEnd[k][j % n] = s1;
        }
        m += b - a + 1;
      }
    }
    this.corners = data.corners;
    this.sectors = Float64Array.from(data.timing.sectors);
    this.speedTrap = data.timing.speedTrap;
    this.drsZones = data.timing.drs.map((z) => ({ ...z }));
    this.pitSide = data.pit.side === 'left' ? LEFT : RIGHT;

    const p = createVec3();
    const t = createVec3();
    const g = createGround();
    // Every pose sits on the one ground the sampler reports: grid slots and the start line from
    // their (s, d), the pit lane's poses from their world position.
    const lapPose = (s: number, d: number): Pose => {
      this.lap.pointAt(s, d, p);
      this.ground(s, d, g);
      this.lap.tangent(s, t);
      return { s, d, x: p.x, y: g.height, z: p.z, yaw: Math.atan2(-t.z, t.x) };
    };
    this.gridSlots = data.grid.map((slot) => lapPose(slot.s, slot.d));
    this.startPose = lapPose(0, 0);
    this.pit = new PitLane(data.pit, (x, z) => this.groundHeightAt(x, z));

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

    this.frameLimit = [new Float64Array(n), new Float64Array(n)];
    for (const k of [LEFT, RIGHT] as const) {
      const sign = k === LEFT ? 1 : -1;
      for (let i = 0; i < n; i++) {
        let kmax = 0;
        for (let w = -12; w <= 12; w++)
          kmax = Math.max(kmax, sign * this.lap.curvature[(i + w + n) % n]!);
        this.frameLimit[k][i] = kmax > 0 ? 0.95 / kmax : 1e6;
      }
      // Let the limit grow by at most 0.5 m per metre away from a tight bend.
      const lim = this.frameLimit[k];
      const rise = 0.5 * this.lap.step;
      for (let pass = 0; pass < 2; pass++) {
        for (let m = 1; m < 2 * n; m++)
          lim[m % n] = Math.min(lim[m % n]!, lim[(m - 1) % n]! + rise);
        for (let m = 2 * n - 2; m >= 0; m--)
          lim[m % n] = Math.min(lim[m % n]!, lim[(m + 1) % n]! + rise);
      }
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

  /**
   * Ground height at a world point: the point projected onto the lap, then the lap's
   * cross-section there. The surface sampler, the meshes and every pose use this ground.
   * `hint` speeds up repeated queries for one moving point; omit it for a one-off query.
   */
  groundHeightAt(x: number, z: number, hint: { index: number } = { index: -1 }): number {
    const q = this.project(x, z, hint, this.worldPoint);
    return this.ground(q.s, q.d, this.groundScratch).height;
  }

  private readonly worldPoint = createPathPoint();

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
    lap.seek(s);
    const i0 = lap.cursor;
    const f = lap.cursorT;
    const j = lap.next(i0);
    const i = f < 0.5 ? i0 : j;
    const side: SideIndex = d >= 0 ? LEFT : RIGHT;
    const sign = side === LEFT ? 1 : -1;
    const a = d * sign;
    const hws = this.halfWidth[side];
    const hw = hws[i0]! + (hws[j]! - hws[i0]!) * f;
    const tbs = this.tanBank;
    const tb = tbs[i0]! + (tbs[j]! - tbs[i0]!) * f;
    const yc = lap.y[i0]! + (lap.y[j]! - lap.y[i0]!) * f;
    const grade = lap.grade[i0]! + (lap.grade[j]! - lap.grade[i0]!) * f;
    // d(tan bank)/ds over this segment, for the along-track slope.
    const dtb = (tbs[j]! - tbs[i0]!) / lap.chord[i0]!;
    const tx = lap.tx[i0]! + (lap.tx[j]! - lap.tx[i0]!) * f;
    const tz = lap.tz[i0]! + (lap.tz[j]! - lap.tz[i0]!) * f;
    const tl = Math.sqrt(tx * tx + tz * tz);
    out.tx = tx / tl;
    out.tz = tz / tl;
    out.curvature = lap.curvature[i0]! + (lap.curvature[j]! - lap.curvature[i0]!) * f;
    out.d = d;
    out.sample = i;
    out.highKerb = false;
    if (a <= hw) {
      out.height = yc + d * tb;
      out.slopeD = tb;
      out.slopeS = grade + d * dtb;
      out.kind = a > hw - this.lineWidth ? SurfaceKind.Paint : SurfaceKind.Asphalt;
      return out;
    }
    const u = a - hw;
    let h = yc + sign * hw * tb - VERGE_FALL * u;
    let slope = -VERGE_FALL;
    let kerbSlopeS = 0;
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
      // Taper: the profile rises from flat over `taper` metres at each end of the run.
      const along = this.lap.wrap(s - this.kerbStart[side][i]!);
      const left = this.kerbEnd[side][i]! - this.kerbStart[side][i]! - along;
      let f = 1;
      let df = 0;
      if (along < kp.taper && along <= left) {
        f = along / kp.taper;
        df = 1 / kp.taper;
      } else if (left < kp.taper) {
        f = left / kp.taper;
        df = -1 / kp.taper;
      }
      const ph = h0 + ds * (u - u0);
      h += f * ph;
      slope += f * ds;
      kerbSlopeS = df * ph;
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
    out.slopeS = grade + sign * hw * dtb + kerbSlopeS;
    out.kind = kind;
    return out;
  }

  /**
   * Unit ground normal from a cross-section computed by `ground`: the cross product of the
   * tangent along the lap (stretched by 1 - curvature * d, as on a parallel offset curve) and
   * the tangent across it.
   */
  groundNormal(g: Ground, out: Vec3): Vec3 {
    let m = 1 - g.curvature * g.d;
    if (m < 0.05) m = 0.05;
    const nx = g.tz;
    const nz = -g.tx;
    const ax = g.slopeS * nz - m * g.tz * g.slopeD;
    const ay = m;
    const az = m * g.tx * g.slopeD - g.slopeS * nx;
    const len = Math.sqrt(ax * ax + ay * ay + az * az);
    out.x = ax / len;
    out.y = ay / len;
    out.z = az / len;
    return out;
  }

  /** Is (x, z), already projected to the lap at (s, d), on the pit-lane surface? Fills `out`. */
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
