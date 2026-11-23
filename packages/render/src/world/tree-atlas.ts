import {
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  RGBAFormat,
  SRGBColorSpace,
  UnsignedByteType,
} from 'three';
import { hash01 } from './dressing';

/**
 * Tree impostor art, painted by script at load (no third-party tree assets): each species is a
 * recursive branching skeleton with leaf clumps grown on its outer twigs inside a species crown
 * envelope, lit from above and the front so the crown reads as a volume (outer clumps light,
 * inner and lower ones in shade, gaps where the sky shows through). Tiles are laid out 4 × 2 in
 * one atlas; ground level is the bottom of each tile, the trunk at its centre.
 */
export interface Species {
  name: string;
  /** Crown envelope: centre height and radii as fractions of the tile. */
  crownY: number;
  crownRx: number;
  crownRy: number;
  /** Cone (conifer) instead of an ellipsoid. */
  cone?: boolean;
  /** Trunk height to the first branch, fraction of the tile. */
  bole: number;
  leaf: [number, number, number];
  /** Leaf clump size in tile fractions. */
  clump: number;
  /** Number of clumps. */
  clumps: number;
  /** Bark colour. */
  bark: string;
}

/** Atlas order: four broadleaves, then poplar, conifer, a second oak and a young tree. */
export const SPECIES: readonly Species[] = [
  {
    name: 'oak',
    crownY: 0.56,
    crownRx: 0.44,
    crownRy: 0.36,
    bole: 0.22,
    leaf: [0.115, 0.175, 0.052],
    clump: 0.046,
    clumps: 560,
    bark: '#352e26',
  },
  {
    name: 'hornbeam',
    crownY: 0.58,
    crownRx: 0.34,
    crownRy: 0.4,
    bole: 0.18,
    leaf: [0.13, 0.195, 0.058],
    clump: 0.04,
    clumps: 600,
    bark: '#4f4b44',
  },
  {
    name: 'plane',
    crownY: 0.57,
    crownRx: 0.42,
    crownRy: 0.4,
    bole: 0.24,
    leaf: [0.16, 0.215, 0.068],
    clump: 0.05,
    clumps: 490,
    bark: '#726b5c',
  },
  {
    name: 'chestnut',
    crownY: 0.55,
    crownRx: 0.4,
    crownRy: 0.38,
    bole: 0.2,
    leaf: [0.09, 0.148, 0.044],
    clump: 0.052,
    clumps: 520,
    bark: '#332922',
  },
  {
    name: 'poplar',
    crownY: 0.56,
    crownRx: 0.14,
    crownRy: 0.43,
    bole: 0.08,
    leaf: [0.14, 0.198, 0.062],
    clump: 0.032,
    clumps: 560,
    bark: '#524e45',
  },
  {
    name: 'spruce',
    crownY: 0.5,
    crownRx: 0.26,
    crownRy: 0.48,
    cone: true,
    bole: 0.05,
    leaf: [0.055, 0.105, 0.045],
    clump: 0.034,
    clumps: 660,
    bark: '#35281e',
  },
  {
    name: 'oak2',
    crownY: 0.52,
    crownRx: 0.46,
    crownRy: 0.3,
    bole: 0.26,
    leaf: [0.145, 0.185, 0.055],
    clump: 0.046,
    clumps: 540,
    bark: '#3c3329',
  },
  {
    name: 'young',
    crownY: 0.6,
    crownRx: 0.3,
    crownRy: 0.3,
    bole: 0.3,
    leaf: [0.175, 0.228, 0.068],
    clump: 0.038,
    clumps: 400,
    bark: '#463e34',
  },
];

export const ATLAS_COLS = 4;
/** Rows 0 and 1: the eight species cards. Row 2: three leaf clusters and a bark strip. */
export const ATLAS_ROWS = 3;
/** Atlas tile index of the first leaf cluster (three in a row), and of the bark strip. */
export const CLUSTER_TILE = 8;
export const BARK_TILE = 11;

/** Brightness of the three cluster tiles relative to the cards' mean (see matchClustersToCards). */
const CLUSTER_BRIGHTNESS = [1.03, 0.93, 1.11];
/** Leaf colours of the three cluster tiles (linear-ish, as the species leaves); calibrated after painting. */
const CLUSTERS: readonly [number, number, number][] = [
  [0.19, 0.27, 0.1],
  [0.14, 0.22, 0.08],
  [0.24, 0.31, 0.12],
];

