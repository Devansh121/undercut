import {
  BufferAttribute,
  BufferGeometry,
  MeshStandardMaterial,
  type WebGLProgramParametersWithUniforms,
} from 'three';
import { hash01, type MappedFeature } from './dressing';
import type { LapIndex } from './lap-index';

/** A grandstand fitted to a mapped footprint: an oriented rectangle facing the track. */
export interface StandFrame {
  id: string;
  /** Front-left corner on the ground (track side), m. */
  ox: number;
  oz: number;
  /** Unit vector along the front edge, and into the stand (away from the track). */
  ax: number;
  az: number;
  bx: number;
  bz: number;
  length: number;
  depth: number;
  base: number;
  rows: number;
  roof: boolean;
  /** Lap distance of the stand's middle, for chunking its crowd. */
  s: number;
  seat: [number, number, number];
}

/** Seating geometry constants, m. */
export const STAND = {
  frontWall: 1.5,
  rowDepth: 0.85,
  rowRise: 0.42,
  backWall: 2.2,
  maxRows: 30,
};

/** Seat colours of the stands (invented; muted commercial tones, linear RGB). */
const SEATS: [number, number, number][] = [
  [0.04, 0.09, 0.22],
  [0.18, 0.19, 0.21],
  [0.04, 0.11, 0.07],
  [0.24, 0.035, 0.03],
  [0.13, 0.14, 0.16],
];

/**
 * Fit a footprint: principal axis by the second moments of its points, the long side nearer the
 * centreline as the front, so the rows rise away from the track.
 */
export function fitStand(
  f: MappedFeature,
  lap: LapIndex,
  ground: (x: number, z: number) => number,
  n: number,
): StandFrame | null {
  const p = f.p;
  const m = p.length / 2;
  if (m < 3) return null;
  let cx = 0;
  let cz = 0;
  for (let i = 0; i < m; i++) {
    cx += p[2 * i] as number;
    cz += p[2 * i + 1] as number;
  }
  cx /= m;
  cz /= m;
  let sxx = 0;
  let szz = 0;
  let sxz = 0;
  for (let i = 0; i < m; i++) {
    const dx = (p[2 * i] as number) - cx;
    const dz = (p[2 * i + 1] as number) - cz;
    sxx += dx * dx;
    szz += dz * dz;
    sxz += dx * dz;
  }
  const ang = 0.5 * Math.atan2(2 * sxz, sxx - szz);
  let ax = Math.cos(ang);
  let az = Math.sin(ang);
  let lo = Infinity;
  let hi = -Infinity;
  let lo2 = Infinity;
  let hi2 = -Infinity;
  for (let i = 0; i < m; i++) {
    const dx = (p[2 * i] as number) - cx;
    const dz = (p[2 * i + 1] as number) - cz;
    const u = dx * ax + dz * az;
    const v = -dx * az + dz * ax;
    lo = Math.min(lo, u);
    hi = Math.max(hi, u);
    lo2 = Math.min(lo2, v);
    hi2 = Math.max(hi2, v);
  }
  const length = hi - lo;
  let depth = hi2 - lo2;
  if (length < 6 || depth < 3) return null;
  // Perpendicular b0 = (-az, ax). The frame must keep b = (-az, ax) for the faces to point out,
  // so when the front is on the +b0 side both axes flip.
  const b0x = -az;
  const b0z = ax;
  const midU = (lo + hi) / 2;
  const near = (v: number): number =>
    lap.nearest(cx + ax * midU + b0x * v, cz + az * midU + b0z * v).dist;
  let cornerX: number;
  let cornerZ: number;
  let bx = b0x;
  let bz = b0z;
  if (near(hi2) < near(lo2)) {
    cornerX = cx + ax * hi + b0x * hi2;
    cornerZ = cz + az * hi + b0z * hi2;
    ax = -ax;
    az = -az;
    bx = -bx;
    bz = -bz;
  } else {
    cornerX = cx + ax * lo + b0x * lo2;
    cornerZ = cz + az * lo + b0z * lo2;
  }
  depth = Math.min(depth, STAND.frontWall + STAND.maxRows * STAND.rowDepth + 1.5);
  const rows = Math.max(3, Math.min(STAND.maxRows, Math.floor((depth - 1.2) / STAND.rowDepth)));
  let base = Infinity;
  for (const [u, v] of [
    [0, 0],
    [length, 0],
    [0, depth],
    [length, depth],
  ] as const) {
    base = Math.min(base, ground(cornerX + ax * u + bx * v, cornerZ + az * u + bz * v));
  }
  const mid = lap.nearest(cornerX + ax * length * 0.5, cornerZ + az * length * 0.5);
  return {
    id: f.id,
    ox: cornerX,
    oz: cornerZ,
    ax,
    az,
    bx,
    bz,
    length,
    depth: rows * STAND.rowDepth + 1.2,
    base: base - 0.3,
    rows,
    roof: rows >= 10 || f.t?.['roof:shape'] !== undefined,
    s: mid.s,
    seat: SEATS[Math.floor(hash01(n, 5) * SEATS.length)] as [number, number, number],
  };
}

