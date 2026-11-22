import fs from 'node:fs';
import { describe, it, expect } from 'vitest';
import { decodeGlb } from './draco.mjs';

const catalogue = JSON.parse(fs.readFileSync('packages/render/data/props.catalog.json', 'utf8'));

// The seat contact measured on the shipped geometry of each LOD: the lowest point under the
// pelvis (delivery frame: x front, y up, z lateral). Feet, shins and hands lie forward of it.
function seatContact(file) {
  let low = Infinity;
  for (const prim of decodeGlb(file)) {
    const p = prim.POSITION;
    for (let i = 0; i < p.values.length / p.size; i++) {
      const [x, y, z] = [0, 1, 2].map((k) => p.values[i * p.size + k]);
      if (Math.abs(x) < 0.12 && Math.abs(z) < 0.16 && y > 0.3) low = Math.min(low, y);
    }
  }
  return low;
}

describe('seated figures sit at one height across LODs', () => {
  for (const prop of catalogue.props.filter((p) => p.id.includes('seated')))
    it(`${prop.id}: every LOD's seat contact matches the catalogue's seat attachment`, () => {
      const seat = prop.attachments.find((a) => a.name === 'seat').position[1];
      for (const lod of prop.lods) {
        // Within 6 mm: no visible pop on the seat at a LOD switch.
        expect(Math.abs(seatContact(`apps/web/public/${lod.file}`) - seat)).toBeLessThan(0.006);
      }
    });
});
