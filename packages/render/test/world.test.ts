import fs from 'node:fs';
import path from 'node:path';
import { DataTexture, type Mesh, type MeshStandardMaterial } from 'three';
import { describe, expect, it } from 'vitest';
import { Track, createVec3, type TrackData } from '@undercut/track';
import { decodeTerrain, gridHeight, hash01, type DressingFile } from '../src/world/dressing';
import { buildStartGantry, buildTrackBridges } from '../src/world/furniture';
import { buildStands, crowdSeats, fitStand, type StandFrame } from '../src/world/grandstands';
import { LapIndex } from '../src/world/lap-index';
import {
  buildPitBuilding,
  pitCrewGeometry,
  pitWallCanopyGeometry,
} from '../src/world/pit-building';

const REPO_ROOT = path.resolve(import.meta.dirname, '../../..');
const monzaTrackData = JSON.parse(
  fs.readFileSync(path.join(REPO_ROOT, 'packages/track/data/monza.json'), 'utf8'),
) as TrackData;
const monzaDressing = JSON.parse(
  fs.readFileSync(path.join(REPO_ROOT, 'packages/render/data/monza.dressing.json'), 'utf8'),
) as DressingFile;
const brandsFile = JSON.parse(
  fs.readFileSync(path.join(REPO_ROOT, 'design/brands.json'), 'utf8'),
) as { brands: { id: string; name: string; bg: string; fg: string; accent: string }[] };

function dummyTexture(): DataTexture {
  return new DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
}

