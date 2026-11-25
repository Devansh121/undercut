import { BoxGeometry, MeshStandardMaterial, Scene, Vector3, type Material } from 'three';
import { describe, expect, it } from 'vitest';
import { MESH_LOD, Track, buildTrackMeshes } from '@undercut/track';
import singaporeTrackJson from '@undercut/track/data/singapore.json';
import catalogJson from '../data/props.catalog.json';
import singaporeDressingJson from '../data/singapore.dressing.json';
import {
  bakeLampMap,
  lampFalloff,
  lampLightAt,
  lampOnGround,
  type PooledLamp,
} from '../src/lighting/lamp-map';
import { LightPool } from '../src/lighting/light-pool';
import {
  worldCatalogPropIds,
  type PropCatalogEntry,
  type PropKitAssets,
} from '../src/props/catalog';
import type { PropKind, PropPlacement, PropRegistry } from '../src/props/registry';
import { buildingHeight } from '../src/world/buildings';
import { decodeTerrain, inRing, type DressingFile } from '../src/world/dressing';
import { LapIndex } from '../src/world/lap-index';
import { bakeCircuitLamps, streetGround } from '../src/world/lamps';
import { pickBackdrops, placeBackdrops, placeStreetCircuit } from '../src/world/street';
import { buildTerrain, TERRAIN_HIGH, TERRAIN_MOBILE, waterBodies } from '../src/world/terrain';
import { worldTheme } from '../src/world/theme';

const track = Track.fromJSON(singaporeTrackJson);
const lap = new LapIndex(track);
const dressing = singaporeDressingJson as unknown as DressingFile;
const street = worldTheme('singapore').street!;
const entries = new Map(
  (catalogJson as unknown as { props: PropCatalogEntry[] }).props.map((p) => [p.id, p]),
);

/** The catalogue's entries with a stand-in level per prop: placement needs no models. */
function fakeKit(): PropKitAssets {
  const geometry = new BoxGeometry(1, 1, 1);
  const material = new MeshStandardMaterial();
  return {
    entries,
    has: (id: string) => entries.has(id),
    lodsFor: (id: string) => (entries.has(id) ? [{ geometry, material, maxDistance: 100 }] : null),
  } as unknown as PropKitAssets;
}

/** A registry that keeps what is placed. */
function recorder(): {
  props: PropRegistry;
  placed: Map<string, PropPlacement[]>;
  kinds: Map<string, PropKind>;
} {
  const placed = new Map<string, PropPlacement[]>();
  const kinds = new Map<string, PropKind>();
  const props = {
    define: (k: PropKind) => {
      kinds.set(k.id, k);
      placed.set(k.id, []);
    },
    place: (id: string, p: PropPlacement) => {
      const list = placed.get(id);
      if (!list) throw new Error(`unknown kind ${id}`);
      list.push(p);
    },
  } as unknown as PropRegistry;
  return { props, placed, kinds };
}

function streetAt(night: boolean, heightAt: (x: number, z: number) => number = () => 0) {
  const { props, placed, kinds } = recorder();
  const spectators: { x: number; z: number }[] = [];
  const res = placeStreetCircuit({
    track,
    lap,
    props,
    kit: fakeKit(),
    street,
    obstacles: [...dressing.mapped.building, ...dressing.mapped.water],
    heightAt,
    night,
    mobile: false,
    castShadows: true,
    boardMaterial: null,
    materials: [] as Material[],
    spectator: (s) => spectators.push(s),
    crowd: 0.8,
  });
  return { res, placed, spectators, kinds };
}

