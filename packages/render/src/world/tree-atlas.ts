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
    leaf: [0.19, 0.27, 0.1],
    clump: 0.05,
    clumps: 520,
    bark: '#3b342c',
  },
  {
    name: 'hornbeam',
    crownY: 0.58,
    crownRx: 0.34,
    crownRy: 0.4,
    bole: 0.18,
    leaf: [0.2, 0.3, 0.11],
    clump: 0.042,
    clumps: 560,
    bark: '#5a564e',
  },
  {
    name: 'plane',
    crownY: 0.57,
    crownRx: 0.42,
    crownRy: 0.4,
    bole: 0.24,
    leaf: [0.24, 0.31, 0.12],
    clump: 0.055,
    clumps: 440,
    bark: '#8a8270',
  },
  {
    name: 'chestnut',
    crownY: 0.55,
    crownRx: 0.4,
    crownRy: 0.38,
    bole: 0.2,
    leaf: [0.15, 0.24, 0.08],
    clump: 0.06,
    clumps: 470,
    bark: '#3a3029',
  },
  {
    name: 'poplar',
    crownY: 0.56,
    crownRx: 0.14,
    crownRy: 0.43,
    bole: 0.08,
    leaf: [0.22, 0.3, 0.12],
    clump: 0.032,
    clumps: 520,
    bark: '#5d5a50',
  },
  {
    name: 'spruce',
    crownY: 0.5,
    crownRx: 0.26,
    crownRy: 0.48,
    cone: true,
    bole: 0.05,
    leaf: [0.08, 0.15, 0.07],
    clump: 0.035,
    clumps: 620,
    bark: '#3d2f25',
  },
  {
    name: 'oak2',
    crownY: 0.52,
    crownRx: 0.46,
    crownRy: 0.3,
    bole: 0.26,
    leaf: [0.21, 0.28, 0.1],
    clump: 0.05,
    clumps: 480,
    bark: '#433a30',
  },
  {
    name: 'young',
    crownY: 0.6,
    crownRx: 0.3,
    crownRy: 0.3,
    bole: 0.3,
    leaf: [0.27, 0.34, 0.13],
    clump: 0.04,
    clumps: 330,
    bark: '#4e463b',
  },
];

export const ATLAS_COLS = 4;
export const ATLAS_ROWS = 2;

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

/** Paint one species into a tile of `size` pixels at (ox, oy) (canvas pixels, y down). */
function paintTree(
  ctx: CanvasRenderingContext2D,
  sp: Species,
  seed: number,
  ox: number,
  oy: number,
  size: number,
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
    ctx.strokeStyle = sp.bark;
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
  // Trunk.
  ctx.strokeStyle = sp.bark;
  ctx.lineWidth = Math.max(1.5, size * (sp.cone ? 0.022 : 0.03));
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
  type Clump = { x: number; y: number; r: number; z: number; light: number };
  const clumps: Clump[] = [];
  for (let k = 0; k < sp.clumps; k++) {
    const t = tips[Math.floor(R(k, 11) * tips.length)] ?? [0.5, sp.crownY];
    const x = t[0] + (R(k, 12) - 0.5) * sp.clump * 3;
    const y = t[1] + (R(k, 13) - 0.5) * sp.clump * 3;
    const inside = inCrown(sp, x, y);
    if (inside < 0) continue;
    // Depth: a pseudo-z on the crown ellipsoid, front clumps catch more light.
    const z = Math.sqrt(Math.max(0, inside)) * (R(k, 14) * 2 - 1);
    const ny = (y - sp.crownY) / sp.crownRy;
    const nx = (x - 0.5) / Math.max(0.05, sp.crownRx);
    const light = 0.55 + 0.35 * ny + 0.25 * z - 0.12 * nx + (1 - inside) * 0.25;
    clumps.push({ x, y, r: sp.clump * (0.6 + R(k, 15) * 0.7), z, light });
  }
  clumps.sort((a, b) => a.z - b.z);
  for (const [k, c] of clumps.entries()) {
    // Each clump: a few overlapping leaves, darker core, lighter top edge.
    const base = Math.max(0.25, c.light);
    const hue = 0.9 + R(k, 16) * 0.2;
    const leaf: [number, number, number] = [sp.leaf[0] * hue, sp.leaf[1], sp.leaf[2] * (2 - hue)];
    for (let j = 0; j < 5; j++) {
      const lx = c.x + (R(k, 20 + j) - 0.5) * c.r * 1.2;
      const ly = c.y + (R(k, 30 + j) - 0.5) * c.r * 1.0;
      const lr = c.r * (0.35 + R(k, 40 + j) * 0.3);
      ctx.fillStyle = shade(leaf, base * (0.75 + 0.35 * (j / 4)) * (0.85 + R(k, 50 + j) * 0.3));
      ctx.beginPath();
      ctx.ellipse(X(lx), Y(ly), lr * size, lr * size * 0.8, R(k, 60 + j) * Math.PI, 0, Math.PI * 2);
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
export function treeAtlas(tile: number, anisotropy: number): DataTexture {
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
    paintTree(ctx, sp, 7919 * (i + 1), ox, oy, tile);
    ctx.restore();
  });
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = new Uint8Array(img.data.buffer.slice(0));
  bleed(data, canvas.width, canvas.height);
  const t = new DataTexture(data, canvas.width, canvas.height, RGBAFormat, UnsignedByteType);
  t.colorSpace = SRGBColorSpace;
  t.generateMipmaps = true;
  t.minFilter = LinearMipmapLinearFilter;
  t.magFilter = LinearFilter;
  t.anisotropy = anisotropy;
  t.flipY = false;
  t.needsUpdate = true;
  return t;
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
