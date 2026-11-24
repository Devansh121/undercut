import { Track } from '@undercut/track';
import monza from '@undercut/track/data/monza.json';
import spa from '@undercut/track/data/spa.json';
import singapore from '@undercut/track/data/singapore.json';
import dressing from '../data/monza.dressing.json';
import catalog from '../data/props.catalog.json';
import {
  createPropKitMaterial,
  type PropCatalogEntry,
  type PropKitAssets,
} from '../src/props/catalog';
import type { DressingFile } from '../src/world/dressing';
import { buildStartGantry, buildTrackBridges } from '../src/world/furniture';
import { placeKitStands, type KitSpectator } from '../src/world/kit-stands';
import { placeKitBarriers } from '../src/world/kit-barriers';
import { LapIndex } from '../src/world/lap-index';
import { DataTexture } from 'three';

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
  AmbientLight,
  BoxGeometry,
  Mesh,
  PointLight,
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
    const scene = new Scene();
    const terrain = new Mesh(geometry, material);
    const lamp = new Mesh(geometry, material);
    const light = new PointLight();
    lamp.add(light);
    scene.add(terrain, lamp, new AmbientLight(), props.group);
    const render = vi.fn(() => {
      expect(meshes.every((m) => m.visible && !m.frustumCulled && m.count === 1)).toBe(true);
      // Only the props draw; the scene's lights (and a mesh carrying one) stay.
      expect(terrain.visible).toBe(false);
      expect(lamp.visible && light.visible).toBe(true);
      if (fail) throw new Error('lost context');
    });
    const renderer = {
      getRenderTarget: () => null,
      setRenderTarget: vi.fn(),
      shadowMap: { autoUpdate: true },
      render,
    };
    const draw = () =>
      warmPropLevels(renderer as unknown as WebGLRenderer, scene, new PerspectiveCamera(), props);
    if (fail) expect(draw).toThrow('lost context');
    else draw();
    expect(render).toHaveBeenCalledOnce();
    expect(
      meshes.map((m) => ({ visible: m.visible, count: m.count, cull: m.frustumCulled })),
    ).toEqual(before);
    expect(terrain.visible).toBe(true);
    expect(renderer.shadowMap.autoUpdate).toBe(true);
    expect(renderer.setRenderTarget).toHaveBeenLastCalledWith(null);
    props.dispose();
    geometry.dispose();
    material.dispose();
  });
});

describe('crowd handover', () => {
  it('shares the eye with the idle animation and decides in the vertex stage, no discard', () => {
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
      expect(shader.vertexShader).toContain(
        near ? 'crowdChoice < crowdFar' : 'crowdChoice >= crowdFar',
      );
      // A discard would turn off early depth testing for every crowd fragment.
      expect(shader.fragmentShader).not.toContain('discard');
      material.dispose();
    }
  });
});