describe('circuit dressing & terrain', () => {
  it('decodes monza.dressing.json terrain grid and interpolates finite heights', () => {
    const grid = decodeTerrain(monzaDressing.terrain);
    expect(grid.cols).toBeGreaterThan(20);
    expect(grid.rows).toBeGreaterThan(20);
    expect(grid.h.length).toBe(grid.cols * grid.rows);

    const hCenter = gridHeight(grid, 0, 0);
    expect(Number.isFinite(hCenter)).toBe(true);
    let minH = Infinity;
    let maxH = -Infinity;
    for (let i = 0; i < grid.h.length; i++) {
      const v = grid.h[i] as number;
      if (v < minH) minH = v;
      if (v > maxH) maxH = v;
    }
    expect(hCenter).toBeGreaterThanOrEqual(minH - 0.01);
    expect(hCenter).toBeLessThanOrEqual(maxH + 0.01);

    // Out-of-bounds queries clamp cleanly to edge samples instead of returning NaN.
    expect(Number.isFinite(gridHeight(grid, 1e6, -1e6))).toBe(true);
    expect(hash01(7, 13, 29)).toBe(hash01(7, 13, 29));
    expect(hash01(7, 13, 29)).toBeGreaterThanOrEqual(0);
    expect(hash01(7, 13, 29)).toBeLessThan(1);
  });

  it('ships 20 unique invented brands in design/brands.json', () => {
    expect(brandsFile.brands).toHaveLength(20);
    const ids = new Set(brandsFile.brands.map((b) => b.id));
    expect(ids.size).toBe(20);
    for (const b of brandsFile.brands) {
      expect(b.name.length).toBeGreaterThan(2);
      expect(b.bg).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(b.fg).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(b.accent).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });
});

describe('pit complex geometry & orientation', () => {
  const track = new Track(monzaTrackData);
  const lap = new LapIndex(track);
  const pit = buildPitBuilding(track, lap, 10);

  it('places the pit building strictly off the racing surface with garages facing the pit lane', () => {
    expect(pit.bays.length).toBeGreaterThanOrEqual(20);
    expect(pit.pitWallSpots.length).toBe(track.pit.boxes.length);
    expect(pit.pitWallLine.length).toBeGreaterThan(30);

    const pTrack = createVec3();
    for (const bay of pit.bays) {
      // Garage bay wall stays well outside the racing centreline.
      const hitTrack = lap.nearest(bay.x, bay.z);
      expect(hitTrack.dist).toBeGreaterThan(15);

      // Bay front normal points toward the pit lane / racing straight, not away into the paddock.
      track.lap.pointAt(bay.s, 0, pTrack);
      const dot = bay.nx * (pTrack.x - bay.x) + bay.nz * (pTrack.z - bay.z);
      expect(dot).toBeGreaterThan(0);
    }
  });

  it('orients pit-wall canopies and catch-fence line normals toward the racing track', () => {
    const pTrack = createVec3();
    for (const spot of pit.pitWallSpots) {
      track.lap.pointAt(spot.s, 0, pTrack);
      const dot = spot.nx * (pTrack.x - spot.x) + spot.nz * (pTrack.z - spot.z);
      expect(dot).toBeGreaterThan(0);
    }
    for (const pt of pit.pitWallLine) {
      track.lap.pointAt(pt.s, 0, pTrack);
      const dot = pt.nx * (pTrack.x - pt.x) + pt.nz * (pTrack.z - pt.z);
      expect(dot).toBeGreaterThan(0);
    }
  });

  it('builds pit-wall canopy and pit-crew stand-in props respecting the ground-centre pivot contract', () => {
    for (const geo of [
      pitWallCanopyGeometry(),
      pitCrewGeometry('mechanic'),
      pitCrewGeometry('engineer'),
    ]) {
      geo.computeBoundingBox();
      const box = geo.boundingBox!;
      expect(box.min.y).toBeGreaterThanOrEqual(-0.01);
      expect(box.max.y).toBeGreaterThan(1.2);
      expect(Number.isFinite(box.max.x)).toBe(true);
      geo.dispose();
    }
  });
});

describe('grandstands, start gantry, and over-track bridges', () => {
  const track = new Track(monzaTrackData);
  const lap = new LapIndex(track);
  const terrain = decodeTerrain(monzaDressing.terrain);
  const heightAt = (x: number, z: number): number => gridHeight(terrain, x, z);

  it('builds grandstands from dressing data facing the circuit with spectator seats', () => {
    const stands: StandFrame[] = [];
    for (const f of monzaDressing.mapped.grandstand) {
      const frame = fitStand(f, lap, heightAt);
      if (frame) stands.push(frame);
    }
    expect(stands.length).toBeGreaterThan(5);
    const geo = buildStands(stands);
    expect(geo.getAttribute('position').count).toBeGreaterThan(100);
    const seats = crowdSeats(stands, () => 0.5);
    expect(seats.length).toBeGreaterThan(200);
    for (const st of stands) {
      // Front edge must be closer to the circuit than the rear edge (b points away from track).
      const midFrontX = st.ox + st.ax * (st.length * 0.5);
      const midFrontZ = st.oz + st.az * (st.length * 0.5);
      const midBackX = midFrontX + st.bx * st.depth;
      const midBackZ = midFrontZ + st.bz * st.depth;
      expect(lap.nearest(midFrontX, midFrontZ).dist).toBeLessThan(
        lap.nearest(midBackX, midBackZ).dist,
      );
    }
    geo.dispose();
  });

  it('controls all 5 addressable start-gantry light pods via bitmask', () => {
    const tex = dummyTexture();
    const gantry = buildStartGantry(track, tex, 2);
    const pods: MeshStandardMaterial[] = [];
    for (let i = 0; i < 5; i++) {
      const m = gantry.group.getObjectByName(`start-light-pod-${i}`) as Mesh | undefined;
      expect(m).toBeDefined();
      pods.push(m!.material as MeshStandardMaterial);
    }

    // Default: all off.
    expect(pods.every((p) => p.emissiveIntensity === 0)).toBe(true);

    // 3 red lights on (bits 0..2).
    gantry.setLights(0b00111);
    expect(pods.slice(0, 3).every((p) => p.emissiveIntensity > 5 && p.emissive.r > 0.8)).toBe(true);
    expect(pods.slice(3).every((p) => p.emissiveIntensity === 0)).toBe(true);

    // Green light signal (bit 5 = 32).
    gantry.setLights(32);
    expect(pods.every((p) => p.emissiveIntensity > 5 && p.emissive.g > 0.7)).toBe(true);

    // Lights out.
    gantry.setLights(0);
    expect(pods.every((p) => p.emissiveIntensity === 0)).toBe(true);

    for (const g of gantry.geometries) g.dispose();
    for (const m of gantry.materials) m.dispose();
    tex.dispose();
  });

  it('builds over-track sponsor bridges with non-empty structure and banner meshes', () => {
    const tex = dummyTexture();
    const bridges = buildTrackBridges(track, monzaDressing, lap, tex);
    expect(bridges.count).toBeGreaterThanOrEqual(2);
    expect(bridges.geometries.length).toBe(2);
    for (const g of bridges.geometries) {
      expect(g.getAttribute('position').count).toBeGreaterThan(20);
      g.dispose();
    }
    for (const m of bridges.materials) m.dispose();
    tex.dispose();
  });
});
