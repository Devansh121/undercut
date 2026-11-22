import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  MeshStandardMaterial,
  SRGBColorSpace,
  type WebGLProgramParametersWithUniforms,
} from 'three';
import { createVec3, type Track } from '@undercut/track';
import type { LapIndex } from './lap-index';

/** A team as the garages and pit wall show it: name, three-letter code, colours. */
export interface GarageTeam {
  name: string;
  code: string;
  primary: string;
  secondary: string;
}

/** Pit building dimensions, m. */
export const PIT_BUILDING = {
  /** Garage floor to ceiling, and the fascia band above it. */
  garageHeight: 4.2,
  fascia: 1.15,
  /** Upper floor (hospitality, glazed) and the roof edge. */
  upperHeight: 4.1,
  roofEdge: 0.75,
  depth: 26,
  /** Overhang canopy projecting over the garage aprons, m. */
  canopy: 2.2,
  /** Garage bay pitch along the building, m. */
  bay: 6.6,
};

export interface PitBayPlacement {
  x: number;
  y: number;
  z: number;
  /** Facing toward the pit lane (+X local points toward the lane). */
  yaw: number;
  /** World normal pointing toward the pit lane. */
  nx: number;
  nz: number;
  /** Pit-lane ground height at this bay. */
  groundY: number;
  s: number;
  width: number;
  teamIndex: number;
}

export interface PitWallSpot {
  x: number;
  y: number;
  z: number;
  /** Facing toward the racing track (+X local points toward the track). */
  yaw: number;
  /** World normal pointing toward the track. */
  nx: number;
  nz: number;
  /** Unit tangent along the pit lane. */
  tx: number;
  tz: number;
  s: number;
  teamIndex: number;
}

export interface PitBuildingChunk {
  geometry: BufferGeometry;
  centre: [number, number, number];
  radius: number;
}

export interface PitComplexData {
  geometry: BufferGeometry;
  chunks: PitBuildingChunk[];
  bays: PitBayPlacement[];
  pitWallSpots: PitWallSpot[];
  /** Track-side pit wall segment points for catch fencing and sponsor boards. */
  pitWallLine: {
    x: number;
    y: number;
    z: number;
    nx: number;
    nz: number;
    tx: number;
    tz: number;
    s: number;
  }[];
  /** Footprint as a flat ring [x, z, ...], buffered for excluding mapped buildings underneath. */
  footprint: number[];
}

/**
 * The pit complex, built from the track's pit-lane geometry (circuit-agnostic):
 * - Pit building along the garage-side wall: recessed open garages with lit ceilings and team back
 *   walls, concrete piers, cantilevered pit-apron canopy, dark fascia carrying team boards, glazed
 *   hospitality upper floor with mullions and balcony, roof parapet, and a race-control / podium
 *   balcony block near the start/finish line.
 * - Pit wall line and engineering canopy spots between the pit lane and the main straight.
 */
