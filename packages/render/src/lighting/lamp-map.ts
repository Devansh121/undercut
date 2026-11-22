import {
  Color,
  DataTexture,
  DataUtils,
  HalfFloatType,
  LinearFilter,
  RGFormat,
  Vector4,
  type Material,
  type MeshStandardMaterial,
  type Object3D,
  type WebGLProgramParametersWithUniforms,
} from 'three';
import type { LocalLight } from './light-pool';

/** Pooled light slots the shader takes out of the baked light (light-pool.ts has 8 or 4). */
export const LAMP_POOL_SLOTS = 8;

/** A pooled light as the shader sees it: where it is, its intensity now (faded) and its reach. */
export interface PooledLamp {
  x: number;
  y: number;
  z: number;
  intensity: number;
  distance: number;
}

/**
 * Baked lamp light for a floodlit circuit. A forward renderer lights each pixel from a few
 * pooled point lights (light-pool.ts: the lamp banks nearest the camera, faded in and out as they
 * take and lose their slots); the rest of a circuit's banks are baked here, once at load: every
 * bank's light on level ground at ground height, on a world grid (x, z), with the ground height
 * each cell was baked at. Static scenery adds the baked light less what the pooled lights, at
 * their current intensity, put on that same ground point: the two are complementary, so a bank
 * lights the road once whether it is in a slot, fading over, or baked, wherever the camera is.
 * Cars and other moving things take only the pooled lights.
 *
 * Falloff is three.js's own for a point light (inverse square with its smooth cut-off at the
 * light's `distance`) and level ground takes the light's cosine from the vertical, as three's
 * point light gives a surface facing up.
 */
export interface LampMap {
  readonly texture: DataTexture;
  /** Shader uniforms: the map, its transform, the pooled lights to take out, the colour. */
  readonly uniforms: {
    uLampMap: { value: DataTexture };
    /** x, z of texel (0, 0)'s outer corner and 1 / the map's width and depth, m. */
    uLampT: { value: Vector4 };
    /** Pooled lights: x, y, z and intensity now (0: a free slot). */
    uLampPool: { value: Vector4[] };
    /** Their reach (cut-off distance), m. */
    uLampReach: { value: number[] };
    uLampColour: { value: Color };
  };
  /** Baked irradiance and ground height at (x, z), filtered as the GPU does (tests). */
  sample(x: number, z: number): { e: number; ground: number };
  /** Take the pool's lights as they now stand (each frame, after the pool's update). */
  update(pooled: readonly PooledLamp[]): void;
  dispose(): void;
}

/** Inverse-square falloff with three.js's cut-off window (getDistanceAttenuation, decay 2). */
export function lampFalloff(d: number, cutoff: number): number {
  const f = 1 / Math.max(d * d, 0.01);
  if (cutoff <= 0) return f;
  const r = Math.min(1, Math.max(0, 1 - (d / cutoff) ** 4));
  return f * r * r;
}

/** Irradiance a lamp puts on level ground at (x, y, z): falloff times the cosine from vertical. */
export function lampOnGround(
  l: { x: number; y: number; z: number; intensity: number; distance: number },
  x: number,
  y: number,
  z: number,
): number {
  const dy = l.y - y;
  if (dy <= 0 || l.intensity <= 0) return 0;
  const d = Math.hypot(l.x - x, dy, l.z - z);
  const reach = l.distance > 0 ? l.distance : Infinity;
  if (d >= reach) return 0;
  return l.intensity * lampFalloff(d, l.distance) * (dy / d);
}

/**
 * The lamp light level ground gets at (x, z), as the scenery's shader adds it: the pooled lights
 * (three's point lights, here on the baked ground point) plus the baked light less their share.
 */
export function lampLightAt(
  map: LampMap,
  pooled: readonly PooledLamp[],
  x: number,
  z: number,
): number {
  const { e, ground } = map.sample(x, z);
  let pool = 0;
  for (const l of pooled) pool += lampOnGround(l, x, ground, z);
  return pool + Math.max(0, e - pool);
}

