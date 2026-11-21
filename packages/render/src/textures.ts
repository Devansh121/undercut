import {
  CanvasTexture,
  LinearMipmapLinearFilter,
  NoColorSpace,
  RepeatWrapping,
  SRGBColorSpace,
  type Texture,
} from 'three';

/**
 * Procedural helpers: seeded tileable noise (macro variation) and the chain-link fence alpha.
 * Surfaces use real texture sets (materials/surface.ts); these fill what a photo cannot.
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
