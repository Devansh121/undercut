import {
  ClampToEdgeWrapping,
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  MeshStandardMaterial,
  NoColorSpace,
  RGBAFormat,
  RepeatWrapping,
  SRGBColorSpace,
  Texture,
  UnsignedByteType,
  type IUniform,
  type MeshStandardMaterialParameters,
  type WebGLProgramParametersWithUniforms,
} from 'three';
import { tileNoise } from '../textures';

/** One PBR texture set as GPU textures: colour (sRGB), OpenGL normal, packed AO/rough/metal. */
export interface PbrSet {
  map: Texture;
  normal: Texture;
  arm: Texture;
  /** Real-world size of one tile, m. */
  sizeM: number;
}

/** Make a set's textures from decoded images: repeat, mipmaps, anisotropy, colour spaces. */
export function pbrSet(
  images: { diff: ImageBitmap; nor: ImageBitmap; arm: ImageBitmap },
  sizeM: number,
  anisotropy: number,
): PbrSet {
  const make = (img: ImageBitmap, colour: boolean): Texture => {
    const t = new Texture(img);
    t.colorSpace = colour ? SRGBColorSpace : NoColorSpace;
    t.wrapS = RepeatWrapping;
    t.wrapT = RepeatWrapping;
    t.flipY = false;
    t.generateMipmaps = true;
    t.minFilter = LinearMipmapLinearFilter;
    t.magFilter = LinearFilter;
    t.anisotropy = anisotropy;
    t.repeat.set(1 / sizeM, 1 / sizeM);
    t.needsUpdate = true;
    return t;
  };
  return {
    map: make(images.diff, true),
    normal: make(images.nor, false),
    arm: make(images.arm, false),
    sizeM,
  };
}

export function disposeSet(s: PbrSet): void {
  s.map.dispose();
  s.normal.dispose();
  s.arm.dispose();
}

/**
 * Four channels of tileable value noise at different frequencies (R 4, G 16, B 64, A 8 cells over
 * the tile), used for macro variation and to break tiling. Linear data, repeat-wrapped.
 */
export function macroNoise(size = 256): DataTexture {
  const ch = [
    tileNoise(size, 101, 4, 4),
    tileNoise(size, 202, 16, 3),
    tileNoise(size, 303, 64, 2),
    tileNoise(size, 404, 8, 4),
  ];
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    for (let c = 0; c < 4; c++) {
      // Stretch the contrast: summed octaves bunch around 0.5.
      const v = ((ch[c]?.[i] as number) - 0.5) * 2.2 + 0.5;
      data[i * 4 + c] = Math.max(0, Math.min(255, Math.round(v * 255)));
    }
  }
  const t = new DataTexture(data, size, size, RGBAFormat, UnsignedByteType);
  t.wrapS = RepeatWrapping;
  t.wrapT = RepeatWrapping;
  t.minFilter = LinearMipmapLinearFilter;
  t.magFilter = LinearFilter;
  t.generateMipmaps = true;
  t.colorSpace = NoColorSpace;
  t.needsUpdate = true;
  return t;
}

/** Range of the racing-line offset in the lap lookup, m (±). */
export const LINE_RANGE = 12.8;

/**
 * A 1D lookup along the lap, 8-bit so it filters on every GPU: R racing-line lateral offset
 * ((d / LINE_RANGE + 1) / 2, 0.1 m steps, smoothed by the filter), G |curvature| × 40 (1/m),
 * B 1 where the lap is inside a corner's braking-to-exit region, A spare.
 */
export function lapTexture(offsets: ArrayLike<number>, curvature: ArrayLike<number>): DataTexture {
  const n = offsets.length;
  const data = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    const d = offsets[i] as number;
    data[i * 4] = Math.round(Math.min(1, Math.max(0, (d / LINE_RANGE + 1) / 2)) * 255);
    data[i * 4 + 1] = Math.round(Math.min(1, Math.abs(curvature[i] as number) * 40) * 255);
    data[i * 4 + 2] = 0;
    data[i * 4 + 3] = 255;
  }
  const t = new DataTexture(data, n, 1, RGBAFormat, UnsignedByteType);
  t.wrapS = RepeatWrapping;
  t.wrapT = ClampToEdgeWrapping;
  t.minFilter = LinearFilter;
  t.magFilter = LinearFilter;
  t.generateMipmaps = false;
  t.colorSpace = NoColorSpace;
  t.needsUpdate = true;
  return t;
}

