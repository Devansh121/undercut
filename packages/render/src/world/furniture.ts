import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Group,
  Mesh,
  MeshStandardMaterial,
  type Material,
  type Texture,
  type WebGLProgramParametersWithUniforms,
} from 'three';
import { MeshSurface, createVec3, type Track } from '@undercut/track';
import type { PropRegistry } from '../props/registry';
import { BRAND_ATLAS_COLS, BRAND_ATLAS_ROWS } from './brands';
import { hash01, type DressingFile, type MappedFeature } from './dressing';
import type { StandFrame } from './grandstands';
import type { LapIndex } from './lap-index';
import type { PitComplexData } from './pit-building';

/** Geometry builder helper for procedural stand-in props (origin on ground at centre, +Y up, +X front). */
class PropBuilder {
  pos: number[] = [];
  nor: number[] = [];
  uv: number[] = [];
  col: number[] = [];
  idx: number[] = [];

  quad(
    a: readonly number[],
    b: readonly number[],
    c: readonly number[],
    d: readonly number[],
    colour: readonly number[],
    uvs: readonly (readonly number[])[] = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ],
  ): void {
    const e1 = [b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!];
    const e2 = [d[0]! - a[0]!, d[1]! - a[1]!, d[2]! - a[2]!];
    let nx = e1[1]! * e2[2]! - e1[2]! * e2[1]!;
    let ny = e1[2]! * e2[0]! - e1[0]! * e2[2]!;
    let nz = e1[0]! * e2[1]! - e1[1]! * e2[0]!;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l;
    ny /= l;
    nz /= l;
    const base = this.pos.length / 3;
    [a, b, c, d].forEach((v, i) => {
      this.pos.push(v[0]!, v[1]!, v[2]!);
      this.nor.push(nx, ny, nz);
      this.col.push(colour[0]!, colour[1]!, colour[2]!);
      const t = uvs[i] as readonly number[];
      this.uv.push(t[0]!, t[1]!);
    });
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  box(
    x0: number,
    x1: number,
    y0: number,
    y1: number,
    z0: number,
    z1: number,
    c: readonly number[],
    frontUv?: [number, number, number, number],
  ): void {
    const fuv = frontUv
      ? [
          [frontUv[0], frontUv[1]],
          [frontUv[2], frontUv[1]],
          [frontUv[2], frontUv[3]],
          [frontUv[0], frontUv[3]],
        ]
      : [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 1],
        ];
    // +X front
    this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], c, fuv);
    // -X back
    this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], c);
    // +Z right
    this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], c);
    // -Z left
    this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], c);
    // +Y top
    this.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], c);
    // -Y bottom
    this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], c);
  }

  build(withColors = true): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(this.pos), 3));
    g.setAttribute('normal', new BufferAttribute(new Float32Array(this.nor), 3));
    g.setAttribute('uv', new BufferAttribute(new Float32Array(this.uv), 2));
    if (withColors) g.setAttribute('color', new BufferAttribute(new Float32Array(this.col), 3));
    g.setIndex(
      this.idx.length > 65535 ? new BufferAttribute(new Uint32Array(this.idx), 1) : this.idx,
    );
    g.computeBoundingSphere();
    return g;
  }
}

/**
 * Modular advertising hoarding (6 m wide along Z, 1.15 m tall, pivot on ground centre, +X front).
 * Front face carries UVs [0..1] for the brand atlas; back & struts stay dark structural steel.
 */
export function hoardingFrontGeometry(): BufferGeometry {
  const b = new PropBuilder();
  const w = 5.92;
  const h = 1.1;
  // Slightly tilted front face (+X) so it catches afternoon sun cleanly without clipping barriers.
  b.quad(
    [0.06, 0.04, w / 2],
    [0.06, 0.04, -w / 2],
    [0.02, 0.04 + h, -w / 2],
    [0.02, 0.04 + h, w / 2],
    [1, 1, 1],
    [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ],
  );
  return b.build(false);
}

export function hoardingFrameGeometry(): BufferGeometry {
  const b = new PropBuilder();
  const dark = [0.07, 0.075, 0.085];
  // Back panel + 3 rear support legs.
  b.box(-0.04, 0.01, 0.04, 1.14, -2.98, 2.98, dark);
  for (const z of [-2.2, 0, 2.2]) {
    b.box(-0.52, -0.04, 0.0, 0.08, z - 0.04, z + 0.04, dark);
    b.box(-0.14, -0.04, 0.0, 1.05, z - 0.035, z + 0.035, dark);
  }
  return b.build(true);
}

/**
 * Low angled A-frame advertising board placed in neat rows along grass verges (4.4 m wide along Z,
 * 0.88 m tall, tilted back ~20 deg toward -X so broadcast cameras read it cleanly).
 * Pivot on ground centre, +Y up, +X front.
 */
export function vergeBoardFrontGeometry(): BufferGeometry {
  const b = new PropBuilder();
  const w = 4.32;
  const h = 0.84;
  b.quad(
    [0.24, 0.03, w / 2],
    [0.24, 0.03, -w / 2],
    [-0.08, 0.03 + h, -w / 2],
    [-0.08, 0.03 + h, w / 2],
    [1, 1, 1],
    [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ],
  );
  return b.build(false);
}

export function vergeBoardFrameGeometry(): BufferGeometry {
  const b = new PropBuilder();
  const dark = [0.08, 0.085, 0.095];
  // Sloped rear foam/composite wedge + ground skids.
  b.quad(
    [-0.1, 0.03 + 0.84, -2.18],
    [0.22, 0.03, -2.18],
    [0.22, 0.03, 2.18],
    [-0.1, 0.03 + 0.84, 2.18],
    dark,
  );
  for (const z of [-1.7, 0, 1.7]) {
    b.box(-0.34, 0.2, 0.0, 0.06, z - 0.04, z + 0.04, dark);
    b.box(-0.18, -0.08, 0.0, 0.82, z - 0.03, z + 0.03, dark);
  }
  return b.build(true);
}

/**
 * Tall vertical steel lattice truss / lighting mast (16.5 m tall) that breaks the treeline skyline
 * along the main straight, paddock, and key spectator corners. Pivot on ground centre, +Y up, +X front.
 */
export function trussTowerGeometry(): BufferGeometry {
  const b = new PropBuilder();
  const steel = [0.16, 0.17, 0.185];
  const dark = [0.07, 0.075, 0.085];
  const lamp = [0.46, 0.47, 0.48];
  // Concrete plinth.
  b.box(-0.85, 0.85, 0.0, 0.65, -0.85, 0.85, [0.18, 0.18, 0.175]);
  // Four tapered lattice legs (wider at base, narrower at top).
  const levels = [0.65, 4.2, 7.8, 11.4, 15.0];
  const widths = [0.62, 0.52, 0.42, 0.34, 0.28];
  for (let i = 0; i < levels.length - 1; i++) {
    const y0 = levels[i] as number;
    const y1 = levels[i + 1] as number;
    const w0 = widths[i] as number;
    for (const sx of [-w0, w0]) {
      for (const sz of [-w0, w0]) {
        b.box(sx - 0.055, sx + 0.055, y0, y1, sz - 0.055, sz + 0.055, steel);
      }
    }
    // Horizontal ring tie at each bay.
    b.box(-w0, w0, y1 - 0.09, y1 + 0.02, -w0, -w0 + 0.09, steel);
    b.box(-w0, w0, y1 - 0.09, y1 + 0.02, w0 - 0.09, w0, steel);
    b.box(-w0, -w0 + 0.09, y1 - 0.09, y1 + 0.02, -w0, w0, steel);
    b.box(w0 - 0.09, w0, y1 - 0.09, y1 + 0.02, -w0, w0, steel);
  }
  // Upper service cage + twin cross-arms with floodlight/broadcast lamp banks facing +X.
  b.box(-0.45, 0.55, 14.9, 15.12, -1.75, 1.75, dark);
  b.box(-0.32, 0.52, 15.8, 16.02, -1.55, 1.55, dark);
  for (const lz of [-1.25, -0.45, 0.45, 1.25]) {
    b.box(0.25, 0.62, 15.12, 15.65, lz - 0.24, lz + 0.24, dark);
    b.box(0.62, 0.67, 15.18, 15.58, lz - 0.2, lz + 0.2, lamp);
  }
  // Lightning rod / telemetry mast above the lamp head.
  b.box(-0.04, 0.04, 15.9, 17.8, -0.04, 0.04, steel);
  return b.build(true);
}

