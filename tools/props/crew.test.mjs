import { it, expect } from 'vitest';
import { decodeGlb } from './draco.mjs';

it('the crouched High overall connects the torso, pelvis and both trouser legs', () => {
  const garment = decodeGlb('apps/web/public/assets/props/crew-mechanic-crouched_high.glb').find(
    (p) => p.material === 'clothing',
  );
  const pos = garment.POSITION.values;
  const weld = new Map();
  const ids = [];
  const parent = [];
  const points = [];
  for (let i = 0; i < pos.length; i += 3) {
    const point = pos.slice(i, i + 3);
    const key = point.map((v) => Math.round(v * 10000)).join(',');
    if (!weld.has(key)) {
      const index = parent.length;
      weld.set(key, index);
      parent.push(index);
      points.push(point);
    }
    ids.push(weld.get(key));
  }
  const root = (v) => {
    while (parent[v] !== v) {
      parent[v] = parent[parent[v]];
      v = parent[v];
    }
    return v;
  };
  for (let i = 0; i < garment.indices.length; i += 3) {
    const a = root(ids[garment.indices[i]]);
    parent[root(ids[garment.indices[i + 1]])] = a;
    parent[root(ids[garment.indices[i + 2]])] = a;
  }
  const bounds = new Map();
  for (let i = 0; i < points.length; i++) {
    const key = root(i);
    if (!bounds.has(key)) bounds.set(key, { min: [...points[i]], max: [...points[i]] });
    const b = bounds.get(key);
    for (let axis = 0; axis < 3; axis++) {
      b.min[axis] = Math.min(b.min[axis], points[i][axis]);
      b.max[axis] = Math.max(b.max[axis], points[i][axis]);
    }
  }
  // One connected surface reaches from the trouser cuffs through the hips to the chest,
  // across both legs. Separate overlapping closed shells cannot satisfy this condition.
  expect(
    [...bounds.values()].some(
      (b) => b.min[1] < 0.15 && b.max[1] > 0.95 && b.max[2] - b.min[2] > 0.25,
    ),
  ).toBe(true);
});
