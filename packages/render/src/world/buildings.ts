import {
  BufferAttribute,
  BufferGeometry,
  MeshStandardMaterial,
  ShapeUtils,
  Vector2,
  type WebGLProgramParametersWithUniforms,
} from 'three';
import { hash01, ringArea, type MappedFeature } from './dressing';
import { DEFAULT_THEME, type BuildingPalette } from './theme';

export interface BuildingStyle {
  /** Default height when the map gives none, by footprint area. */
  heightFor: (area: number, tags: Record<string, string>) => number;
}

const LEVEL = 3.2;

export function buildingHeight(area: number, tags: Record<string, string> = {}): number {
  const h = parseFloat(tags.height ?? '');
  if (Number.isFinite(h) && h > 1) return h;
  const lv = parseFloat(tags['building:levels'] ?? tags.levels ?? '');
  if (Number.isFinite(lv) && lv > 0) return lv * LEVEL + 1;
  const kind = tags.building ?? 'yes';
  if (kind === 'roof' || kind === 'carport') return 4;
  if (kind === 'garage' || kind === 'garages' || kind === 'shed' || kind === 'hut') return 3;
  if (area < 40) return 3.2;
  if (area < 250) return 7;
  if (area < 1500) return 10;
  return 8.5;
}

function hexRgb(hex: string): [number, number, number] {
  const v = parseInt(hex.slice(1), 16);
  // sRGB to linear (vertex colours are linear).
  const f = (c: number): number => Math.pow(c / 255, 2.2);
  return [f((v >> 16) & 255), f((v >> 8) & 255), f(v & 255)];
}

/** A closed ring without its duplicate end point, counter-clockwise seen from above (+y). */
function ring(p: readonly number[]): number[] {
  let r = p.slice();
  const n = r.length;
  if (n >= 4 && r[0] === r[n - 2] && r[1] === r[n - 1]) r = r.slice(0, n - 2);
  // In x-z with z south, a positive shoelace area is clockwise seen from above; flip it.
  if (ringArea(r) > 0) {
    const out: number[] = [];
    for (let i = r.length - 2; i >= 0; i -= 2) out.push(r[i] as number, r[i + 1] as number);
    r = out;
  }
  return r;
}

/**
 * Every mapped building around the circuit as one merged mesh: footprints extruded from the
 * ground (sunk below its lowest corner) to a height from the map's tags or the footprint size,
 * walls in the region's colours (the circuit's theme) with window bands in the shader, flat roofs in
 * tile or grey. uv: walls (metres along the wall, metres above the base), roofs (-1, -1).
 */
export function buildBuildings(
  features: readonly MappedFeature[],
  heightAt: (x: number, z: number) => number,
  skip: (f: MappedFeature) => boolean = () => false,
  palette: BuildingPalette = DEFAULT_THEME.buildings,
): { geometry: BufferGeometry; count: number } {
  const { walls, roofs } = palette;
  const pos: number[] = [];
  const nor: number[] = [];
  const col: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  let count = 0;
  for (const [n, f] of features.entries()) {
    if (skip(f)) continue;
    const r = ring(f.p);
    const m = r.length / 2;
    if (m < 3) continue;
    const area = Math.abs(ringArea(r));
    if (area < 8) continue;
    let gmin = Infinity;
    let gmax = -Infinity;
    for (let i = 0; i < m; i++) {
      const g = heightAt(r[2 * i] as number, r[2 * i + 1] as number);
      gmin = Math.min(gmin, g);
      gmax = Math.max(gmax, g);
    }
    const base = gmin - 0.4;
    const top = gmax + buildingHeight(area, f.t);
    const wall = hexRgb(walls[Math.floor(hash01(n, 1) * walls.length)] as string);
    const roof = hexRgb(roofs[Math.floor(hash01(n, 2) * roofs.length)] as string);
    const shadeK = 0.85 + hash01(n, 3) * 0.25;
    // Walls.
    let along = 0;
    for (let i = 0; i < m; i++) {
      const j = (i + 1) % m;
      const x0 = r[2 * i] as number;
      const z0 = r[2 * i + 1] as number;
      const x1 = r[2 * j] as number;
      const z1 = r[2 * j + 1] as number;
      const len = Math.hypot(x1 - x0, z1 - z0);
      if (len < 1e-3) continue;
      // Counter-clockwise from above: outward normal is the edge direction turned right.
      const nx = (z1 - z0) / len;
      const nz = -(x1 - x0) / len;
      const b = pos.length / 3;
      pos.push(x0, base, z0, x1, base, z1, x1, top, z1, x0, top, z0);
      for (let k = 0; k < 4; k++) {
        nor.push(-nx, 0, -nz);
        col.push(wall[0] * shadeK, wall[1] * shadeK, wall[2] * shadeK);
      }
      uv.push(along, 0, along + len, 0, along + len, top - base, along, top - base);
      idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
      along += len;
    }
    // Roof.
    const contour: Vector2[] = [];
    for (let i = 0; i < m; i++)
      contour.push(new Vector2(r[2 * i] as number, r[2 * i + 1] as number));
    const tris = ShapeUtils.triangulateShape(contour, []);
    const b = pos.length / 3;
    for (let i = 0; i < m; i++) {
      pos.push(r[2 * i] as number, top, r[2 * i + 1] as number);
      nor.push(0, 1, 0);
      col.push(roof[0], roof[1], roof[2]);
      uv.push(-1, -1);
    }
    for (const t of tris) {
      const a = t[0] as number;
      let c1 = t[1] as number;
      let c2 = t[2] as number;
      // Face up (+y): the cross product's y is e1.z * e2.x - e1.x * e2.z.
      const ax = r[2 * a] as number;
      const az = r[2 * a + 1] as number;
      const e1x = (r[2 * c1] as number) - ax;
      const e1z = (r[2 * c1 + 1] as number) - az;
      const e2x = (r[2 * c2] as number) - ax;
      const e2z = (r[2 * c2 + 1] as number) - az;
      if (e1z * e2x - e1x * e2z < 0) [c1, c2] = [c2, c1];
      idx.push(b + a, b + c1, b + c2);
    }
    count++;
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array(nor), 3));
  g.setAttribute('color', new BufferAttribute(new Float32Array(col), 3));
  g.setAttribute('facade', new BufferAttribute(new Float32Array(uv), 2));
  g.setIndex(idx.length > 65535 ? new BufferAttribute(new Uint32Array(idx), 1) : idx);
  g.computeBoundingSphere();
  return { geometry: g, count };
}

