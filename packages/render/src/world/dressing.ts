/**
 * The committed dressing file (`packages/render/data/<circuit>.dressing.json`, written by
 * tools/dressing/build.py): what OpenStreetMap maps around a circuit, projected into the track's
 * world frame (x east, z south, metres from the track origin), and a canopy-filtered terrain grid.
 * This module types it and decodes the compact parts; it has no three.js.
 */

/** One mapped feature: flat [x0, z0, x1, z1, ...] points, a source id and the tags kept. */
export interface MappedFeature {
  id: string;
  p: number[];
  t?: Record<string, string>;
}

export const AREA_CLASSES = [
  'grandstand',
  'building',
  'wood',
  'scrub',
  'water',
  'grass',
  'parking',
  'park',
] as const;
export const LINE_CLASSES = [
  'raceway',
  'bridge',
  'tunnel',
  'treeRow',
  'waterway',
  'road',
  'service',
  'path',
] as const;
export type AreaClass = (typeof AREA_CLASSES)[number];
export type LineClass = (typeof LINE_CLASSES)[number];

export interface TerrainGridFile {
  x0: number;
  z0: number;
  cell: number;
  cols: number;
  rows: number;
  /** int16 decimetres above the track datum, little endian, base64; rows run +z. */
  heights: string;
  range: [number, number];
}

export interface DressingFile {
  format: 'undercut-dressing';
  version: number;
  id: string;
  radius: number;
  counts: Record<string, number>;
  mapped: Record<AreaClass | LineClass, MappedFeature[]> & { tree: number[] };
  terrain: TerrainGridFile;
  /** Authored placements (tools/dressing/circuits/<id>.json), resolved to the world frame. */
  authored?: AuthoredDressing;
}

/** Authored trackside objects, placed by lap distance and offset by the build script. */
export interface AuthoredDressing {
  /** Grandstands the map has no footprint for, or extra detail for mapped ones. */
  grandstands?: AuthoredStand[];
  boards?: AuthoredBoard[];
  objects?: AuthoredObject[];
}

export interface AuthoredStand {
  /** Matches a mapped grandstand's id to add detail, or absent for a new one. */
  id?: string;
  /** Footprint corners when new, flat [x, z, ...]. */
  p?: number[];
  roof?: boolean;
  tiers?: number;
  capacity?: number;
  /** Crowd density 0..1. */
  fill?: number;
}

export interface AuthoredBoard {
  kind: string;
  s: number;
  d: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  text?: string;
}

export interface AuthoredObject {
  kind: string;
  s: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  scale?: number;
  data?: Record<string, number | string>;
}

export function isDressingFile(x: unknown): x is DressingFile {
  const d = x as DressingFile | null;
  return !!d && d.format === 'undercut-dressing' && typeof d.terrain === 'object' && !!d.mapped;
}

/** Decoded terrain grid: heights in metres above the track datum. */
export interface TerrainGrid {
  x0: number;
  z0: number;
  cell: number;
  cols: number;
  rows: number;
  h: Float32Array;
}

export function decodeTerrain(t: TerrainGridFile): TerrainGrid {
  const bin = atob(t.heights);
  const n = t.cols * t.rows;
  if (bin.length !== n * 2) throw new Error(`terrain grid has ${bin.length / 2} heights, not ${n}`);
  const h = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let v = bin.charCodeAt(2 * i) | (bin.charCodeAt(2 * i + 1) << 8);
    if (v >= 0x8000) v -= 0x10000;
    h[i] = v / 10;
  }
  return { x0: t.x0, z0: t.z0, cell: t.cell, cols: t.cols, rows: t.rows, h };
}

/** Bilinear height of the grid at (x, z), clamped at its edges. */
export function gridHeight(g: TerrainGrid, x: number, z: number): number {
  const fx = Math.min(Math.max((x - g.x0) / g.cell, 0), g.cols - 1.0001);
  const fz = Math.min(Math.max((z - g.z0) / g.cell, 0), g.rows - 1.0001);
  const c = Math.floor(fx);
  const r = Math.floor(fz);
  const ax = fx - c;
  const az = fz - r;
  const i = r * g.cols + c;
  const h00 = g.h[i] as number;
  const h10 = g.h[i + 1] as number;
  const h01 = g.h[i + g.cols] as number;
  const h11 = g.h[i + g.cols + 1] as number;
  return (h00 * (1 - ax) + h10 * ax) * (1 - az) + (h01 * (1 - ax) + h11 * ax) * az;
}

/** Points of a feature as [x, z] pairs. */
export function points(f: MappedFeature): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i + 1 < f.p.length; i += 2) out.push([f.p[i] as number, f.p[i + 1] as number]);
  return out;
}

/** Signed area of a closed ring (positive when counter-clockwise in x-z with z down). */
export function ringArea(p: readonly number[]): number {
  let a = 0;
  const n = p.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    a +=
      (p[2 * i] as number) * (p[2 * j + 1] as number) -
      (p[2 * j] as number) * (p[2 * i + 1] as number);
  }
  return a / 2;
}

/** Even-odd point in polygon for a flat ring. */
export function inRing(p: readonly number[], x: number, z: number): boolean {
  let inside = false;
  const n = p.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = p[2 * i] as number;
    const zi = p[2 * i + 1] as number;
    const xj = p[2 * j] as number;
    const zj = p[2 * j + 1] as number;
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** Bounding box of a flat point list: [minX, minZ, maxX, maxZ]. */
export function bounds(p: readonly number[]): [number, number, number, number] {
  let x0 = Infinity;
  let z0 = Infinity;
  let x1 = -Infinity;
  let z1 = -Infinity;
  for (let i = 0; i + 1 < p.length; i += 2) {
    const x = p[i] as number;
    const z = p[i + 1] as number;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (z < z0) z0 = z;
    if (z > z1) z1 = z;
  }
  return [x0, z0, x1, z1];
}

/** Small deterministic hash to [0, 1) for placement jitter (no Math.random in placement). */
export function hash01(a: number, b = 0, c = 0): number {
  let h =
    Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1) ^ Math.imul(c | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
