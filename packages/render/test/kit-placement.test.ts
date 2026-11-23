import { Track } from '@undercut/track';
import monza from '@undercut/track/data/monza.json';
import spa from '@undercut/track/data/spa.json';
import singapore from '@undercut/track/data/singapore.json';
import dressing from '../data/monza.dressing.json';
import catalog from '../data/props.catalog.json';
import type { PropCatalogEntry, PropKitAssets } from '../src/props/catalog';
import type { DressingFile } from '../src/world/dressing';
import { buildStartGantry, buildTrackBridges } from '../src/world/furniture';
import { placeKitStands, type KitSpectator } from '../src/world/kit-stands';
import { placeKitBarriers } from '../src/world/kit-barriers';
import { LapIndex } from '../src/world/lap-index';
import { DataTexture, type Mesh } from 'three';

function fakeKit(): PropKitAssets {
  const entries = new Map((catalog.props as unknown as PropCatalogEntry[]).map((p) => [p.id, p]));
  return {
    entries,
    has: (id: string) => entries.has(id),
    lodsFor: (id: string) =>
      entries.has(id)
        ? [{ geometry: new BoxGeometry(), material: new MeshStandardMaterial(), maxDistance: 100 }]
        : null,
  } as unknown as PropKitAssets;
}

import { describe, expect, it, vi } from 'vitest';
import {
  BoxGeometry,
  type InstancedMesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Scene,
  type WebGLRenderer,
} from 'three';
import { PropRegistry, placementMatrix, type PropPlacement } from '../src/props/registry';
import { warmPropLevels } from '../src/world/warm-props';
import { crowdMaterial, crowdSwapMaterial } from '../src/world/crowd';
import { Vector3, type WebGLProgramParametersWithUniforms } from 'three';

describe('loading prop levels', () => {
  it.each([false, true])('draws every level and restores state after failure=%s', (fail) => {
    const props = new PropRegistry(1000);
    const geometry = new BoxGeometry();
    const material = new MeshStandardMaterial();
    props.define({
      id: 'kit',
      lods: [20, 50, 100].map((maxDistance) => ({ geometry, material, maxDistance })),
    });
    for (let i = 0; i < 3; i++) props.place('kit', { x: i, y: 0, z: 0, s: i });
    props.build();
    props.update(new Vector3());
    const meshes = props.group.children as InstancedMesh[];
    const before = meshes.map((m) => ({
      visible: m.visible,
      count: m.count,
      cull: m.frustumCulled,
    }));
    const render = vi.fn(() => {
      expect(meshes.every((m) => m.visible && !m.frustumCulled && m.count === 1)).toBe(true);
      if (fail) throw new Error('lost context');
    });
    const renderer = {
      getRenderTarget: () => null,
      setRenderTarget: vi.fn(),
      shadowMap: { autoUpdate: true },
      render,
    };
    const draw = () =>
      warmPropLevels(
        renderer as unknown as WebGLRenderer,
        new Scene(),
        new PerspectiveCamera(),
        props,
      );
    if (fail) expect(draw).toThrow('lost context');
    else draw();
    expect(render).toHaveBeenCalledOnce();
    expect(
      meshes.map((m) => ({ visible: m.visible, count: m.count, cull: m.frustumCulled })),
    ).toEqual(before);
    expect(renderer.shadowMap.autoUpdate).toBe(true);
    expect(renderer.setRenderTarget).toHaveBeenLastCalledWith(null);
    props.dispose();
    geometry.dispose();
    material.dispose();
  });
});

