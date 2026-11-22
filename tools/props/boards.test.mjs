import fs from 'node:fs';
import { describe, it, expect } from 'vitest';
import { decodeGlb } from './draco.mjs';

const catalogue = JSON.parse(fs.readFileSync('packages/render/data/props.catalog.json', 'utf8'));
const ids = [
  'braking-board',
  'zone-board',
  'corner-board',
  'kilometre-board',
  'hoarding',
  'pit-garage',
  'start-gantry',
  'bridge-banner',
  'pedestrian-bridge',
  'screen-tower',
];

// Asymmetric test art: red stripe on the left, blue on the right, white centre.
const art = (u) => (u < 0.35 ? 'red' : u > 0.65 ? 'blue' : 'white');
describe('board artwork seen from +X, +Y camera up', () => {
  for (const id of ids)
    it(`${id}: red left and blue right in every shipped LOD`, () => {
      const prop = catalogue.props.find((p) => p.id === id);
      for (const lod of prop.lods) {
        const materialName = id === 'screen-tower' ? 'glazing' : 'board-face';
        const front = [];
        for (const prim of decodeGlb(`apps/web/public/${lod.file}`)) {
          if (prim.material !== materialName) continue;
          const { POSITION: p, NORMAL: n, TEXCOORD_0: uv } = prim;
          for (let i = 0; i < p.values.length / p.size; i++) {
            if (n.values[i * n.size] > 0.9)
              front.push({ z: p.values[i * p.size + 2], u: uv.values[i * uv.size] });
          }
        }
        expect(front.length).toBeGreaterThanOrEqual(4);
        // Looking from +X, screen-left is +Z. Sample the same asymmetric artwork on those corners.
        const left = front.filter((v) => v.z > Math.max(...front.map((v) => v.z)) - 0.01);
        const right = front.filter((v) => v.z < Math.min(...front.map((v) => v.z)) + 0.01);
        expect(left.map((v) => art(v.u))).toEqual(left.map(() => 'red'));
        expect(right.map((v) => art(v.u))).toEqual(right.map(() => 'blue'));
      }
    });
});