/** Geometry builder with vertex colours and world-space/local-UV weathering attributes. */
class Builder {
  pos: number[] = [];
  nor: number[] = [];
  col: number[] = [];
  uv: number[] = [];
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
    // a b c d counter-clockwise seen from the front.
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
  /** Axis box from a local frame: origin, unit axes a (length), b (depth), y up. */
  box(
    f: StandFrame,
    u0: number,
    u1: number,
    v0: number,
    v1: number,
    y0: number,
    y1: number,
    colour: readonly number[],
  ): void {
    const P = (u: number, v: number, y: number): number[] => [
      f.ox + f.ax * u + f.bx * v,
      f.base + y,
      f.oz + f.az * u + f.bz * v,
    ];
    // Front (v0), back (v1), left (u0), right (u1), top, all faces outward.
    this.quad(P(u1, v0, y0), P(u0, v0, y0), P(u0, v0, y1), P(u1, v0, y1), colour, [
      [u1, y0],
      [u0, y0],
      [u0, y1],
      [u1, y1],
    ]);
    this.quad(P(u0, v1, y0), P(u1, v1, y0), P(u1, v1, y1), P(u0, v1, y1), colour, [
      [u0, y0],
      [u1, y0],
      [u1, y1],
      [u0, y1],
    ]);
    this.quad(P(u0, v0, y0), P(u0, v1, y0), P(u0, v1, y1), P(u0, v0, y1), colour, [
      [v0, y0],
      [v1, y0],
      [v1, y1],
      [v0, y1],
    ]);
    this.quad(P(u1, v1, y0), P(u1, v0, y0), P(u1, v0, y1), P(u1, v1, y1), colour, [
      [v1, y0],
      [v0, y0],
      [v0, y1],
      [v1, y1],
    ]);
    this.quad(P(u0, v0, y1), P(u0, v1, y1), P(u1, v1, y1), P(u1, v0, y1), colour, [
      [u0, v0],
      [u0, v1],
      [u1, v1],
      [u1, v0],
    ]);
  }
  /** Sloped trapezoidal side wall following the seating rake from yFront at v0 to yBack at v1. */
  slopedWall(
    f: StandFrame,
    u0: number,
    u1: number,
    v0: number,
    v1: number,
    yFront: number,
    yBack: number,
    colour: readonly number[],
  ): void {
    const P = (u: number, v: number, y: number): number[] => [
      f.ox + f.ax * u + f.bx * v,
      f.base + y,
      f.oz + f.az * u + f.bz * v,
    ];
    // Left face (u0, outward -a).
    this.quad(P(u0, v0, 0), P(u0, v1, 0), P(u0, v1, yBack), P(u0, v0, yFront), colour, [
      [v0, 0],
      [v1, 0],
      [v1, yBack],
      [v0, yFront],
    ]);
    // Right face (u1, outward +a).
    this.quad(P(u1, v1, 0), P(u1, v0, 0), P(u1, v0, yFront), P(u1, v1, yBack), colour, [
      [v1, 0],
      [v0, 0],
      [v0, yFront],
      [v1, yBack],
    ]);
    // Front edge (v0).
    this.quad(P(u1, v0, 0), P(u0, v0, 0), P(u0, v0, yFront), P(u1, v0, yFront), colour, [
      [u1, 0],
      [u0, 0],
      [u0, yFront],
      [u1, yFront],
    ]);
    // Back edge (v1).
    this.quad(P(u0, v1, 0), P(u1, v1, 0), P(u1, v1, yBack), P(u0, v1, yBack), colour, [
      [u0, 0],
      [u1, 0],
      [u1, yBack],
      [u0, yBack],
    ]);
    // Sloped top coping cap.
    this.quad(P(u0, v0, yFront), P(u0, v1, yBack), P(u1, v1, yBack), P(u1, v0, yFront), colour, [
      [u0, v0],
      [u0, v1],
      [u1, v1],
      [u1, v0],
    ]);
  }
  build(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(this.pos), 3));
    g.setAttribute('normal', new BufferAttribute(new Float32Array(this.nor), 3));
    g.setAttribute('color', new BufferAttribute(new Float32Array(this.col), 3));
    g.setAttribute('uv', new BufferAttribute(new Float32Array(this.uv), 2));
    g.setIndex(new BufferAttribute(new Uint32Array(this.idx), 1));
    g.computeBoundingSphere();
    return g;
  }
}