describe('Singapore street circuit', () => {
  const { res, placed, spectators, kinds } = streetAt(true);

  it('puts the temporary stands in the water reflection everywhere, the street kit with the circuit', () => {
    expect(kinds.get('temporary-stand')?.reflect).toBe('skyline');
    for (const id of ['street-block', 'street-fence', 'floodlight-mast', 'lighting-truss'])
      expect(kinds.get(id)?.reflect, id).toBe('scenery');
    // Small kit along the wall is left out of the reflection.
    expect(kinds.get('street-fence-end')?.reflect).toBeUndefined();
  });

  it('lines every concrete barrier run with blocks at the module pitch, the fence on each', () => {
    let modules = 0;
    let open = 0;
    for (const bar of track.barriers) {
      if (bar.type !== 'concrete' || bar.side === 'pit') continue;
      let len = 0;
      for (let k = 3; k < bar.points.length; k += 3)
        len += Math.hypot(
          (bar.points[k] as number) - (bar.points[k - 3] as number),
          (bar.points[k + 2] as number) - (bar.points[k - 1] as number),
        );
      modules += Math.floor(len / 4);
      if (!bar.closed && len >= 4) open++;
    }
    expect(res.counts.streetBlocks).toBe(modules);
    expect(res.counts.debrisFences).toBe(modules);
    expect(res.counts.fenceEnds).toBe(2 * open);
    expect(modules).toBeGreaterThan(1000);
  });

  it('stands the blocks on the barrier line, never on the road', () => {
    const hit = { index: 0, s: 0, d: 0, dist: 0 };
    for (const b of placed.get('street-block') ?? []) {
      lap.nearest(b.x, b.z, hit);
      const bar = lap.barrierAt(hit.index, hit.d);
      // The block's centre sits just behind the barrier face (0.37 m in), on whichever leg of
      // the lap is nearest.
      expect(hit.dist).toBeGreaterThan(Math.min(bar, track.halfWidthAt(hit.s, hit.d >= 0 ? 0 : 1)));
    }
  });

  it('puts a floodlight mast every 40 m a side behind the wall, by the track rule, its bank a light', () => {
    const rule = track.environment!.floodlights!.rule!;
    expect(rule.spacing).toBe(40);
    const masts = placed.get('floodlight-mast') ?? [];
    expect(masts.length).toBe(res.counts.floodlightMasts);
    // Both sides, less the pit lane's reach on the pit side and folded bends.
    expect(masts.length).toBeGreaterThan(((2 * track.length) / rule.spacing) * 0.8);
    expect(masts.length).toBeLessThanOrEqual(Math.ceil((2 * track.length) / rule.spacing));
    const hit = { index: 0, s: 0, d: 0, dist: 0 };
    for (const m of masts) {
      lap.nearest(m.x, m.z, hit);
      expect(hit.dist).toBeGreaterThan(lap.barrierAt(hit.index, hit.d) + 1);
    }
    // One light per mast (its lamps' height on a 10 m rule) and the trusses' lights.
    const mastLights = res.lights.filter((l) => l.intensity === res.lights[0]!.intensity);
    expect(mastLights.length).toBe(masts.length);
    for (const l of mastLights) expect(l.y).toBeCloseTo(rule.height - 0.5, 5);
    expect(res.lights.length).toBeGreaterThan(masts.length);
  });

  it('builds the temporary stands clear of buildings and water, with spectators on their rows', () => {
    const stands = placed.get('temporary-stand') ?? [];
    expect(res.counts.tempStands).toBeGreaterThanOrEqual(5);
    expect(stands.length).toBe(res.counts.tempStandModules);
    const obstacles = [...dressing.mapped.building, ...dressing.mapped.water];
    const occupied: { stand: number; feature: string }[] = [];
    for (const [index, stand] of stands.entries()) {
      for (const feature of obstacles) {
        if (inRing(feature.p, stand.x, stand.z))
          occupied.push({ stand: index, feature: feature.id });
      }
    }
    expect(occupied).toEqual([]);
    // Eight rows of twelve per module, about the crowd fill taken.
    const seats = stands.length * 8 * 12;
    expect(spectators.length).toBe(res.counts.crowd);
    expect(spectators.length / seats).toBeGreaterThan(0.7);
    expect(spectators.length / seats).toBeLessThan(0.9);
  });
});

