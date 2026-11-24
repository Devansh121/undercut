import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  MeshDepthMaterial,
  MeshStandardMaterial,
  RGBADepthPacking,
  ShaderChunk,
  Vector3,
  type Texture,
  type WebGLProgramParametersWithUniforms,
} from 'three';
import { createPropKitMaterial } from '../props/catalog';
import { hash01 } from './dressing';
import { ATLAS_COLS, ATLAS_ROWS, BARK_TILE, CLUSTER_TILE } from './tree-atlas';

/**
 * Tree impostor cards: `planes` vertical quads crossed about the trunk (and, near, a canopy
 * card), with vertex normals bent outward from the crown's centre so the sun shades the crown as
 * a volume instead of as flat cards. Height and width 1; the prop's scale sizes it. So the
 * crossing does not show as the same outline repeated in a star: every other card shows the
 * tile mirrored, and each card is folded along the trunk (its outer edges a tenth of its width
 * forward or back, alternately), so the crown has depth seen from any side.
 */
export function treeCards(planes: number, aspect = 1): BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  // Each card's own frame (for the relief level): its uv's u direction and its front normal.
  // cardT.w: -1 where the card shows its tile mirrored (u runs against the frame's tangent).
  const cardT: number[] = [];
  const cardP: number[] = [];
  let frame: [number, number, number, number, number, number] = [1, 0, 0, 0, 0, 1];
  let flip = 1;
  const crownY = 0.58;
  const push = (x: number, y: number, z: number, u: number, v: number): void => {
    pos.push(x, y, z);
    cardT.push(frame[0], frame[1], frame[2], flip);
    cardP.push(frame[3], frame[4], frame[5]);
    // Normal: outward from the crown centre, leaning up (light from the sky on the top).
    let nx = x;
    let ny = (y - crownY) * 0.8 + 0.35;
    let nz = z;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l;
    ny /= l;
    nz /= l;
    nor.push(nx, ny, nz);
    uv.push(flip < 0 ? 1 - u : u, v);
  };
  const half = 0.5 * aspect;
  for (let k = 0; k < planes; k++) {
    const a = (k / planes) * Math.PI;
    const cx = Math.cos(a) * half;
    const cz = Math.sin(a) * half;
    // u runs along (cos a, 0, sin a); the winding below faces (-sin a, 0, cos a).
    frame = [Math.cos(a), 0, Math.sin(a), -Math.sin(a), 0, Math.cos(a)];
    flip = k % 2 === 1 ? -1 : 1;
    // The fold: outer edges forward (even cards) or back (odd), along the card's normal.
    const fold = (k % 2 === 0 ? 1 : -1) * FOLD * half;
    const fx = frame[3] * fold;
    const fz = frame[5] * fold;
    const base = pos.length / 3;
    // Split each card in two columns so the bent normals interpolate across the middle.
    push(-cx + fx, 0, -cz + fz, 0, 0);
    push(0, 0, 0, 0.5, 0);
    push(cx + fx, 0, cz + fz, 1, 0);
    push(-cx + fx, 1, -cz + fz, 0, 1);
    push(0, 1, 0, 0.5, 1);
    push(cx + fx, 1, cz + fz, 1, 1);
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
      cardT.push(1, 0, 0, 1);
      cardP.push(0, 1, 0);
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
  g.setAttribute('cardT', new BufferAttribute(new Float32Array(cardT), 4));
  g.setAttribute('cardP', new BufferAttribute(new Float32Array(cardP), 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

/** Fold of each crossed card, fraction of its half-width (see treeCards). */
const FOLD = 0.2;

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
#ifdef TREE_RELIEF
    vTreeMirror = fract(hsh * 7.31) > 0.5 ? 1.0 : -1.0;
#endif
    vMapUv = vec2((col + u) / ${ATLAS_COLS.toFixed(1)}, (row + 1.0 - uv.y) / ${ATLAS_ROWS.toFixed(1)});
  }
#endif`;
}

/**
 * The crown's normals point out of the crown on both faces of a leaf card: three.js turns a
 * double-sided material's normal round on back faces, which on bent crown normals puts half the
 * cards' faces in the crown's own shade (under floodlights, half the crown dark at random). Undo
 * it (faceDirection is ±1).
 */
const CROWN_NORMAL = /* glsl */ `
#include <normal_fragment_begin>
#ifdef DOUBLE_SIDED
  normal *= faceDirection;
#endif`;

/**
 * Leaves let through a share of the light that falls on their back (diffusely, about a third for
 * a thin broad leaf): direct light from behind a leaf card lights it at `LEAF_TRANSMISSION` of
 * its front-lit strength. Without it a crown is black on the side away from a floodlight, and
 * the near trees' clusters (each lit by its own facing) and the cards (lit as a whole) part.
 */
export const LEAF_TRANSMISSION = 0.35;
const LEAF_LIGHT = ShaderChunk.lights_physical_pars_fragment.replace(
  'vec3 irradiance = dotNL * directLight.color;',
  // Diffuse only: the specular lobe is the front face's (fed transmitted light, its grazing
  // terms overflow).
  `vec3 irradiance = dotNL * directLight.color;
  reflectedLight.directDiffuse += ${LEAF_TRANSMISSION.toFixed(2)} * saturate( - dot( geometryNormal, directLight.direction ) ) * directLight.color * BRDF_Lambert( material.diffuseColor );`,
);
if (LEAF_LIGHT === ShaderChunk.lights_physical_pars_fragment)
  throw new Error('three.js lights chunk changed: leaf transmission not applied');

/** Shader hook: crown-outward normals on both faces, and the leaves' transmitted light. */
function leafShading(shader: WebGLProgramParametersWithUniforms): void {
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <normal_fragment_begin>', CROWN_NORMAL)
    .replace('#include <lights_physical_pars_fragment>', LEAF_LIGHT);
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

/**
 * The relief level (the mid-distance cards): the crown's painted normals in each card's frame
 * (tree-atlas.ts reliefStyle) light the card by the scene's sun and sky from wherever it stands,
 * instead of by the light painted into the atlas, which the relief's de-lighting factor takes
 * out of the colour. Both fade to the plain card by `uTreeRelief.y` from the eye, the distance at
 * which the far level takes over, so the switch does not show.
 */
const RELIEF_PARS_VERTEX = /* glsl */ `
attribute vec4 cardT;
attribute vec3 cardP;
varying vec3 vCardT;
varying vec3 vCardP;
varying float vTreeMirror;
varying float vCardFlip;`;
const RELIEF_VERTEX = /* glsl */ `
#include <defaultnormal_vertex>
#ifdef USE_INSTANCING
  vCardT = normalMatrix * (mat3(instanceMatrix) * cardT.xyz);
  vCardP = normalMatrix * (mat3(instanceMatrix) * cardP);
#else
  vCardT = normalMatrix * cardT.xyz;
  vCardP = normalMatrix * cardP;
#endif
  vCardFlip = cardT.w;`;
const RELIEF_PARS_FRAGMENT = /* glsl */ `
uniform sampler2D uTreeReliefMap;
/** x: fade start, y: fade end (m from the eye), z: weight of the relief normal. */
uniform vec3 uTreeRelief;
varying vec3 vCardT;
varying vec3 vCardP;
varying float vTreeMirror;
varying float vCardFlip;`;
const RELIEF_MAP_FRAGMENT = /* glsl */ `
#include <map_fragment>
vec4 treeRelief = texture2D(uTreeReliefMap, vMapUv);
float treeReliefK = uTreeRelief.y > uTreeRelief.x
  ? 1.0 - smoothstep(uTreeRelief.x, uTreeRelief.y, length(vViewPosition))
  : 0.0;
diffuseColor.rgb *= mix(1.0, treeRelief.b * 2.0, treeReliefK);
// A card seen edge-on is a line, not foliage: it dissolves (through the alpha test, dithered by
// alpha to coverage) as the view comes within about 15 degrees of its plane; the crossing cards
// cover the crown there.
diffuseColor.a *= smoothstep(0.08, 0.26, abs(dot(normalize(vCardP), normalize(vViewPosition))));`;
const RELIEF_NORMAL_FRAGMENT = /* glsl */ `
#include <normal_fragment_maps>
{
  vec2 rxy = treeRelief.rg * 2.0 - 1.0;
  rxy.x *= vTreeMirror * vCardFlip;
  float rz = sqrt(max(0.0, 1.0 - dot(rxy, rxy)));
  vec3 cT = normalize(vCardT);
  vec3 cP = normalize(vCardP);
  vec3 cB = normalize(cross(cP, cT));
  // The painted bulge faces whoever looks at the card, from either side.
  vec3 rn = normalize(cT * rxy.x + cB * rxy.y + cP * (rz * faceDirection));
  normal = normalize(mix(normal, rn, treeReliefK * uTreeRelief.z));
}`;

/**
 * Relief level settings: the relief atlas and, shared by every relief material, its fade (x:
 * start, y: end, m from the eye; both 0 turns the relief off) and the relief normal's weight (z).
 */
export interface TreeRelief {
  map: Texture;
  params: { value: Vector3 };
}

/** The relief's shared settings, fading out between `fadeStart` and `fadeEnd` from the eye. */
export function treeReliefParams(fadeStart: number, fadeEnd: number): { value: Vector3 } {
  return { value: new Vector3(fadeStart, fadeEnd, RELIEF_WEIGHT) };
}

function addRelief(shader: WebGLProgramParametersWithUniforms, relief: TreeRelief): void {
  shader.uniforms.uTreeReliefMap = { value: relief.map };
  shader.uniforms.uTreeRelief = relief.params;
  shader.defines = { ...(shader.defines ?? {}), TREE_RELIEF: '' };
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>\n${RELIEF_PARS_VERTEX}`)
    .replace('#include <defaultnormal_vertex>', RELIEF_VERTEX);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>\n${RELIEF_PARS_FRAGMENT}`)
    .replace('#include <map_fragment>', RELIEF_MAP_FRAGMENT)
    .replace('#include <normal_fragment_maps>', RELIEF_NORMAL_FRAGMENT);
}

/** How far the relief normal replaces the card's crown-bent vertex normal. */
export const RELIEF_WEIGHT = 0.85;

/**
 * Per-tree swap between the near trees (real geometry) and the cards, by the tree's distance
 * from the eye (`uTreeEye`, the view camera even in the shadow pass), dithered over a 20 m band
 * so there is no pop. Cards draw beyond the swap distance, near trees inside it.
 */
export interface TreeSwap {
  eye: { value: Vector3 };
  /** Swap distance, m; 0 turns the near trees off (cards everywhere). */
  distance: { value: number };
}

const SWAP_PARS_VERTEX = /* glsl */ `
uniform vec3 uTreeEye;
uniform float uTreeSwap;
varying float vTreeFar;`;
const SWAP_VERTEX = /* glsl */ `
#ifdef USE_INSTANCING
  {
    vec3 ipw = (modelMatrix * vec4(instanceMatrix[3].xyz, 1.0)).xyz;
    float td = distance(ipw.xz, uTreeEye.xz);
    vTreeFar = uTreeSwap > 0.0 ? smoothstep(uTreeSwap - 10.0, uTreeSwap + 10.0, td) : 1.0;
  }
#else
  vTreeFar = 1.0;
#endif`;
function swapFragment(near: boolean): string {
  return /* glsl */ `
#include <alphatest_fragment>
{
  float dn = fract(sin(dot(floor(gl_FragCoord.xy), vec2(12.9898, 78.233))) * 43758.5453);
  if (${near ? 'dn < vTreeFar' : 'dn >= vTreeFar'}) discard;
}`;
}

/** Shader hook adding the per-tree swap to a tree material (cards: `near` false). */
function addSwap(shader: WebGLProgramParametersWithUniforms, swap: TreeSwap, near: boolean): void {
  shader.uniforms.uTreeEye = swap.eye;
  shader.uniforms.uTreeSwap = swap.distance;
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>\n${SWAP_PARS_VERTEX}`)
    .replace('#include <project_vertex>', `#include <project_vertex>\n${SWAP_VERTEX}`);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', '#include <common>\nvarying float vTreeFar;')
    .replace('#include <alphatest_fragment>', swapFragment(near));
}

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
  options: {
    wind: boolean;
    coverage: boolean;
    swap?: TreeSwap | null;
    /** The relief level (the cards' mid-distance level): lit through the relief atlas. */
    relief?: TreeRelief | null;
  },
): TreeMaterials {
  const relief = options.relief ?? null;
  const time = { value: 0 };
  const swap = options.swap ?? null;
  const hook = (shader: WebGLProgramParametersWithUniforms): void => {
    shader.uniforms.uTreeTime = time;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTreeTime;')
      .replace('#include <uv_vertex>', tileChunk(tiles));
    if (options.wind)
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', WIND);
  };
  // The colour pass hands the near trees over within the swap distance; the shadow pass keeps
  // the cards everywhere (the near trees cast no shadow), so each tree casts one shadow.
  const colourHook = (shader: WebGLProgramParametersWithUniforms): void => {
    // The relief's defines come first: the tile pick writes the mirror sign under them.
    if (relief) addRelief(shader, relief);
    hook(shader);
    leafShading(shader);
    if (swap) addSwap(shader, swap, false);
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
  material.name = relief ? `tree-${key}-relief` : `tree-${key}`;
  // The relief atlas only reaches the compiled shader: listed for the texture-memory count.
  if (relief) material.userData.surfaceUniforms = { uTreeReliefMap: { value: relief.map } };
  material.onBeforeCompile = colourHook;
  material.customProgramCacheKey = () =>
    `tree-v3-${key}-${options.wind ? 1 : 0}-${swap ? 1 : 0}-${relief ? 1 : 0}`;
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

/** Crown shape of a near tree, in units of its height (the prop's scale sizes it). */
export interface CloudShape {
  /** Crown centre height and radii (x and z share `rx`). */
  crownY: number;
  rx: number;
  ry: number;
  /** Leaf cards and their size. */
  cards: number;
  card: number;
}

/**
 * Occlusion of the innermost leaf clusters (1 at the crown's surface). The cluster tiles are
 * already matched to the cards' painted mean, occlusion included, so this is only the extra
 * depth of the near crown (the tree-swap check: near trees against the cards they replace).
 */
const CROWN_AO = 0.5;
/** Shade on the trunk and limbs under the crown. */
const TRUNK_AO = 0.6;

export const BROADLEAF_CLOUD: CloudShape = {
  crownY: 0.6,
  rx: 0.36,
  ry: 0.32,
  cards: 48,
  card: 0.24,
};
export const COLUMNAR_CLOUD: CloudShape = {
  crownY: 0.58,
  rx: 0.14,
  ry: 0.4,
  cards: 40,
  card: 0.155,
};

/** Atlas uv of a point (tu, tv) in tile `t`, tv = 0 at the tile's bottom (see treeAtlas). */
function atlasUv(t: number, tu: number, tv: number): [number, number] {
  const col = t % ATLAS_COLS;
  const row = Math.floor(t / ATLAS_COLS);
  return [(col + tu) / ATLAS_COLS, (row + 1 - tv) / ATLAS_ROWS];
}

/**
 * A near tree with real geometry: a tapered six-sided trunk and four limbs in bark, and a cloud
 * of leaf-cluster cards in and around the crown, each turned at random, with normals bent out
 * from the crown's centre so the sun shades the whole crown as one volume and the sky shows
 * through between clusters. About 200 triangles; height 1 (the prop's scale sizes it).
 */
export function treeCloudGeometry(shape: CloudShape, seed: number): BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  // Baked crown occlusion (vertex colour): clusters deep inside and under the crown are darker,
  // as the cards' painted crowns are. Without it the near crowns light evenly where there is no
  // sun shadow (night under floodlights) and read brighter than the cards around them.
  const col: number[] = [];
  const idx: number[] = [];
  const R = (a: number, b = 0): number => hash01(seed, a, b);
  // Trunk and limbs: prisms from a to b, radius r0 to r1.
  const prism = (
    a: [number, number, number],
    b: [number, number, number],
    r0: number,
    r1: number,
  ): void => {
    const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const len = Math.hypot(d[0]!, d[1]!, d[2]!) || 1;
    const ax = [d[0]! / len, d[1]! / len, d[2]! / len];
    // Two axes perpendicular to the prism.
    const ref = Math.abs(ax[1]!) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    let px = [
      ax[1]! * ref[2]! - ax[2]! * ref[1]!,
      ax[2]! * ref[0]! - ax[0]! * ref[2]!,
      ax[0]! * ref[1]! - ax[1]! * ref[0]!,
    ];
    const pl = Math.hypot(px[0]!, px[1]!, px[2]!) || 1;
    px = px.map((v) => v / pl);
    const py = [
      ax[1]! * px[2]! - ax[2]! * px[1]!,
      ax[2]! * px[0]! - ax[0]! * px[2]!,
      ax[0]! * px[1]! - ax[1]! * px[0]!,
    ];
    const sides = 6;
    const base = pos.length / 3;
    for (let k = 0; k <= sides; k++) {
      const t = (k / sides) * Math.PI * 2;
      const c = Math.cos(t);
      const sn = Math.sin(t);
      const n = [px[0]! * c + py[0]! * sn, px[1]! * c + py[1]! * sn, px[2]! * c + py[2]! * sn];
      for (const [p, r, tv] of [
        [a, r0, 0],
        [b, r1, 1],
      ] as const) {
        pos.push(p[0] + n[0]! * r, p[1] + n[1]! * r, p[2] + n[2]! * r);
        nor.push(n[0]!, n[1]!, n[2]!);
        // Trunk and limbs stand in the crown's shade.
        col.push(TRUNK_AO, TRUNK_AO, TRUNK_AO);
        uv.push(...atlasUv(BARK_TILE, k / sides, tv * 0.98 + 0.01));
      }
    }
    for (let k = 0; k < sides; k++) {
      const i = base + k * 2;
      idx.push(i, i + 2, i + 1, i + 1, i + 2, i + 3);
    }
  };
  const top = shape.crownY + shape.ry * 0.3;
  prism([0, 0, 0], [0, top, 0], 0.024, 0.012);
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + R(k, 1);
    const y0 = shape.crownY - shape.ry * 0.55 + R(k, 2) * shape.ry * 0.4;
    const reach = shape.rx * (0.55 + R(k, 3) * 0.3);
    prism(
      [0, y0, 0],
      [Math.cos(a) * reach, y0 + shape.ry * 0.45, Math.sin(a) * reach],
      0.01,
      0.004,
    );
  }
  // Leaf cluster cards.
  for (let i = 0; i < shape.cards; i++) {
    const az = R(i, 10) * Math.PI * 2;
    const el = Math.acos(1 - 2 * R(i, 11));
    const shell = 0.55 + 0.45 * Math.sqrt(R(i, 12));
    const dx = Math.sin(el) * Math.cos(az) * shell;
    const dy = Math.cos(el) * shell;
    const dz = Math.sin(el) * Math.sin(az) * shell;
    const c = [dx * shape.rx, shape.crownY + dy * shape.ry, dz * shape.rx];
    // Card axes: random orientation.
    const yaw = R(i, 13) * Math.PI * 2;
    const tilt = (R(i, 14) - 0.5) * 1.6;
    const ux = [Math.cos(yaw), 0, Math.sin(yaw)];
    const vx = [-Math.sin(yaw) * Math.sin(tilt), Math.cos(tilt), Math.cos(yaw) * Math.sin(tilt)];
    const h = shape.card * (0.75 + R(i, 15) * 0.5) * 0.5;
    // Normal: out of the crown, leaning up (sky light on the top).
    let n = [dx, dy * 0.8 + 0.25, dz];
    const nl = Math.hypot(n[0]!, n[1]!, n[2]!) || 1;
    n = n.map((v) => v / nl);
    const t = CLUSTER_TILE + Math.floor(R(i, 16) * 3);
    const depth = (shell - 0.55) / 0.45;
    // Brightest round the crown's waist: the underside in its own shade, the very top a little
    // darker too (seen from above, cards cover little of the crown and the ground shows through).
    const band = dy >= 0 ? 1 - 0.12 * dy : 1 + 0.2 * dy;
    const ao = (CROWN_AO + (1 - CROWN_AO) * depth) * band;
    const base = pos.length / 3;
    for (const [su, sv] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ] as const) {
      pos.push(
        c[0]! + (ux[0]! * su + vx[0]! * sv) * h,
        c[1]! + (ux[1]! * su + vx[1]! * sv) * h,
        c[2]! + (ux[2]! * su + vx[2]! * sv) * h,
      );
      nor.push(n[0]!, n[1]!, n[2]!);
      col.push(ao, ao, ao);
      uv.push(...atlasUv(t, (su + 1) / 2, (sv + 1) / 2));
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array(nor), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
  g.setAttribute('color', new BufferAttribute(new Float32Array(col), 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

/**
 * Material for the near trees: the same atlas, alpha-tested leaf clusters and bark, per-instance
 * tint, optional wind; no per-instance species pick (the geometry's uv point at the cluster and
 * bark tiles). The depth material casts the same leaves.
 */
export function treeCloudMaterials(
  atlas: Texture,
  key: string,
  options: { wind: boolean; coverage: boolean },
  time: { value: number },
  swap: TreeSwap,
): { material: MeshStandardMaterial; depth: MeshDepthMaterial } {
  const hook = (shader: WebGLProgramParametersWithUniforms): void => {
    shader.uniforms.uTreeTime = time;
    shader.vertexShader = shader.vertexShader.replace(
      '#include <common>',
      '#include <common>\nuniform float uTreeTime;',
    );
    if (options.wind)
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', WIND);
    addSwap(shader, swap, true);
    leafShading(shader);
  };
  const material = new MeshStandardMaterial({
    map: atlas,
    vertexColors: true,
    alphaTest: 0.5,
    alphaToCoverage: options.coverage,
    side: DoubleSide,
    roughness: 0.8,
    metalness: 0,
    envMapIntensity: 0.8,
  });
  material.name = `tree-cloud-${key}`;
  material.onBeforeCompile = hook;
  material.customProgramCacheKey = () => `tree-cloud-v3-${options.wind ? 1 : 0}`;
  const depth = new MeshDepthMaterial({
    depthPacking: RGBADepthPacking,
    map: atlas,
    alphaTest: 0.5,
    side: DoubleSide,
  });
  depth.onBeforeCompile = hook;
  depth.customProgramCacheKey = () => `tree-cloud-depth-${options.wind ? 1 : 0}`;
  return { material, depth };
}

/**
 * The prop kit's material for kit tree models drawn as near trees (the conifers): faded in per
 * tree over the swap band as the cards fade out, as the near trees of the atlas are.
 */
export function nearKitTreeMaterial(swap: TreeSwap): MeshStandardMaterial {
  const m = createPropKitMaterial({ key: 'tree-kit-near' });
  const inner = m.onBeforeCompile.bind(m);
  m.onBeforeCompile = (shader, renderer) => {
    inner(shader, renderer);
    addSwap(shader, swap, true);
  };
  m.customProgramCacheKey = () => 'tree-kit-near-v1';
  return m;
}
