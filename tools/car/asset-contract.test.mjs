import fs from 'node:fs';
import { it, expect } from 'vitest';

it('publishes the triangle counts and draw counts measured from the shipped car GLBs', () => {
  const doc = fs.readFileSync('docs/car-asset.md', 'utf8');
  const evidence = JSON.parse(fs.readFileSync('docs/evidence/m2-car/stats.json', 'utf8'));
  for (const [lod, budget] of [
    ['high', 120000],
    ['mobile', 40000],
    ['far', 12000],
  ]) {
    const data = fs.readFileSync(`apps/web/public/assets/car/car_${lod}.glb`);
    const gltf = JSON.parse(data.subarray(20, 20 + data.readUInt32LE(12)).toString());
    const primitives = gltf.meshes.flatMap((m) => m.primitives);
    const triangles = primitives.reduce((n, p) => n + gltf.accessors[p.indices].count / 3, 0);
    expect(triangles).toBeLessThanOrEqual(budget);
    expect(evidence[lod].triangles).toBe(triangles);
    const row = doc.split('\n').find((line) => line.startsWith(`| \`car_${lod}.glb\``));
    expect(row).toBeDefined();
    expect(Number(row.split('|')[3].replaceAll(',', '').trim())).toBe(triangles);
    expect(Number(row.split('|')[4].trim())).toBe(primitives.length);
  }
});
