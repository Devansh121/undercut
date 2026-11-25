import { BoxGeometry, DataTexture, InstancedMesh, MeshStandardMaterial, type Mesh } from 'three';
import { describe, expect, it } from 'vitest';
import { Track, createVec3, type TrackData } from '@undercut/track';
import monzaTrackJson from '@undercut/track/data/monza.json';
import spaTrackJson from '@undercut/track/data/spa.json';
import brandsJson from '../../../design/brands.json';
import catalogJson from '../data/props.catalog.json';
import monzaDressingJson from '../data/monza.dressing.json';
import spaDressingJson from '../data/spa.dressing.json';
import type { PropCatalogEntry, PropKitAssets } from '../src/props/catalog';
import { PropRegistry } from '../src/props/registry';
import { QUALITY } from '../src/quality';
import { CircuitWorld } from '../src/world/world';
import { decodeTerrain, gridHeight, hash01, type DressingFile } from '../src/world/dressing';
import {
  buildHistoricBanking,
  buildStartGantry,
  buildTrackBridges,
  startLightMask,
} from '../src/world/furniture';
import { buildStands, crowdSeats, fitStand, type StandFrame } from '../src/world/grandstands';
import { LapIndex } from '../src/world/lap-index';
import { BROADLEAF_CLOUD, COLUMNAR_CLOUD, treeCloudGeometry } from '../src/world/trees';
import {
  buildPitBuilding,
  pitCrewGeometry,
  pitWallCanopyGeometry,
} from '../src/world/pit-building';

const monzaTrackData = monzaTrackJson as unknown as TrackData;
const monzaDressing = monzaDressingJson as unknown as DressingFile;
const brandsFile = brandsJson as {
  brands: { id: string; name: string; bg: string; fg: string; accent: string }[];
};

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
    monzaDressing.mapped.grandstand.forEach((f, idx) => {
      const frame = fitStand(f, lap, heightAt, idx);
      if (frame) stands.push(frame);
    });
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
    expect(bridges.geometries.length).toBe(bridges.count * 2);
    // One structure and one banner geometry per bridge (chunked for culling): the structure is
    // a real deck with supports, the banner a face on each side of the bridge.
    bridges.geometries.forEach((g, i) => {
      const n = g.getAttribute('position').count;
      if (i % 2 === 0) expect(n).toBeGreaterThan(20);
      else expect(n).toBe(8);
      g.dispose();
    });
    for (const m of bridges.materials) m.dispose();
    tex.dispose();
  });
});

describe('lap index and the old oval', () => {
  const track = new Track(monzaTrackData);
  const lap = new LapIndex(track);

  it('finds the same nearest lap sample as a brute-force search, near the circuit and kilometres away', () => {
    const brute = (x: number, z: number): number => {
      let best = Infinity;
      for (let i = 0; i < track.lap.count; i++) {
        const d = Math.hypot((track.lap.x[i] as number) - x, (track.lap.z[i] as number) - z);
        if (d < best) best = d;
      }
      return best;
    };
    for (let k = 0; k < 400; k++) {
      // Points from on the circuit out to the 6 km horizon of the terrain.
      const r = 6000 * hash01(k, 1) ** 2;
      const a = hash01(k, 2) * Math.PI * 2;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      expect(lap.nearest(x, z).dist).toBeCloseTo(brute(x, z), 6);
    }
  });

  it('builds no old-oval concrete beside the circuit, only overpasses where it crosses', () => {
    const { geometry } = buildHistoricBanking(monzaDressing.mapped.raceway, () => 0, lap);
    expect(geometry).toBeDefined();
    const p = (geometry as NonNullable<typeof geometry>).getAttribute('position');
    // The oval's mapped ways share Monza's main straight, where they once raised a deck over the
    // start line for hundreds of metres. Concrete within 20 m of the centreline may only be a
    // crossing: each cluster of it spans a short stretch of lap.
    const near: number[] = [];
    for (let i = 0; i < p.count; i++) {
      const hit = lap.nearest(p.getX(i), p.getZ(i));
      if (hit.dist < 20) near.push(hit.s);
    }
    near.sort((x, y) => x - y);
    let start = near[0] ?? 0;
    for (let i = 1; i <= near.length; i++) {
      const s = near[i];
      if (s === undefined || s - (near[i - 1] as number) > 50) {
        expect((near[i - 1] as number) - start).toBeLessThan(100);
        if (s !== undefined) start = s;
      }
    }
  });
});

describe('start light mask', () => {
  it('lights the red pods left to right and puts them all out at lights out', () => {
    expect(startLightMask(null)).toBe(0);
    expect(startLightMask(0)).toBe(0);
    expect(startLightMask(1)).toBe(0b00001);
    expect(startLightMask(3)).toBe(0b00111);
    expect(startLightMask(5)).toBe(0b11111);
    expect(startLightMask(7)).toBe(0b11111);
  });
});

