import { describe, expect, it } from 'vitest';
import { bucketBySector, chunkLod, sectorOf } from '../src/props/registry';

describe('prop registry', () => {
  it('buckets placements by lap sector, wrapping past the line', () => {
    const lap = 1000;
    expect(sectorOf(0, lap, 200)).toBe(0);
    expect(sectorOf(199.9, lap, 200)).toBe(0);
    expect(sectorOf(200, lap, 200)).toBe(1);
    expect(sectorOf(1050, lap, 200)).toBe(0);
    expect(sectorOf(-10, lap, 200)).toBe(4);
    const b = bucketBySector([{ s: 10 }, { s: 950 }, { s: 210 }, { s: 1010 }], lap, 200);
    expect(b.get(0)).toEqual([0, 3]);
    expect(b.get(1)).toEqual([2]);
    expect(b.get(4)).toEqual([1]);
  });

  it('picks the nearest level that reaches, and culls beyond the last', () => {
    const lods = [{ maxDistance: 60 }, { maxDistance: 400 }];
    expect(chunkLod(10, lods)).toBe(0);
    expect(chunkLod(60, lods)).toBe(1);
    expect(chunkLod(399, lods)).toBe(1);
    expect(chunkLod(400, lods)).toBe(-1);
  });
});
