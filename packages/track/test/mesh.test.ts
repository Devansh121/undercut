import { describe, expect, it } from 'vitest';
import raw from '../data/monza.json';
import {
  MESH_LOD,
  MeshSurface,
  buildTrackMeshes,
  type MeshData,
  type TrackMeshes,
} from '../src/mesh';
import { createSurfaceHint, createSurfaceSample } from '@undercut/sim';
import { TrackSurface } from '../src/surface';
import { Track } from '../src/track';
import { syntheticTrackData } from './fixtures';

const SURFACES = new Set<number>(Object.values(MeshSurface));

function checkMesh(name: string, m: MeshData): void {
  const count = m.surface.length;
  expect(count, name).toBeGreaterThan(0);
  expect(m.positions.length, name).toBe(3 * count);
  expect(m.normals.length, name).toBe(3 * count);
  expect(m.uvs.length, name).toBe(2 * count);
  expect(m.indices.length % 3, name).toBe(0);
  let badIndex = 0;
  let badNumber = 0;
  let badNormal = 0;
  let badSurface = 0;
  let backFacing = 0;
  for (const i of m.indices) if (i >= count) badIndex++;
  for (const v of m.positions) if (!Number.isFinite(v)) badNumber++;
  for (const v of m.uvs) if (!Number.isFinite(v)) badNumber++;
  for (let k = 0; k < count; k++) {
    const len = Math.hypot(m.normals[3 * k]!, m.normals[3 * k + 1]!, m.normals[3 * k + 2]!);
    if (Math.abs(len - 1) > 1e-3) badNormal++;
    if (!SURFACES.has(m.surface[k]!)) badSurface++;
  }
  // Counter-clockwise winding: each triangle's face normal agrees with its vertex normals.
  const p = m.positions;
  for (let t = 0; t < m.indices.length; t += 3) {
    const [a, b, c] = [m.indices[t]!, m.indices[t + 1]!, m.indices[t + 2]!];
    const ux = p[3 * b]! - p[3 * a]!;
    const uy = p[3 * b + 1]! - p[3 * a + 1]!;
    const uz = p[3 * b + 2]! - p[3 * a + 2]!;
    const vx = p[3 * c]! - p[3 * a]!;
    const vy = p[3 * c + 1]! - p[3 * a + 1]!;
    const vz = p[3 * c + 2]! - p[3 * a + 2]!;
    const fx = uy * vz - uz * vy;
    const fy = uz * vx - ux * vz;
    const fz = ux * vy - uy * vx;
    const area = Math.hypot(fx, fy, fz);
    if (area < 1e-6) continue;
    let dot = 0;
    for (const v of [a, b, c])
      dot += fx * m.normals[3 * v]! + fy * m.normals[3 * v + 1]! + fz * m.normals[3 * v + 2]!;
    if (dot <= 0) backFacing++;
  }
  expect({ name, badIndex, badNumber, badNormal, badSurface, backFacing }).toEqual({
    name,
    badIndex: 0,
    badNumber: 0,
    badNormal: 0,
    badSurface: 0,
    backFacing: 0,
  });
}

function checkAll(meshes: TrackMeshes): void {
  for (const [name, m] of Object.entries(meshes)) checkMesh(name, m);
}

/** Terrain height under (x, z), bilinear on the regular grid. */
function terrainAt(t: MeshData, x: number, z: number): number {
  const x0 = t.positions[0]!;
  const z0 = t.positions[2]!;
  const cell = t.positions[3]! - x0;
  let cols = 1;
  while (t.positions[3 * cols + 2] === z0) cols++;
  const fc = (x - x0) / cell;
  const fr = (z - z0) / cell;
  const c = Math.floor(fc);
  const r = Math.floor(fr);
  const at = (rr: number, cc: number): number => t.positions[3 * (rr * cols + cc) + 1]!;
  const u = fc - c;
  const v = fr - r;
  return (
    (at(r, c) * (1 - u) + at(r, c + 1) * u) * (1 - v) +
    (at(r + 1, c) * (1 - u) + at(r + 1, c + 1) * u) * v
  );
}