/** Brand atlas instanced material: selects one of the 20 invented brand slots per instance position. */
export function brandHoardingMaterial(atlas: Texture): MeshStandardMaterial {
  const m = new MeshStandardMaterial({
    map: atlas,
    roughness: 0.52,
    metalness: 0.04,
  });
  m.name = 'brand-hoarding';
  const total = BRAND_ATLAS_COLS * BRAND_ATLAS_ROWS;
  m.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    shader.vertexShader = shader.vertexShader.replace(
      '#include <uv_vertex>',
      `#include <uv_vertex>
      #if defined( USE_INSTANCING ) && defined( USE_MAP )
      {
        vec2 ip = vec2(instanceMatrix[3][0], instanceMatrix[3][2]);
        float h = fract(sin(dot(floor(ip * 0.25), vec2(12.9898, 78.233))) * 43758.5453);
        float slot = floor(h * ${total.toFixed(1)});
        float col = mod(slot, ${BRAND_ATLAS_COLS.toFixed(1)});
        float row = floor(slot / ${BRAND_ATLAS_COLS.toFixed(1)});
        // CanvasTexture has flipY=true: row 0 is at the top (v near 1).
        float vRow = ${(BRAND_ATLAS_ROWS - 1).toFixed(1)} - row;
        vMapUv = vec2((col + uv.x) / ${BRAND_ATLAS_COLS.toFixed(1)}, (vRow + uv.y) / ${BRAND_ATLAS_ROWS.toFixed(1)});
      }
      #endif`,
    );
  };
  m.customProgramCacheKey = () => 'brand-hoarding-v1';
  return m;
}

/**
 * Modular catch fence (4 m wide along Z, 3.8 m tall, +X facing the track with 0.55 m angled top
 * overhang toward +X): separated into steel posts/arm (opaque) and wire mesh (alpha-tested).
 */
export function catchFencePostsGeometry(): BufferGeometry {
  const b = new PropBuilder();
  const steel = [0.22, 0.23, 0.245];
  // Main upright steel I-post at z = -2.0 m (tiling cleanly every 4 m) + top cantilever arm.
  b.box(-0.07, 0.07, 0.0, 3.25, -2.05, -1.95, steel);
  // Angled overhang arm projecting toward track (+X).
  b.quad(
    [-0.04, 3.22, -1.96],
    [0.54, 3.78, -1.96],
    [0.54, 3.86, -1.96],
    [-0.04, 3.3, -1.96],
    steel,
  );
  b.quad(
    [0.54, 3.78, -2.04],
    [-0.04, 3.22, -2.04],
    [-0.04, 3.3, -2.04],
    [0.54, 3.86, -2.04],
    steel,
  );
  // Top horizontal tie bar.
  b.box(0.48, 0.56, 3.78, 3.85, -2.0, 2.0, steel);
  // Base mounting bracket.
  b.box(-0.14, 0.14, 0.0, 0.12, -2.1, -1.9, [0.14, 0.145, 0.155]);
  return b.build(true);
}

export function catchFenceMeshGeometry(): BufferGeometry {
  const b = new PropBuilder();
  // Vertical wire mesh section (y = 0.85..3.25 m, sitting above the concrete/Armco barrier).
  b.quad(
    [0.05, 0.85, 2.0],
    [0.05, 0.85, -2.0],
    [0.05, 3.25, -2.0],
    [0.05, 3.25, 2.0],
    [1, 1, 1],
    [
      [0, 0],
      [2, 0],
      [2, 1.2],
      [0, 1.2],
    ],
  );
  // Angled overhang mesh section.
  b.quad(
    [0.05, 3.25, 2.0],
    [0.05, 3.25, -2.0],
    [0.52, 3.82, -2.0],
    [0.52, 3.82, 2.0],
    [1, 1, 1],
    [
      [0, 0],
      [2, 0],
      [2, 0.45],
      [0, 0.45],
    ],
  );
  return b.build(false);
}

/**
 * Modular distance / DRS / marshal board on steel posts: pivot on ground centre, +Y up, +X front.
 * `slot` indexes the 4 × 2 `signageAtlas` (0:150, 1:100, 2:50, 3:200, 4:DRS, 5:DRS det, 6:POST).
 */
export function signBoardGeometry(
  slot: number,
  size = 1.35,
  height = 0.7,
): {
  face: BufferGeometry;
  posts: BufferGeometry;
} {
  const col = slot % 4;
  const row = Math.floor(slot / 4);
  const u0 = col / 4;
  const u1 = (col + 1) / 4;
  const v1 = 1 - row / 2;
  const v0 = 1 - (row + 1) / 2;
  const hs = size / 2;

  const faceB = new PropBuilder();
  faceB.quad(
    [0.04, height, hs],
    [0.04, height, -hs],
    [0.04, height + size, -hs],
    [0.04, height + size, hs],
    [1, 1, 1],
    [
      [u0, v0],
      [u1, v0],
      [u1, v1],
      [u0, v1],
    ],
  );

  const postB = new PropBuilder();
  const steel = [0.16, 0.17, 0.18];
  const back = [0.12, 0.125, 0.135];
  // Board backing + 2 posts.
  postB.box(-0.04, 0.03, height, height + size, -hs, hs, back);
  postB.box(-0.04, 0.02, 0, height + size * 0.9, -hs * 0.65 - 0.03, -hs * 0.65 + 0.03, steel);
  postB.box(-0.04, 0.02, 0, height + size * 0.9, hs * 0.65 - 0.03, hs * 0.65 + 0.03, steel);

  return { face: faceB.build(false), posts: postB.build(true) };
}

/**
 * Marshal post & LED light panel mast: pivot on ground centre, +Y up, +X front.
 * Includes a painted barrier shelter box + 3.9 m steel mast + black LED matrix panel housing.
 */
export function marshalPostGeometry(): BufferGeometry {
  const b = new PropBuilder();
  const orange = [0.68, 0.16, 0.03];
  const white = [0.72, 0.71, 0.68];
  const dark = [0.06, 0.065, 0.075];
  const steel = [0.18, 0.19, 0.21];
  const ledGreen = [0.08, 0.55, 0.22];

  // Orange-and-white marshal barrier hut / protective screen.
  b.box(-0.45, 0.45, 0.0, 0.72, -1.0, 1.0, orange);
  b.box(-0.45, 0.45, 0.72, 1.12, -1.0, 1.0, white);
  b.box(-0.45, 0.45, 1.12, 1.48, -1.0, 1.0, orange);
  // Light panel mast beside the hut.
  b.box(-0.06, 0.06, 0.0, 3.85, 1.18, 1.3, steel);
  b.box(-0.09, 0.11, 2.75, 3.72, 0.88, 1.6, dark);
  // Subtle green status border on the LED panel face (+X).
  b.box(0.11, 0.13, 2.84, 3.62, 0.96, 1.52, ledGreen);
  return b.build(true);
}