/**
 * A leaf cluster for the near trees' leaf cards: overlapping leaves filling a rough disc, lit
 * from above and the front (darker underneath and toward the core), ragged at the edge so the
 * cards' outlines never read as circles.
 */
function paintCluster(
  ctx: CanvasRenderingContext2D,
  leaf: readonly [number, number, number],
  seed: number,
  ox: number,
  oy: number,
  size: number,
): void {
  const R = (a: number, b = 0): number => hash01(seed, a, b);
  const n = 260;
  const items: { x: number; y: number; r: number; a: number; k: number }[] = [];
  for (let i = 0; i < n; i++) {
    const ang = R(i, 1) * Math.PI * 2;
    const rad = Math.sqrt(R(i, 2)) * 0.42 * (0.8 + 0.25 * Math.sin(ang * 5 + seed));
    const x = 0.5 + Math.cos(ang) * rad;
    const y = 0.5 + Math.sin(ang) * rad;
    // Light from the upper left, a darker core.
    const k =
      0.62 + 0.38 * (0.5 - (y - 0.5)) - 0.18 * (x - 0.5) - 0.25 * (1 - rad / 0.42) * R(i, 3);
    items.push({ x, y, r: 0.028 + R(i, 4) * 0.03, a: R(i, 5) * Math.PI, k });
  }
  items.sort((a, b) => a.k - b.k);
  for (const [i, it] of items.entries()) {
    ctx.fillStyle = shade(leaf, Math.max(0.3, it.k) * (0.85 + R(i, 6) * 0.3));
    ctx.beginPath();
    ctx.ellipse(
      ox + it.x * size,
      oy + it.y * size,
      it.r * size,
      it.r * size * 0.55,
      it.a,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }
}

const toLinear = (c: number): number => Math.pow(c / 255, 2.2);
const toByte = (v: number): number =>
  Math.round(Math.min(1, Math.pow(Math.max(0, v), 1 / 2.2)) * 255);

/** Mean linear colour of a tile's opaque texels (alpha at least half). */
export function tileMean(
  data: Uint8Array,
  width: number,
  tile: number,
  t: number,
): [number, number, number] {
  const ox = (t % ATLAS_COLS) * tile;
  const oy = Math.floor(t / ATLAS_COLS) * tile;
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let y = oy; y < oy + tile; y++) {
    for (let x = ox; x < ox + tile; x++) {
      const i = (y * width + x) * 4;
      if ((data[i + 3] as number) < 128) continue;
      r += toLinear(data[i] as number);
      g += toLinear(data[i + 1] as number);
      b += toLinear(data[i + 2] as number);
      n++;
    }
  }
  return n ? [r / n, g / n, b / n] : [0, 0, 0];
}

/**
 * The near trees replace the cards within the swap distance, so their leaves must average to the
 * same colour as the card crowns or a band of lighter trees travels with the camera. Scale each
 * cluster tile (in linear light) so its mean over opaque texels equals the mean of the species
 * card tiles, keeping the clusters' small differences between each other.
 */
function matchClustersToCards(data: Uint8Array, width: number, tile: number): void {
  const target = [0, 0, 0];
  SPECIES.forEach((_, t) => {
    const m = tileMean(data, width, tile, t);
    for (let c = 0; c < 3; c++)
      target[c] = (target[c] as number) + (m[c] as number) / SPECIES.length;
  });
  CLUSTERS.forEach((_, i) => {
    const t = CLUSTER_TILE + i;
    const m = tileMean(data, width, tile, t);
    const variation = CLUSTER_BRIGHTNESS[i] ?? 1;
    const k = m.map((v, c) => (v > 1e-6 ? ((target[c] as number) * variation) / v : 1));
    const ox = (t % ATLAS_COLS) * tile;
    const oy = Math.floor(t / ATLAS_COLS) * tile;
    for (let y = oy; y < oy + tile; y++) {
      for (let x = ox; x < ox + tile; x++) {
        const p = (y * width + x) * 4;
        if ((data[p + 3] as number) === 0) continue;
        for (let c = 0; c < 3; c++)
          data[p + c] = toByte(toLinear(data[p + c] as number) * (k[c] as number));
      }
    }
  });
}