describe('crowd handover, evaluated', () => {
  // The generated shader's own handover lines, run in JS with GLSL's helpers: which of the near
  // and far representations of a person at `origin` draws for an eye at `eye`.
  const glsl = {
    smoothstep: (a: number, b: number, x: number) => {
      const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
      return t * t * (3 - 2 * t);
    },
    fract: (x: number) => x - Math.floor(x),
    sin: Math.sin,
    dot: (a: number[], b: number[]) => a[0]! * b[0]! + a[1]! * b[1]!,
    distance: (a: number[], b: number[]) => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!),
    vec2: (x: number, y: number) => [x, y],
  };
  function drawn(near: boolean): (origin: number[], eye: number[]) => boolean {
    const material = crowdMaterial({ value: 3 });
    crowdSwapMaterial(material, { value: new Vector3() }, near);
    const shader = {
      uniforms: {},
      vertexShader: '#include <common>\n#include <begin_vertex>\n#include <project_vertex>',
      fragmentShader: '#include <common>\n#include <alphatest_fragment>',
    } as WebGLProgramParametersWithUniforms;
    material.onBeforeCompile(shader, {} as WebGLRenderer);
    material.dispose();
    const line = (source: string, name: string) =>
      new RegExp(`${name} = ([^;]+);`)
        .exec(source)![1]!
        .replace(/crowdOrigin\.xz/g, '[crowdOrigin[0], crowdOrigin[2]]');
    const far = line(shader.vertexShader, 'float crowdFar');
    const choice = line(shader.vertexShader, 'float crowdChoice');
    const clipVertex = /if \(([^)]+)\) gl_Position/.exec(shader.vertexShader)![1]!;
    const run = new Function(
      ...Object.keys(glsl),
      'crowdOrigin',
      'uCrowdEye',
      `const crowdFar = ${far}; const crowdChoice = ${choice}; return !(${clipVertex});`,
    );
    return (origin, eye) => run(...Object.values(glsl), origin, eye) as boolean;
  }

  it('draws exactly one representation of every person at every distance', () => {
    const near = drawn(true);
    const far = drawn(false);
    let nearDrawn = 0;
    let farDrawn = 0;
    for (let k = 0; k < 400; k++) {
      const origin = [hashish(k, 1) * 2000 - 1000, hashish(k, 2) * 20, hashish(k, 3) * 2000 - 1000];
      for (const d of [0, 10, 23.9, 24, 26, 28, 30, 31.9, 32, 40, 200]) {
        const eye = [origin[0]! + d, origin[1]!, origin[2]!];
        const a = near(origin, eye);
        const b = far(origin, eye);
        expect(a !== b, `person ${k} at ${d} m`).toBe(true);
        if (a) nearDrawn++;
        else farDrawn++;
        if (d < 24) expect(a).toBe(true);
        if (d >= 32) expect(b).toBe(true);
      }
    }
    // Both representations are in use across the band.
    expect(nearDrawn).toBeGreaterThan(0);
    expect(farDrawn).toBeGreaterThan(0);
  });
});