/**
 * Tecpro-style modular energy-absorbing barrier block (1.6 m along Z, 1.1 m tall, 0.85 m deep).
 * Origin on ground at centre, +Y up, +X front. Alternating dark/light pairs read unmistakably at chicane exits.
 */
export function tecproBlockGeometry(): BufferGeometry {
  const b = new PropBuilder();
  const dark = [0.09, 0.1, 0.12];
  const light = [0.62, 0.61, 0.59];
  const strap = [0.04, 0.042, 0.048];
  // Two half-modules side by side: dark left, light right, tied by dark top/mid straps.
  b.box(-0.42, 0.42, 0.0, 1.08, -0.78, -0.02, dark);
  b.box(-0.42, 0.42, 0.0, 1.08, 0.02, 0.78, light);
  b.box(-0.44, 0.44, 0.48, 0.58, -0.8, 0.8, strap);
  b.box(-0.44, 0.44, 0.94, 1.04, -0.8, 0.8, strap);
  return b.build(true);
}

/**
 * Big-screen LED tower: steel lattice pylon + 9.5 m × 5.4 m broadcast screen (signageAtlas slot 7).
 * Pivot on ground centre, +Y up, +X facing spectators/track.
 */
export function bigScreenTowerGeometry(): { frame: BufferGeometry; screen: BufferGeometry } {
  const f = new PropBuilder();
  const steel = [0.11, 0.115, 0.125];
  const casing = [0.04, 0.045, 0.055];
  // Concrete base + two steel lattice legs + screen housing.
  f.box(-1.2, 1.2, 0.0, 0.7, -3.2, 3.2, [0.17, 0.17, 0.165]);
  for (const sz of [-2.4, 2.4]) {
    f.box(-0.35, 0.35, 0.7, 6.2, sz - 0.35, sz + 0.35, steel);
  }
  // Cross brace.
  f.box(-0.22, 0.22, 3.2, 3.55, -2.4, 2.4, steel);
  // Screen cabinet (y = 5.2..10.6 m, z = -4.8..4.8 m).
  f.box(-0.55, 0.28, 5.2, 10.6, -4.85, 4.85, casing);

  const s = new PropBuilder();
  // signageAtlas row 1, col 3 => u: [0.75, 1.0], v: [0.0, 0.5]
  s.quad(
    [0.3, 5.45, 4.6],
    [0.3, 5.45, -4.6],
    [0.3, 10.35, -4.6],
    [0.3, 10.35, 4.6],
    [1, 1, 1],
    [
      [0.75, 0.0],
      [1.0, 0.0],
      [1.0, 0.5],
      [0.75, 0.5],
    ],
  );
  return { frame: f.build(true), screen: s.build(false) };
}

/**
 * Broadcast camera tower: 8.5 m tall steel tripod/lattice tower with railed platform & camera pod.
 * Pivot on ground centre, +Y up, +X front.
 */
export function cameraTowerGeometry(): BufferGeometry {
  const b = new PropBuilder();
  const steel = [0.14, 0.145, 0.155];
  const deck = [0.09, 0.095, 0.105];
  const pod = [0.18, 0.19, 0.2];
  // 4 corner uprights + cross braces.
  for (const sx of [-0.9, 0.9]) {
    for (const sz of [-0.9, 0.9]) {
      b.box(sx - 0.08, sx + 0.08, 0, 7.6, sz - 0.08, sz + 0.08, steel);
    }
  }
  for (const y of [2.4, 5.0]) {
    b.box(-0.9, 0.9, y, y + 0.12, -0.9, -0.78, steel);
    b.box(-0.9, 0.9, y, y + 0.12, 0.78, 0.9, steel);
    b.box(-0.9, -0.78, y, y + 0.12, -0.9, 0.9, steel);
    b.box(0.78, 0.9, y, y + 0.12, -0.9, 0.9, steel);
  }
  // Upper operator platform + handrails + broadcast camera housing.
  b.box(-1.35, 1.35, 7.5, 7.75, -1.35, 1.35, deck);
  b.box(-1.35, 1.35, 8.65, 8.75, -1.35, -1.27, steel);
  b.box(-1.35, 1.35, 8.65, 8.75, 1.27, 1.35, steel);
  b.box(1.27, 1.35, 8.65, 8.75, -1.35, 1.35, steel);
  b.box(-1.35, -1.27, 8.65, 8.75, -1.35, 1.35, steel);
  b.box(-0.2, 0.95, 8.2, 8.8, -0.3, 0.3, pod);
  return b.build(true);
}

/**
 * Start gantry spanning the start/finish line at s = 0, with 5 individually addressable emissive
 * start-light pods facing the grid (`setStartLights(mask)` turns red lights 0..4 on/off, bit 5
 * turns green).
 */
export interface StartGantry {
  group: Group;
  /** Bitmask: bits 0..4 light the five red start pods; bit 5 lights green (race start). */
  setLights: (mask: number) => void;
  geometries: BufferGeometry[];
  materials: Material[];
}