/**
 * Plaster facades with windows: dark glass panes in floors of 3.2 m and bays of 3.4 m, shutters
 * and frames lighter, a plinth darker; the glass is smooth and reflects the sky. Roofs keep the
 * vertex colour, rougher.
 */
export function facadeMaterial(): MeshStandardMaterial {
  const m = new MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0 });
  m.name = 'facade';
  m.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute vec2 facade;\nvarying vec2 vFacade;',
      )
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFacade = facade;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vFacade;\nfloat facadeGlass;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        facadeGlass = 0.0;
        if (vFacade.x >= 0.0) {
          vec2 cell = vec2(vFacade.x / 3.4, (vFacade.y - 0.6) / 3.2);
          vec2 f = fract(cell);
          float floorIdx = floor(cell.y);
          float bay = floor(cell.x);
          float rnd = fract(sin(bay * 12.9898 + floorIdx * 78.233) * 43758.5453);
          float win = step(0.3, f.x) * step(f.x, 0.72) * step(0.28, f.y) * step(f.y, 0.82) * step(0.0, floorIdx);
          // Where the window grid is finer than a pixel, show its average instead of nothing:
          // about a fifth of the facade is dark glass and frames.
          float aaw = fwidth(cell.x) * 2.0;
          win = mix(win, 0.2 * step(0.0, floorIdx), smoothstep(0.25, 0.6, aaw));
          // Some shutters closed.
          float shut = step(0.72, rnd);
          vec3 glass = vec3(0.035, 0.04, 0.045);
          vec3 shutter = diffuseColor.rgb * vec3(0.55, 0.6, 0.5);
          diffuseColor.rgb = mix(diffuseColor.rgb, mix(glass, shutter, shut), win);
          facadeGlass = win * (1.0 - shut);
          // Plinth and dirt toward the ground.
          diffuseColor.rgb *= mix(0.72, 1.0, smoothstep(0.3, 1.0, vFacade.y));
        }`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.08, facadeGlass);',
      );
  };
  m.customProgramCacheKey = () => 'facade-v1';
  return m;
}

/**
 * Build mapped buildings partitioned into spatial grid cells so off-screen sectors frustum-cull
 * and distant cells stop casting shadows into the sun cascades.
 */
export function buildBuildingChunks(
  features: readonly MappedFeature[],
  heightAt: (x: number, z: number) => number,
  skip: (f: MappedFeature) => boolean = () => false,
  cellSize = 320,
  palette: BuildingPalette = DEFAULT_THEME.buildings,
): {
  chunks: { geometry: BufferGeometry; centre: [number, number, number]; radius: number }[];
  count: number;
} {
  const buckets = new Map<number, MappedFeature[]>();
  for (const f of features) {
    if (skip(f)) continue;
    const p = f.p;
    if (p.length < 6) continue;
    let cx = 0;
    let cz = 0;
    const m = p.length / 2;
    for (let i = 0; i < m; i++) {
      cx += p[2 * i] as number;
      cz += p[2 * i + 1] as number;
    }
    cx /= m;
    cz /= m;
    const key = Math.floor(cx / cellSize) * 65536 + Math.floor(cz / cellSize);
    let list = buckets.get(key);
    if (!list) buckets.set(key, (list = []));
    list.push(f);
  }
  const chunks: { geometry: BufferGeometry; centre: [number, number, number]; radius: number }[] =
    [];
  let total = 0;
  for (const list of buckets.values()) {
    const { geometry, count } = buildBuildings(list, heightAt, undefined, palette);
    if (count === 0) {
      geometry.dispose();
      continue;
    }
    geometry.computeBoundingSphere();
    const bs = geometry.boundingSphere;
    if (!bs || bs.radius <= 0) {
      geometry.dispose();
      continue;
    }
    chunks.push({
      geometry,
      centre: [bs.center.x, bs.center.y, bs.center.z],
      radius: bs.radius,
    });
    total += count;
  }
  return { chunks, count: total };
}
