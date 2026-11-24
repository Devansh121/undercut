import type { BufferAttribute } from 'three';
import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { ATLAS_COLS, ATLAS_ROWS, keepReliefMean } from '../src/world/tree-atlas';
import { treeCards } from '../src/world/trees';

const toLinear = (c: number): number => Math.pow(c / 255, 2.2);
const luma = (d: Uint8Array, i: number): number =>
  0.2126 * toLinear(d[i] as number) +
  0.7152 * toLinear(d[i + 1] as number) +
  0.0722 * toLinear(d[i + 2] as number);

describe('relief atlas', () => {
  it("scales a tile's de-lighting so the de-lit colour keeps the painted mean", () => {
    const tile = 32;
    const rtile = 16;
    const cw = tile * ATLAS_COLS;
    const rw = rtile * ATLAS_COLS;
    const colour = new Uint8Array(cw * tile * ATLAS_ROWS * 4);
    const relief = new Uint8Array(rw * rtile * ATLAS_ROWS * 4);
    const t = 5; // second row, second column
    const ox = (t % ATLAS_COLS) * tile;
    const oy = Math.floor(t / ATLAS_COLS) * tile;
    let seed = 7;
    const rnd = (): number => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 255;
    for (let y = 0; y < tile; y++) {
      for (let x = 0; x < tile; x++) {
        const i = ((oy + y) * cw + ox + x) * 4;
        // A disc of leaves, transparent corners.
        const inside = Math.hypot(x - tile / 2, y - tile / 2) < tile * 0.45;
        colour.set([rnd() * 0.4, rnd() * 0.6, rnd() * 0.2, inside ? 255 : 0], i);
      }
    }
    const rox = (t % ATLAS_COLS) * rtile;
    const roy = Math.floor(t / ATLAS_COLS) * rtile;
    for (let y = 0; y < rtile; y++)
      for (let x = 0; x < rtile; x++)
        relief.set([128, 128, 40 + rnd() * 0.6, 255], ((roy + y) * rw + rox + x) * 4);
    keepReliefMean(colour, cw, tile, relief, rw, rtile, t);
    let painted = 0;
    let flat = 0;
    for (let y = 0; y < tile; y++) {
      for (let x = 0; x < tile; x++) {
        const i = ((oy + y) * cw + ox + x) * 4;
        if ((colour[i + 3] as number) < 128) continue;
        const r = ((roy + (y >> 1)) * rw + rox + (x >> 1)) * 4;
        painted += luma(colour, i);
        flat += luma(colour, i) * (((relief[r + 2] as number) / 255) * 2);
      }
    }
    // Within the factor's 8-bit rounding.
    expect(flat / painted).toBeCloseTo(1, 2);
    // Other tiles untouched.
    expect(relief[2]).toBe(0);
  });
});

describe('tree cards', () => {
  const g = treeCards(3);
  const pos = g.getAttribute('position') as BufferAttribute;
  const cardT = g.getAttribute('cardT') as BufferAttribute;
  const cardP = g.getAttribute('cardP') as BufferAttribute;
  const uv = g.getAttribute('uv') as BufferAttribute;

  it('mirrors every other crossed card, so the crossing does not repeat one outline', () => {
    // Six vertices per card: card k's first vertex is its left bottom corner.
    const flips = [0, 1, 2].map((k) => cardT.getW(k * 6));
    expect(flips).toEqual([1, -1, 1]);
    expect([0, 1, 2].map((k) => uv.getX(k * 6))).toEqual([0, 1, 0]);
  });

  it('folds each card along the trunk, alternately forward and back', () => {
    for (const k of [0, 1, 2]) {
      const p = new Vector3(cardP.getX(k * 6), cardP.getY(k * 6), cardP.getZ(k * 6));
      const edge = new Vector3().fromBufferAttribute(pos, k * 6);
      const middle = new Vector3().fromBufferAttribute(pos, k * 6 + 1);
      const along = edge.sub(middle).dot(p);
      expect(Math.sign(along)).toBe(k % 2 === 0 ? 1 : -1);
      expect(Math.abs(along)).toBeCloseTo(0.1, 5);
    }
  });
});