describe('baked lamp light', () => {
  it('falls off as three.js does for a point light, to nothing at its reach', () => {
    expect(lampFalloff(10, 0)).toBeCloseTo(0.01, 10);
    expect(lampFalloff(10, 70)).toBeCloseTo(0.01 * (1 - (10 / 70) ** 4) ** 2, 10);
    expect(lampFalloff(70, 70)).toBe(0);
  });

  it('bakes a lamp onto the ground below it and nowhere beyond its reach', () => {
    const lamp = { x: 0, y: 10, z: 0, colour: '#ffffff', intensity: 900, distance: 70 };
    const map = bakeLampMap([lamp], [-100, -100, 100, 100], 2, () => 0);
    expect(map.sample(0, 0).e).toBeCloseTo(900 * lampFalloff(10, 70), 3);
    // At 20 m out: the angle of incidence and the distance both count.
    const d = Math.hypot(20, 10);
    expect(map.sample(20, 0).e).toBeCloseTo(900 * lampFalloff(d, 70) * (10 / d), 3);
    expect(map.sample(80, 0).e).toBe(0);
    map.dispose();
  });

  // As a session builds it (track-view.ts, world.ts, race-view.ts): the world's terrain on the
  // preset's track meshes, the street kit on the street ground, the lamp map baked over the
  // lap's box on it. High has eight light slots, Mobile four.
  for (const preset of ['high', 'mobile'] as const) {
    it(
      `lights the road once as banks hand over between the pooled lights and the bake (${preset})`,
      { timeout: 60_000 },
      () => {
        const grid = decodeTerrain(dressing.terrain);
        const water = waterBodies(dressing.mapped.water, grid);
        const meshes = buildTrackMeshes(track, MESH_LOD[preset]);
        const drivable = [
          meshes.road,
          meshes.lines,
          meshes.kerbs,
          meshes.runoff,
          meshes.pit,
          meshes.markings,
        ];
        const terrain = buildTerrain(
          track,
          grid,
          lap,
          drivable,
          preset === 'high' ? TERRAIN_HIGH : TERRAIN_MOBILE,
          water,
        );
        const { res } = streetAt(true, streetGround(track, lap, terrain.heightAt));
        const lights = res.lights;
        const map = bakeCircuitLamps(track, lap, terrain.heightAt, lights);
        const eye = new Vector3();
        const p = { x: 0, y: 0, z: 0 };
        // Road probes every 250 m round the lap, the Esplanade bridge (s 3000) among them.
        const probes: { s: number; x: number; y: number; z: number; reference: number }[] = [];
        for (let s = 0; s < track.length; s += 250) {
          track.lap.pointAt(s, 0, p);
          const y = track.groundHeightAt(p.x, p.z);
          let reference = 0;
          for (const l of lights) reference += lampOnGround(l, p.x, y, p.z);
          probes.push({ s, x: p.x, y, z: p.z, reference });
        }
        // On the bridge the road is far above the terrain under it, the map holds the road and the
        // masts beside it stand on the deck, 10 m up from it.
        const bridge = probes.find((q) => q.s === 3000)!;
        expect(bridge.y - terrain.heightAt(bridge.x, bridge.z)).toBeGreaterThan(3);
        expect(map.sample(bridge.x, bridge.z).ground).toBeCloseTo(bridge.y, 1);
        const near = lights.filter((l) => Math.hypot(l.x - bridge.x, l.z - bridge.z) < 30);
        expect(near.length).toBeGreaterThan(0);
        for (const l of near) expect(l.y - bridge.y).toBeGreaterThan(8);
        const pool = new LightPool(new Scene(), preset === 'high' ? 8 : 4);
        pool.setLights(lights);
        let lo = Infinity;
        let hi = 0;
        let naiveHi = 0;
        for (const q of probes) {
          expect(q.reference, `s ${q.s}`).toBeGreaterThan(0);
          // The camera drives past the probe: from 300 m before to 300 m after it.
          for (let ds = -300; ds <= 300; ds += 10) {
            track.lap.pointAt((q.s + ds + track.length) % track.length, 0, p);
            eye.set(p.x, track.groundHeightAt(p.x, p.z) + 1.2, p.z);
            pool.update(eye);
            const pooled: PooledLamp[] = pool.active.map((l) => ({
              x: l.position.x,
              y: l.position.y,
              z: l.position.z,
              intensity: l.intensity,
              distance: l.distance,
            }));
            const ratio = lampLightAt(map, pooled, q.x, q.y, q.z) / q.reference;
            lo = Math.min(lo, ratio);
            hi = Math.max(hi, ratio);
            // Adding the whole bake to the pooled lights: lit twice near the camera.
            let pool0 = 0;
            for (const l of pooled) pool0 += lampOnGround(l, q.x, q.y, q.z);
            naiveHi = Math.max(naiveHi, (pool0 + map.sample(q.x, q.z).e) / q.reference);
          }
        }
        expect(lo, preset).toBeGreaterThan(0.97);
        expect(hi, preset).toBeLessThan(1.03);
        expect(naiveHi).toBeGreaterThan(1.3);
        pool.dispose();
        map.dispose();
      },
    );
  }
});

