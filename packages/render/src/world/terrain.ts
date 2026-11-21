import { BufferAttribute, BufferGeometry } from 'three';
import type { MeshData, Track } from '@undercut/track';
import { gridHeight, type TerrainGrid } from './dressing';
import type { LapIndex } from './lap-index';

/** Terrain sits this far below the track's ground so it never shows through it (as the track's). */
export const TERRAIN_DROP = 0.5;

export interface TerrainOptions {
  /** Cell size near the circuit, m. */
  innerCell: number;
  /** Margin of fine cells around the lap's bounding box, m. */
  innerMargin: number;
  /** Growth factor of cell size per step outside the fine region. */
  growth: number;
  /** Half size of the whole terrain square around the origin, m (the horizon). */
  extent: number;
  /** Below this distance from the centreline the ground follows the track's own elevation, m. */
  blendNear: number;
  /** Beyond this distance it is the filtered surface model alone, m. */
  blendFar: number;
}

export const TERRAIN_HIGH: TerrainOptions = {
  innerCell: 10,
  innerMargin: 700,
  growth: 1.22,
  extent: 6000,
  blendNear: 120,
  blendFar: 450,
};
export const TERRAIN_MOBILE: TerrainOptions = {
  ...TERRAIN_HIGH,
  innerCell: 24,
  growth: 1.35,
};

/** Grid line positions: fine cells across [a, b], growing geometrically out to ±extent. */
export function gridLines(
  a: number,
  b: number,
  cell: number,
  growth: number,
  extent: number,
): number[] {
  const inner: number[] = [];
  const n = Math.max(1, Math.ceil((b - a) / cell));
  for (let i = 0; i <= n; i++) inner.push(a + ((b - a) * i) / n);
  const lo: number[] = [];
  let step = cell;
  let p = a;
  while (p > -extent) {
    step *= growth;
    p = Math.max(-extent, p - step);
    lo.push(p);
  }
  const hi: number[] = [];
  step = cell;
  p = b;
  while (p < extent) {
    step *= growth;
    p = Math.min(extent, p + step);
    hi.push(p);
  }
  return [...lo.reverse(), ...inner, ...hi];
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** Index of the last line at or below v (binary search), clamped to a valid cell. */
function cellOf(lines: readonly number[], v: number): number {
  let lo = 0;
  let hi = lines.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if ((lines[mid] as number) <= v) lo = mid;
    else hi = mid;
  }
  return lo;
}

/**
 * The ground of the whole world: a tensor grid, fine around the circuit and coarser toward the
 * horizon, so no seams or T-junctions. Near the track its height is the track pipeline's own
 * (inverse-distance weighted from the centreline elevation, as the track package's terrain), out
 * in the park and beyond it is the canopy-filtered Copernicus surface, blended between the two by
 * distance from the centreline. Every grid corner under a drivable triangle is then lowered to
 * TERRAIN_DROP below that triangle's lowest vertex, the rule the track package uses, so the ground
 * never shows through the circuit and meets the verge apron without a crack.
 */