/**
 * Bake the lamps onto a grid of `cell` metres over `box` (x0, z0, x1, z1), the ground height
 * from `groundAt`. Each lamp touches only the cells within its reach.
 */
export function bakeLampMap(
  lights: readonly LocalLight[],
  box: readonly [number, number, number, number],
  cell: number,
  groundAt: (x: number, z: number) => number,
): LampMap {
  const [x0, z0, x1, z1] = box;
  const w = Math.max(2, Math.ceil((x1 - x0) / cell) + 1);
  const h = Math.max(2, Math.ceil((z1 - z0) / cell) + 1);
  const e = new Float32Array(w * h);
  const ground = new Float32Array(w * h);
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) ground[j * w + i] = groundAt(x0 + i * cell, z0 + j * cell);
  // Mean colour of the lamps (they are all warm white); the texture holds the scalar.
  const colour = new Color(0, 0, 0);
  for (const l of lights) {
    const reach = l.distance > 0 ? l.distance : 80;
    const i0 = Math.max(0, Math.floor((l.x - reach - x0) / cell));
    const i1 = Math.min(w - 1, Math.ceil((l.x + reach - x0) / cell));
    const j0 = Math.max(0, Math.floor((l.z - reach - z0) / cell));
    const j1 = Math.min(h - 1, Math.ceil((l.z + reach - z0) / cell));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const k = j * w + i;
        e[k] =
          (e[k] as number) + lampOnGround(l, x0 + i * cell, ground[k] as number, z0 + j * cell);
      }
    }
    colour.add(new Color(l.colour));
  }
  if (lights.length > 0) colour.multiplyScalar(1 / lights.length);
  const half = new Uint16Array(w * h * 2);
  for (let k = 0; k < w * h; k++) {
    half[2 * k] = DataUtils.toHalfFloat(Math.min(60000, e[k] as number));
    half[2 * k + 1] = DataUtils.toHalfFloat(ground[k] as number);
  }
  const texture = new DataTexture(half, w, h, RGFormat, HalfFloatType);
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  // Grid point (i, j) is at the centre of texel (i, j).
  const uniforms = {
    uLampMap: { value: texture },
    uLampT: {
      value: new Vector4(x0 - cell / 2, z0 - cell / 2, 1 / (w * cell), 1 / (h * cell)),
    },
    uLampPool: {
      value: Array.from({ length: LAMP_POOL_SLOTS }, () => new Vector4(0, 0, 0, 0)),
    },
    uLampReach: { value: new Array<number>(LAMP_POOL_SLOTS).fill(1) },
    uLampColour: { value: colour },
  };
  // Bilinear between grid points, clamped at the edges, as LinearFilter with clamping does.
  const bilinear = (data: Float32Array, x: number, z: number): number => {
    const fx = Math.min(w - 1, Math.max(0, (x - x0) / cell));
    const fz = Math.min(h - 1, Math.max(0, (z - z0) / cell));
    const i = Math.min(w - 2, Math.floor(fx));
    const j = Math.min(h - 2, Math.floor(fz));
    const ax = fx - i;
    const az = fz - j;
    const at = (a: number, b: number): number => data[b * w + a] as number;
    return (
      (at(i, j) * (1 - ax) + at(i + 1, j) * ax) * (1 - az) +
      (at(i, j + 1) * (1 - ax) + at(i + 1, j + 1) * ax) * az
    );
  };
  return {
    texture,
    uniforms,
    sample(x, z) {
      if (x < x0 || z < z0 || x > x0 + (w - 1) * cell || z > z0 + (h - 1) * cell)
        return { e: 0, ground: bilinear(ground, x, z) };
      return { e: bilinear(e, x, z), ground: bilinear(ground, x, z) };
    },
    update(pooled) {
      for (let k = 0; k < LAMP_POOL_SLOTS; k++) {
        const l = pooled[k];
        const v = uniforms.uLampPool.value[k] as Vector4;
        if (l && l.intensity > 0) {
          v.set(l.x, l.y, l.z, l.intensity);
          uniforms.uLampReach.value[k] = l.distance > 0 ? l.distance : 1e6;
        } else v.set(0, 0, 0, 0);
      }
    },
    dispose() {
      texture.dispose();
    },
  };
}