export function buildPitBuilding(track: Track, lap: LapIndex, teamCount = 10): PitComplexData {
  const pit = track.pit;
  const gs = pit.side === 'left' ? 1 : -1;
  const side = pit.side === 'left' ? 0 : 1;
  const trackSide = pit.side === 'left' ? 1 : 0;
  const [w0, w1] = pit.garageWall;
  const step = 2;
  const front: {
    x: number;
    y: number;
    z: number;
    ox: number;
    oz: number;
    tx: number;
    tz: number;
    u: number;
    sPit: number;
  }[] = [];
  const p = createVec3();
  const t = createVec3();
  let u = 0;
  let prev: { x: number; z: number } | null = null;
  for (let s = w0; s <= w1 + 1e-6; s += step) {
    const sc = Math.min(s, w1);
    const off = gs * (pit.halfWidth(sc, side as 0 | 1) + 0.5 + 0.35);
    pit.path.pointAt(sc, off, p);
    pit.path.tangent(sc, t);
    const tl = Math.hypot(t.x, t.z) || 1;
    const tx = t.x / tl;
    const tz = t.z / tl;
    // Outward: away from the pit lane, on the garage side (left normal is (tz, -tx) in x-z).
    const ox = tz * gs;
    const oz = -tx * gs;
    if (prev) u += Math.hypot(p.x - prev.x, p.z - prev.z);
    prev = { x: p.x, z: p.z };
    front.push({ x: p.x, y: track.groundHeightAt(p.x, p.z), z: p.z, ox, oz, tx, tz, u, sPit: sc });
  }

  const CHUNK_COUNT = 5;
  interface ChunkBuf {
    pos: number[];
    nor: number[];
    fac: number[];
    idx: number[];
  }
  const chunkBufs: ChunkBuf[] = Array.from({ length: CHUNK_COUNT }, () => ({
    pos: [],
    nor: [],
    fac: [],
    idx: [],
  }));
  let activeChunk = 0;
  const quad = (
    a: readonly number[],
    b: readonly number[],
    c: readonly number[],
    d: readonly number[],
    n: readonly number[],
    fa: readonly (readonly number[])[],
  ): void => {
    const cb = chunkBufs[activeChunk] as ChunkBuf;
    const base = cb.pos.length / 3;
    for (const [i, v] of [a, b, c, d].entries()) {
      cb.pos.push(v[0] as number, v[1] as number, v[2] as number);
      cb.nor.push(n[0] as number, n[1] as number, n[2] as number);
      cb.fac.push(
        (fa[i] as readonly number[])[0] as number,
        (fa[i] as readonly number[])[1] as number,
      );
    }
    cb.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };

  const B = PIT_BUILDING;
  const top = B.garageHeight + B.fascia + B.upperHeight + B.roofEdge;
  const floor = Math.min(...front.map((f) => f.y)) - 0.1;
  const plain: readonly (readonly number[])[] = [
    [-1, 0],
    [-1, 0],
    [-1, 0],
    [-1, 0],
  ];
  const roofFa: readonly (readonly number[])[] = [
    [-2, 0],
    [-2, 0],
    [-2, 0],
    [-2, 0],
  ];
  const canopyFa: readonly (readonly number[])[] = [
    [-3, 0],
    [-3, 0],
    [-3, 0],
    [-3, 0],
  ];
  const trimFa: readonly (readonly number[])[] = [
    [-4, 0],
    [-4, 0],
    [-4, 0],
    [-4, 0],
  ];

  // (B - A) x (0, 1, 0) = (-tz, 0, tx), which equals -ox when gs > 0 (left) and +ox when gs < 0 (right).
  const flip = gs > 0;
  for (let i = 0; i + 1 < front.length; i++) {
    activeChunk = Math.min(
      CHUNK_COUNT - 1,
      Math.floor((i * CHUNK_COUNT) / Math.max(1, front.length - 1)),
    );
    const a = front[i] as (typeof front)[number];
    const b = front[i + 1] as (typeof front)[number];
    const y0 = floor;
    const y1 = floor + top;
    const nx = -(a.ox + b.ox) / 2;
    const nz = -(a.oz + b.oz) / 2;
    const nl = Math.hypot(nx, nz) || 1;
    const fn = [nx / nl, 0, nz / nl];

    // Main front facade.
    const A0 = [a.x, y0, a.z];
    const B0 = [b.x, y0, b.z];
    const A1 = [a.x, y1, a.z];
    const B1 = [b.x, y1, b.z];
    const fa = [
      [a.u, 0],
      [b.u, 0],
      [b.u, top],
      [a.u, top],
    ];
    if (flip) quad(A0, B0, B1, A1, fn, fa);
    else quad(B0, A0, A1, B1, fn, [fa[1]!, fa[0]!, fa[3]!, fa[2]!]);

    // Cantilevered pit-apron canopy above the garage doors (gives real depth & shadow).
    const cy0 = floor + B.garageHeight - 0.15;
    const cy1 = floor + B.garageHeight + 0.25;
    const C = B.canopy;
    const Ac0 = [a.x - a.ox * C, cy0, a.z - a.oz * C];
    const Bc0 = [b.x - b.ox * C, cy0, b.z - b.oz * C];
    const Ac1 = [a.x - a.ox * C, cy1, a.z - a.oz * C];
    const Bc1 = [b.x - b.ox * C, cy1, b.z - b.oz * C];
    const Af0 = [a.x, cy0, a.z];
    const Bf0 = [b.x, cy0, b.z];
    const Af1 = [a.x, cy1, a.z];
    const Bf1 = [b.x, cy1, b.z];
    // Canopy front edge, top (+Y), underside soffit (-Y).
    if (flip) {
      quad(Ac0, Bc0, Bc1, Ac1, fn, trimFa);
      quad(Ac1, Bc1, Bf1, Af1, [0, 1, 0], canopyFa);
      quad(Af0, Bf0, Bc0, Ac0, [0, -1, 0], canopyFa);
    } else {
      quad(Bc0, Ac0, Ac1, Bc1, fn, trimFa);
      quad(Bc1, Ac1, Af1, Bf1, [0, 1, 0], canopyFa);
      quad(Bf0, Af0, Ac0, Bc0, [0, -1, 0], canopyFa);
    }

    // Upper-floor roof overhang lip (projects 1.1 m over the glazed hospitality floor).
    const ry0 = floor + top - B.roofEdge;
    const ry1 = floor + top;
    const R = 1.1;
    const Ar0 = [a.x - a.ox * R, ry0, a.z - a.oz * R];
    const Br0 = [b.x - b.ox * R, ry0, b.z - b.oz * R];
    const Ar1 = [a.x - a.ox * R, ry1, a.z - a.oz * R];
    const Br1 = [b.x - b.ox * R, ry1, b.z - b.oz * R];
    const Afr0 = [a.x, ry0, a.z];
    const Bfr0 = [b.x, ry0, b.z];
    const Afr1 = [a.x, ry1, a.z];
    const Bfr1 = [b.x, ry1, b.z];
    if (flip) {
      quad(Ar0, Br0, Br1, Ar1, fn, trimFa);
      quad(Ar1, Br1, Bfr1, Afr1, [0, 1, 0], roofFa);
      quad(Afr0, Bfr0, Br0, Ar0, [0, -1, 0], canopyFa);
    } else {
      quad(Br0, Ar0, Ar1, Br1, fn, trimFa);
      quad(Br1, Ar1, Afr1, Bfr1, [0, 1, 0], roofFa);
      quad(Bfr0, Afr0, Ar0, Br0, [0, -1, 0], canopyFa);
    }

    // Back wall and roof.
    const D = B.depth;
    const Ab0 = [a.x + a.ox * D, y0, a.z + a.oz * D];
    const Bb0 = [b.x + b.ox * D, y0, b.z + b.oz * D];
    const Ab1 = [a.x + a.ox * D, y1, a.z + a.oz * D];
    const Bb1 = [b.x + b.ox * D, y1, b.z + b.oz * D];
    if (flip) {
      quad(Bb0, Ab0, Ab1, Bb1, [-fn[0]!, 0, -fn[2]!], plain);
      quad(A1, B1, Bb1, Ab1, [0, 1, 0], roofFa);
    } else {
      quad(Ab0, Bb0, Bb1, Ab1, [-fn[0]!, 0, -fn[2]!], plain);
      quad(B1, A1, Ab1, Bb1, [0, 1, 0], roofFa);
    }
  }

  // End walls.
  for (const [k, f] of [
    [0, front[0]],
    [1, front[front.length - 1]],
  ] as const) {
    if (!f) continue;
    activeChunk = k === 0 ? 0 : CHUNK_COUNT - 1;
    const D = B.depth;
    const a0 = [f.x, floor, f.z];
    const a1 = [f.x, floor + top, f.z];
    const b0 = [f.x + f.ox * D, floor, f.z + f.oz * D];
    const b1 = [f.x + f.ox * D, floor + top, f.z + f.oz * D];
    const n = k === 0 ? [-f.tx, 0, -f.tz] : [f.tx, 0, f.tz];
    const e1 = [b0[0]! - a0[0]!, 0, b0[2]! - a0[2]!];
    const cy = e1[2]! * n[0]! - e1[0]! * n[2]!;
    if (cy > 0) quad(a0, b0, b1, a1, n, plain);
    else quad(b0, a0, a1, b1, n, plain);
  }

  // Race-control & timing penthouse block on the roof near the pit-lane midpoint (gives iconic
  // pit-complex skyline silhouette instead of a flat bar).
  const midIdx = Math.floor(front.length * 0.62);
  const rc0 = Math.max(0, midIdx - 14);
  const rc1 = Math.min(front.length - 1, midIdx + 14);
  if (rc1 > rc0 + 2) {
    const rcH = 3.8;
    const rcD = 11;
    const y0 = floor + top;
    const y1 = y0 + rcH;
    for (let i = rc0; i < rc1; i++) {
      activeChunk = Math.min(
        CHUNK_COUNT - 1,
        Math.floor((i * CHUNK_COUNT) / Math.max(1, front.length - 1)),
      );
      const a = front[i] as (typeof front)[number];
      const b = front[i + 1] as (typeof front)[number];
      const fn = [-(a.ox + b.ox) / 2, 0, -(a.oz + b.oz) / 2];
      const A0 = [a.x + a.ox * 1.5, y0, a.z + a.oz * 1.5];
      const B0 = [b.x + b.ox * 1.5, y0, b.z + b.oz * 1.5];
      const A1 = [a.x + a.ox * 1.5, y1, a.z + a.oz * 1.5];
      const B1 = [b.x + b.ox * 1.5, y1, b.z + b.oz * 1.5];
      const Ab0 = [a.x + a.ox * (1.5 + rcD), y0, a.z + a.oz * (1.5 + rcD)];
      const Bb0 = [b.x + b.ox * (1.5 + rcD), y0, b.z + b.oz * (1.5 + rcD)];
      const Ab1 = [a.x + a.ox * (1.5 + rcD), y1, a.z + a.oz * (1.5 + rcD)];
      const Bb1 = [b.x + b.ox * (1.5 + rcD), y1, b.z + b.oz * (1.5 + rcD)];
      // Reuse the upper-floor glazing band in facade.y.
      const vy0 = B.garageHeight + B.fascia;
      const vy1 = vy0 + B.upperHeight;
      const fa = [
        [a.u, vy0],
        [b.u, vy0],
        [b.u, vy1],
        [a.u, vy1],
      ];
      if (flip) {
        quad(A0, B0, B1, A1, fn, fa);
        quad(Bb0, Ab0, Ab1, Bb1, [-fn[0]!, 0, -fn[2]!], plain);
        quad(A1, B1, Bb1, Ab1, [0, 1, 0], roofFa);
      } else {
        quad(B0, A0, A1, B1, fn, [fa[1]!, fa[0]!, fa[3]!, fa[2]!]);
        quad(Ab0, Bb0, Bb1, Ab1, [-fn[0]!, 0, -fn[2]!], plain);
        quad(B1, A1, Ab1, Bb1, [0, 1, 0], roofFa);
      }
    }
    // Race-control end walls.
    for (const [k, f] of [
      [0, front[rc0]],
      [1, front[rc1]],
    ] as const) {
      if (!f) continue;
      activeChunk = Math.min(
        CHUNK_COUNT - 1,
        Math.floor(((k === 0 ? rc0 : rc1) * CHUNK_COUNT) / Math.max(1, front.length - 1)),
      );
      const a0 = [f.x + f.ox * 1.5, y0, f.z + f.oz * 1.5];
      const a1 = [f.x + f.ox * 1.5, y1, f.z + f.oz * 1.5];
      const b0 = [f.x + f.ox * (1.5 + rcD), y0, f.z + f.oz * (1.5 + rcD)];
      const b1 = [f.x + f.ox * (1.5 + rcD), y1, f.z + f.oz * (1.5 + rcD)];
      const n = k === 0 ? [-f.tx, 0, -f.tz] : [f.tx, 0, f.tz];
      const e1 = [b0[0]! - a0[0]!, 0, b0[2]! - a0[2]!];
      const cy = e1[2]! * n[0]! - e1[0]! * n[2]!;
      if (cy > 0) quad(a0, b0, b1, a1, n, plain);
      else quad(b0, a0, a1, b1, n, plain);
    }
  }

  // Buffered footprint (front -4 m to back +38 m) so mapped OSM slabs under the pit complex stay out.
  const footprint: number[] = [];
  if (front.length >= 2) {
    const padBack = B.depth + 26;
    const padFront = -4;
    for (const f of front) footprint.push(f.x + f.ox * padFront, f.z + f.oz * padFront);
    for (let i = front.length - 1; i >= 0; i--) {
      const f = front[i] as (typeof front)[number];
      footprint.push(f.x + f.ox * padBack, f.z + f.oz * padBack);
    }
  }

  // Board positions: one per bay along the fascia, facing the pit lane (exact interpolation).
  const bays: PitBayPlacement[] = [];
  const total = front[front.length - 1]?.u ?? 0;
  const bayCount = Math.floor(total / B.bay);
  const teamsN = Math.max(1, teamCount);
  for (let k = 0; k < bayCount; k++) {
    const uc = (k + 0.5) * B.bay;
    let i = 0;
    while (i + 1 < front.length && (front[i + 1] as (typeof front)[number]).u < uc) i++;
    const a = front[i] as (typeof front)[number];
    const b = front[Math.min(front.length - 1, i + 1)] as (typeof front)[number];
    const span = Math.max(1e-6, b.u - a.u);
    const frac = Math.min(1, Math.max(0, (uc - a.u) / span));
    const px = a.x + (b.x - a.x) * frac;
    const pz = a.z + (b.z - a.z) * frac;
    const py = a.y + (b.y - a.y) * frac;
    const ox = a.ox + (b.ox - a.ox) * frac;
    const oz = a.oz + (b.oz - a.oz) * frac;
    const ol = Math.hypot(ox, oz) || 1;
    const nx = -ox / ol;
    const nz = -oz / ol;
    const hit = lap.nearest(px, pz);
    bays.push({
      // Mounted on the front of the fascia (slightly proud of the wall, below the upper floor).
      x: px + nx * 0.08,
      y: floor + B.garageHeight + B.fascia * 0.52,
      z: pz + nz * 0.08,
      yaw: Math.atan2(-nz, nx),
      nx,
      nz,
      groundY: py,
      s: hit.s,
      width: B.bay - 0.5,
      teamIndex: Math.floor(k / 2) % teamsN,
    });
  }

  // Pit wall line along the track-side edge of the pit lane (between pit lane and main straight).
  const pitWallLine: PitComplexData['pitWallLine'] = [];
  const wallStart = Math.max(pit.limitStart + 10, w0 + 15);
  const wallEnd = Math.min(pit.limitEnd - 10, w1 - 15);
  for (let sp = wallStart; sp <= wallEnd + 1e-6; sp += 4) {
    const sc = Math.min(sp, wallEnd);
    const off = -gs * (pit.halfWidth(sc, trackSide as 0 | 1) + 0.55);
    pit.path.pointAt(sc, off, p);
    pit.path.tangent(sc, t);
    const tl = Math.hypot(t.x, t.z) || 1;
    const tx = t.x / tl;
    const tz = t.z / tl;
    // Normal pointing toward the main racing track (left normal (tz, -tx) * -gs).
    const nx = tz * -gs;
    const nz = -tx * -gs;
    const hit = lap.nearest(p.x, p.z);
    pitWallLine.push({
      x: p.x,
      y: track.groundHeightAt(p.x, p.z),
      z: p.z,
      nx,
      nz,
      tx,
      tz,
      s: hit.s,
    });
  }

  // Pit-wall engineering canopies aligned with the pit boxes (one per team).
  const pitWallSpots: PitWallSpot[] = [];
  pit.boxes.forEach((box, idxBox) => {
    const sc = box.s;
    const off = -gs * (pit.halfWidth(sc, trackSide as 0 | 1) + 1.15);
    pit.path.pointAt(sc, off, p);
    pit.path.tangent(sc, t);
    const tl = Math.hypot(t.x, t.z) || 1;
    const tx = t.x / tl;
    const tz = t.z / tl;
    // Normal pointing toward the racing track (+X front).
    const nx = tz * -gs;
    const nz = -tx * -gs;
    const hit = lap.nearest(p.x, p.z);
    pitWallSpots.push({
      x: p.x,
      y: track.groundHeightAt(p.x, p.z),
      z: p.z,
      yaw: Math.atan2(-nz, nx),
      nx,
      nz,
      tx,
      tz,
      s: hit.s,
      teamIndex: idxBox % teamsN,
    });
  });

  const chunks: PitBuildingChunk[] = [];
  for (const cb of chunkBufs) {
    if (cb.pos.length === 0) continue;
    const cg = new BufferGeometry();
    cg.setAttribute('position', new BufferAttribute(new Float32Array(cb.pos), 3));
    cg.setAttribute('normal', new BufferAttribute(new Float32Array(cb.nor), 3));
    cg.setAttribute('facade', new BufferAttribute(new Float32Array(cb.fac), 2));
    cg.setIndex(cb.idx.length > 65535 ? new BufferAttribute(new Uint32Array(cb.idx), 1) : cb.idx);
    cg.computeBoundingSphere();
    const bs = cg.boundingSphere;
    chunks.push({
      geometry: cg,
      centre: bs ? [bs.center.x, bs.center.y, bs.center.z] : [0, 0, 0],
      radius: bs ? bs.radius : 1,
    });
  }
  const g = chunks[0]?.geometry ?? new BufferGeometry();
  return { geometry: g, chunks, bays, pitWallSpots, pitWallLine, footprint };
}

