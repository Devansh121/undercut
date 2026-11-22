import fs from 'node:fs';
import crypto from 'node:crypto';
import { it, expect } from 'vitest';

// The record tools/props/swap.mjs writes: Mobile against Far where Far is drawn (250 m and 300 m,
// full scene, three lightings, twelve azimuths). It must belong to the shipped files and pass.
const record = JSON.parse(fs.readFileSync('docs/evidence/m2-models/forest-swap.json'));
const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

for (const id of ['forest-spruce', 'forest-fir'])
  it(`${id} keeps its tone and density through the Mobile to Far swap`, () => {
    for (const light of ['overcast', 'afternoon', 'night']) {
      const r = record[light][id];
      for (const lod of ['mobile', 'far'])
        expect(r.files[lod]).toBe(sha(`apps/web/public/assets/props/${id}_${lod}.glb`));
      expect(r.samples).toHaveLength(24);
      const keys = r.samples.map((s) => `${Math.round((s.angle * 180) / Math.PI)}@${s.distance}`);
      for (let k = 0; k < 12; k++)
        for (const d of [250, 300]) expect(keys).toContain(`${k * 30}@${d}`);
      for (const s of r.samples) {
        expect(s.coverage[0]).toBeGreaterThan(0);
        expect(s.solid[0]).toBeGreaterThan(0);
        expect(Math.abs(s.interior.far / s.interior.mobile - 1)).toBeLessThanOrEqual(0.15);
        expect(Math.abs(s.region.far / s.region.mobile - 1)).toBeLessThanOrEqual(0.15);
        expect(Math.abs(s.solid[1] / s.solid[0] - 1)).toBeLessThanOrEqual(0.15);
        expect(s.coverage[0] / s.coverage[1]).toBeGreaterThanOrEqual(0.85);
        expect(s.coverage[0] / s.coverage[1]).toBeLessThanOrEqual(1.2);
      }
    }
  });