export interface SurfacePatch {
  /** Shader program cache key: identical keys must mean identical shader text. */
  key: string;
  uniforms?: Record<string, IUniform>;
  /** GLSL after `#include <common>` in the fragment shader (uniforms, helpers). */
  pars?: string;
  /** GLSL after the (anti-tiled) base colour: may change `diffuseColor`, set globals. */
  colour?: string;
  /** GLSL after the roughness map: may change `roughnessFactor`. */
  roughness?: string;
  /** Break the texture's repetition with a second rotated sample blended by macro noise. */
  antiTile?: boolean;
  /** World-space XZ for macro noise instead of the mesh UV (terrain). */
  worldMacro?: boolean;
}

/**
 * A MeshStandardMaterial over a PBR set, with the shared surface shader: raw UVs in metres
 * (`vSurfUv`), world position (`vSurfWorld`), a macro noise sampler, a wetness hook (`uWet`,
 * 0 dry; darker albedo and smoother surface, ready for wet weather after v1), optional
 * anti-tiling, and per-surface extras.
 */
export function surfaceMaterial(
  set: PbrSet,
  macro: Texture,
  patch: SurfacePatch,
  params: MeshStandardMaterialParameters = {},
): MeshStandardMaterial {
  const m = new MeshStandardMaterial({
    map: set.map,
    normalMap: set.normal,
    roughnessMap: set.arm,
    metalnessMap: set.arm,
    aoMap: set.arm,
    aoMapIntensity: 0.8,
    roughness: 1,
    metalness: 1,
    ...params,
  });
  const uniforms: Record<string, IUniform> = {
    uMacro: { value: macro },
    uWet: { value: 0 },
    ...patch.uniforms,
  };
  m.userData.surfaceUniforms = uniforms;
  const anti = patch.antiTile !== false;
  m.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec2 vSurfUv;\nvarying vec3 vSurfWorld;',
      )
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
        vSurfUv = uv;
        {
          vec4 sw = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            sw = instanceMatrix * sw;
          #endif
          vSurfWorld = (modelMatrix * sw).xyz;
        }`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec2 vSurfUv;
        varying vec3 vSurfWorld;
        uniform sampler2D uMacro;
        uniform float uWet;
        ${patch.pars ?? ''}`,
      )
      .replace(
        '#include <map_fragment>',
        `
        vec2 macroUv = ${patch.worldMacro ? 'vSurfWorld.xz' : 'vSurfUv'};
        vec4 macro = texture2D(uMacro, macroUv * 0.011);
        vec4 macroFine = texture2D(uMacro, macroUv * 0.07 + 0.31);
        vec2 tileUv2 = mat2(0.8, -0.6, 0.6, 0.8) * vMapUv * 0.73 + vec2(0.37, 0.61);
        float tileBlend = ${anti ? 'smoothstep(0.3, 0.7, macro.a)' : '0.0'};
        {
          vec4 t1 = texture2D(map, vMapUv);
          ${anti ? 'vec4 t2 = texture2D(map, tileUv2); vec4 texelColor = mix(t1, t2, tileBlend);' : 'vec4 texelColor = t1;'}
          diffuseColor *= texelColor;
        }
        ${patch.colour ?? ''}
        diffuseColor.rgb *= mix(1.0, 0.55, uWet);
        `,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `
        float roughnessFactor = roughness;
        vec4 armTexel = ${anti ? 'mix(texture2D(roughnessMap, vRoughnessMapUv), texture2D(roughnessMap, tileUv2), tileBlend)' : 'texture2D(roughnessMap, vRoughnessMapUv)'};
        roughnessFactor *= armTexel.g;
        ${patch.roughness ?? ''}
        roughnessFactor = mix(roughnessFactor, 0.06, uWet * 0.9);
        `,
      )
      .replace(
        '#include <metalnessmap_fragment>',
        'float metalnessFactor = metalness * armTexel.b;',
      )
      .replace(
        '#include <normal_fragment_maps>',
        anti
          ? `
        vec3 mapN = mix(texture2D(normalMap, vNormalMapUv), texture2D(normalMap, tileUv2), tileBlend).xyz * 2.0 - 1.0;
        mapN.xy *= normalScale * (1.0 - 0.7 * uWet);
        normal = normalize(tbn * mapN);
        `
          : '#include <normal_fragment_maps>',
      );
  };
  m.customProgramCacheKey = () =>
    `surface-${patch.key}-${anti ? 1 : 0}-${patch.worldMacro ? 1 : 0}`;
  return m;
}