describe('crowd handover', () => {
  it('shares the eye and complementary discard with the existing idle animation', () => {
    const eye = { value: new Vector3() };
    for (const near of [false, true]) {
      const material = crowdMaterial({ value: 3 });
      crowdSwapMaterial(material, eye, near);
      const shader = {
        uniforms: {},
        vertexShader: '#include <common>\n#include <begin_vertex>\n#include <project_vertex>',
        fragmentShader: '#include <common>\n#include <alphatest_fragment>',
      } as WebGLProgramParametersWithUniforms;
      material.onBeforeCompile(shader, {} as WebGLRenderer);
      expect(shader.uniforms.uCrowdEye).toBe(eye);
      expect(shader.vertexShader).toContain('sin(uCrowdTime');
      expect(shader.fragmentShader).toContain(
        near ? 'crowdNoise < vCrowdFar' : 'crowdNoise >= vCrowdFar',
      );
      material.dispose();
    }
  });
});

describe('kit structures', () => {
  it('places the gantry facing the grid and keeps five independent light channels', () => {
    const track = Track.fromJSON(monza);
    const props = new PropRegistry(track.length);
    const kit = fakeKit();
    const texture = new DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    const gantry = buildStartGantry(track, texture, 0, kit, props);
    expect(props.count('start-gantry')).toBe(1);
    expect(gantry.group.children).toHaveLength(5);
    gantry.setLights(1 << 2);
    const intensities = gantry.group.children.map(
      (o) => ((o as Mesh).material as MeshStandardMaterial).emissiveIntensity,
    );
    expect(intensities).toEqual([0, 0, 9, 0, 0]);
    gantry.setLights(32);
    for (const child of gantry.group.children) {
      const material = (child as Mesh).material as MeshStandardMaterial;
      expect(material.emissiveIntensity).toBe(8);
      expect(material.emissive.getHex()).toBe(0x10e048);
    }
    gantry.geometries.forEach((g) => g.dispose());
    gantry.materials.forEach((m) => m.dispose());
    props.dispose();
    texture.dispose();
  });

  it('uses kit bridges at the same crossings as the existing builder', () => {
    const track = Track.fromJSON(monza);
    const lap = new LapIndex(track);
    const props = new PropRegistry(track.length);
    const texture = new DataTexture();
    const baseline = buildTrackBridges(track, dressing as unknown as DressingFile, lap, texture);
    const built = buildTrackBridges(
      track,
      dressing as unknown as DressingFile,
      lap,
      texture,
      fakeKit(),
      props,
    );
    expect(built.count).toBeGreaterThan(0);
    expect(built.count).toBe(baseline.count);
    expect(props.instanceCount).toBe(built.count);
    expect(built.group.children).toHaveLength(0);
    for (const b of [baseline, built]) {
      b.geometries.forEach((g) => g.dispose());
      b.materials.forEach((m) => m.dispose());
    }
    props.dispose();
    texture.dispose();
  });
});

describe('kit barrier pitch', () => {
  it('tiles across vertices closer together than the module length', () => {
    const track = Track.fromJSON(monza);
    const sampled = {
      ...track,
      barriers: [
        {
          type: 'armco',
          side: 'left',
          points: Float64Array.from(Array.from({ length: 11 }, (_, i) => [i * 2, 4, 50]).flat()),
        },
      ],
    } as unknown as Track;
    const props = new PropRegistry(track.length);
    const place = vi.spyOn(props, 'place');
    expect(placeKitBarriers(sampled, new LapIndex(track), fakeKit(), props, false)).toBe(5);
    expect(place.mock.calls.map(([, p]) => p.x)).toEqual([2, 6, 10, 14, 18]);
    expect(place.mock.calls.every(([, p]) => p.y === 4 && Number.isFinite(p.yaw))).toBe(true);
    props.dispose();
  });
});