export function buildTerrain(
  track: Track,
  grid: TerrainGrid,
  lapIndex: LapIndex,
  drivable: readonly MeshData[],
  o: TerrainOptions,
): { geometry: BufferGeometry; heightAt: (x: number, z: number) => number } {
  const lap = track.lap;
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < lap.count; i++) {
    minX = Math.min(minX, lap.x[i] as number);
    maxX = Math.max(maxX, lap.x[i] as number);
    minZ = Math.min(minZ, lap.z[i] as number);
    maxZ = Math.max(maxZ, lap.z[i] as number);
  }
  const xs = gridLines(minX - o.innerMargin, maxX + o.innerMargin, o.innerCell, o.growth, o.extent);
  const zs = gridLines(minZ - o.innerMargin, maxZ + o.innerMargin, o.innerCell, o.growth, o.extent);
  const cols = xs.length;
  const rows = zs.length;

  // Centreline samples for the near-track height (every 5th, as the track package).
  const every = 5;
  const m = Math.ceil(lap.count / every);
  const sx = new Float64Array(m);
  const sz = new Float64Array(m);
  const sy = new Float64Array(m);
  for (let k = 0; k < m; k++) {
    sx[k] = lap.x[k * every] as number;
    sz[k] = lap.z[k * every] as number;
    sy[k] = lap.y[k * every] as number;
  }
  const near = (x: number, z: number): number => {
    let wsum = 0;
    let ysum = 0;
    for (let k = 0; k < m; k++) {
      const dd = ((sx[k] as number) - x) ** 2 + ((sz[k] as number) - z) ** 2 + 100;
      const w = 1 / (dd * dd);
      wsum += w;
      ysum += w * (sy[k] as number);
    }
    return ysum / wsum;
  };
  const hit = { index: 0, s: 0, d: 0, dist: 0 };
  const natural = (x: number, z: number): number => {
    const dist = lapIndex.nearest(x, z, hit).dist;
    const w = smoothstep(o.blendNear, o.blendFar, dist);
    const far = gridHeight(grid, x, z);
    const h = w >= 1 ? far : w <= 0 ? near(x, z) : near(x, z) * (1 - w) + far * w;
    return h - TERRAIN_DROP;
  };

  const h = new Float32Array(cols * rows);
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) h[r * cols + c] = natural(xs[c] as number, zs[r] as number);

  for (const md of drivable) {
    const p = md.positions;
    const idx = md.indices;
    for (let k = 0; k < idx.length; k += 3) {
      let x0t = Infinity;
      let x1t = -Infinity;
      let z0t = Infinity;
      let z1t = -Infinity;
      let ymin = Infinity;
      for (let e = 0; e < 3; e++) {
        const v = 3 * (idx[k + e] as number);
        x0t = Math.min(x0t, p[v] as number);
        x1t = Math.max(x1t, p[v] as number);
        ymin = Math.min(ymin, p[v + 1] as number);
        z0t = Math.min(z0t, p[v + 2] as number);
        z1t = Math.max(z1t, p[v + 2] as number);
      }
      const cap = ymin - TERRAIN_DROP;
      const c0 = cellOf(xs, x0t);
      const c1 = Math.min(cols - 1, cellOf(xs, x1t) + 1);
      const r0 = cellOf(zs, z0t);
      const r1 = Math.min(rows - 1, cellOf(zs, z1t) + 1);
      for (let r = r0; r <= r1; r++)
        for (let c = c0; c <= c1; c++) if ((h[r * cols + c] as number) > cap) h[r * cols + c] = cap;
    }
  }

  const positions = new Float32Array(cols * rows * 3);
  const normals = new Float32Array(cols * rows * 3);
  const uvs = new Float32Array(cols * rows * 2);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      const x = xs[c] as number;
      const z = zs[r] as number;
      const cl = Math.max(c - 1, 0);
      const cr = Math.min(c + 1, cols - 1);
      const ru = Math.max(r - 1, 0);
      const rd = Math.min(r + 1, rows - 1);
      const dhdx =
        ((h[r * cols + cr] as number) - (h[r * cols + cl] as number)) /
        Math.max(1e-3, (xs[cr] as number) - (xs[cl] as number));
      const dhdz =
        ((h[rd * cols + c] as number) - (h[ru * cols + c] as number)) /
        Math.max(1e-3, (zs[rd] as number) - (zs[ru] as number));
      const len = Math.hypot(dhdx, 1, dhdz);
      positions.set([x, h[i] as number, z], i * 3);
      normals.set([-dhdx / len, 1 / len, -dhdz / len], i * 3);
      uvs.set([x, z], i * 2);
    }
  }
  const index = new Uint32Array((cols - 1) * (rows - 1) * 6);
  let t = 0;
  for (let r = 0; r + 1 < rows; r++) {
    for (let c = 0; c + 1 < cols; c++) {
      const a = r * cols + c;
      // Rows run south (+z), columns east (+x): (a, a+cols, a+1) is counter-clockwise from above.
      index[t++] = a;
      index[t++] = a + cols;
      index[t++] = a + 1;
      index[t++] = a + 1;
      index[t++] = a + cols;
      index[t++] = a + cols + 1;
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new BufferAttribute(uvs, 2));
  geometry.setIndex(new BufferAttribute(index, 1));
  geometry.computeBoundingSphere();

  /** Height of the built ground at (x, z): bilinear on the grid (what the mesh shows, nearly). */
  const heightAt = (x: number, z: number): number => {
    const c = Math.min(cellOf(xs, x), cols - 2);
    const r = Math.min(cellOf(zs, z), rows - 2);
    const ax = Math.min(
      1,
      Math.max(0, (x - (xs[c] as number)) / ((xs[c + 1] as number) - (xs[c] as number))),
    );
    const az = Math.min(
      1,
      Math.max(0, (z - (zs[r] as number)) / ((zs[r + 1] as number) - (zs[r] as number))),
    );
    const i = r * cols + c;
    return (
      ((h[i] as number) * (1 - ax) + (h[i + 1] as number) * ax) * (1 - az) +
      ((h[i + cols] as number) * (1 - ax) + (h[i + cols + 1] as number) * ax) * az
    );
  };
  return { geometry, heightAt };
}
