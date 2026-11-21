import {
  CanvasTexture,
  LinearMipmapLinearFilter,
  NoColorSpace,
  RepeatWrapping,
  SRGBColorSpace,
  type Texture,
} from 'three';

/**
 * Procedural textures drawn at load time. No third-party images in M1: every texture is
 * generated here from seeded value noise, so the look is reproducible and licence-free.
 */

/** Small deterministic PRNG (mulberry32), so textures are the same on every load. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Tileable value noise on a size x size grid, summed over octaves; values in [0, 1]. */
export function tileNoise(
  size: number,
  seed: number,
  cells: number,
  octaves = 4,
  gain = 0.5,
): Float32Array {
  const out = new Float32Array(size * size);
  const rand = prng(seed);
  let amp = 1;
  let total = 0;
  for (let o = 0; o < octaves; o++) {
    const c = cells << o;
    const lattice = new Float32Array(c * c);
    for (let i = 0; i < lattice.length; i++) lattice[i] = rand();
    for (let y = 0; y < size; y++) {
      const fy = (y / size) * c;
      const y0 = Math.floor(fy);
      const ty = smooth(fy - y0);
      const r0 = (y0 % c) * c;
      const r1 = ((y0 + 1) % c) * c;
      for (let x = 0; x < size; x++) {
        const fx = (x / size) * c;
        const x0 = Math.floor(fx);
        const tx = smooth(fx - x0);
        const c0 = x0 % c;
        const c1 = (x0 + 1) % c;
        const a =
          (lattice[r0 + c0] as number) +
          ((lattice[r0 + c1] as number) - (lattice[r0 + c0] as number)) * tx;
        const b =
          (lattice[r1 + c0] as number) +
          ((lattice[r1 + c1] as number) - (lattice[r1 + c0] as number)) * tx;
        out[y * size + x] = (out[y * size + x] as number) + (a + (b - a) * ty) * amp;
      }
    }
    total += amp;
    amp *= gain;
  }
  for (let i = 0; i < out.length; i++) out[i] = (out[i] as number) / total;
  return out;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

function canvas(size: number): { el: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const el = document.createElement('canvas');
  el.width = size;
  el.height = size;
  const ctx = el.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  return { el, ctx };
}

function finish(el: HTMLCanvasElement, colour: boolean, anisotropy: number): Texture {
  const tex = new CanvasTexture(el);
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  tex.colorSpace = colour ? SRGBColorSpace : NoColorSpace;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.anisotropy = anisotropy;
  tex.generateMipmaps = true;
  return tex;
}

type RGB = readonly [number, number, number];

function hex(c: string): RGB {
  const v = parseInt(c.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

/**
 * A colour texture: noise mixes between `dark` and `light`, with optional speckle (aggregate,
 * gravel stones) of `speckle` density.
 */
export function noiseColourTexture(
  size: number,
  seed: number,
  dark: string,
  light: string,
  options: {
    cells?: number;
    octaves?: number;
    speckle?: number;
    speckleColour?: string;
    contrast?: number;
  } = {},
  anisotropy = 8,
): Texture {
  const { el, ctx } = canvas(size);
  const n = tileNoise(size, seed, options.cells ?? 8, options.octaves ?? 5);
  const fine = tileNoise(size, seed + 101, Math.max(32, size / 4), 2);
  const a = hex(dark);
  const b = hex(light);
  const sp = options.speckleColour ? hex(options.speckleColour) : b;
  const contrast = options.contrast ?? 1.6;
  const img = ctx.createImageData(size, size);
  const rand = prng(seed + 7);
  for (let i = 0; i < size * size; i++) {
    let t = ((n[i] as number) - 0.5) * contrast + 0.5;
    t = t * 0.75 + (fine[i] as number) * 0.25;
    t = Math.min(1, Math.max(0, t));
    let r = a[0] + (b[0] - a[0]) * t;
    let g = a[1] + (b[1] - a[1]) * t;
    let bl = a[2] + (b[2] - a[2]) * t;
    if (options.speckle && rand() < options.speckle) {
      const k = 0.4 + rand() * 0.6;
      r = r + (sp[0] - r) * k;
      g = g + (sp[1] - g) * k;
      bl = bl + (sp[2] - bl) * k;
    }
    img.data[i * 4] = r;
    img.data[i * 4 + 1] = g;
    img.data[i * 4 + 2] = bl;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return finish(el, true, anisotropy);
}

/** A tangent-space normal map from tileable noise height, `strength` scaling the slopes. */
export function noiseNormalTexture(
  size: number,
  seed: number,
  cells: number,
  strength: number,
  anisotropy = 8,
): Texture {
  const { el, ctx } = canvas(size);
  const h = tileNoise(size, seed, cells, 4, 0.55);
  const img = ctx.createImageData(size, size);
  const at = (x: number, y: number): number =>
    h[((y + size) % size) * size + ((x + size) % size)] as number;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * size + x) * 4;
      img.data[i] = ((-dx / len) * 0.5 + 0.5) * 255;
      img.data[i + 1] = ((dy / len) * 0.5 + 0.5) * 255;
      img.data[i + 2] = ((1 / len) * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return finish(el, false, anisotropy);
}

/** A greyscale data texture (roughness, masks) from noise in [lo, hi]. */
export function noiseGreyTexture(
  size: number,
  seed: number,
  cells: number,
  lo: number,
  hi: number,
  anisotropy = 8,
): Texture {
  const { el, ctx } = canvas(size);
  const n = tileNoise(size, seed, cells, 4);
  const img = ctx.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    const v = (lo + (hi - lo) * (n[i] as number)) * 255;
    img.data[i * 4] = v;
    img.data[i * 4 + 1] = v;
    img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return finish(el, false, anisotropy);
}

/**
 * Chain-link fence: a diamond wire mesh on transparent, for an alpha-tested material. One tile
 * is one diamond pitch along and up.
 */
export function fenceTexture(anisotropy = 8): Texture {
  const size = 128;
  const { el, ctx } = canvas(size);
  ctx.clearRect(0, 0, size, size);
  ctx.strokeStyle = 'rgba(178, 184, 188, 1)';
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(size, size);
  ctx.moveTo(size, 0);
  ctx.lineTo(0, size);
  ctx.stroke();
  // Wrap the line ends so the tile repeats cleanly.
  ctx.beginPath();
  ctx.moveTo(-size / 2, size / 2);
  ctx.lineTo(size / 2, size * 1.5);
  ctx.moveTo(size / 2, -size / 2);
  ctx.lineTo(size * 1.5, size / 2);
  ctx.stroke();
  return finish(el, true, anisotropy);
}

/** Carbon twill weave as a colour map for the car's bare carbon. */
export function carbonTexture(anisotropy = 8): Texture {
  const size = 64;
  const { el, ctx } = canvas(size);
  const cell = 8;
  for (let y = 0; y < size; y += cell) {
    for (let x = 0; x < size; x += cell) {
      const twill = ((x / cell + y / cell) >> 1) % 2 === 0;
      const g = ctx.createLinearGradient(x, y, twill ? x + cell : x, twill ? y : y + cell);
      g.addColorStop(0, '#15171a');
      g.addColorStop(0.5, twill ? '#2a2d32' : '#202328');
      g.addColorStop(1, '#15171a');
      ctx.fillStyle = g;
      ctx.fillRect(x, y, cell, cell);
    }
  }
  return finish(el, true, anisotropy);
}