describe('kit barrier slope', () => {
  // Height of a run's polyline at the point nearest (x, z) in plan, and that distance.
  function baseAt(points: ArrayLike<number>, x: number, z: number): { y: number; d: number } {
    let best = Infinity;
    let y = 0;
    for (let i = 3; i < points.length; i += 3) {
      const dx = points[i]! - points[i - 3]!;
      const dz = points[i + 2]! - points[i - 1]!;
      const l2 = dx * dx + dz * dz;
      if (l2 === 0) continue;
      const u = Math.max(
        0,
        Math.min(1, ((x - points[i - 3]!) * dx + (z - points[i - 1]!) * dz) / l2),
      );
      const d = Math.hypot(x - points[i - 3]! - u * dx, z - points[i - 1]! - u * dz);
      if (d < best) {
        best = d;
        y = points[i - 2]! + u * (points[i + 1]! - points[i - 2]!);
      }
    }
    return { y, d: best };
  }

  it.each([
    ['monza', monza, false],
    ['spa', spa, false],
    ['singapore', singapore, true],
  ])('keeps both ends of every module within 3 cm of its run at %s', (_, data, street) => {
    const track = Track.fromJSON(data as never);
    const lap = new LapIndex(track);
    const kit = fakeKit();
    // Every barrier kit module is 4 m long and centred on its origin along +Z; the run it sleeves
    // lies along local x = face − 3 cm (its track face stands 3 cm proud of the base mesh).
    const half = 2;
    const kitOf = { armco: 'armco-three', tyres: 'tyre-wall', concrete: 'concrete-wall' } as const;
    const end = new Vector3();
    const matrix = placementMatrix({ x: 0, y: 0, z: 0, s: 0 });
    let modules = 0;
    let sloped = 0;
    let worst = 0;
    for (const bar of track.barriers) {
      const props = new PropRegistry(track.length);
      const placed: PropPlacement[] = [];
      vi.spyOn(props, 'place').mockImplementation((_id, p) => void placed.push(p));
      placeKitBarriers({ ...track, barriers: [bar] } as unknown as Track, lap, kit, props, street);
      const kitId = kitOf[bar.type as keyof typeof kitOf];
      const line = kitId ? kit.entries.get(kitId)!.bounds!.max[0] - 0.03 : 0;
      for (const p of placed) {
        placementMatrix(p, matrix);
        if (p.pitch) sloped++;
        for (const e of [-half, half]) {
          end.set(line, 0, e).applyMatrix4(matrix);
          const base = baseAt(bar.points, end.x, end.z);
          expect(base.d).toBeLessThan(0.05);
          worst = Math.max(worst, Math.abs(end.y - base.y));
        }
        modules++;
      }
    }
    expect(modules).toBeGreaterThan(300);
    expect(sloped).toBeGreaterThan(0);
    expect(worst).toBeLessThan(0.03);
  });
});

describe('permanent stand banks', () => {
  it('keeps human-scale row heights and grounds the supports of all raised banks', () => {
    const props = new PropRegistry(1000);
    const define = vi.spyOn(props, 'define');
    const place = vi.spyOn(props, 'place');
    const seats: KitSpectator[] = [];
    const result = placeKitStands(
      [
        {
          id: 'stand',
          ox: 0,
          oz: 0,
          ax: 0,
          az: 1,
          bx: -1,
          bz: 0,
          length: 20,
          depth: 26.7,
          base: 0,
          rows: 30,
          roof: true,
          s: 100,
          seat: [0.1, 0.2, 0.3],
        },
      ],
      fakeKit(),
      props,
      1,
      true,
      (seat) => seats.push(seat),
    );
    expect(result.modules).toBe(6);
    expect(result.fallback).toHaveLength(0);
    const heights = [...new Set(seats.map((p) => Math.round(p.y * 1000) / 1000))].sort(
      (a, b) => a - b,
    );
    expect(heights[1]! - heights[0]!).toBeCloseTo(0.42);
    expect(heights.at(-1)).toBeCloseTo(14.2);
    for (const [kind] of define.mock.calls) {
      expect(kind.gridCell).toBeGreaterThan(0);
      const geometry = kind.lods[0]!.geometry;
      geometry.computeBoundingBox();
      const placement = place.mock.calls.find(([id]) => id === kind.id)![1];
      expect(placement.y + geometry.boundingBox!.min.y).toBeCloseTo(-0.5);
      geometry.dispose();
    }
    props.dispose();
  });
});