describe('track meshes on a synthetic stadium', () => {
  const track = new Track(syntheticTrackData({ bank: 0.02, height: (s) => Math.sin(s / 150) }));
  const meshes = buildTrackMeshes(track);

  it('are well formed and face the right way', () => {
    checkAll(meshes);
  });

  it('flow UV v along s on the road, closing the lap at its length', () => {
    const v = meshes.road.uvs;
    const rows = meshes.road.surface.length / 3;
    for (let r = 1; r < rows; r++)
      expect(v[2 * 3 * r + 1]!).toBeGreaterThan(v[2 * 3 * (r - 1) + 1]!);
    expect(v[2 * 3 * (rows - 1) + 1]).toBeCloseTo(track.length, 3);
    // u is the lateral offset: -right half-width, 0, +left half-width.
    expect([meshes.road.uvs[0], meshes.road.uvs[2], meshes.road.uvs[4]]).toEqual([-5, 0, 5]);
  });

  it('tags kerb vertices by profile part', () => {
    expect(new Set(meshes.kerbs.surface)).toEqual(new Set([MeshSurface.Kerb]));
    const runoff = new Set(meshes.runoff.surface);
    for (const k of [
      MeshSurface.Grass,
      MeshSurface.Gravel,
      MeshSurface.RunoffAsphalt,
      MeshSurface.Verge,
    ]) {
      expect(runoff.has(k)).toBe(true);
    }
  });
});

describe('track meshes on Monza', () => {
  const track = Track.fromJSON(raw);
  const high = buildTrackMeshes(track, MESH_LOD.high);
  const mobile = buildTrackMeshes(track, MESH_LOD.mobile);

  it('are well formed and face the right way at both levels of detail', () => {
    checkAll(high);
    checkAll(mobile);
  });

  it('are lighter at the Mobile level of detail', () => {
    const verts = (m: TrackMeshes): number =>
      Object.values(m).reduce((a, x) => a + x.surface.length, 0);
    expect(mobile.road.surface.length).toBeLessThan(high.road.surface.length / 2.5);
    expect(verts(mobile)).toBeLessThan(verts(high) / 2);
    expect(new Set(high.kerbs.surface)).toEqual(new Set([MeshSurface.Kerb, MeshSurface.KerbHigh]));
    expect(new Set(high.barriers.surface)).toEqual(
      new Set([MeshSurface.Armco, MeshSurface.Concrete, MeshSurface.Tyres, MeshSurface.Fence]),
    );
  });

  it('keeps the terrain below the road everywhere and reaches well beyond the barriers', () => {
    const r = high.road.positions;
    let worst = Infinity;
    for (let k = 0; k < r.length; k += 3) {
      worst = Math.min(worst, r[k + 1]! - terrainAt(high.terrain, r[k]!, r[k + 2]!));
    }
    expect(worst).toBeGreaterThan(0.2);
    const t = high.terrain.positions;
    let minX = Infinity;
    let maxX = -Infinity;
    for (let k = 0; k < t.length; k += 3) {
      minX = Math.min(minX, t[k]!);
      maxX = Math.max(maxX, t[k]!);
    }
    let lapMin = Infinity;
    let lapMax = -Infinity;
    for (const x of track.lap.x) {
      lapMin = Math.min(lapMin, x);
      lapMax = Math.max(lapMax, x);
    }
    expect(lapMin - minX).toBeGreaterThan(300);
    expect(maxX - lapMax).toBeGreaterThan(300);
  });

  it('lays the pit lane on the same ground the sampler reports, lifted 1 cm', () => {
    const surface = new TrackSurface(track);
    const out = createSurfaceSample();
    const hint = createSurfaceHint();
    const p = high.pit.positions;
    let worst = 0;
    for (let k = 0; k < p.length; k += 3) {
      surface.sample(p[k]!, p[k + 2]!, hint, out);
      worst = Math.max(worst, Math.abs(p[k + 1]! - 0.01 - out.height));
    }
    expect(worst).toBeLessThan(0.001);
  });

  it('marks the start line, twenty grid slots, DRS lines and the pit', () => {
    // Start line: 2 m strips across 12 m; each slot three bars; four DRS lines; pit lines and boxes.
    expect(high.markings.indices.length / 6).toBeGreaterThan(20 * 3 + 4 + 2 + 10 * 3);
  });
});