describe('near trees', () => {
  it('builds a trunk, limbs and leaf cards with uv inside the cluster and bark tiles', () => {
    for (const shape of [BROADLEAF_CLOUD, COLUMNAR_CLOUD]) {
      const g = treeCloudGeometry(shape, 7);
      const pos = g.getAttribute('position');
      const uv = g.getAttribute('uv');
      // Six-sided trunk and four limbs (12 triangles each) plus two triangles per leaf card.
      expect((g.index?.count ?? 0) / 3).toBe(5 * 12 + shape.cards * 2);
      let top = 0;
      for (let i = 0; i < pos.count; i++) {
        top = Math.max(top, pos.getY(i));
        // Row 2 of the atlas (clusters and bark): v between 2/3 and 1.
        expect(uv.getY(i)).toBeGreaterThanOrEqual(2 / 3 - 1e-6);
        expect(uv.getY(i)).toBeLessThanOrEqual(1 + 1e-6);
      }
      // Unit height, as the cards it replaces near the eye.
      expect(top).toBeGreaterThan(0.85);
      expect(top).toBeLessThan(1.1);
      g.dispose();
    }
  });
});

function withStubCanvas<T>(fn: () => T): T {
  const prev = (globalThis as { document?: unknown }).document;
  const noop = () => undefined;
  const ctx = new Proxy(
    {
      canvas: { width: 0, height: 0 },
      createLinearGradient: () => ({ addColorStop: noop }),
      createRadialGradient: () => ({ addColorStop: noop }),
      measureText: () => ({ width: 0 }),
      getImageData: (_x: number, _y: number, w: number, h: number) => ({
        data: new Uint8ClampedArray(Math.max(1, w) * Math.max(1, h) * 4),
      }),
    } as Record<string, unknown>,
    { get: (target, prop) => (prop in target ? target[prop as string] : noop) },
  );
  (globalThis as { document?: unknown }).document = {
    createElement: (tag: string) => {
      if (tag !== 'canvas') throw new Error(`unexpected element: ${tag}`);
      return { width: 0, height: 0, getContext: () => ctx };
    },
  };
  try {
    return fn();
  } finally {
    if (prev === undefined) delete (globalThis as { document?: unknown }).document;
    else (globalThis as { document?: unknown }).document = prev;
  }
}

describe('High-world near tree reflections', () => {
  it('marks instantiated near cloud trees and kit conifers as scenery for water reflections', () => {
    const entries = new Map(
      (catalogJson as unknown as { props: PropCatalogEntry[] }).props.map((e) => [e.id, e]),
    );
    const kitGeo = new BoxGeometry(1, 1, 1);
    const kitMat = new MeshStandardMaterial();
    const propKit = {
      entries,
      has: (id: string) => entries.has(id),
      lodsFor: (id: string) =>
        entries.has(id) ? [{ geometry: kitGeo, material: kitMat, maxDistance: 100 }] : null,
    } as unknown as PropKitAssets;
    const tex = dummyTexture();
    const track = Track.fromJSON(spaTrackJson);
    const props = new PropRegistry(track.length, 200, () => undefined);
    // Two small wooded strips exercise both near-tree builders with the unchanged High
    // preset. Omit unrelated mapped scenery rather than rebuilding the whole circuit map.
    const full = spaDressingJson as unknown as DressingFile;
    const wood = (id: string, start: number, leaf_type: string) => ({
      id,
      t: { leaf_type },
      p: [
        [start, 30],
        [start + 40, 30],
        [start + 40, 60],
        [start, 60],
      ].flatMap(([s, d]) => {
        const p = createVec3();
        track.lap.pointAt(s!, d!, p);
        return [p.x, p.z];
      }),
    });
    const mapped = { ...full.mapped };
    for (const key of Object.keys(mapped) as (keyof DressingFile['mapped'])[]) mapped[key] = [];
    mapped.wood = [
      wood('test-broadleaf', 5450, 'broadleaved'),
      wood('test-conifers', 5600, 'needleleaved'),
    ];
    const dressing: DressingFile = { ...full, authored: {}, mapped };
    let world: CircuitWorld | null = null;
    try {
      world = withStubCanvas(
        () =>
          new CircuitWorld({
            track,
            dressing,
            quality: QUALITY.high,
            drivable: [],
            grass: { map: tex, normal: tex, arm: tex, sizeM: 10 },
            grassColour: '',
            props,
            propKit,
          }),
      );
      props.build();

      const nearTrees: { name: string; count: number; reflect: unknown }[] = [];
      props.group.traverse((o) => {
        if (
          o instanceof InstancedMesh &&
          o.name.startsWith('prop:tree-') &&
          o.name.includes('-near')
        ) {
          nearTrees.push({ name: o.name, count: o.count, reflect: o.userData.reflect ?? null });
        }
      });

      const clouds = nearTrees.filter((o) => /^prop:tree-(wood|row|park)-near$/.test(o.name));
      const conifers = nearTrees.filter((o) => o.name.startsWith('prop:tree-conifer-near-'));
      for (const [kind, meshes] of [
        ['cloud trees', clouds],
        ['kit conifers', conifers],
      ] as const) {
        expect(meshes.length, `${kind}: instantiated meshes`).toBeGreaterThan(0);
        expect(
          meshes.reduce((n, o) => n + o.count, 0),
          `${kind}: instances`,
        ).toBeGreaterThan(0);
        for (const mesh of meshes) expect(mesh.reflect, mesh.name).toBe('scenery');
      }
      expect(new Set(conifers.map((o) => o.name))).toEqual(
        new Set(['prop:tree-conifer-near-forest-spruce', 'prop:tree-conifer-near-forest-fir']),
      );
    } finally {
      world?.dispose();
      props.dispose();
      kitGeo.dispose();
      kitMat.dispose();
      tex.dispose();
    }
  });
});