// Weathered trackside albedos (linear RGB; ~0.42-0.50 sRGB, never blown-out bright white).
const CONCRETE = [0.18, 0.175, 0.168];
const CONCRETE_DARK = [0.13, 0.128, 0.124];
const STAIR = [0.23, 0.225, 0.215];
const STEEL = [0.1, 0.105, 0.115];
const RAIL = [0.16, 0.165, 0.175];
const ROOF = [0.22, 0.23, 0.24];
const FASCIA = [0.06, 0.065, 0.075];

/** Height of row r's tread above the stand's base, m. */
export function rowHeight(r: number): number {
  return STAND.frontWall + r * STAND.rowRise;
}

/**
 * Grandstand structures: weathered concrete front wall with dark front safety handrail, stepped
 * treads and seat risers, sloped trapezoidal side walls matching the seating rake (never giant
 * rectangular blocks), back wall, access stairs every 22 m, and cantilevered roof on structural
 * steel columns and ribs over larger stands.
 */
export function buildStands(frames: readonly StandFrame[]): BufferGeometry {
  const b = new Builder();
  for (const f of frames) {
    const L = f.length;
    const top = rowHeight(f.rows);
    const back = 0.3 + f.rows * STAND.rowDepth;

    // Front concrete retaining wall + darker plinth + top metal guardrail.
    b.box(f, 0, L, 0, 0.3, 0, STAND.frontWall, CONCRETE);
    b.box(f, 0, L, 0.08, 0.22, STAND.frontWall + 0.72, STAND.frontWall + 0.82, RAIL);
    for (let u = 0.2; u <= L - 0.1; u += 4) {
      b.box(f, u - 0.04, u + 0.04, 0.1, 0.2, STAND.frontWall, STAND.frontWall + 0.82, RAIL);
    }

    // Rows: tread (weathered concrete) and the seat band at its front edge.
    for (let r = 0; r < f.rows; r++) {
      const v0 = 0.3 + r * STAND.rowDepth;
      const v1 = v0 + STAND.rowDepth;
      const y = rowHeight(r);
      const stepTone = r % 2 === 0 ? CONCRETE : CONCRETE_DARK;
      b.box(f, 0, L, v0, v1, Math.max(0, y - STAND.rowRise - 0.1), y, stepTone);
      b.box(f, 0, L, v0 + 0.06, v0 + 0.48, y, y + 0.4, f.seat);
    }

    // Back wall + darker structural base + rear structural buttress pilasters & horizontal beam.
    b.box(f, 0, L, back, back + 0.35, 0, top + STAND.backWall, CONCRETE_DARK);
    b.box(f, 0, L, back + 0.35, back + 0.65, top * 0.48, top * 0.48 + 0.42, STEEL);
    b.box(
      f,
      0,
      L,
      back + 0.35,
      back + 0.65,
      top + STAND.backWall - 0.55,
      top + STAND.backWall,
      STEEL,
    );
    const backCols = Math.max(2, Math.round(L / 10));
    for (let k = 0; k <= backCols; k++) {
      const u = (k / backCols) * (L - 0.5) + 0.25;
      b.box(f, u - 0.24, u + 0.24, back + 0.35, back + 0.85, 0, top + STAND.backWall, CONCRETE);
    }

    // Sloped side walls following the rake (removes the giant rectangular side-cube silhouette).
    const yFrontSide = STAND.frontWall + 0.95;
    const yBackSide = top + Math.min(STAND.backWall, 1.4);
    b.slopedWall(f, -0.35, 0, 0, back + 0.35, yFrontSide, yBackSide, CONCRETE_DARK);
    b.slopedWall(f, L, L + 0.35, 0, back + 0.35, yFrontSide, yBackSide, CONCRETE_DARK);

    // Stairs: lighter concrete step band every 22 m.
    for (let u = 11; u < L - 6; u += 22) {
      for (let r = 0; r < f.rows; r++) {
        const v0 = 0.3 + r * STAND.rowDepth;
        b.box(
          f,
          u - 0.65,
          u + 0.65,
          v0,
          v0 + STAND.rowDepth,
          rowHeight(r) - 0.1,
          rowHeight(r) + 0.24,
          STAIR,
        );
      }
    }

    if (f.roof) {
      const ry = top + STAND.backWall + 2.4;
      const over = back * 0.18;
      const yf = ry - 0.7;
      const P = (u: number, v: number, y: number): number[] => [
        f.ox + f.ax * u + f.bx * v,
        f.base + y,
        f.oz + f.az * u + f.bz * v,
      ];
      // Back steel columns + cantilevered roof ribs every ~10 m.
      const bayCount = Math.max(1, Math.round((L - 1) / 10));
      const bayStep = (L - 1) / bayCount;
      for (let k = 0; k <= bayCount; k++) {
        const u = 0.5 + k * bayStep;
        b.box(f, u - 0.22, u + 0.22, back - 0.05, back + 0.4, 0, ry, STEEL);
        // Cantilever truss beam from back column toward front roof edge.
        b.quad(
          P(u - 0.14, over, yf - 0.45),
          P(u - 0.14, back + 0.3, ry - 0.85),
          P(u - 0.14, back + 0.3, ry - 0.06),
          P(u - 0.14, over, yf - 0.06),
          STEEL,
        );
        b.quad(
          P(u + 0.14, back + 0.3, ry - 0.85),
          P(u + 0.14, over, yf - 0.45),
          P(u + 0.14, over, yf - 0.06),
          P(u + 0.14, back + 0.3, ry - 0.06),
          STEEL,
        );
      }
      // Roof plate top, underside soffit, and crisp dark fascia band.
      b.quad(
        P(-0.5, over, yf),
        P(-0.5, back + 0.6, ry),
        P(L + 0.5, back + 0.6, ry),
        P(L + 0.5, over, yf),
        ROOF,
      );
      b.quad(
        P(L + 0.5, over, yf - 0.06),
        P(L + 0.5, back + 0.6, ry - 0.06),
        P(-0.5, back + 0.6, ry - 0.06),
        P(-0.5, over, yf - 0.06),
        STEEL,
      );
      b.quad(
        P(-0.5, over, yf - 0.85),
        P(L + 0.5, over, yf - 0.85),
        P(L + 0.5, over, yf),
        P(-0.5, over, yf),
        FASCIA,
      );
      // Back fascia edge.
      b.quad(
        P(L + 0.5, back + 0.6, ry - 0.6),
        P(-0.5, back + 0.6, ry - 0.6),
        P(-0.5, back + 0.6, ry),
        P(L + 0.5, back + 0.6, ry),
        FASCIA,
      );
    }
  }
  return b.build();
}