export function buildStartGantry(track: Track, brandAtlasTex: Texture, brandSlot = 0): StartGantry {
  const group = new Group();
  group.name = 'world:start-gantry';
  const geometries: BufferGeometry[] = [];
  const materials: Material[] = [];

  const leftBar = Math.abs(track.barrier[0][0] ?? 10) + 1.4;
  const rightBar = Math.abs(track.barrier[1][0] ?? 10) + 1.4;
  const span = leftBar + rightBar;
  const midD = (leftBar - rightBar) / 2;

  const p = createVec3();
  const t = createVec3();
  track.lap.pointAt(0, midD, p);
  track.lap.tangent(0, t);
  const groundY = track.groundHeightAt(p.x, p.z);
  const yaw = Math.atan2(-t.z, t.x); // +X local = direction of travel, -X local = facing grid

  group.position.set(p.x, groundY, p.z);
  group.rotation.y = yaw;

  const clearH = 6.1;
  const topH = 8.4;
  const halfSpan = span / 2;

  // Steel gantry structure.
  const sb = new PropBuilder();
  const steel = [0.1, 0.11, 0.125];
  const dark = [0.055, 0.06, 0.07];
  const concrete = [0.2, 0.2, 0.195];

  // Left & right concrete plinths + twin steel portal legs.
  for (const sz of [-halfSpan, halfSpan]) {
    sb.box(-1.3, 1.3, -0.4, 0.8, sz - 0.9, sz + 0.9, concrete);
    for (const sx of [-0.75, 0.75]) {
      sb.box(sx - 0.24, sx + 0.24, 0.8, topH + 0.3, sz - 0.32, sz + 0.32, steel);
    }
    // Diagonal bracing in portal legs.
    sb.box(-0.75, 0.75, 2.8, 3.05, sz - 0.22, sz + 0.22, steel);
    sb.box(-0.75, 0.75, 5.2, 5.45, sz - 0.22, sz + 0.22, steel);
  }
  // Main horizontal gantry deck & truss box.
  sb.box(-1.1, 1.1, clearH, clearH + 0.28, -halfSpan - 0.4, halfSpan + 0.4, dark);
  sb.box(-1.1, 1.1, topH - 0.25, topH, -halfSpan - 0.4, halfSpan + 0.4, dark);
  sb.box(-1.05, 1.05, clearH + 0.28, topH - 0.25, -halfSpan, halfSpan, [0.07, 0.075, 0.085]);
  // Hanging start-light beam bar beneath the gantry centred over the racing lane (offset -midD).
  const laneZ = -midD;
  sb.box(-0.65, 0.15, clearH - 1.15, clearH, laneZ - 4.4, laneZ + 4.4, dark);
  for (let i = 0; i < 5; i++) {
    const zc = laneZ + (i - 2) * 1.65;
    // Hooded light pod housing facing -X (toward cars on the grid).
    sb.box(-0.82, -0.1, clearH - 1.48, clearH - 0.28, zc - 0.36, zc + 0.36, [0.035, 0.038, 0.045]);
  }

  const structGeo = sb.build(true);
  const structMat = new MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.65,
    metalness: 0.35,
  });
  structMat.name = 'start-gantry-steel';
  geometries.push(structGeo);
  materials.push(structMat);
  const structMesh = new Mesh(structGeo, structMat);
  structMesh.castShadow = true;
  structMesh.receiveShadow = true;
  group.add(structMesh);

  // Front & back gantry sponsor banner faces (mapped cleanly to one invented brand).
  const col = brandSlot % BRAND_ATLAS_COLS;
  const row = Math.floor(brandSlot / BRAND_ATLAS_COLS);
  const u0 = col / BRAND_ATLAS_COLS;
  const u1 = (col + 1) / BRAND_ATLAS_COLS;
  const vRow = BRAND_ATLAS_ROWS - 1 - row;
  const v0 = vRow / BRAND_ATLAS_ROWS;
  const v1 = (vRow + 1) / BRAND_ATLAS_ROWS;

  const bb = new PropBuilder();
  const bw = Math.min(halfSpan - 1.0, 12.5);
  // Facing oncoming cars (-X).
  bb.quad(
    [-1.13, clearH + 0.2, -bw],
    [-1.13, clearH + 0.2, bw],
    [-1.13, topH - 0.15, bw],
    [-1.13, topH - 0.15, -bw],
    [1, 1, 1],
    [
      [u0, v0],
      [u1, v0],
      [u1, v1],
      [u0, v1],
    ],
  );
  // Facing down-straight (+X).
  bb.quad(
    [1.13, clearH + 0.2, bw],
    [1.13, clearH + 0.2, -bw],
    [1.13, topH - 0.15, -bw],
    [1.13, topH - 0.15, bw],
    [1, 1, 1],
    [
      [u0, v0],
      [u1, v0],
      [u1, v1],
      [u0, v1],
    ],
  );
  const bannerGeo = bb.build(false);
  const bannerMat = new MeshStandardMaterial({
    map: brandAtlasTex,
    roughness: 0.48,
    metalness: 0.05,
  });
  bannerMat.name = 'start-gantry-banner';
  geometries.push(bannerGeo);
  materials.push(bannerMat);
  const bannerMesh = new Mesh(bannerGeo, bannerMat);
  bannerMesh.receiveShadow = true;
  group.add(bannerMesh);

  // 5 individually addressable start-light lenses (two stacked LED circles per pod, facing -X).
  const podMaterials: MeshStandardMaterial[] = [];
  for (let i = 0; i < 5; i++) {
    const zc = laneZ + (i - 2) * 1.65;
    const lb = new PropBuilder();
    for (const ly of [clearH - 1.24, clearH - 0.72]) {
      lb.quad(
        [-0.84, ly - 0.16, zc - 0.16],
        [-0.84, ly - 0.16, zc + 0.16],
        [-0.84, ly + 0.16, zc + 0.16],
        [-0.84, ly + 0.16, zc - 0.16],
        [1, 1, 1],
      );
    }
    const lg = lb.build(false);
    const lm = new MeshStandardMaterial({
      color: 0x1a0808,
      emissive: new Color(0xff1408),
      emissiveIntensity: 0,
      roughness: 0.2,
      metalness: 0.1,
    });
    lm.name = `start-light-${i}`;
    geometries.push(lg);
    materials.push(lm);
    podMaterials.push(lm);
    const lMesh = new Mesh(lg, lm);
    lMesh.name = `start-light-pod-${i}`;
    group.add(lMesh);
  }

  const setLights = (mask: number): void => {
    const green = (mask & 32) !== 0;
    for (let i = 0; i < 5; i++) {
      const lm = podMaterials[i]!;
      const on = (mask & (1 << i)) !== 0;
      if (green) {
        lm.emissive.setHex(0x10e048);
        lm.emissiveIntensity = 8.0;
      } else if (on) {
        lm.emissive.setHex(0xff1808);
        lm.emissiveIntensity = 9.0;
      } else {
        lm.emissiveIntensity = 0;
      }
    }
  };
  // Default: lights out (subtle off lenses ready for race-engine start sequence).
  setLights(0);

  return { group, setLights, geometries, materials };
}

/**
 * Over-track sponsor & pedestrian bridges: built from OSM mapped bridges crossing the track plus
 * authored bridge lap positions, each with concrete piers, steel deck truss, and crisp double-sided
 * brand banners spanning cleanly above the circuit (6.4 m clearance).
 */