/**
 * Pit building facade shader: open garages (dark recessed interiors, lit ceiling strip, team
 * colour on the back wall), concrete piers, dark charcoal fascia, reflective glazed hospitality
 * floor with mullions and subtle interior depth, weathered architectural parapet.
 */
export function pitFacadeMaterial(teamColours: readonly string[]): MeshStandardMaterial {
  const cols = teamColours.length > 0 ? teamColours : ['#2a2d33'];
  const palette = cols.map((c) => new Color(c));
  const m = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.84, metalness: 0.04 });
  m.name = 'pit-building';
  const B = PIT_BUILDING;
  m.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    shader.uniforms.uTeams = { value: palette };
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute vec2 facade;\nvarying vec2 vFacade;',
      )
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFacade = facade;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec2 vFacade;
        uniform vec3 uTeams[${palette.length}];
        float pitGlass;
        float pitMetal;
        float pitGlow;`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        pitGlass = 0.0;
        pitMetal = 0.0;
        pitGlow = 0.0;
        vec3 concrete = vec3(0.21, 0.21, 0.205);
        if (vFacade.x < -3.5) {
          // Canopy and parapet architectural silver-charcoal trim.
          diffuseColor.rgb = vec3(0.16, 0.17, 0.185);
          pitMetal = 0.6;
        } else if (vFacade.x < -2.5) {
          // Canopy soffit.
          diffuseColor.rgb = vec3(0.22, 0.225, 0.23);
          pitMetal = 0.35;
        } else if (vFacade.x < -1.5) {
          // Ribbed standing-seam architectural roof membrane (subtle strips visible from heli view).
          float seam = 0.92 + 0.08 * step(0.88, fract(vFacade.y * 0.45));
          diffuseColor.rgb = vec3(0.21, 0.215, 0.22) * seam;
        } else if (vFacade.x < -0.5) {
          // Back and end concrete walls.
          diffuseColor.rgb = concrete * 0.9;
        } else {
          float u = vFacade.x;
          float v = vFacade.y;
          float bayF = u / ${B.bay.toFixed(2)};
          float f = fract(bayF);
          int bay = int(floor(bayF));
          int ti = (bay / 2) - ((bay / 2) / ${palette.length}) * ${palette.length};
          vec3 team = uTeams[ti];
          // Subtle architectural concrete panel seam.
          float panelShade = 0.94 + 0.06 * sin(floor(u / 3.3) * 1.7);
          vec3 c = concrete * panelShade;
          if (v < ${(B.garageHeight - 0.42).toFixed(2)}) {
            float open = step(0.08, f) * step(f, 0.92);
            // Recessed garage interior: painted epoxy floor, team colour back wall band,
            // bright linear workshop LED strips near the ceiling.
            float hFrac = v / ${(B.garageHeight - 0.42).toFixed(2)};
            float stripe = smoothstep(0.30, 0.35, hFrac) * (1.0 - smoothstep(0.68, 0.72, hFrac));
            vec3 inside = mix(vec3(0.055, 0.058, 0.064), team * 0.48, stripe * 0.9) * (0.65 + 0.55 * hFrac);
            float strip = smoothstep(0.20, 0.0, abs(v - ${(B.garageHeight - 0.65).toFixed(2)})) * step(0.14, f) * step(f, 0.86);
            // Work-bench / tyre-rack silhouette low on the back wall.
            float bench = (1.0 - smoothstep(0.18, 0.24, hFrac)) * step(0.18, f) * step(f, 0.82);
            inside = mix(inside, vec3(0.09, 0.095, 0.105), bench * 0.65);
            pitGlow = open * strip;
            c = mix(c * (0.82 + 0.18 * smoothstep(0.0, 1.0, v)), inside, open);
          } else if (v < ${B.garageHeight.toFixed(2)}) {
            c = vec3(0.28, 0.29, 0.305);
            pitMetal = 0.45;
          } else if (v < ${(B.garageHeight + B.fascia).toFixed(2)}) {
            c = vec3(0.032, 0.035, 0.042);
            pitMetal = 0.25;
          } else if (v < ${(B.garageHeight + B.fascia + B.upperHeight).toFixed(2)}) {
            float uvY = (v - ${(B.garageHeight + B.fascia).toFixed(2)}) / ${B.upperHeight.toFixed(2)};
            float mull = fract(u / 1.65);
            float frame = step(mull, 0.07) + step(0.92, uvY) + step(uvY, 0.14) + step(abs(uvY - 0.42), 0.025);
            frame = clamp(frame, 0.0, 1.0);
            // Warm interior ceiling hint inside upper hospitality lounges.
            float lounge = step(0.45, fract(sin(floor(u / 6.6) * 41.3) * 4375.5));
            vec3 glass = mix(vec3(0.028, 0.038, 0.052), vec3(0.09, 0.082, 0.068), lounge * smoothstep(0.45, 0.9, uvY));
            c = mix(glass, vec3(0.24, 0.25, 0.27), frame);
            pitGlass = 1.0 - frame;
            pitMetal = frame * 0.55;
          } else {
            // Crisp architectural light-aluminium roof parapet fascia.
            c = vec3(0.46, 0.47, 0.485);
            pitMetal = 0.35;
          }
          diffuseColor.rgb = c;
        }`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.42, pitMetal);
        roughnessFactor = mix(roughnessFactor, 0.06, pitGlass);`,
      )
      .replace(
        '#include <metalnessmap_fragment>',
        `#include <metalnessmap_fragment>
        metalnessFactor = mix(metalnessFactor, 0.55, pitMetal);
        metalnessFactor = mix(metalnessFactor, 0.1, pitGlass);`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vec3(1.0, 0.96, 0.88) * pitGlow * 3.8;',
      );
  };
  m.customProgramCacheKey = () => `pit-building-v3-${palette.length}`;
  return m;
}

/**
 * Garage boards: one canvas per team (name over a colour band, code at the right), applied to a
 * plane per bay.
 */
export function garageBoardTexture(team: GarageTeam): CanvasTexture {
  const w = 512;
  const h = 96;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d') as CanvasRenderingContext2D;
  ctx.fillStyle = '#0d0f13';
  ctx.fillRect(0, 0, w, h);
  // Subtle frame.
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, w - 2, h - 2);
  // Team colour band.
  ctx.fillStyle = team.primary;
  ctx.fillRect(0, h - 16, w, 16);
  ctx.fillStyle = team.secondary;
  ctx.fillRect(0, h - 20, w, 4);
  ctx.fillStyle = '#f0efe9';
  ctx.font = '600 42px "Barlow Semi Condensed", Archivo, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillText(team.name.toUpperCase(), 22, (h - 20) / 2 + 2, w - 140);
  ctx.font = '700 38px "Barlow Semi Condensed", Archivo, sans-serif';
  ctx.fillStyle = team.primary;
  const code = team.code;
  ctx.fillText(code, w - 22 - ctx.measureText(code).width, (h - 20) / 2 + 2);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/**
 * Modular pit-wall timing gantry / engineering canopy stand-in (origin on ground at centre, +Y up,
 * +X facing the track, 4.6 m wide along Z, 1.8 m deep along X, 3.0 m tall). Matches the
 * `m2/3d-models` prop pivot contract so the catalogue GLB swaps in cleanly.
 */
export function pitWallCanopyGeometry(): BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const box = (
    x0: number,
    x1: number,
    y0: number,
    y1: number,
    z0: number,
    z1: number,
    c: readonly number[],
  ): void => {
    const faces: [number[], number[][]][] = [
      [
        [1, 0, 0],
        [
          [x1, y0, z1],
          [x1, y0, z0],
          [x1, y1, z0],
          [x1, y1, z1],
        ],
      ],
      [
        [-1, 0, 0],
        [
          [x0, y0, z0],
          [x0, y0, z1],
          [x0, y1, z1],
          [x0, y1, z0],
        ],
      ],
      [
        [0, 0, 1],
        [
          [x0, y0, z1],
          [x1, y0, z1],
          [x1, y1, z1],
          [x0, y1, z1],
        ],
      ],
      [
        [0, 0, -1],
        [
          [x1, y0, z0],
          [x0, y0, z0],
          [x0, y1, z0],
          [x1, y1, z0],
        ],
      ],
      [
        [0, 1, 0],
        [
          [x0, y1, z1],
          [x1, y1, z1],
          [x1, y1, z0],
          [x0, y1, z0],
        ],
      ],
      [
        [0, -1, 0],
        [
          [x0, y0, z0],
          [x1, y0, z0],
          [x1, y0, z1],
          [x0, y0, z1],
        ],
      ],
    ];
    for (const [n, vs] of faces) {
      const b = pos.length / 3;
      for (const v of vs) {
        pos.push(v[0]!, v[1]!, v[2]!);
        nor.push(n[0]!, n[1]!, n[2]!);
        col.push(c[0]!, c[1]!, c[2]!);
      }
      idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    }
  };
  const frame = [0.09, 0.095, 0.11];
  const desk = [0.13, 0.135, 0.15];
  const roof = [0.15, 0.155, 0.17];
  const teamBand = [1, 1, 1]; // tinted by instance colour
  const monitorHousing = [0.05, 0.055, 0.065];
  const screenGlow = [0.14, 0.56, 0.78];

  // Floor platform + back desk console (facing +X toward track).
  box(-0.9, 0.85, 0.0, 0.22, -2.3, 2.3, frame);
  box(0.25, 0.82, 0.22, 1.05, -2.2, 2.2, desk);
  // Team-coloured fascia bands on BOTH track-facing (+X) and pit-lane-facing (-X) edges.
  box(0.82, 0.88, 0.28, 0.96, -2.22, 2.22, teamBand);
  box(0.84, 0.92, 2.72, 3.04, -2.35, 2.35, teamBand);
  box(-0.98, -0.9, 2.72, 3.04, -2.35, 2.35, teamBand);
  // 4 timing monitor banks on the desk with cyan-teal telemetry screen faces toward engineers (-X).
  for (let k = 0; k < 4; k++) {
    const zc = -1.5 + k * 1.0;
    box(0.45, 0.65, 1.08, 1.52, zc - 0.38, zc + 0.38, monitorHousing);
    box(0.41, 0.45, 1.13, 1.47, zc - 0.33, zc + 0.33, screenGlow);
  }
  // 4 corner steel uprights + cantilevered roof canopy.
  for (const sx of [-0.82, 0.72]) {
    for (const sz of [-2.22, 2.22]) {
      box(sx - 0.05, sx + 0.05, 0.22, 2.8, sz - 0.05, sz + 0.05, frame);
    }
  }
  box(-0.92, 0.88, 2.75, 2.95, -2.35, 2.35, roof);

  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array(nor), 3));
  g.setAttribute('color', new BufferAttribute(new Float32Array(col), 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

/**
 * Low-poly pit crew figure (standing mechanic or seated pit-wall engineer): origin on ground at
 * centre, +Y up, +X front, metres. Overall/shirt marked white so per-instance team colour tints
 * the kit; helmet/headset and boots stay neutral dark. Matches `m2/3d-models` pivot contract.
 */
export function pitCrewGeometry(role: 'mechanic' | 'engineer'): BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const box = (
    x0: number,
    x1: number,
    y0: number,
    y1: number,
    z0: number,
    z1: number,
    c: readonly number[],
  ): void => {
    const faces: [number[], number[][]][] = [
      [
        [1, 0, 0],
        [
          [x1, y0, z1],
          [x1, y0, z0],
          [x1, y1, z0],
          [x1, y1, z1],
        ],
      ],
      [
        [-1, 0, 0],
        [
          [x0, y0, z0],
          [x0, y0, z1],
          [x0, y1, z1],
          [x0, y1, z0],
        ],
      ],
      [
        [0, 0, 1],
        [
          [x0, y0, z1],
          [x1, y0, z1],
          [x1, y1, z1],
          [x0, y1, z1],
        ],
      ],
      [
        [0, 0, -1],
        [
          [x1, y0, z0],
          [x0, y0, z0],
          [x0, y1, z0],
          [x1, y1, z0],
        ],
      ],
      [
        [0, 1, 0],
        [
          [x0, y1, z1],
          [x1, y1, z1],
          [x1, y1, z0],
          [x0, y1, z0],
        ],
      ],
    ];
    for (const [n, vs] of faces) {
      const b = pos.length / 3;
      for (const v of vs) {
        pos.push(v[0]!, v[1]!, v[2]!);
        nor.push(n[0]!, n[1]!, n[2]!);
        col.push(c[0]!, c[1]!, c[2]!);
      }
      idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    }
  };
  const suit = [1, 1, 1]; // tinted by team colour via instanceColor
  const dark = [0.05, 0.055, 0.065];
  const helmet = [0.12, 0.125, 0.14];
  const skin = [0.55, 0.36, 0.25];

  if (role === 'mechanic') {
    // Standing mechanic in fireproof overalls + full-face pit helmet (~1.76 m tall).
    box(-0.1, 0.1, 0.0, 0.12, -0.17, -0.03, dark); // left boot
    box(-0.1, 0.1, 0.0, 0.12, 0.03, 0.17, dark); // right boot
    box(-0.11, 0.11, 0.12, 0.88, -0.18, -0.02, suit); // left leg
    box(-0.11, 0.11, 0.12, 0.88, 0.02, 0.18, suit); // right leg
    box(-0.14, 0.14, 0.88, 1.46, -0.22, 0.22, suit); // torso
    box(-0.08, 0.1, 0.92, 1.42, -0.31, -0.22, suit); // left arm
    box(-0.08, 0.1, 0.92, 1.42, 0.22, 0.31, suit); // right arm
    box(-0.12, 0.14, 1.48, 1.76, -0.12, 0.12, helmet); // pit helmet
    box(0.12, 0.15, 1.56, 1.68, -0.09, 0.09, dark); // visor
  } else {
    // Seated pit-wall engineer in team shirt + headset, seated at y=0.55 m.
    box(-0.12, 0.28, 0.45, 0.62, -0.18, 0.18, dark); // thighs
    box(0.18, 0.32, 0.0, 0.48, -0.17, 0.17, dark); // shins
    box(-0.18, 0.1, 0.62, 1.18, -0.21, 0.21, suit); // team shirt torso
    box(0.04, 0.34, 0.86, 1.0, -0.24, -0.14, suit); // arms toward console
    box(0.04, 0.34, 0.86, 1.0, 0.14, 0.24, suit);
    box(-0.14, 0.08, 1.2, 1.44, -0.1, 0.1, skin); // head
    box(-0.11, 0.04, 1.26, 1.46, -0.14, 0.14, dark); // radio headset
  }

  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array(nor), 3));
  g.setAttribute('color', new BufferAttribute(new Float32Array(col), 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

/** Shared material for instanced team-tinted pit structures and pit crew (white vertices take instanceColor). */
export function teamTintedMaterial(
  name: string,
  roughness = 0.72,
  metalness = 0.08,
): MeshStandardMaterial {
  const m = new MeshStandardMaterial({ vertexColors: true, roughness, metalness });
  m.name = name;
  m.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    shader.vertexShader = shader.vertexShader.replace(
      '#include <color_vertex>',
      `#include <color_vertex>
      #if defined( USE_COLOR ) && defined( USE_INSTANCING_COLOR )
        vColor.xyz = (color.r > 0.98 && color.g > 0.98 && color.b > 0.98) ? instanceColor.xyz : color.xyz;
      #endif`,
    );
  };
  m.customProgramCacheKey = () => `team-tinted-${name}`;
  return m;
}

