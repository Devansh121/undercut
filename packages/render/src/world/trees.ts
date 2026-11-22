import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  MeshDepthMaterial,
  MeshStandardMaterial,
  RGBADepthPacking,
  type Texture,
  type WebGLProgramParametersWithUniforms,
} from 'three';
import { ATLAS_COLS, ATLAS_ROWS } from './tree-atlas';

/**
 * Tree impostor cards: `planes` vertical quads crossed about the trunk (and, near, a canopy
 * card), with vertex normals bent outward from the crown's centre so the sun shades the crown as
 * a volume instead of as flat cards. Height and width 1; the prop's scale sizes it.
 */
export function treeCards(planes: number, aspect = 1): BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const crownY = 0.58;
  const push = (x: number, y: number, z: number, u: number, v: number): void => {
    pos.push(x, y, z);
    // Normal: outward from the crown centre, leaning up (light from the sky on the top).
    let nx = x;
    let ny = (y - crownY) * 0.8 + 0.35;
    let nz = z;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l;
    ny /= l;
    nz /= l;
    nor.push(nx, ny, nz);
    uv.push(u, v);
  };
  const half = 0.5 * aspect;
  for (let k = 0; k < planes; k++) {
    const a = (k / planes) * Math.PI;
    const cx = Math.cos(a) * half;
    const cz = Math.sin(a) * half;
    const base = pos.length / 3;
    // Split each card in two columns so the bent normals interpolate across the middle.
    push(-cx, 0, -cz, 0, 0);
    push(0, 0, 0, 0.5, 0);
    push(cx, 0, cz, 1, 0);
    push(-cx, 1, -cz, 0, 1);
    push(0, 1, 0, 0.5, 1);
    push(cx, 1, cz, 1, 1);
    // Middle column's normals point toward the viewer of either face: keep them crown-outward.
    idx.push(base, base + 1, base + 4, base, base + 4, base + 3);
    idx.push(base + 1, base + 2, base + 5, base + 1, base + 5, base + 4);
  }
  // For near/medium trees, add a shallow upper canopy cap with upward normals so elevated views
  // see full crowns without casting a horizontal seam inside the crown at eye level.
  if (planes >= 3) {
    const r = half * 0.48;
    const yRim = 0.68;
    const yTop = 0.82;
    const base = pos.length / 3;
    const pushTop = (x: number, y: number, z: number, u: number, v: number): void => {
      pos.push(x, y, z);
      nor.push(0, 1, 0);
      uv.push(u, v);
    };
    pushTop(0, yTop, 0, 0.5, 0.64);
    pushTop(-r, yRim, -r, 0.2, 0.4);
    pushTop(r, yRim, -r, 0.8, 0.4);
    pushTop(r, yRim, r, 0.8, 0.84);
    pushTop(-r, yRim, r, 0.2, 0.84);
    idx.push(base, base + 2, base + 1);
    idx.push(base, base + 3, base + 2);
    idx.push(base, base + 4, base + 3);
    idx.push(base, base + 1, base + 4);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array(nor), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

/** GLSL: pick an atlas tile per instance (hash of its position) among the kind's species. */
function tileChunk(tiles: readonly number[]): string {
  const list = tiles.map((t) => t.toFixed(1)).join(', ');
  return /* glsl */ `
#include <uv_vertex>
#if defined( USE_INSTANCING ) && defined( USE_MAP )
  {
    vec2 ip = vec2(instanceMatrix[3][0], instanceMatrix[3][2]);
    float hsh = fract(sin(dot(floor(ip * 3.0), vec2(12.9898, 78.233))) * 43758.5453);
    float tiles[${tiles.length}] = float[](${list});
    float tile = tiles[int(min(hsh * ${tiles.length.toFixed(1)}, ${(tiles.length - 1).toFixed(1)}))];
    float col = mod(tile, ${ATLAS_COLS.toFixed(1)});
    float row = floor(tile / ${ATLAS_COLS.toFixed(1)});
    // Mirror half of them so neighbours of one species differ.
    float u = fract(hsh * 7.31) > 0.5 ? uv.x : 1.0 - uv.x;
    vMapUv = vec2((col + u) / ${ATLAS_COLS.toFixed(1)}, (row + 1.0 - uv.y) / ${ATLAS_ROWS.toFixed(1)});
  }
#endif`;
}

/** Wind: the crown sways with height, phase from the instance position (High only). */
const WIND = /* glsl */ `
#include <begin_vertex>
#ifdef USE_INSTANCING
  {
    vec2 ip = vec2(instanceMatrix[3][0], instanceMatrix[3][2]);
    float sway = sin(uTreeTime * 1.3 + dot(ip, vec2(0.11, 0.07))) * 0.6 + sin(uTreeTime * 2.9 + ip.x * 0.3) * 0.25;
    float bendK = position.y * position.y * 0.018;
    transformed.x += sway * bendK;
    transformed.z += sway * bendK * 0.6;
  }
#endif`;

export interface TreeMaterials {
  material: MeshStandardMaterial;
  depth: MeshDepthMaterial;
  /** Seconds, for the wind. */
  time: { value: number };
}

/**
 * Leaf card material: alpha-tested atlas (alpha to coverage with MSAA), a low specular, light
 * passing through (a little emission of the leaf colour in sunlight stands in for translucency),
 * per-instance tint, per-instance species, optional wind. The depth material repeats the species
 * pick so shadows have the same silhouettes.
 */
export function treeMaterials(
  atlas: Texture,
  tiles: readonly number[],
  key: string,
  options: { wind: boolean; coverage: boolean },
): TreeMaterials {
  const time = { value: 0 };
  const hook = (shader: WebGLProgramParametersWithUniforms): void => {
    shader.uniforms.uTreeTime = time;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTreeTime;')
      .replace('#include <uv_vertex>', tileChunk(tiles));
    if (options.wind)
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', WIND);
  };
  const material = new MeshStandardMaterial({
    map: atlas,
    alphaTest: 0.45,
    alphaToCoverage: options.coverage,
    side: DoubleSide,
    roughness: 0.78,
    metalness: 0,
    envMapIntensity: 0.8,
  });
  material.name = `tree-${key}`;
  material.onBeforeCompile = hook;
  material.customProgramCacheKey = () => `tree-${key}-${options.wind ? 1 : 0}`;
  const depth = new MeshDepthMaterial({
    depthPacking: RGBADepthPacking,
    map: atlas,
    alphaTest: 0.45,
    side: DoubleSide,
  });
  depth.onBeforeCompile = hook;
  depth.customProgramCacheKey = () => `tree-depth-${key}-${options.wind ? 1 : 0}`;
  return { material, depth, time };
}