export function buildTrackBridges(
  track: Track,
  dressing: DressingFile,
  lap: LapIndex,
  brandAtlasTex: Texture,
): { group: Group; geometries: BufferGeometry[]; materials: Material[]; count: number } {
  const group = new Group();
  group.name = 'world:bridges';
  const geometries: BufferGeometry[] = [];
  const materials: Material[] = [];

  // Gather candidate bridge lap positions: OSM mapped bridges crossing within 20 m (excluding Podio)
  // plus authored bridge objects in the dressing file.
  const bridgeS: number[] = [];
  const addBridgeS = (s: number): void => {
    const wrapped = ((s % track.length) + track.length) % track.length;
    // Keep out of the start gantry (±80 m) and avoid duplicate crossings within 80 m.
    if (wrapped < 80 || wrapped > track.length - 80) return;
    if (bridgeS.some((prev) => Math.abs(prev - wrapped) < 80)) return;
    bridgeS.push(wrapped);
  };

  for (const b of dressing.mapped.bridge) {
    if ((b.t?.name ?? '').toLowerCase().includes('podio')) continue;
    if ((b.t?.highway ?? '') === 'steps') continue;
    let bestD = Infinity;
    let bestS = 0;
    for (let i = 0; i + 1 < b.p.length; i += 2) {
      const hit = lap.nearest(b.p[i] as number, b.p[i + 1] as number);
      if (hit.dist < bestD) {
        bestD = hit.dist;
        bestS = hit.s;
      }
    }
    if (bestD < 18) addBridgeS(bestS);
  }
  for (const obj of dressing.authored?.objects ?? []) {
    if (obj.kind === 'bridge') addBridgeS(obj.s);
  }

  if (bridgeS.length === 0) return { group, geometries, materials, count: 0 };

  const sb = new PropBuilder();
  const bb = new PropBuilder();
  const steel = [0.13, 0.14, 0.15];
  const concrete = [0.2, 0.2, 0.195];
  const dark = [0.065, 0.07, 0.08];
  const p = createVec3();
  const t = createVec3();

  bridgeS.forEach((s, bi) => {
    const idxS = Math.min(track.lap.count - 1, Math.round(s / track.lap.step));
    const leftBar = Math.abs(track.barrier[0][idxS] ?? 11) + 2.2;
    const rightBar = Math.abs(track.barrier[1][idxS] ?? 11) + 2.2;
    const span = leftBar + rightBar;
    const midD = (leftBar - rightBar) / 2;
    track.lap.pointAt(s, midD, p);
    track.lap.tangent(s, t);
    const tl = Math.hypot(t.x, t.z) || 1;
    const fx = t.x / tl;
    const fz = t.z / tl;
    // Left normal (-fz, fx).
    const lx = -fz;
    const lz = fx;
    const gy = track.groundHeightAt(p.x, p.z);
    const clearH = 6.2;
    const topH = 9.0;
    const halfSpan = span / 2;

    const W = (xLocal: number, yLocal: number, zLocal: number): number[] => [
      p.x + fx * xLocal + lx * zLocal,
      gy + yLocal,
      p.z + fz * xLocal + lz * zLocal,
    ];
    const addBoxWorld = (
      x0: number,
      x1: number,
      y0: number,
      y1: number,
      z0: number,
      z1: number,
      c: readonly number[],
    ): void => {
      // +x face
      sb.quad(W(x1, y0, z0), W(x1, y0, z1), W(x1, y1, z1), W(x1, y1, z0), c);
      // -x face
      sb.quad(W(x0, y0, z1), W(x0, y0, z0), W(x0, y1, z0), W(x0, y1, z1), c);
      // +z face
      sb.quad(W(x1, y0, z1), W(x0, y0, z1), W(x0, y1, z1), W(x1, y1, z1), c);
      // -z face
      sb.quad(W(x0, y0, z0), W(x1, y0, z0), W(x1, y1, z0), W(x0, y1, z0), c);
      // top
      sb.quad(W(x0, y1, z0), W(x1, y1, z0), W(x1, y1, z1), W(x0, y1, z1), c);
      // bottom
      sb.quad(W(x0, y0, z1), W(x1, y0, z1), W(x1, y0, z0), W(x0, y0, z0), c);
    };

    // Concrete abutment towers outside both barriers.
    for (const sz of [-halfSpan, halfSpan]) {
      addBoxWorld(-1.8, 1.8, -0.8, topH + 0.4, sz - 1.1, sz + 1.1, concrete);
    }
    // Overhead bridge deck + enclosed steel walkway box.
    addBoxWorld(-1.9, 1.9, clearH, clearH + 0.4, -halfSpan - 1.1, halfSpan + 1.1, dark);
    addBoxWorld(-1.75, 1.75, clearH + 0.4, topH - 0.25, -halfSpan, halfSpan, steel);
    addBoxWorld(-1.95, 1.95, topH - 0.25, topH + 0.1, -halfSpan - 1.1, halfSpan + 1.1, dark);

    // Double-sided brand banner face across the bridge span.
    const slot = (bi * 3 + 2) % (BRAND_ATLAS_COLS * BRAND_ATLAS_ROWS);
    const col = slot % BRAND_ATLAS_COLS;
    const row = Math.floor(slot / BRAND_ATLAS_COLS);
    const u0 = col / BRAND_ATLAS_COLS;
    const u1 = (col + 1) / BRAND_ATLAS_COLS;
    const vRow = BRAND_ATLAS_ROWS - 1 - row;
    const v0 = vRow / BRAND_ATLAS_ROWS;
    const v1 = (vRow + 1) / BRAND_ATLAS_ROWS;
    const bw = Math.min(halfSpan - 0.8, 14);
    const uvRect = [
      [u0, v0],
      [u1, v0],
      [u1, v1],
      [u0, v1],
    ];
    // Oncoming (-x) face.
    bb.quad(
      W(-1.96, clearH + 0.2, bw),
      W(-1.96, clearH + 0.2, -bw),
      W(-1.96, topH - 0.15, -bw),
      W(-1.96, topH - 0.15, bw),
      [1, 1, 1],
      uvRect,
    );
    // Trailing (+x) face.
    bb.quad(
      W(1.96, clearH + 0.2, -bw),
      W(1.96, clearH + 0.2, bw),
      W(1.96, topH - 0.15, bw),
      W(1.96, topH - 0.15, -bw),
      [1, 1, 1],
      uvRect,
    );
  });

  const sg = sb.build(true);
  const sm = new MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0.18 });
  sm.name = 'track-bridge-struct';
  const bg = bb.build(false);
  const bm = new MeshStandardMaterial({ map: brandAtlasTex, roughness: 0.5, metalness: 0.04 });
  bm.name = 'track-bridge-banner';
  geometries.push(sg, bg);
  materials.push(sm, bm);

  const sMesh = new Mesh(sg, sm);
  sMesh.castShadow = true;
  sMesh.receiveShadow = true;
  const bMesh = new Mesh(bg, bm);
  bMesh.receiveShadow = true;
  group.add(sMesh, bMesh);

  return { group, geometries, materials, count: bridgeS.length };
}

/**
 * Historic banked oval concrete (e.g., Monza's Sopraelevata Nord/Sud where OSM maps concrete
 * raceways near the circuit): extruded weathered concrete slab with banked outer lip so the old
 * high-speed banking reads clearly where it crosses or parallels the view.
 */
export function buildHistoricBanking(
  features: readonly MappedFeature[],
  heightAt: (x: number, z: number) => number,
  lap: LapIndex,
): { mesh: Mesh | null; geometry?: BufferGeometry; material?: Material } {
  const banked = features.filter((f) => {
    const name = (f.t?.name ?? '').toLowerCase();
    return (f.t?.surface === 'concrete' && f.p.length >= 6) || name.includes('sopraelevata');
  });
  if (banked.length === 0) return { mesh: null };

  const b = new PropBuilder();
  const concrete = [0.21, 0.205, 0.195];
  const lip = [0.15, 0.148, 0.145];
  let built = 0;

  for (const f of banked) {
    const pts = f.p;
    const isBridge = f.t?.layer === '1';
    for (let i = 0; i + 3 < pts.length; i += 2) {
      const ax = pts[i] as number;
      const az = pts[i + 1] as number;
      const bx = pts[i + 2] as number;
      const bz = pts[i + 3] as number;
      const dx = bx - ax;
      const dz = bz - az;
      const len = Math.hypot(dx, dz);
      if (len < 1.5) continue;
      // Skip segments that cross directly on top of the active drivable road at ground level.
      const mx = (ax + bx) * 0.5;
      const mz = (az + bz) * 0.5;
      const hit = lap.nearest(mx, mz);
      const elevated = isBridge || hit.dist < 18;
      // Only raise as a banked overpass where it crosses the circuit, otherwise ground-hugging embankment.
      const nx = -dz / len;
      const nz = dx / len;
      const w = 5.5;
      const baseA = heightAt(ax, az) + (elevated ? 6.6 : 0.4);
      const baseB = heightAt(bx, bz) + (elevated ? 6.6 : 0.4);
      const bankRise = elevated ? 0.5 : 3.2;

      const A0 = [ax - nx * w, baseA, az - nz * w];
      const B0 = [bx - nx * w, baseB, bz - nz * w];
      const A1 = [ax + nx * w, baseA + bankRise, az + nz * w];
      const B1 = [bx + nx * w, baseB + bankRise, bz + nz * w];
      // Banked concrete deck.
      b.quad(A0, B0, B1, A1, concrete);
      // Outer embankment concrete wall down to ground.
      const gA = heightAt(ax + nx * w, az + nz * w) - 0.6;
      const gB = heightAt(bx + nx * w, bz + nz * w) - 0.6;
      b.quad([ax + nx * w, gA, az + nz * w], [bx + nx * w, gB, bz + nz * w], B1, A1, lip);
      built++;
    }
  }
  if (built === 0) return { mesh: null };

  const geometry = b.build(true);
  const material = new MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 });
  material.name = 'historic-banking';
  const mesh = new Mesh(geometry, material);
  mesh.name = 'world:historic-banking';
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.matrixAutoUpdate = false;
  return { mesh, geometry, material };
}