/** Bark: vertical fissures in grey-brown, tiling top to bottom. */
function paintBark(ctx: CanvasRenderingContext2D, ox: number, oy: number, size: number): void {
  // The species cards' bark tones ('#3b342c' to '#5a564e'), toward their darker end.
  ctx.fillStyle = '#3d362e';
  ctx.fillRect(ox, oy, size, size);
  for (let i = 0; i < 90; i++) {
    const x = hash01(i, 31) * size;
    const w = 1 + hash01(i, 32) * size * 0.02;
    const shadeK = 0.6 + hash01(i, 33) * 0.6;
    ctx.fillStyle = shade([0.2, 0.17, 0.13], shadeK);
    ctx.fillRect(ox + x, oy, w, size);
  }
}

function inCrown(sp: Species, x: number, y: number): number {
  // Signed "inside" measure: 1 at the centre, 0 at the envelope.
  const dx = (x - 0.5) / sp.crownRx;
  if (sp.cone) {
    const top = sp.crownY + sp.crownRy;
    const bottom = sp.crownY - sp.crownRy;
    const t = (top - y) / (top - bottom);
    if (t < 0 || t > 1) return -1;
    const r = sp.crownRx * Math.pow(t, 0.85);
    return 1 - Math.abs(x - 0.5) / Math.max(1e-3, r);
  }
  const dy = (y - sp.crownY) / sp.crownRy;
  return 1 - Math.hypot(dx, dy);
}