/**
 * Weathered concrete & painted steel grandstand material: subtle architectural expansion joints,
 * surface grain variation, and ground-level dirt darkening so large stand walls never look like
 * flat untextured polygons.
 */
export function grandstandMaterial(): MeshStandardMaterial {
  const m = new MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.88,
    metalness: 0.04,
  });
  m.name = 'grandstand';
  m.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vStandUv;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvStandUv = uv;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vStandUv;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        {
          // Subtle concrete form-tie panels (3.5 m × 1.8 m) and weathering noise.
          vec2 cell = vec2(vStandUv.x / 3.5, vStandUv.y / 1.8);
          vec2 f = fract(cell);
          float joint = (1.0 - smoothstep(0.0, 0.025, f.x)) + (1.0 - smoothstep(0.0, 0.025, f.y));
          float grain = fract(sin(dot(floor(vStandUv * 2.5), vec2(12.9898, 78.233))) * 43758.5453);
          float panel = fract(sin(dot(floor(cell), vec2(37.1, 17.3))) * 43758.5453);
          float grime = mix(0.76, 1.0, smoothstep(0.0, 1.2, vStandUv.y));
          diffuseColor.rgb *= grime * (0.93 + 0.1 * panel) * (0.95 + 0.08 * grain) * (1.0 - clamp(joint, 0.0, 1.0) * 0.14);
        }`,
      );
  };
  m.customProgramCacheKey = () => 'grandstand-v2';
  return m;
}

/** Seat positions for the crowd: per stand, per row, every 0.55 m, kept with probability `fill`. */
export function crowdSeats(
  frames: readonly StandFrame[],
  fill: (f: StandFrame, row: number) => number,
): { x: number; y: number; z: number; yaw: number; s: number; k: number }[] {
  const out: { x: number; y: number; z: number; yaw: number; s: number; k: number }[] = [];
  let k = 0;
  for (const f of frames) {
    // Facing the track: -b.
    const yaw = Math.atan2(f.bz, -f.bx);
    for (let r = 0; r < f.rows; r++) {
      const p = fill(f, r);
      const v = 0.3 + r * STAND.rowDepth + 0.38;
      const y = f.base + rowHeight(r) + 0.4;
      for (let u = 0.5; u < f.length - 0.4; u += 0.55) {
        k++;
        if (hash01(k, 77) > p) continue;
        // Leave stair aisles clear every 22 m!
        const modStair = (((u - 11) % 22) + 22) % 22;
        if (u > 9 && (modStair < 0.85 || modStair > 21.15)) continue;
        const uj = u + (hash01(k, 78) - 0.5) * 0.12;
        out.push({
          x: f.ox + f.ax * uj + f.bx * v,
          y,
          z: f.oz + f.az * uj + f.bz * v,
          yaw,
          s: f.s,
          k,
        });
      }
    }
  }
  return out;
}
