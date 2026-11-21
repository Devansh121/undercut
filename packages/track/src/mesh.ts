import { SurfaceKind } from '@undercut/sim';
import { createVec3 } from './path';
import { LEFT, RIGHT, createGround, type Barrier, type SideIndex, type Track } from './track';
import type { BarrierType } from './data';

/**
 * Renderer-agnostic track meshes: typed arrays a renderer uploads as-is. Positions are in the
 * world frame, triangles wind counter-clockwise seen from their front (normal) side, UV v runs
 * along s in metres (u across, in metres) so textures flow along the track, and `surface` gives
 * each vertex a MeshSurface id for material selection.
 */
export const MeshSurface = {
  Asphalt: SurfaceKind.Asphalt,
  Paint: SurfaceKind.Paint,
  Kerb: SurfaceKind.Kerb,
  RunoffAsphalt: SurfaceKind.RunoffAsphalt,
  Grass: SurfaceKind.Grass,
  Gravel: SurfaceKind.Gravel,
  PitLane: SurfaceKind.PitLane,
  /** Ground just beyond the barriers. */
  Verge: SurfaceKind.OutOfBounds,
  KerbHigh: 8,
  Terrain: 9,
  Armco: 10,
  Concrete: 11,
  Tyres: 12,
  Fence: 13,
  Marking: 14,
} as const;
export type MeshSurface = (typeof MeshSurface)[keyof typeof MeshSurface];

export interface MeshData {
  /** x, y, z per vertex. */
  positions: Float32Array;
  normals: Float32Array;
  /** u, v per vertex, in metres. */
  uvs: Float32Array;
  indices: Uint32Array;
  /** MeshSurface id per vertex. */
  surface: Uint8Array;
}

export interface TrackMeshes {
  road: MeshData;
  /** White lines at the track edges (track limits). */
  lines: MeshData;
  kerbs: MeshData;
  /** Run-off and verges out to just beyond the barriers. */
  runoff: MeshData;
  /** Elevation-following ground under and around everything. */
  terrain: MeshData;
  barriers: MeshData;
  pit: MeshData;
  /** Start/finish, grid slots, DRS lines, pit limit lines and boxes. */
  markings: MeshData;
}

export interface TrackMeshOptions {
  /** Lap samples per mesh row: 1 keeps every sample (2 m). Zone boundaries are always kept. */
  stride: number;
  /** Terrain grid cell, metres. */
  terrainCell: number;
  /** How far the terrain reaches beyond the track's bounding box, metres. */
  terrainMargin: number;
}

/** Presets: High keeps every 2 m sample; Mobile uses every third and a coarser terrain. */
export const MESH_LOD: Readonly<Record<'high' | 'mobile', TrackMeshOptions>> = Object.freeze({
  high: { stride: 1, terrainCell: 12, terrainMargin: 400 },
  mobile: { stride: 3, terrainCell: 30, terrainMargin: 300 },
});

/** Heights above the ground of overlaid layers, so they never fight with it in depth. */
const LIFT_LINES = 0.004;
const LIFT_MARKING = 0.006;
const LIFT_PIT = 0.01;
/** Verge strip beyond the barrier, then an apron falling to the terrain. */
const VERGE_WIDTH = 4;
const APRON_WIDTH = 3;
const APRON_DROP = 0.7;
/** Terrain sits this far below the track's ground so it never shows through it. */
const TERRAIN_DROP = 0.5;

const BARRIER_PROFILE: Record<
  BarrierType,
  { surface: MeshSurface; points: readonly [number, number][] }
> = {
  // [outward from the track-side face, height]; drawn bottom of the face, up, across, down.
  armco: {
    surface: MeshSurface.Armco,
    points: [
      [0, 0.3],
      [0, 0.75],
      [0.15, 0.75],
      [0.15, 0.3],
    ],
  },
  concrete: {
    surface: MeshSurface.Concrete,
    points: [
      [0, 0],
      [0, 1.0],
      [0.3, 1.0],
      [0.5, 0],
    ],
  },
  tyres: {
    surface: MeshSurface.Tyres,
    points: [
      [0, 0],
      [0, 0.9],
      [1.0, 0.9],
      [1.0, 0],
    ],
  },
  fence: {
    surface: MeshSurface.Fence,
    points: [
      [0, 0],
      [0, 3.0],
      [0.02, 3.0],
      [0.02, 0],
    ],
  },
};