/**
 * Places all modular trackside furniture through `props` (hoardings, catch fencing, braking & DRS
 * boards, marshal posts, Tecpro blocks, big-screen & camera towers) using the shared prop pivot
 * contract (+Y up, origin on ground centre, +X front, metres).
 */
export function placeTracksideFurniture(options: {
  track: Track;
  dressing: DressingFile;
  lap: LapIndex;
  stands: readonly StandFrame[];
  pitComplex: PitComplexData | null;
  heightAt: (x: number, z: number) => number;
  props: PropRegistry;
  brandAtlasTex: Texture;
  signageAtlasTex: Texture;
  fenceTex: Texture;
  castShadows: boolean;
  mobile: boolean;
  geometries: BufferGeometry[];
  materials: Material[];
}): Record<string, number> {
  const {
    track,
    dressing,
    stands,
    pitComplex,
    heightAt,
    props,
    brandAtlasTex,
    signageAtlasTex,
    fenceTex,
    castShadows,
    mobile,
    geometries,
    materials,
  } = options;
  const counts: Record<string, number> = {};

  // 1. Register modular prop kinds.
  const hoardFrontGeo = hoardingFrontGeometry();
  const hoardFrameGeo = hoardingFrameGeometry();
  const hoardMat = brandHoardingMaterial(brandAtlasTex);
  const steelMat = new MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.68,
    metalness: 0.28,
  });
  steelMat.name = 'furniture-steel';
  const fencePostGeo = catchFencePostsGeometry();
  const fenceMeshGeo = catchFenceMeshGeometry();
  const fenceMeshMat = new MeshStandardMaterial({
    map: fenceTex,
    alphaTest: 0.22,
    transparent: false,
    side: DoubleSide,
    roughness: 0.55,
    metalness: 0.5,
  });
  fenceMeshMat.name = 'catch-fence-mesh';
  const signMat = new MeshStandardMaterial({
    map: signageAtlasTex,
    roughness: 0.5,
    metalness: 0.04,
  });
  signMat.name = 'trackside-signage';
  const screenMat = new MeshStandardMaterial({
    map: signageAtlasTex,
    emissiveMap: signageAtlasTex,
    emissive: new Color(0xffffff),
    emissiveIntensity: 0.65,
    roughness: 0.35,
    metalness: 0.05,
  });
  screenMat.name = 'big-screen-led';
  const vergeFrontGeo = vergeBoardFrontGeometry();
  const vergeFrameGeo = vergeBoardFrameGeometry();
  const marshalGeo = marshalPostGeometry();
  const tecproGeo = tecproBlockGeometry();
  const screenParts = bigScreenTowerGeometry();
  const camTowerGeo = cameraTowerGeometry();
  const trussTowerGeo = trussTowerGeometry();

  geometries.push(
    hoardFrontGeo,
    hoardFrameGeo,
    vergeFrontGeo,
    vergeFrameGeo,
    fencePostGeo,
    fenceMeshGeo,
    marshalGeo,
    tecproGeo,
    screenParts.frame,
    screenParts.screen,
    camTowerGeo,
    trussTowerGeo,
  );
  materials.push(hoardMat, steelMat, fenceMeshMat, signMat, screenMat);

  const farDist = mobile ? 450 : 950;
  props.define({
    id: 'hoarding-front',
    castShadow: false,
    receiveShadow: true,
    lods: [{ geometry: hoardFrontGeo, material: hoardMat, maxDistance: farDist }],
  });
  props.define({
    id: 'hoarding-frame',
    castShadow: castShadows,
    receiveShadow: true,
    lods: [{ geometry: hoardFrameGeo, material: steelMat, maxDistance: farDist * 0.65 }],
  });
  props.define({
    id: 'verge-board-front',
    castShadow: false,
    receiveShadow: true,
    lods: [{ geometry: vergeFrontGeo, material: hoardMat, maxDistance: farDist * 0.9 }],
  });
  props.define({
    id: 'verge-board-frame',
    castShadow: castShadows,
    receiveShadow: true,
    lods: [{ geometry: vergeFrameGeo, material: steelMat, maxDistance: farDist * 0.55 }],
  });
  props.define({
    id: 'catch-fence-post',
    castShadow: false,
    receiveShadow: true,
    lods: [{ geometry: fencePostGeo, material: steelMat, maxDistance: mobile ? 300 : 650 }],
  });
  props.define({
    id: 'catch-fence-mesh',
    castShadow: false,
    receiveShadow: false,
    lods: [{ geometry: fenceMeshGeo, material: fenceMeshMat, maxDistance: mobile ? 220 : 480 }],
  });
  props.define({
    id: 'marshal-post',
    castShadow: castShadows,
    receiveShadow: true,
    lods: [{ geometry: marshalGeo, material: steelMat, maxDistance: farDist }],
  });
  props.define({
    id: 'tecpro-block',
    castShadow: castShadows,
    receiveShadow: true,
    lods: [{ geometry: tecproGeo, material: steelMat, maxDistance: farDist * 0.8 }],
  });
  props.define({
    id: 'big-screen-frame',
    castShadow: castShadows,
    receiveShadow: true,
    lods: [{ geometry: screenParts.frame, material: steelMat, maxDistance: farDist * 1.4 }],
  });
  props.define({
    id: 'big-screen-led',
    castShadow: false,
    receiveShadow: false,
    lods: [{ geometry: screenParts.screen, material: screenMat, maxDistance: farDist * 1.4 }],
  });
  props.define({
    id: 'camera-tower',
    castShadow: castShadows,
    receiveShadow: true,
    lods: [{ geometry: camTowerGeo, material: steelMat, maxDistance: farDist * 1.2 }],
  });
  props.define({
    id: 'truss-tower',
    castShadow: castShadows,
    receiveShadow: true,
    lods: [{ geometry: trussTowerGeo, material: steelMat, maxDistance: farDist * 1.5 }],
  });

  // Register braking & DRS board slots (0:150, 1:100, 2:50, 4:DRS, 5:DRS det).
  const signKinds: [string, number, number][] = [
    ['board-150', 0, 1.35],
    ['board-100', 1, 1.35],
    ['board-50', 2, 1.35],
    ['board-drs', 4, 1.45],
    ['board-drs-det', 5, 1.3],
  ];
  for (const [id, slot, sz] of signKinds) {
    const parts = signBoardGeometry(slot, sz, 0.72);
    geometries.push(parts.face, parts.posts);
    props.define({
      id: `${id}-face`,
      castShadow: false,
      receiveShadow: true,
      lods: [{ geometry: parts.face, material: signMat, maxDistance: farDist }],
    });
    props.define({
      id: `${id}-post`,
      castShadow: castShadows,
      receiveShadow: true,
      lods: [{ geometry: parts.posts, material: steelMat, maxDistance: farDist * 0.75 }],
    });
  }

  const p = createVec3();
  const t = createVec3();
  const L = track.length;
  const wrapS = (s: number): number => ((s % L) + L) % L;
  const pitSideIdx: 0 | 1 = track.pit.side === 'left' ? 0 : 1;
  const otherSideIdx: 0 | 1 = pitSideIdx === 0 ? 1 : 0;

  const nearPitGap = (s: number, side: 0 | 1): boolean => {
    if (side !== pitSideIdx) return false;
    const dEntry = Math.min(Math.abs(s - track.pit.entryS), L - Math.abs(s - track.pit.entryS));
    const dExit = Math.min(Math.abs(s - track.pit.exitS), L - Math.abs(s - track.pit.exitS));
    return dEntry < 38 || dExit < 38;
  };

  /** Helper: world point & inward-facing normal at lap (s, side: 0=left, 1=right, extra m past barrier). */
  const atBarrier = (s: number, side: 0 | 1, extra = 0.25) => {
    const sw = wrapS(s);
    const idxS = Math.min(track.lap.count - 1, Math.round(sw / track.lap.step));
    const barD = track.barrier[side][idxS] as number;
    const halfW = track.halfWidth[side][idxS] as number;
    const sign = side === 0 ? 1 : -1;
    const d = sign * (Math.abs(barD) + extra);
    track.lap.pointAt(sw, d, p);
    track.lap.tangent(sw, t);
    const tl = Math.hypot(t.x, t.z) || 1;
    const tx = t.x / tl;
    const tz = t.z / tl;
    // Normal pointing INWARD toward the racing surface.
    const nx = side === 0 ? tz : -tz;
    const nz = side === 0 ? -tx : tx;
    return {
      x: p.x,
      y: track.groundHeightAt(p.x, p.z),
      z: p.z,
      nx,
      nz,
      tx,
      tz,
      barD: Math.abs(barD),
      halfW: Math.abs(halfW),
      yawInward: Math.atan2(-nz, nx),
      yawOncoming: Math.atan2(tz, -tx),
      s: sw,
    };
  };

  // Main straight span derived strictly from pit entry/exit and first corner.
  const firstCornerStart = track.corners[0]?.start ?? Math.min(600, L * 0.12);
  const mainStartS = wrapS(track.pit.entryS - 180);
  const mainEndS = wrapS(Math.max(track.pit.exitS + 140, firstCornerStart + 20));

  // 2. Advertising hoardings along the barriers + neat rows of angled grass-verge boards.
  let hoardings = 0;
  const placeHoarding = (x: number, y: number, z: number, yaw: number, s: number): void => {
    props.place('hoarding-front', { x, y, z, yaw, s });
    props.place('hoarding-frame', { x, y, z, yaw, s });
    hoardings++;
  };
  const placeVergeBoard = (x: number, y: number, z: number, yaw: number, s: number): void => {
    props.place('verge-board-front', { x, y, z, yaw, s });
    props.place('verge-board-frame', { x, y, z, yaw, s });
    hoardings++;
  };

  // Main straight (both sides, skipping pit entry/exit openings) + braking zones & corner outsides.
  const hoardingRuns: { s0: number; s1: number; side: 0 | 1; step?: number }[] = [
    { s0: mainStartS, s1: mainEndS, side: otherSideIdx },
    { s0: wrapS(track.pit.entryS + 36), s1: mainEndS, side: pitSideIdx },
  ];
  // Add corner-outside and braking-approach hoarding runs automatically for every circuit corner.
  for (const c of track.corners) {
    const outSide: 0 | 1 = c.direction === 'right' ? 0 : 1;
    const inSide: 0 | 1 = outSide === 0 ? 1 : 0;
    hoardingRuns.push({
      s0: wrapS(c.start - 160),
      s1: wrapS(c.end + 60),
      side: outSide,
    });
    // Shorter inside-barrier boards at corner entry/exit for dense broadcast corridor framing.
    hoardingRuns.push({
      s0: wrapS(c.start - 70),
      s1: wrapS(c.end + 30),
      side: inSide,
      step: mobile ? 20 : 12.8,
    });
  }
  const usedHoard = new Set<string>();
  const hoardStep = mobile ? 14 : 6.4;
  for (const run of hoardingRuns) {
    const span = run.s1 >= run.s0 ? run.s1 - run.s0 : L - run.s0 + run.s1;
    for (let ds = 0; ds < span; ds += run.step ?? hoardStep) {
      const s = wrapS(run.s0 + ds);
      const key = `${run.side}:${Math.round(s / 6)}`;
      if (usedHoard.has(key)) continue;
      usedHoard.add(key);
      if (nearPitGap(s, run.side)) continue;
      const b = atBarrier(s, run.side, -0.18);
      placeHoarding(b.x, b.y, b.z, b.yawInward, b.s);
    }
  }
  // Neat rhythmic rows of angled advertising boards along grass verges (outside kerbs/run-off,
  // right inside the barrier corridor on straights and sweeping approaches).
  const vergeStep = mobile ? 18 : 7.5;
  for (let s = 20; s < L - 20; s += vergeStep) {
    for (const side of [0, 1] as const) {
      if (nearPitGap(s, side)) continue;
      const idxS = Math.min(track.lap.count - 1, Math.round(s / track.lap.step));
      // Only place verge boards where the outer strip is grass and the barrier sits well off the track.
      const outerSurf = track.outer[side][idxS] as number;
      if (outerSurf !== MeshSurface.Grass) continue;
      const barD = Math.abs(track.barrier[side][idxS] as number);
      const halfW = Math.abs(track.halfWidth[side][idxS] as number);
      if (barD - halfW < 4.8) continue;
      // Place cleanly on the grass verge, ~2.2 m inside the barrier (never encroaching on the track).
      const b = atBarrier(s, side, -2.1);
      // Skip if too close to the road edge.
      if (barD - 2.1 < halfW + 2.8) continue;
      placeVergeBoard(b.x, b.y, b.z, b.yawInward, b.s);
    }
  }
  // Grandstand front-wall brand banners (mounted cleanly along the concrete front wall of each stand).
  for (const st of stands) {
    const yawFront = Math.atan2(st.bz, -st.bx);
    for (let u = 3.5; u < st.length - 3.5; u += 6.4) {
      const x = st.ox + st.ax * u - st.bx * 0.14;
      const z = st.oz + st.az * u - st.bz * 0.14;
      placeHoarding(x, st.base + 0.3, z, yawFront, st.s);
    }
  }
  counts.hoardings = hoardings;

  // 3. Catch fencing along the pit wall, main straight, every grandstand, and corner spectator corridors.
  let fences = 0;
  const placeFence = (x: number, y: number, z: number, yaw: number, s: number): void => {
    props.place('catch-fence-post', { x, y, z, yaw, s });
    props.place('catch-fence-mesh', { x, y, z, yaw, s });
    fences++;
  };
  // Pit-wall catch fence.
  if (pitComplex) {
    for (const pt of pitComplex.pitWallLine) {
      const yaw = Math.atan2(-pt.nz, pt.nx);
      placeFence(pt.x, pt.y, pt.z, yaw, pt.s);
    }
  }
  // Circuit-agnostic spectator catch fencing: main straight both sides + every grandstand frontage + corner outsides.
  const fenceZones: { s0: number; s1: number; side: 0 | 1 }[] = [
    { s0: mainStartS, s1: mainEndS, side: otherSideIdx },
    { s0: wrapS(track.pit.exitS + 38), s1: mainEndS, side: pitSideIdx },
  ];
  for (const st of stands) {
    const cx = st.ox + st.ax * (st.length * 0.5) + st.bx * (st.depth * 0.5);
    const cz = st.oz + st.az * (st.length * 0.5) + st.bz * (st.depth * 0.5);
    track.lap.pointAt(st.s, 1, p);
    const dl = Math.hypot(cx - p.x, cz - p.z);
    track.lap.pointAt(st.s, -1, p);
    const dr = Math.hypot(cx - p.x, cz - p.z);
    const standSide: 0 | 1 = dl <= dr ? 0 : 1;
    fenceZones.push({
      s0: wrapS(st.s - st.length * 0.55 - 24),
      s1: wrapS(st.s + st.length * 0.55 + 24),
      side: standSide,
    });
  }
  for (const c of track.corners) {
    const outSide: 0 | 1 = c.direction === 'right' ? 0 : 1;
    fenceZones.push({
      s0: wrapS(c.start - 90),
      s1: wrapS(c.end + 50),
      side: outSide,
    });
  }
  const usedFence = new Set<string>();
  const fenceStep = mobile ? 8 : 4;
  for (const z of fenceZones) {
    const span = z.s1 >= z.s0 ? z.s1 - z.s0 : L - z.s0 + z.s1;
    for (let ds = 0; ds < span; ds += fenceStep) {
      const s = wrapS(z.s0 + ds);
      const key = `${z.side}:${Math.round(s / 4)}`;
      if (usedFence.has(key)) continue;
      usedFence.add(key);
      if (nearPitGap(s, z.side)) continue;
      const b = atBarrier(s, z.side, 0.25);
      placeFence(b.x, b.y, b.z, b.yawInward, b.s);
    }
  }
  counts.catchFences = fences;

  // 4. Braking boards (150, 100, 50 m) before every braking corner + DRS boards.
  let boards = 0;
  const placeSign = (id: string, x: number, y: number, z: number, yaw: number, s: number): void => {
    props.place(`${id}-face`, { x, y, z, yaw, s });
    props.place(`${id}-post`, { x, y, z, yaw, s });
    boards++;
  };
  // Identify primary braking zones (first corner of each chicane or distinct corner separated > 200 m).
  let lastBrakeS = -999;
  for (const c of track.corners) {
    // Skip long flat-out sweeps and second apex of a chicane.
    if (c.end - c.start > 450) continue;
    if (c.start - lastBrakeS < 220) continue;
    lastBrakeS = c.start;
    const outSide: 0 | 1 = c.direction === 'right' ? 0 : 1;
    for (const [dist, id] of [
      [150, 'board-150'],
      [100, 'board-100'],
      [50, 'board-50'],
    ] as const) {
      const b = atBarrier(c.start - dist, outSide, 0.9);
      // Angle slightly toward the centreline so drivers read it cleanly approaching at 300 km/h.
      const cant = outSide === 0 ? -0.22 : 0.22;
      placeSign(id, b.x, b.y, b.z, b.yawOncoming + cant, b.s);
    }
  }
  // DRS detection & activation boards on both sides of the circuit.
  for (const zone of track.drsZones) {
    for (const side of [0, 1] as const) {
      const act = atBarrier(zone.activation, side, 0.95);
      placeSign('board-drs', act.x, act.y, act.z, act.yawOncoming, act.s);
      const det = atBarrier(zone.detection, side, 0.95);
      placeSign('board-drs-det', det.x, det.y, det.z, det.yawOncoming, det.s);
    }
  }
  counts.signBoards = boards;

  // 5. Marshal posts + light panels around the lap (every ~320 m alternating sides + every corner).
  let marshals = 0;
  const marshalS: [number, 0 | 1][] = [];
  for (let s = 120; s < L - 80; s += 320) {
    marshalS.push([s, Math.floor(s / 320) % 2 === 0 ? 0 : 1]);
  }
  for (const c of track.corners) {
    const outSide: 0 | 1 = c.direction === 'right' ? 0 : 1;
    marshalS.push([c.s, outSide]);
  }
  const usedMarshal = new Set<number>();
  for (const [s, side] of marshalS) {
    const bucket = Math.round(wrapS(s) / 90);
    if (usedMarshal.has(bucket)) continue;
    usedMarshal.add(bucket);
    const b = atBarrier(s, side, 1.4);
    props.place('marshal-post', { x: b.x, y: b.y, z: b.z, yaw: b.yawInward, s: b.s });
    marshals++;
  }
  counts.marshalPosts = marshals;

  // 6. Tecpro blocks at tight corner/chicane run-off barriers.
  let tecpro = 0;
  for (const c of track.corners) {
    if (c.end - c.start > 350) continue;
    const outSide: 0 | 1 = c.direction === 'right' ? 0 : 1;
    for (let s = c.start - 12; s <= c.end + 16; s += 1.65) {
      const b = atBarrier(s, outSide, -0.45);
      props.place('tecpro-block', { x: b.x, y: b.y, z: b.z, yaw: b.yawInward, s: b.s });
      tecpro++;
    }
  }
  counts.tecproBlocks = tecpro;

  // 7. Big-screen towers, broadcast camera towers, and vertical skyline truss towers.
  let screens = 0;
  let cameras = 0;
  const authoredObjects = dressing.authored?.objects ?? [];
  const screenSpots: { s: number; side: 0 | 1; extra: number }[] = authoredObjects
    .filter((o) => o.kind === 'big-screen')
    .map((o) => ({
      s: o.s,
      side: (o.data?.side === 'right' ? 1 : 0) as 0 | 1,
      extra: Number(o.data?.offset ?? 10),
    }));
  if (screenSpots.length === 0) {
    // Fallback circuit-agnostic placement opposite start/finish and distinct corners.
    screenSpots.push({ s: wrapS(L - 180), side: pitSideIdx, extra: 12 });
    let lastScr = -999;
    for (const c of track.corners) {
      if (c.start - lastScr < 700) continue;
      lastScr = c.start;
      const outSide: 0 | 1 = c.direction === 'right' ? 0 : 1;
      screenSpots.push({ s: wrapS(c.s), side: outSide, extra: 9 });
    }
  }
  for (const sp of screenSpots) {
    const b = atBarrier(sp.s, sp.side, sp.extra);
    props.place('big-screen-frame', {
      x: b.x,
      y: heightAt(b.x, b.z),
      z: b.z,
      yaw: b.yawInward,
      s: b.s,
    });
    props.place('big-screen-led', {
      x: b.x,
      y: heightAt(b.x, b.z),
      z: b.z,
      yaw: b.yawInward,
      s: b.s,
    });
    screens++;
  }

  for (const c of track.corners) {
    if (hash01(c.number, 23) > 0.65 && c.number !== 1 && c.number !== 8) continue;
    const inSide: 0 | 1 = c.direction === 'right' ? 1 : 0;
    const b = atBarrier(c.s, inSide, 5.5);
    props.place('camera-tower', {
      x: b.x,
      y: heightAt(b.x, b.z),
      z: b.z,
      yaw: b.yawInward,
      s: b.s,
    });
    cameras++;
  }

  // Tall vertical steel lattice truss/lighting towers breaking the skyline along the main straight
  // and major braking zones (placed behind barriers/stands so they frame the corridor cleanly).
  const mainSpan = mainEndS >= mainStartS ? mainEndS - mainStartS : L - mainStartS + mainEndS;
  for (let ds = 40; ds < mainSpan; ds += 145) {
    const s = wrapS(mainStartS + ds);
    const b = atBarrier(s, otherSideIdx, 28);
    props.place('truss-tower', {
      x: b.x,
      y: heightAt(b.x, b.z),
      z: b.z,
      yaw: b.yawInward,
      s: b.s,
    });
    cameras++;
  }
  let lastTrussS = -999;
  for (const c of track.corners) {
    if (c.start - lastTrussS < 500) continue;
    lastTrussS = c.start;
    const outSide: 0 | 1 = c.direction === 'right' ? 0 : 1;
    const b = atBarrier(c.start - 40, outSide, 14);
    props.place('truss-tower', {
      x: b.x,
      y: heightAt(b.x, b.z),
      z: b.z,
      yaw: b.yawInward,
      s: b.s,
    });
    cameras++;
  }
  counts.bigScreens = screens;
  counts.cameraTowers = cameras;

  return counts;
}