/**
 * Consolidated atlas containing every team's garage fascia board in one texture (2 columns ×
 * ceil(N/2) rows), replacing N separate textures and draw calls with a single draw call.
 */
export function garageBoardAtlas(teams: readonly GarageTeam[], anisotropy = 8): CanvasTexture {
  const cols = 2;
  const rows = Math.max(1, Math.ceil(teams.length / cols));
  const tileW = 512;
  const tileH = 96;
  const c = document.createElement('canvas');
  c.width = cols * tileW;
  c.height = rows * tileH;
  const ctx = c.getContext('2d') as CanvasRenderingContext2D;
  ctx.fillStyle = '#0d0f13';
  ctx.fillRect(0, 0, c.width, c.height);
  teams.forEach((team, ti) => {
    const col = ti % cols;
    const row = Math.floor(ti / cols);
    const ox = col * tileW;
    const oy = row * tileH;
    ctx.fillStyle = '#0d0f13';
    ctx.fillRect(ox, oy, tileW, tileH);
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 2;
    ctx.strokeRect(ox + 1, oy + 1, tileW - 2, tileH - 2);
    ctx.fillStyle = team.primary;
    ctx.fillRect(ox, oy + tileH - 16, tileW, 16);
    ctx.fillStyle = team.secondary;
    ctx.fillRect(ox, oy + tileH - 20, tileW, 4);
    ctx.fillStyle = '#f0efe9';
    ctx.font = '600 42px "Barlow Semi Condensed", Archivo, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText(team.name.toUpperCase(), ox + 22, oy + (tileH - 20) / 2 + 2, tileW - 140);
    ctx.font = '700 38px "Barlow Semi Condensed", Archivo, sans-serif';
    ctx.fillStyle = team.primary;
    const code = team.code;
    ctx.fillText(code, ox + tileW - 22 - ctx.measureText(code).width, oy + (tileH - 20) / 2 + 2);
  });
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = anisotropy;
  return t;
}