class MeshBuilder {
  private readonly p: number[] = [];
  private readonly n: number[] = [];
  private readonly t: number[] = [];
  private readonly i: number[] = [];
  private readonly s: number[] = [];

  get count(): number {
    return this.s.length;
  }

  vertex(
    x: number,
    y: number,
    z: number,
    nx: number,
    ny: number,
    nz: number,
    u: number,
    v: number,
    surface: number,
  ): number {
    this.p.push(x, y, z);
    this.n.push(nx, ny, nz);
    this.t.push(u, v);
    this.s.push(surface);
    return this.s.length - 1;
  }

  /** Two triangles over a, b (one edge) and c, d (the next), wound so the normal side is up. */
  quad(a: number, b: number, c: number, d: number): void {
    this.i.push(a, c, b, b, c, d);
  }

  tri(a: number, b: number, c: number): void {
    this.i.push(a, b, c);
  }

  build(): MeshData {
    return {
      positions: Float32Array.from(this.p),
      normals: Float32Array.from(this.n),
      uvs: Float32Array.from(this.t),
      indices: Uint32Array.from(this.i),
      surface: Uint8Array.from(this.s),
    };
  }
}

/** Mesh rows: every `stride`-th lap sample plus every sample where zone data changes. */
function rows(track: Track, stride: number): number[] {
  const n = track.lap.count;
  const keep = new Uint8Array(n);
  for (let i = 0; i < n; i += stride) keep[i] = 1;
  for (let i = 0; i < n; i++) {
    const h = (i + n - 1) % n;
    for (const k of [LEFT, RIGHT] as const) {
      if (
        track.kerb[k][i] !== track.kerb[k][h] ||
        track.inner[k][i] !== track.inner[k][h] ||
        track.outer[k][i] !== track.outer[k][h] ||
        Math.abs(track.barrier[k][i]! - track.barrier[k][h]!) > 1
      ) {
        keep[i] = 1;
        keep[h] = 1;
      }
    }
  }
  const out: number[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(i);
  out.push(n); // closes the loop: same sample as 0, with s = length
  return out;
}

/**
 * Emits a ribbon along the lap: for each row, vertices at the given lateral offsets with the
 * ground's height and normal (plus `lift`). `columns(i)` returns offsets for sample i, or null
 * where the ribbon is absent; a ribbon breaks there and where `key(i)` changes.
 */
function ribbon(
  track: Track,
  b: MeshBuilder,
  rowList: readonly number[],
  columns: (i: number) => readonly number[] | null,
  surface: (i: number, col: number) => number,
  key: (i: number) => number,
  lift: (i: number, col: number) => number = () => 0,
): void {
  const n = track.lap.count;
  const step = track.lap.step;
  const g = createGround();
  const p = createVec3();
  const nrm = createVec3();
  const emit = (s: number, cols: readonly number[], sample: number): number[] =>
    cols.map((d, c) => {
      track.lap.pointAt(s, d, p);
      track.ground(s, d, g);
      track.groundNormal(s, d, g, nrm);
      return b.vertex(
        p.x,
        g.height + lift(sample, c),
        p.z,
        nrm.x,
        nrm.y,
        nrm.z,
        d,
        s,
        surface(sample, c),
      );
    });
  const join = (a: readonly number[], c: readonly number[]): void => {
    for (let k = 0; k + 1 < a.length; k++) b.quad(a[k]!, a[k + 1]!, c[k]!, c[k + 1]!);
  };
  let prev: number[] | null = null;
  let prevKey = Number.NaN;
  let prevSample = -1;
  for (const r of rowList) {
    const i = r % n;
    const s = r * step;
    const cols = columns(i);
    if (!cols) {
      prev = null;
      continue;
    }
    const k = key(i);
    if (prev && k !== prevKey) {
      // Close the old strip on this row (with its own surface), then start a new one here.
      if (prev.length === cols.length) join(prev, emit(s, cols, prevSample));
      prev = null;
    }
    const cur = emit(s, cols, i);
    if (prev && prev.length === cur.length) join(prev, cur);
    prev = cur;
    prevKey = k;
    prevSample = i;
  }
}

/** Lateral offsets ordered from the right edge to the left, so quads face up. */
function side(k: SideIndex, inner: number, outer: number): readonly number[] {
  return k === LEFT ? [inner, outer] : [-outer, -inner];
}

function buildRoad(track: Track, rowList: readonly number[]): { road: MeshData; lines: MeshData } {
  const road = new MeshBuilder();
  const lines = new MeshBuilder();
  const lw = track.lineWidth;
  ribbon(
    track,
    road,
    rowList,
    (i) => [-track.halfWidth[RIGHT][i]!, 0, track.halfWidth[LEFT][i]!],
    () => MeshSurface.Asphalt,
    () => 0,
  );
  for (const k of [LEFT, RIGHT] as const) {
    ribbon(
      track,
      lines,
      rowList,
      (i) => side(k, track.halfWidth[k][i]! - lw, track.halfWidth[k][i]!),
      () => MeshSurface.Paint,
      () => 0,
      () => LIFT_LINES,
    );
  }
  return { road: road.build(), lines: lines.build() };
}

function buildKerbs(track: Track, rowList: readonly number[]): MeshData {
  const b = new MeshBuilder();
  for (const k of [LEFT, RIGHT] as const) {
    const sign = k === LEFT ? 1 : -1;
    ribbon(
      track,
      b,
      rowList,
      (i) => {
        const p = track.kerb[k][i]!;
        if (p < 0) return null;
        const prof = track.kerbProfiles[p]!;
        const hw = track.halfWidth[k][i]!;
        const cols = Array.from(prof.u, (u) => sign * (hw + u));
        return k === LEFT ? cols : cols.reverse();
      },
      (i, c) => {
        const prof = track.kerbProfiles[track.kerb[k][i]!]!;
        const m = k === LEFT ? c : prof.u.length - 1 - c;
        const u = prof.u[m]!;
        return u > prof.highFrom && u < prof.highTo ? MeshSurface.KerbHigh : MeshSurface.Kerb;
      },
      (i) => track.kerb[k][i]!,
    );
  }
  return b.build();
}

function buildRunoff(track: Track, rowList: readonly number[]): MeshData {
  const b = new MeshBuilder();
  for (const k of [LEFT, RIGHT] as const) {
    const edge = (i: number): number => {
      const p = track.kerb[k][i]!;
      return track.halfWidth[k][i]! + (p >= 0 ? track.kerbProfiles[p]!.width : 0);
    };
    // Surface nearest the track, out to the split.
    ribbon(
      track,
      b,
      rowList,
      (i) =>
        side(k, edge(i), Math.max(edge(i), Math.min(track.split[k][i]!, track.barrier[k][i]!))),
      (i) => track.inner[k][i]!,
      (i) => track.inner[k][i]!,
    );
    // From the split to the barrier.
    ribbon(
      track,
      b,
      rowList,
      (i) =>
        side(
          k,
          Math.max(edge(i), Math.min(track.split[k][i]!, track.barrier[k][i]!)),
          track.barrier[k][i]!,
        ),
      (i) => track.outer[k][i]!,
      (i) => track.outer[k][i]!,
    );
    // Verge behind the barrier, then the apron down to the terrain.
    ribbon(
      track,
      b,
      rowList,
      (i) => {
        // Stop short of the frame's fold on the inside of tight bends.
        const o = track.barrier[k][i]!;
        const lim = track.frameLimit[k][i]!;
        if (lim < o + VERGE_WIDTH + APRON_WIDTH) return null;
        const v = o + VERGE_WIDTH;
        const a = o + VERGE_WIDTH + APRON_WIDTH;
        return k === LEFT ? [o, v, a] : [-a, -v, -o];
      },
      () => MeshSurface.Verge,
      () => 0,
      (_i, c) => ((k === LEFT ? c === 2 : c === 0) ? -APRON_DROP : 0),
    );
  }
  return b.build();
}

function buildBarriers(track: Track): MeshData {
  const b = new MeshBuilder();
  const n = createVec3();
  for (const bar of track.barriers) addBarrier(track, b, bar, n);
  return b.build();
}

function addBarrier(
  track: Track,
  b: MeshBuilder,
  bar: Barrier,
  tmp: { x: number; y: number; z: number },
): void {
  const prof = BARRIER_PROFILE[bar.type];
  const m = bar.points.length / 3;
  const pit = bar.side === 'pit';
  const sign =
    bar.side === 'left' ? 1 : bar.side === 'right' ? -1 : track.pit.side === 'left' ? 1 : -1;
  // Outward (away from the track) direction at each vertex, from the frame it belongs to.
  const ox = new Float64Array(m);
  const oz = new Float64Array(m);
  for (let k = 0; k < m; k++) {
    if (pit) track.pit.path.normal(bar.s[k]!, tmp);
    else track.lap.normal(bar.s[k]!, tmp);
    ox[k] = sign * tmp.x;
    oz[k] = sign * tmp.z;
  }
  // Thickness shrinks where the barrier stands close to the frame's fold inside a tight bend.
  const maxW = Math.max(...prof.points.map((q) => q[0]));
  const thick = new Float64Array(m).fill(1);
  if (!pit) {
    const k = bar.side === 'left' ? LEFT : RIGHT;
    for (let v = 0; v < m; v++) {
      const i = track.lap.sampleIndex(bar.s[v]!);
      const room = track.frameLimit[k][i]! - track.barrier[k][i]!;
      thick[v] = Math.min(1, Math.max(0.1, room / maxW));
    }
  }
  let along = 0;
  const dist = new Float64Array(m);
  for (let k = 1; k < m; k++) {
    along += Math.hypot(
      bar.points[3 * k]! - bar.points[3 * k - 3]!,
      bar.points[3 * k + 2]! - bar.points[3 * k - 1]!,
    );
    dist[k] = along;
  }
  const pts = prof.points;
  for (let e = 0; e + 1 < pts.length; e++) {
    const [w0, h0] = pts[e]!;
    const [w1, h1] = pts[e + 1]!;
    // Face normal in the (outward, up) plane for an edge drawn bottom-up, track side first.
    const len = Math.hypot(w1 - w0, h1 - h0);
    const nw = -(h1 - h0) / len;
    const nh = (w1 - w0) / len;
    let prev: [number, number] | null = null;
    for (let k = 0; k < m; k++) {
      const x = bar.points[3 * k]!;
      const y = bar.points[3 * k + 1]!;
      const z = bar.points[3 * k + 2]!;
      const nx = nw * ox[k]!;
      const nz = nw * oz[k]!;
      const a = b.vertex(
        x + w0 * thick[k]! * ox[k]!,
        y + h0,
        z + w0 * thick[k]! * oz[k]!,
        nx,
        nh,
        nz,
        dist[k]!,
        h0,
        prof.surface,
      );
      const c = b.vertex(
        x + w1 * thick[k]! * ox[k]!,
        y + h1,
        z + w1 * thick[k]! * oz[k]!,
        nx,
        nh,
        nz,
        dist[k]!,
        h1,
        prof.surface,
      );
      if (prev) {
        // Vertices run along the frame's direction of travel; wind so the face normal is in front.
        if (sign > 0) b.quad(prev[0], prev[1], a, c);
        else b.quad(prev[1], prev[0], c, a);
      }
      prev = [a, c];
    }
  }
}

function buildPit(track: Track, stride: number): { pit: MeshData; marks: MeshBuilder } {
  const b = new MeshBuilder();
  const marks = new MeshBuilder();
  const pit = track.pit;
  const path = pit.path;
  const p = createVec3();
  const g = createGround();
  const nrm = createVec3();
  const hint = { index: -1 };
  const q = { s: 0, d: 0, index: -1 };
  const vertexAt = (
    mb: MeshBuilder,
    sp: number,
    dp: number,
    lift: number,
    surface: number,
    u: number,
    v: number,
  ): number => {
    path.pointAt(sp, dp, p);
    track.project(p.x, p.z, hint, q);
    track.ground(q.s, q.d, g);
    track.groundNormal(q.s, q.d, g, nrm);
    return mb.vertex(p.x, g.height + lift, p.z, nrm.x, nrm.y, nrm.z, u, v, surface);
  };
  const pitRows: number[] = [];
  for (let j = 0; j < path.count - 1; j += stride) pitRows.push(j);
  pitRows.push(path.count - 1);
  let prev: number[] | null = null;
  for (const j of pitRows) {
    const sp = j * path.step;
    const cols = [-pit.halfWidthRight[j]!, 0, pit.halfWidthLeft[j]!];
    const cur = cols.map((d) => vertexAt(b, sp, d, LIFT_PIT, MeshSurface.PitLane, d, sp));
    if (prev) for (let c = 0; c < 2; c++) b.quad(prev[c]!, prev[c + 1]!, cur[c]!, cur[c + 1]!);
    prev = cur;
  }
  // Speed-limit lines across the pit lane and an outline at each box.
  const rect = (s0: number, s1: number, d0: number, d1: number): void => {
    const a = vertexAt(marks, s0, d0, LIFT_PIT + LIFT_MARKING, MeshSurface.Marking, 0, 0);
    const c = vertexAt(marks, s0, d1, LIFT_PIT + LIFT_MARKING, MeshSurface.Marking, 1, 0);
    const e = vertexAt(marks, s1, d0, LIFT_PIT + LIFT_MARKING, MeshSurface.Marking, 0, 1);
    const f = vertexAt(marks, s1, d1, LIFT_PIT + LIFT_MARKING, MeshSurface.Marking, 1, 1);
    marks.quad(a, c, e, f);
  };
  for (const s of [pit.limitStart, pit.limitEnd]) {
    rect(s - 0.15, s + 0.15, -pit.halfWidth(s, RIGHT), pit.halfWidth(s, LEFT));
  }
  for (const box of pit.boxes) {
    const [s0, s1, d0, d1] = [box.s - 3, box.s + 3, box.d - 1.6, box.d + 1.6];
    rect(s0, s1, d0, d0 + 0.12);
    rect(s0, s1, d1 - 0.12, d1);
    rect(s1 - 0.12, s1, d0, d1);
  }
  return { pit: b.build(), marks };
}

function buildMarkings(track: Track, marks: MeshBuilder): MeshData {
  const p = createVec3();
  const g = createGround();
  const nrm = createVec3();
  const vertexAt = (s: number, d: number, u: number, v: number): number => {
    track.lap.pointAt(s, d, p);
    track.ground(s, d, g);
    track.groundNormal(s, d, g, nrm);
    return marks.vertex(
      p.x,
      g.height + LIFT_MARKING,
      p.z,
      nrm.x,
      nrm.y,
      nrm.z,
      u,
      v,
      MeshSurface.Marking,
    );
  };
  const rect = (s0: number, s1: number, d0: number, d1: number): void => {
    // Split along d so wide lines follow banking and curvature.
    const parts = Math.max(1, Math.ceil((d1 - d0) / 2));
    let prev: [number, number] | null = null;
    for (let k = 0; k <= parts; k++) {
      const d = d0 + ((d1 - d0) * k) / parts;
      const a = vertexAt(s0, d, k / parts, 0);
      const c = vertexAt(s1, d, k / parts, 1);
      if (prev) marks.quad(prev[0], a, prev[1], c);
      prev = [a, c];
    }
  };
  const across = (s: number, width: number): void => {
    rect(s - width / 2, s + width / 2, -track.halfWidthAt(s, RIGHT), track.halfWidthAt(s, LEFT));
  };
  across(0, 0.6);
  for (const z of track.drsZones) {
    across(z.detection, 0.2);
    across(z.activation, 0.2);
  }
  for (const slot of track.gridSlots) {
    // Front bar of the slot and two short side lines.
    rect(slot.s + 0.5, slot.s + 0.7, slot.d - 1.3, slot.d + 1.3);
    rect(slot.s - 1.2, slot.s + 0.7, slot.d - 1.3, slot.d - 1.15);
    rect(slot.s - 1.2, slot.s + 0.7, slot.d + 1.15, slot.d + 1.3);
  }
  return marks.build();
}

function buildTerrain(track: Track, cell: number, margin: number): MeshData {
  const lap = track.lap;
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < lap.count; i++) {
    minX = Math.min(minX, lap.x[i]!);
    maxX = Math.max(maxX, lap.x[i]!);
    minZ = Math.min(minZ, lap.z[i]!);
    maxZ = Math.max(maxZ, lap.z[i]!);
  }
  const x0 = minX - margin;
  const z0 = minZ - margin;
  const cols = Math.ceil((maxX - minX + 2 * margin) / cell) + 1;
  const rowsN = Math.ceil((maxZ - minZ + 2 * margin) / cell) + 1;
  // Heights from the centreline, weighted strongly toward the nearest stretch (1 / r^4), so the
  // ground follows the track's elevation and blends smoothly between distant parts of the lap.
  const every = 5;
  const m = Math.ceil(lap.count / every);
  const sx = new Float64Array(m);
  const sz = new Float64Array(m);
  const sy = new Float64Array(m);
  for (let k = 0; k < m; k++) {
    sx[k] = lap.x[k * every]!;
    sz[k] = lap.z[k * every]!;
    sy[k] = lap.y[k * every]!;
  }
  const h = new Float64Array(cols * rowsN);
  for (let r = 0; r < rowsN; r++) {
    for (let c = 0; c < cols; c++) {
      const x = x0 + c * cell;
      const z = z0 + r * cell;
      let wsum = 0;
      let ysum = 0;
      for (let k = 0; k < m; k++) {
        const dd = (sx[k]! - x) ** 2 + (sz[k]! - z) ** 2 + 100;
        const w = 1 / (dd * dd);
        wsum += w;
        ysum += w * sy[k]!;
      }
      h[r * cols + c] = ysum / wsum - TERRAIN_DROP;
    }
  }
  const b = new MeshBuilder();
  for (let r = 0; r < rowsN; r++) {
    for (let c = 0; c < cols; c++) {
      const hl = h[r * cols + Math.max(c - 1, 0)]!;
      const hr = h[r * cols + Math.min(c + 1, cols - 1)]!;
      const hu = h[Math.max(r - 1, 0) * cols + c]!;
      const hd = h[Math.min(r + 1, rowsN - 1) * cols + c]!;
      const nx = -(hr - hl) / (2 * cell);
      const nz = -(hd - hu) / (2 * cell);
      const len = Math.hypot(nx, 1, nz);
      const x = x0 + c * cell;
      const z = z0 + r * cell;
      b.vertex(x, h[r * cols + c]!, z, nx / len, 1 / len, nz / len, x, z, MeshSurface.Terrain);
    }
  }
  for (let r = 0; r + 1 < rowsN; r++) {
    for (let c = 0; c + 1 < cols; c++) {
      const a = r * cols + c;
      // Rows run south (+z), columns east (+x): (a, a+1, a+cols) is counter-clockwise from above.
      b.tri(a, a + cols, a + 1);
      b.tri(a + 1, a + cols, a + cols + 1);
    }
  }
  return b.build();
}

/** Builds every track mesh at the given level of detail. Runs once at load; allocates freely. */
export function buildTrackMeshes(
  track: Track,
  options: TrackMeshOptions = MESH_LOD.high,
): TrackMeshes {
  const rowList = rows(track, options.stride);
  const { road, lines } = buildRoad(track, rowList);
  const { pit, marks } = buildPit(track, options.stride);
  return {
    road,
    lines,
    kerbs: buildKerbs(track, rowList),
    runoff: buildRunoff(track, rowList),
    terrain: buildTerrain(track, options.terrainCell, options.terrainMargin),
    barriers: buildBarriers(track),
    pit,
    markings: buildMarkings(track, marks),
  };
}