const PATCHED = new WeakSet<Material>();

/**
 * Add the baked lamp light to every standard material under `roots` (static scenery: the track,
 * the world, the props). The material's own shader hooks run first; its program cache key gets a
 * suffix so a material shared with a scene without lamps keeps its own program.
 */
export function addLampLight(roots: readonly Object3D[], lamp: LampMap): number {
  let n = 0;
  const patch = (m: Material): void => {
    const sm = m as MeshStandardMaterial;
    if (!sm.isMeshStandardMaterial || PATCHED.has(m)) return;
    PATCHED.add(m);
    n++;
    const inner = sm.onBeforeCompile.bind(sm);
    // three's default key is the hook's source: keep the original hook's, not the wrapper's.
    const ownKey = Object.prototype.hasOwnProperty.call(sm, 'customProgramCacheKey');
    const hookSource = sm.onBeforeCompile.toString();
    const innerKey = ownKey ? sm.customProgramCacheKey.bind(sm) : () => hookSource;
    sm.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms, renderer) => {
      inner(shader, renderer);
      Object.assign(shader.uniforms, lamp.uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vLampWorld;')
        .replace(
          '#include <worldpos_vertex>',
          `#include <worldpos_vertex>
          {
            vec4 lw = vec4(transformed, 1.0);
            #ifdef USE_INSTANCING
              lw = instanceMatrix * lw;
            #endif
            vLampWorld = (modelMatrix * lw).xyz;
          }`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          varying vec3 vLampWorld;
          uniform sampler2D uLampMap;
          uniform vec4 uLampT;
          uniform vec4 uLampPool[${LAMP_POOL_SLOTS}];
          uniform float uLampReach[${LAMP_POOL_SLOTS}];
          uniform vec3 uLampColour;`,
        )
        .replace(
          '#include <lights_fragment_end>',
          `#include <lights_fragment_end>
          {
            // The baked light of every bank, less what the pooled lights (three's point lights,
            // lighting this pixel already) put on the same ground point: see lamp-map.ts.
            vec2 luv = (vLampWorld.xz - uLampT.xy) * uLampT.zw;
            float inside = step(0.0, luv.x) * step(luv.x, 1.0) * step(0.0, luv.y) * step(luv.y, 1.0);
            vec2 lamp = texture2D(uLampMap, luv).rg;
            float lampE = lamp.r;
            for (int k = 0; k < ${LAMP_POOL_SLOTS}; k++) {
              vec4 pl = uLampPool[k];
              vec3 dv = pl.xyz - vec3(vLampWorld.x, lamp.g, vLampWorld.z);
              float d = length(dv);
              float r = clamp(1.0 - pow(d / uLampReach[k], 4.0), 0.0, 1.0);
              lampE -= pl.w * r * r / max(d * d, 0.01) * max(dv.y, 0.0) / max(d, 1e-3);
            }
            reflectedLight.directDiffuse += max(lampE, 0.0) * inside * uLampColour * BRDF_Lambert(material.diffuseColor);
          }`,
        );
    };
    sm.customProgramCacheKey = () => `${innerKey()}-lamp`;
    sm.needsUpdate = true;
  };
  for (const root of roots) {
    root.traverse((o) => {
      const mat = (o as { material?: Material | Material[] }).material;
      if (Array.isArray(mat)) mat.forEach(patch);
      else if (mat) patch(mat);
    });
  }
  return n;
}