/**
 * Single merged BufferGeometry for all garage fascia boards mapped into `garageBoardAtlas`.
 */
export function buildGarageBoardsGeometry(
  bays: readonly PitBayPlacement[],
  teamCount: number,
): BufferGeometry {
  const cols = 2;
  const rows = Math.max(1, Math.ceil(Math.max(1, teamCount) / cols));
  const hw = (PIT_BUILDING.bay - 0.6) * 0.5;
  const hh = (PIT_BUILDING.fascia - 0.25) * 0.5;
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];

  for (const bay of bays) {
    const ti = bay.teamIndex % Math.max(1, teamCount);
    const col = ti % cols;
    const row = Math.floor(ti / cols);
    const u0 = col / cols;
    const u1 = (col + 1) / cols;
    const v1 = 1 - row / rows;
    const v0 = 1 - (row + 1) / rows;
    const tx = bay.nz;
    const tz = -bay.nx;
    const b = pos.length / 3;
    pos.push(
      bay.x - tx * hw,
      bay.y - hh,
      bay.z - tz * hw,
      bay.x + tx * hw,
      bay.y - hh,
      bay.z + tz * hw,
      bay.x + tx * hw,
      bay.y + hh,
      bay.z + tz * hw,
      bay.x - tx * hw,
      bay.y + hh,
      bay.z - tz * hw,
    );
    for (let k = 0; k < 4; k++) nor.push(bay.nx, 0, bay.nz);
    uv.push(u0, v0, u1, v0, u1, v1, u0, v1);
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array(nor), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}