function hashish(k: number, salt: number): number {
  const x = Math.sin(k * 127.1 + salt * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

describe('kit structures', () => {
  it('places the gantry facing the grid and keeps five independent light channels', () => {
    const track = Track.fromJSON(monza);
    const props = new PropRegistry(track.length);
    const kit = fakeKit();
    const texture = new DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    const gantry = buildStartGantry(track, texture, 0, kit, props);
    expect(props.count('start-gantry')).toBe(1);
    // Five pods, each a face plate and two lenses.
    expect(gantry.group.children).toHaveLength(15);
    const pods = [0, 1, 2, 3, 4].map((i) =>
      gantry.group.children
        .slice(i * 3, i * 3 + 3)
        .map((o) => (o as Mesh).material as MeshStandardMaterial),
    );
    gantry.setLights(1 << 2);
    expect(pods.map(([, a, b]) => [a!.emissiveIntensity, b!.emissiveIntensity])).toEqual([
      [0, 0],
      [0, 0],
      [9, 9],
      [0, 0],
      [0, 0],
    ]);
    expect(pods.map(([plate]) => plate!.emissiveIntensity)).toEqual([0, 0, 0.35, 0, 0]);
    gantry.setLights(32);
    for (const [plate, a, b] of pods) {
      for (const lens of [a!, b!]) {
        expect(lens.emissiveIntensity).toBe(8);
        expect(lens.emissive.getHex()).toBe(0x10e048);
      }
      expect(plate!.emissive.getHex()).toBe(0x10e048);
      expect(plate!.emissiveIntensity).toBe(0.35);
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

  it('covers a run to its end with equal modules, no bare remainder', () => {
    const track = Track.fromJSON(monza);
    // 21.5 m: five modules of 4.3 m (four of 4 m left 5.5 m bare before).
    const run = {
      ...track,
      barriers: [
        { type: 'armco', side: 'left', points: Float64Array.from([0, 4, 50, 21.5, 4, 50]) },
      ],
    } as unknown as Track;
    const props = new PropRegistry(track.length);
    const place = vi.spyOn(props, 'place');
    expect(placeKitBarriers(run, new LapIndex(track), fakeKit(), props, false)).toBe(5);
    const xs = place.mock.calls.map(([, p]) => p.x);
    xs.forEach((x, i) => expect(x).toBeCloseTo(2.15 + 4.3 * i, 9));
    expect(place.mock.calls.every(([, p]) => Math.abs(p.stretch![2] - 4.3 / 4) < 1e-9)).toBe(true);
    props.dispose();
  });

  it.each([
    ['monza', monza, false],
    ['spa', spa, false],
    ['singapore', singapore, true],
  ])('sleeves every sleeved run over its whole length at %s', (_, data, street) => {
    const track = Track.fromJSON(data as never);
    const lap = new LapIndex(track);
    const kit = fakeKit();
    const kitOf = { armco: 'armco-three', tyres: 'tyre-wall', concrete: 'concrete-wall' } as const;
    const matrix = placementMatrix({ x: 0, y: 0, z: 0, s: 0 });
    // Both ends of a module on its run's line (modules are 4 m along +Z, centred on the origin).
    const ends = (p: PropPlacement, line: number): Vector3[] => {
      placementMatrix(p, matrix);
      return [-2, 2].map((e) => new Vector3(line, 0, e).applyMatrix4(matrix).setY(0));
    };
    const gap = (a: Vector3[], b: Vector3[]): number =>
      Math.min(...a.flatMap((u) => b.map((v) => u.distanceTo(v))));
    let runs = 0;
    for (const bar of track.barriers) {
      const props = new PropRegistry(track.length);
      const placed: PropPlacement[] = [];
      vi.spyOn(props, 'place').mockImplementation((_id, p) => void placed.push(p));
      placeKitBarriers({ ...track, barriers: [bar] } as unknown as Track, lap, kit, props, street);
      if (placed.length === 0) continue;
      const line = kit.entries.get(kitOf[bar.type as keyof typeof kitOf])!.bounds!.max[0] - 0.03;
      const pts = bar.points;
      const first = [new Vector3(pts[0]!, 0, pts[2]!)];
      const last = [new Vector3(pts[pts.length - 3]!, 0, pts[pts.length - 1]!)];
      const chain = placed.map((p) => ends(p, line));
      // The first module starts on the run's first point, each next one where the last ended,
      // and the last ends on the run's last point: nothing of the run is left bare.
      expect(gap(first, chain[0]!)).toBeLessThan(0.03);
      for (let i = 1; i < chain.length; i++)
        expect(gap(chain[i - 1]!, chain[i]!)).toBeLessThan(0.03);
      expect(gap(last, chain.at(-1)!)).toBeLessThan(0.03);
      runs++;
    }
    expect(runs).toBeGreaterThan(5);
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
  it('shares one geometry per kit model and bank height across stands of any size', () => {
    const props = new PropRegistry(1000);
    const define = vi.spyOn(props, 'define');
    const place = vi.spyOn(props, 'place');
    const frame = {
      id: 'stand',
      ox: 0,
      oz: 0,
      ax: 0,
      az: 1,
      bx: -1,
      bz: 0,
      base: 0,
      roof: true,
      s: 100,
      seat: [0.1, 0.2, 0.3] as [number, number, number],
    };
    const frames = [
      { ...frame, length: 20, depth: 26.7, rows: 30 },
      { ...frame, length: 47, depth: 31, rows: 30, ox: 100 },
      { ...frame, length: 33, depth: 9, rows: 10, roof: false, oz: 100 },
    ];
    placeKitStands(
      frames,
      fakeKit(),
      props,
      () => 0,
      false,
      () => undefined,
    );
    expect(define.mock.calls.every(([kind]) => kind.reflect === 'skyline')).toBe(true);
    // Banks 0 and 1, the roofed rear bank 2; the one-bank stand reuses bank 0: three kinds.
    expect(define.mock.calls.map(([kind]) => kind.id).sort()).toEqual([
      'stand-kit-grandstand-0',
      'stand-kit-grandstand-1',
      'stand-kit-grandstand-roof-2',
    ]);
    // Each stand's fit rides on its instances: footprint depth over the banks' depth, module pitch.
    const fits = new Set(place.mock.calls.map(([, p]) => p.stretch!.join(',')));
    expect(fits).toEqual(
      new Set([
        [26.7 / 26.47, 1, 1].join(','),
        [31 / 26.47, 1, 47 / 5 / 10].join(','),
        [9 / 9.47, 1, 33 / 3 / 10].join(','),
      ]),
    );
    props.dispose();
  });

  it('keeps human-scale row heights and grounds the supports of all raised banks', () => {
    const props = new PropRegistry(1000);
    const define = vi.spyOn(props, 'define');
    const place = vi.spyOn(props, 'place');
    const seats: KitSpectator[] = [];
    const rowsAsked = new Set<number>();
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
      (_, row) => (rowsAsked.add(row), 1),
      true,
      (seat) => seats.push(seat),
    );
    // Occupancy is asked by the stand's own row, front to back over all three banks, as the
    // procedural stands' seats are.
    expect(Math.min(...rowsAsked)).toBe(0);
    expect(Math.max(...rowsAsked)).toBeGreaterThanOrEqual(20);
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

describe('kit material grain', () => {
  function compiled(grain?: boolean): string {
    const material = createPropKitMaterial(grain === undefined ? {} : { grain });
    const shader = {
      uniforms: {},
      vertexShader:
        '#include <common>\n#include <color_vertex>\n#include <begin_vertex>\n#include <worldpos_vertex>',
      fragmentShader:
        '#include <common>\n#include <color_fragment>\n#include <roughnessmap_fragment>\n#include <metalnessmap_fragment>',
    } as WebGLProgramParametersWithUniforms;
    material.onBeforeCompile(shader, {} as WebGLRenderer);
    const key = material.customProgramCacheKey();
    material.dispose();
    return `${key}\n${shader.fragmentShader}`;
  }

  it('hashes the grain without sin, and leaves it out of far-only levels', () => {
    const grained = compiled();
    const smooth = compiled(false);
    // The grain's hash: no trigonometry per fragment (its range reduction was the cost).
    expect(grained).not.toMatch(/\bsin\(/);
    expect(grained.match(/propGrain\(vPropWorld/g)).toHaveLength(2);
    expect(smooth.match(/propGrain\(vPropWorld/g)).toBeNull();
    // Distinct programs, so the two never share a compiled variant.
    expect(grained.split('\n')[0]).not.toBe(smooth.split('\n')[0]);
  });
});

describe('stand banks far level', () => {
  it('draws the far level with the given material, in 40 m cells, reflected', () => {
    const props = new PropRegistry(1000);
    const define = vi.spyOn(props, 'define');
    const far = new MeshStandardMaterial();
    placeKitStands(
      [
        {
          id: 'stand',
          ox: 0,
          oz: 0,
          ax: 0,
          az: 1,
          bx: -1,
          bz: 0,
          base: 0,
          roof: false,
          s: 100,
          seat: [0.1, 0.2, 0.3],
          length: 40,
          depth: 9,
          rows: 10,
        },
      ],
      fakeKit(),
      props,
      () => 0,
      true,
      () => undefined,
      far,
    );
    const [kind] = define.mock.calls.map(([k]) => k);
    expect(kind!.lods.at(-1)!.material).toBe(far);
    expect([kind!.gridCell, kind!.reflect, kind!.shadowLevel]).toEqual([
      40,
      'skyline',
      kind!.lods.length - 1,
    ]);
    props.dispose();
    far.dispose();
  });
});