describe('Singapore water, backdrops and props', () => {
  it('draws the bay at sea level and skips the rooftop pool', () => {
    const water = waterBodies(dressing.mapped.water, decodeTerrain(dressing.terrain));
    // The track datum is 3 m above sea level; the reservoir is the biggest body.
    const big = water.reduce((a, b) =>
      (b.box[2] - b.box[0]) * (b.box[3] - b.box[1]) > (a.box[2] - a.box[0]) * (a.box[3] - a.box[1])
        ? b
        : a,
    );
    expect(big.level).toBeCloseTo(-3, 0);
    const roofs = dressing.mapped.water.filter((f) => f.t?.height !== undefined);
    expect(roofs.length).toBeGreaterThan(0);
    for (const r of roofs) expect(water.some((w) => w.p === r.p)).toBe(false);
  });

  it('stands the kit backdrops in for small low buildings by the track only', () => {
    const picks = pickBackdrops(
      dressing.mapped.building,
      lap,
      () => 0,
      street,
      fakeKit(),
      buildingHeight,
    );
    expect(picks.length).toBeGreaterThan(5);
    const hit = { index: 0, s: 0, d: 0, dist: 0 };
    for (const b of picks) {
      lap.nearest(b.x, b.z, hit);
      expect(hit.dist - lap.barrierAt(hit.index, hit.d)).toBeLessThanOrEqual(street.backdropReach);
      expect(street.backdrops.some((d) => d.id === b.kitId)).toBe(true);
      expect(b.scale).toBeGreaterThanOrEqual(0.7);
      expect(b.scale).toBeLessThanOrEqual(1.5);
    }
  });

  it('defines every backdrop kind for the water reflection on every preset', () => {
    const picks = pickBackdrops(
      dressing.mapped.building,
      lap,
      () => 0,
      street,
      fakeKit(),
      buildingHeight,
    );
    const { props, placed, kinds } = recorder();
    placeBackdrops(props, fakeKit(), picks, new MeshStandardMaterial(), true, 4000);
    const ids = new Set(picks.map((b) => `backdrop-${b.kitId}`));
    expect(ids.size).toBeGreaterThan(0);
    for (const id of ids) {
      expect(kinds.get(id)?.reflect, id).toBe('skyline');
      expect(placed.get(id)?.length, id).toBeGreaterThan(0);
    }
  });

  it('loads the street kit at Singapore on every preset', () => {
    for (const q of [{ world: { treeCloud: 95 } }, { world: { treeCloud: 0 } }]) {
      const ids = worldCatalogPropIds('singapore', q);
      for (const id of [
        street.block,
        street.fence,
        street.fenceEnd,
        street.mast,
        street.truss,
        street.stand,
      ])
        expect(ids).toContain(id);
      for (const b of street.backdrops) expect(ids).toContain(b.id);
    }
  });
});