function shade(rgb: readonly number[], k: number): string {
  const c = rgb.map((v) => Math.round(Math.min(1, Math.max(0, v * k)) ** (1 / 2.2) * 255));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

/**
 * Relief of the species cards (the mid-distance level, trees.ts): per texel the crown's surface
 * normal in the card's frame (red: toward the tile's right, green: up; the part toward the viewer
 * follows from the two) and, in blue, the factor (÷ 2) that takes the painted colour to the
 * colour without its painted sunlight, ambient occlusion only. With the normals the card is lit
 * by the scene's sun from wherever it stands, so the painted light must come out first.
 */
const reliefByte = (v: number): number => Math.round(Math.min(1, Math.max(0, v)) * 255);
function reliefStyle(nx: number, ny: number, nz: number, ratio: number): string {
  const l = Math.hypot(nx, ny, nz) || 1;
  return `rgb(${reliefByte(0.5 + (0.5 * nx) / l)},${reliefByte(0.5 + (0.5 * ny) / l)},${reliefByte(ratio / 2)})`;
}
/** The flat relief: facing the viewer, colour unchanged (trunks, limbs). */
const RELIEF_FLAT = reliefStyle(0, 0, 1, 1);

/**
 * Paint one species into a tile of `size` pixels at (ox, oy) (canvas pixels, y down): its
 * colour, or (`relief`) its relief with the same shapes (see reliefStyle).
 */
function paintTree(
  ctx: CanvasRenderingContext2D,
  sp: Species,
  seed: number,
  ox: number,
  oy: number,
  size: number,
  relief = false,
): void {
  const R = (a: number, b = 0): number => hash01(seed, a, b);
  const X = (u: number): number => ox + u * size;
  const Y = (v: number): number => oy + (1 - v) * size;
  // Branch skeleton: tips collected for the leaf clumps.
  const tips: [number, number][] = [];
  ctx.lineCap = 'round';
  let counter = 1;
  const branch = (
    x: number,
    y: number,
    ang: number,
    len: number,
    width: number,
    depth: number,
  ): void => {
    const id = counter++;
    const bend = (R(id, 1) - 0.5) * 0.5;
    const x1 = x + Math.cos(ang + bend) * len;
    const y1 = y + Math.sin(ang + bend) * len;
    ctx.strokeStyle = relief ? RELIEF_FLAT : sp.bark;
    ctx.lineWidth = Math.max(0.6, width * size);
    ctx.beginPath();
    ctx.moveTo(X(x), Y(y));
    ctx.quadraticCurveTo(X((x + x1) / 2 + bend * len * 0.3), Y((y + y1) / 2), X(x1), Y(y1));
    ctx.stroke();
    if (depth <= 0 || inCrown(sp, x1, y1) < -0.05) {
      tips.push([x1, y1]);
      return;
    }
    const n = sp.cone ? 2 : 2 + (R(id, 2) > 0.6 ? 1 : 0);
    for (let k = 0; k < n; k++) {
      const spread = sp.cone ? 1.25 : sp.name === 'poplar' ? 0.35 : 0.75;
      const a = ang + (k - (n - 1) / 2) * spread * (0.7 + R(id, 3 + k) * 0.6);
      branch(x1, y1, a, len * (0.68 + R(id, 7 + k) * 0.12), width * 0.66, depth - 1);
    }
    tips.push([x1, y1]);
  };
  const trunkTop = sp.cone ? sp.crownY + sp.crownRy * 0.9 : sp.bole + 0.04;
  // Trunk with sunlit edge highlight.
  ctx.strokeStyle = relief ? RELIEF_FLAT : sp.bark;
  ctx.lineWidth = Math.max(1.5, size * (sp.cone ? 0.022 : 0.032));
  ctx.beginPath();
  ctx.moveTo(X(0.5), Y(0));
  ctx.lineTo(X(0.5 + (R(0, 9) - 0.5) * 0.02), Y(trunkTop));
  ctx.stroke();
  if (sp.cone) {
    for (let k = 0; k < 18; k++) {
      const y = sp.bole + (trunkTop - sp.bole) * (k / 18);
      for (const side of [-1, 1])
        branch(0.5, y, side > 0 ? -0.35 : Math.PI + 0.35, 0.05 + 0.18 * (1 - k / 18), 0.006, 1);
    }
  } else {
    const main = sp.name === 'poplar' ? 5 : 3;
    for (let k = 0; k < main; k++) {
      const a = Math.PI / 2 + (k - (main - 1) / 2) * (sp.name === 'poplar' ? 0.18 : 0.55);
      branch(0.5, sp.bole, a, sp.crownRy * 0.55, 0.018, 4);
    }
  }
  // Leaf clumps: on and around the tips, inside the envelope, back to front.
  type Clump = {
    x: number;
    y: number;
    r: number;
    z: number;
    light: number;
    /** Crown normal at the clump (x right, y up, z toward the viewer). */
    n: [number, number, number];
    /** Painted light without its directional part: occlusion only. */
    ao: number;
  };
  const clumps: Clump[] = [];
  for (let k = 0; k < sp.clumps; k++) {
    const t = tips[Math.floor(R(k, 11) * tips.length)] ?? [0.5, sp.crownY];
    const x = t[0] + (R(k, 12) - 0.5) * sp.clump * 3.1;
    const y = t[1] + (R(k, 13) - 0.5) * sp.clump * 3.1;
    const inside = inCrown(sp, x, y);
    if (inside < 0) continue;
    // Depth: a pseudo-z on the crown ellipsoid, front clumps catch more light, deep core is occluded.
    const z = Math.sqrt(Math.max(0, inside)) * (R(k, 14) * 2 - 1);
    const ny = (y - sp.crownY) / sp.crownRy;
    const nx = (x - 0.5) / Math.max(0.05, sp.crownRx);
    const coreAO = 0.72 + 0.34 * (1 - inside);
    const light = (0.48 + 0.42 * ny + 0.26 * z - 0.14 * nx) * coreAO;
    // The crown as a volume: out from its centre, toward the viewer by the clump's depth, leaning
    // up as the near trees' and the plain cards' normals do (sky light on the top).
    const n: [number, number, number] = [
      Math.max(-1, Math.min(1, nx)),
      Math.max(-1, Math.min(1, ny)) * 0.8 + 0.25,
      0.3 + Math.max(0, z),
    ];
    // The painted light without its sun from the front and side (the normals bring the scene's
    // own): the core's occlusion and the sky's from above stay, as on the near trees' clusters.
    const ao = (0.48 + 0.42 * ny) * coreAO;
    clumps.push({ x, y, r: sp.clump * (0.55 + R(k, 15) * 0.65), z, light, n, ao });
  }
  clumps.sort((a, b) => a.z - b.z);
  for (const [k, c] of clumps.entries()) {
    // High-frequency serrated foliage cluster: darker shadowed under-sprigs, warmer sunlit outer tips.
    const base = Math.max(0.18, c.light);
    const warmShift = 0.88 + R(k, 16) * 0.28;
    const leaf: [number, number, number] = [
      sp.leaf[0] * warmShift,
      sp.leaf[1] * (0.94 + R(k, 17) * 0.12),
      sp.leaf[2] * (1.9 - warmShift),
    ];
    for (let j = 0; j < 10; j++) {
      const ang = R(k, 60 + j) * Math.PI * 2;
      const dist = Math.sqrt(R(k, 20 + j)) * c.r * 0.95;
      const lx = c.x + Math.cos(ang) * dist;
      const ly = c.y + Math.sin(ang) * dist * 0.85;
      const lr = c.r * (0.16 + R(k, 40 + j) * 0.19);
      const lift = 0.62 + 0.52 * (j / 9);
      if (relief) {
        // Each sprig a small dome on the clump: tilted out by its offset from the clump's centre.
        const ox2 = (lx - c.x) / c.r;
        const oy2 = (ly - c.y) / c.r;
        ctx.fillStyle = reliefStyle(
          c.n[0] + 0.5 * ox2,
          c.n[1] + 0.5 * oy2,
          c.n[2],
          Math.min(2, Math.max(0.25, Math.max(0.18, c.ao) / base)),
        );
      } else ctx.fillStyle = shade(leaf, base * lift * (0.82 + R(k, 50 + j) * 0.36));
      ctx.beginPath();
      ctx.ellipse(X(lx), Y(ly), lr * size, lr * size * 0.58, ang, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

/**
 * The atlas as a texture: `tile` pixels per species (512 on High, 256 on Mobile). A data texture,
 * not a canvas texture: the canvas stores premultiplied alpha, which would lose the colour bled
 * into the transparent texels. Row 0 of the data is the canvas's top row, so in uv a tile at
 * canvas row r spans v = r / ROWS (its top) to (r + 1) / ROWS (the ground).
 */
export function treeAtlas(
  tile: number,
  anisotropy: number,
  /** Per-species changes by name (a circuit's own form of a species; theme.ts). */
  species: Readonly<Record<string, Partial<Species>>> = {},
): DataTexture {
  return treeAtlases(tile, anisotropy, species, false).colour;
}

/**
 * The colour atlas and, with `relief`, the species cards' relief atlas in the same layout (half
 * the colour's size from 512-pixel tiles up; the mid-distance cards it serves are never that
 * close): normals and the factor that takes out the painted sunlight (reliefStyle), scaled per
 * species so the colour without it keeps the painted colour's mean.
 */
export function treeAtlases(
  tile: number,
  anisotropy: number,
  species: Readonly<Record<string, Partial<Species>>> = {},
  relief = false,
): { colour: DataTexture; relief: DataTexture | null } {
  const canvas = document.createElement('canvas');
  canvas.width = tile * ATLAS_COLS;
  canvas.height = tile * ATLAS_ROWS;
  const ctx = canvas.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  SPECIES.forEach((sp, i) => {
    const ox = (i % ATLAS_COLS) * tile;
    const oy = Math.floor(i / ATLAS_COLS) * tile;
    ctx.save();
    ctx.beginPath();
    ctx.rect(ox, oy, tile, tile);
    ctx.clip();
    paintTree(ctx, { ...sp, ...species[sp.name] }, 7919 * (i + 1), ox, oy, tile);
    ctx.restore();
  });
  CLUSTERS.forEach((leaf, i) => {
    const t = CLUSTER_TILE + i;
    paintCluster(
      ctx,
      leaf,
      4241 * (i + 1),
      (t % ATLAS_COLS) * tile,
      Math.floor(t / ATLAS_COLS) * tile,
      tile,
    );
  });
  paintBark(ctx, (BARK_TILE % ATLAS_COLS) * tile, Math.floor(BARK_TILE / ATLAS_COLS) * tile, tile);
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = new Uint8Array(img.data.buffer.slice(0));
  matchClustersToCards(data, canvas.width, tile);
  let reliefTexture: DataTexture | null = null;
  if (relief) {
    const rt = tile >= 512 ? tile / 2 : tile;
    const rc = document.createElement('canvas');
    rc.width = rt * ATLAS_COLS;
    rc.height = rt * ATLAS_ROWS;
    const rctx = rc.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
    rctx.clearRect(0, 0, rc.width, rc.height);
    SPECIES.forEach((sp, i) => {
      const ox = (i % ATLAS_COLS) * rt;
      const oy = Math.floor(i / ATLAS_COLS) * rt;
      rctx.save();
      rctx.beginPath();
      rctx.rect(ox, oy, rt, rt);
      rctx.clip();
      paintTree(rctx, { ...sp, ...species[sp.name] }, 7919 * (i + 1), ox, oy, rt, true);
      rctx.restore();
    });
    const rd = new Uint8Array(rctx.getImageData(0, 0, rc.width, rc.height).data.buffer.slice(0));
    SPECIES.forEach((_, t) => keepReliefMean(data, canvas.width, tile, rd, rc.width, rt, t));
    bleed(rd, rc.width, rc.height);
    reliefTexture = atlasTexture(rd, rc.width, rc.height, anisotropy, false);
  }
  bleed(data, canvas.width, canvas.height);
  return {
    colour: atlasTexture(data, canvas.width, canvas.height, anisotropy, true),
    relief: reliefTexture,
  };
}

function atlasTexture(
  data: Uint8Array,
  w: number,
  h: number,
  anisotropy: number,
  colour: boolean,
): DataTexture {
  const t = new DataTexture(data, w, h, RGBAFormat, UnsignedByteType);
  if (colour) t.colorSpace = SRGBColorSpace;
  t.generateMipmaps = true;
  t.minFilter = LinearMipmapLinearFilter;
  t.magFilter = LinearFilter;
  t.anisotropy = anisotropy;
  t.flipY = false;
  t.needsUpdate = true;
  return t;
}

/**
 * Scale species tile `t`'s de-lighting factor (relief blue) so the colour times the factor keeps
 * the painted colour's mean luminance over the opaque texels (the relief atlas may be smaller:
 * each relief texel stands for the colour texels it covers).
 */
export function keepReliefMean(
  colour: Uint8Array,
  cw: number,
  tile: number,
  relief: Uint8Array,
  rw: number,
  rtile: number,
  t: number,
): void {
  const ox = (t % ATLAS_COLS) * tile;
  const oy = Math.floor(t / ATLAS_COLS) * tile;
  const rox = (t % ATLAS_COLS) * rtile;
  const roy = Math.floor(t / ATLAS_COLS) * rtile;
  const k = tile / rtile;
  let painted = 0;
  let flat = 0;
  for (let y = 0; y < tile; y++) {
    for (let x = 0; x < tile; x++) {
      const i = ((oy + y) * cw + ox + x) * 4;
      if ((colour[i + 3] as number) < 128) continue;
      const r = ((roy + Math.floor(y / k)) * rw + rox + Math.floor(x / k)) * 4;
      if ((relief[r + 3] as number) < 128) continue;
      const l =
        0.2126 * toLinear(colour[i] as number) +
        0.7152 * toLinear(colour[i + 1] as number) +
        0.0722 * toLinear(colour[i + 2] as number);
      painted += l;
      flat += l * (((relief[r + 2] as number) / 255) * 2);
    }
  }
  if (flat <= 1e-9) return;
  const scale = painted / flat;
  for (let y = roy; y < roy + rtile; y++) {
    for (let x = rox; x < rox + rtile; x++) {
      const r = (y * rw + x) * 4 + 2;
      relief[r] = Math.round(Math.min(255, (relief[r] as number) * scale));
    }
  }
}

/** Fill transparent texels' colour from opaque neighbours (dilation), so mipmaps keep the leaf colour. */
function bleed(d: Uint8Array, w: number, h: number): void {
  const offs = [-4, 4, -w * 4, w * 4];
  const filled = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) filled[i] = (d[i * 4 + 3] as number) > 0 ? 1 : 0;
  for (let pass = 0; pass < 6; pass++) {
    const prev = filled.slice();
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const p = y * w + x;
        if (prev[p]) continue;
        const i = p * 4;
        let r = 0;
        let g = 0;
        let b = 0;
        let n = 0;
        for (let k = 0; k < 4; k++) {
          const o = offs[k] as number;
          if (!prev[p + o / 4]) continue;
          r += d[i + o] as number;
          g += d[i + o + 1] as number;
          b += d[i + o + 2] as number;
          n++;
        }
        if (n > 0) {
          d[i] = r / n;
          d[i + 1] = g / n;
          d[i + 2] = b / n;
          filled[p] = 1;
        }
      }
    }
  }
}
