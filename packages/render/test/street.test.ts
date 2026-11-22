import { BoxGeometry, MeshStandardMaterial, Scene, Vector3, type Material } from 'three';
import { describe, expect, it } from 'vitest';
import { Track } from '@undercut/track';
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
import { pickBackdrops, placeStreetCircuit } from '../src/world/street';
import { waterBodies } from '../src/world/terrain';
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
function recorder(): { props: PropRegistry; placed: Map<string, PropPlacement[]> } {
  const placed = new Map<string, PropPlacement[]>();
  const props = {
    define: (k: PropKind) => placed.set(k.id, []),
    place: (id: string, p: PropPlacement) => {
      const list = placed.get(id);
      if (!list) throw new Error(`unknown kind ${id}`);
      list.push(p);
    },
  } as unknown as PropRegistry;
  return { props, placed };
}

function streetAt(night: boolean) {
  const { props, placed } = recorder();
  const spectators: { x: number; z: number }[] = [];
  const res = placeStreetCircuit({
    track,
    lap,
    props,
    kit: fakeKit(),
    street,
    obstacles: [...dressing.mapped.building, ...dressing.mapped.water],
    heightAt: () => 0,
    night,
    mobile: false,
    castShadows: true,
    boardMaterial: null,
    materials: [] as Material[],
    spectator: (s) => spectators.push(s),
    crowd: 0.8,
  });
  return { res, placed, spectators };
}

describe('Singapore street circuit', () => {
  const { res, placed, spectators } = streetAt(true);

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
    for (const s of stands) {
      for (const f of [...dressing.mapped.building, ...dressing.mapped.water])
        expect(inRing(f.p, s.x, s.z)).toBe(false);
    }
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
    // Half-float storage: three significant figures.
    expect(map.sample(0, 0).e / (900 * lampFalloff(10, 70))).toBeCloseTo(1, 2);
    // At 20 m out: the angle of incidence and the distance both count.
    const d = Math.hypot(20, 10);
    expect(map.sample(20, 0).e / (900 * lampFalloff(d, 70) * (10 / d))).toBeCloseTo(1, 2);
    expect(map.sample(80, 0).e).toBe(0);
    map.dispose();
  });

  it('lights the road once as banks hand over between the pooled lights and the bake', () => {
    // Singapore's own banks on level ground, the pool as a session runs it.
    const { res } = streetAt(true);
    const lights = res.lights;
    const map = bakeLampMap(lights, [-1400, -1400, 1400, 1400], 2, () => 0);
    const pool = new LightPool(new Scene(), 8);
    pool.setLights(lights);
    const eye = new Vector3();
    const p = { x: 0, y: 0, z: 0 };
    const pooled = (): PooledLamp[] =>
      pool.active.map((l) => ({
        x: l.position.x,
        y: l.position.y,
        z: l.position.z,
        intensity: l.intensity,
        distance: l.distance,
      }));
    let worst = 0;
    let naiveWorst = 0;
    for (const probeS of [500, 1000, 2000, 3000, 4500]) {
      track.lap.pointAt(probeS, 0, p);
      const px = p.x;
      const pz = p.z;
      let reference = 0;
      for (const l of lights) reference += lampOnGround(l, px, 0, pz);
      expect(reference).toBeGreaterThan(0);
      // The camera drives past the probe: from 300 m before to 300 m after it.
      for (let ds = -300; ds <= 300; ds += 5) {
        track.lap.pointAt((probeS + ds + track.length) % track.length, 0, p);
        eye.set(p.x, 1.2, p.z);
        pool.update(eye);
        const slots = pooled();
        const total = lampLightAt(map, slots, px, pz);
        worst = Math.max(worst, Math.abs(total / reference - 1));
        // Adding the whole bake to the pooled lights, as before: lit twice near the camera.
        let pool0 = 0;
        for (const l of slots) pool0 += lampOnGround(l, px, 0, pz);
        naiveWorst = Math.max(naiveWorst, (pool0 + map.sample(px, pz).e) / reference);
      }
    }
    expect(worst).toBeLessThan(0.03);
    expect(naiveWorst).toBeGreaterThan(1.3);
    map.dispose();
  });
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
