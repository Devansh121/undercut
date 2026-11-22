import fs from 'node:fs';
import { describe, it, expect } from 'vitest';
import { decodeGlb } from './draco.mjs';

const catalogue = JSON.parse(fs.readFileSync('packages/render/data/props.catalog.json', 'utf8'));

// The contract puts the pivot on the ground at the centre of the footprint. The footprint is
// what touches the ground: every High vertex within 3 cm of the lowest point. Its centre must
// sit within 5 cm of the origin across the prop (x); along a tiling module's run (z) the posts
// belong to the starting end, so z is checked only on props that do not tile.
const TOLERANCE = 0.05;
// Slice 1 props whose ground contact is off-centre by design, measured on the shipped files.
// Their offsets are pinned (1 cm) so a change is caught; new props get no entry here.
const KNOWN = {
  'armco-two': [-0.15, 'posts stand behind the rail'],
  'armco-three': [-0.15, 'posts stand behind the rail'],
  'pit-wall': [-0.555, 'the timing stand stands behind the wall'],
  'crew-engineer-seated': [0.4, 'seated: the pivot is under the seat, the feet are ahead'],
  'crowd-seated-0': [0.4, 'seated: the pivot is under the seat, the feet are ahead'],
  'crowd-seated-1': [0.4, 'seated: the pivot is under the seat, the feet are ahead'],
  'crowd-seated-2': [0.4, 'seated: the pivot is under the seat, the feet are ahead'],
  'braking-board': [-0.06, 'posts stand behind the board face'],
  'zone-board': [-0.06, 'posts stand behind the board face'],
  'corner-board': [-0.06, 'posts stand behind the board face'],
  'kilometre-board': [-0.06, 'posts stand behind the board face'],
  hoarding: [-0.22, 'the rear strut of the angled hoarding'],
};

function footprint(file) {
  const prims = decodeGlb(file);
  let low = Infinity;
  for (const p of prims)
    for (let i = 1; i < p.POSITION.values.length; i += 3) low = Math.min(low, p.POSITION.values[i]);
  const b = [Infinity, -Infinity, Infinity, -Infinity];
  for (const p of prims) {
    const v = p.POSITION.values;
    for (let i = 0; i < v.length; i += 3)
      if (v[i + 1] < low + 0.03) {
        b[0] = Math.min(b[0], v[i]);
        b[1] = Math.max(b[1], v[i]);
        b[2] = Math.min(b[2], v[i + 2]);
        b[3] = Math.max(b[3], v[i + 2]);
      }
  }
  return { x: (b[0] + b[1]) / 2, z: (b[2] + b[3]) / 2 };
}

describe('pivot at the centre of the ground footprint', () => {
  for (const prop of catalogue.props)
    it(`${prop.id}`, () => {
      const c = footprint(`apps/web/public/${prop.lods[0].file}`);
      const [expected] = KNOWN[prop.id] ?? [0];
      expect(Math.abs(c.x - expected)).toBeLessThan(KNOWN[prop.id] ? 0.01 : TOLERANCE);
      if (!prop.tiles) expect(Math.abs(c.z)).toBeLessThan(TOLERANCE);
    });
});
