import {
  Color,
  DataTexture,
  DataUtils,
  HalfFloatType,
  LinearFilter,
  RedFormat,
  Vector2,
  Vector3,
  Vector4,
  type Material,
  type MeshStandardMaterial,
  type Object3D,
  type WebGLProgramParametersWithUniforms,
} from 'three';
import type { LocalLight } from './light-pool';

/**
 * Baked lamp light for a floodlit circuit. A forward renderer lights each pixel from a few
 * pooled point lights (light-pool.ts: the lamp banks nearest the camera); the rest of a
 * circuit's banks are baked here, once at load, into a texture of the light they throw on the
 * ground: irradiance on a level surface at ground height, on a world grid (x, z). Static
 * scenery adds it in its shader beyond the pool's reach, fading in where the pool fades out, so
 * the road ahead stays lit to the horizon and nothing is lit twice near the camera. Cars and other
 * moving things take only the pooled lights.
 *
 * Falloff is three.js's own for a point light (inverse square with its smooth cut-off at the
 * light's `distance`), so baked and pooled light agree where they meet.
 */
export interface LampMap {
  readonly texture: DataTexture;
  /** Shader uniforms: the map, its transform, the eye, the fade and the lamp colour. */
  readonly uniforms: {
    uLampMap: { value: DataTexture };
    /** x0, z0, 1/width, 1/depth of the map, m. */
    uLampT: { value: Vector4 };
    uLampEye: { value: Vector3 };
    /** Baked light fades in from x to y metres from the eye. */
    uLampFade: { value: Vector2 };
    uLampColour: { value: Color };
  };
  /** Irradiance at (x, z) as the texture holds it (tests). */
  sample(x: number, z: number): number;
  /** Follow the eye and the pool's reach (distance of its farthest light), each frame. */
  update(eye: Vector3, poolReach: number): void;
  dispose(): void;
}

/** Inverse-square falloff with three.js's cut-off window (getDistanceAttenuation, decay 2). */
export function lampFalloff(d: number, cutoff: number): number {
  const f = 1 / Math.max(d * d, 0.01);
  if (cutoff <= 0) return f;
  const r = Math.min(1, Math.max(0, 1 - (d / cutoff) ** 4));
  return f * r * r;
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
  const ground = new Float32Array(w * h).fill(Number.NaN);
  const groundOf = (i: number, j: number): number => {
    const k = j * w + i;
    let g = ground[k] as number;
    if (Number.isNaN(g)) {
      g = groundAt(x0 + i * cell, z0 + j * cell);
      ground[k] = g;
    }
    return g;
  };
  // Mean colour of the lamps (they are all warm white); the texture holds the scalar.
  const colour = new Color(0, 0, 0);
  for (const l of lights) {
    const reach = l.distance > 0 ? l.distance : 80;
    const i0 = Math.max(0, Math.floor((l.x - reach - x0) / cell));
    const i1 = Math.min(w - 1, Math.ceil((l.x + reach - x0) / cell));
    const j0 = Math.max(0, Math.floor((l.z - reach - z0) / cell));
    const j1 = Math.min(h - 1, Math.ceil((l.z + reach - z0) / cell));
    for (let j = j0; j <= j1; j++) {
      const z = z0 + j * cell;
      for (let i = i0; i <= i1; i++) {
        const x = x0 + i * cell;
        const y = groundOf(i, j);
        const dy = l.y - y;
        if (dy <= 0) continue;
        const d = Math.hypot(l.x - x, dy, l.z - z);
        if (d >= reach) continue;
        // Level surface: cosine of the light's angle from the vertical.
        const k = j * w + i;
        e[k] = (e[k] as number) + l.intensity * lampFalloff(d, reach) * (dy / d);
      }
    }
    colour.add(new Color(l.colour));
  }
  if (lights.length > 0) colour.multiplyScalar(1 / lights.length);
  const half = new Uint16Array(w * h);
  for (let k = 0; k < w * h; k++) half[k] = DataUtils.toHalfFloat(Math.min(60000, e[k] as number));
  const texture = new DataTexture(half, w, h, RedFormat, HalfFloatType);
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  const uniforms = {
    uLampMap: { value: texture },
    uLampT: { value: new Vector4(x0, z0, 1 / ((w - 1) * cell), 1 / ((h - 1) * cell)) },
    uLampEye: { value: new Vector3() },
    uLampFade: { value: new Vector2(40, 90) },
    uLampColour: { value: colour },
  };
  return {
    texture,
    uniforms,
    sample(x, z) {
      const i = Math.round((x - x0) / cell);
      const j = Math.round((z - z0) / cell);
      if (i < 0 || j < 0 || i >= w || j >= h) return 0;
      return e[j * w + i] as number;
    },
    update(eye, poolReach) {
      uniforms.uLampEye.value.copy(eye);
      // The pool's farthest lights are fading out over its last quarter; the baked light takes
      // over from there, by the reach of a lamp (the light a surface gets comes from lamps up to
      // a lamp's reach away).
      const r = Math.max(0, poolReach);
      uniforms.uLampFade.value.set(Math.max(0, r * 0.75 - 30), r + 10);
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
          uniform vec3 uLampEye;
          uniform vec2 uLampFade;
          uniform vec3 uLampColour;`,
        )
        .replace(
          '#include <lights_fragment_end>',
          `#include <lights_fragment_end>
          {
            vec2 luv = (vLampWorld.xz - uLampT.xy) * uLampT.zw;
            float inside = step(0.0, luv.x) * step(luv.x, 1.0) * step(0.0, luv.y) * step(luv.y, 1.0);
            float lampE = texture2D(uLampMap, luv).r * inside;
            float far = smoothstep(uLampFade.x, uLampFade.y, distance(vLampWorld, uLampEye));
            reflectedLight.directDiffuse += lampE * far * uLampColour * BRDF_Lambert(material.diffuseColor);
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
