import { describe, it, expect } from 'vitest';
import { decodeGlb } from '../props/draco.mjs';

const LODS = { high: 120000, mobile: 40000, far: 12000 };

describe('shipped car levels', () => {
  for (const [lod, budget] of Object.entries(LODS)) {
    const file = `apps/web/public/assets/car/car_${lod}.glb`;
    const prims = decodeGlb(file);

    it(`${lod} stays inside its ${budget} triangle budget`, () => {
      const triangles = prims.reduce((n, p) => n + p.indices.length / 3, 0);
      expect(triangles).toBeLessThanOrEqual(budget);
    });

    if (lod !== 'far')
      it(`${lod}: gauntlet rear caps sit inside the sleeves`, () => {
        for (const side of [-1, 1]) {
          const cap = [];
          for (const p of prims) {
            if (p.material !== 'glove') continue;
            for (let i = 0; i < p.POSITION.values.length / 3; i++) {
              const v = p.POSITION.values.slice(i * 3, i * 3 + 3);
              if (v[0] < -0.06 && v[2] * side > 0.1 && p.NORMAL.values[i * 3] < -0.8) cap.push(v);
            }
          }
          expect(cap.length).toBeGreaterThanOrEqual(8);
          const center = [0, 1, 2].map(
            (i) => (Math.min(...cap.map((v) => v[i])) + Math.max(...cap.map((v) => v[i]))) / 2,
          );
          // Car frame relative to the wheel pivot. Sleeve end and previous sleeve section are
          // measured hard points; the closed glove cap must be 20 mm inside this segment.
          const end = [-0.075, -0.023, side * 0.151];
          const direction = [-0.085, 0.013, side * 0.015];
          const length = Math.hypot(...direction);
          const expected = end.map((v, i) => v + (direction[i] / length) * 0.02);
          expect(Math.hypot(...center.map((v, i) => v - expected[i]))).toBeLessThan(0.001);
        }
      });

    // The carbon's normal and anisotropy maps take their tangent frame from TEXCOORD_1. A
    // triangle whose metric UVs have no area gives a zero frame, and three.js's anisotropic
    // environment lighting then returns NaN, which bloom spreads over the whole frame. The shader
    // guards against it (car-shader.ts), and the asset must not rely on that: every triangle
    // at least 1 mm high, several 14-bit UV steps (0.37 mm), must carry real metric UV area.
    // Thinner slivers (front-wing endplate edges, 0.3 mm) cannot hold distinct UVs at any setting.
    it(`${lod}: every carbon triangle has non-degenerate metric UVs`, () => {
      let bad = 0;
      let total = 0;
      for (const p of prims) {
        if (!p.material.startsWith('carbon') || !p.TEXCOORD_1) continue;
        const uv = p.TEXCOORD_1.values;
        const pos = p.POSITION.values;
        for (let t = 0; t < p.indices.length; t += 3) {
          const [a, b, c] = [0, 1, 2].map((k) => p.indices[t + k]);
          const uvArea = Math.abs(
            (uv[b * 2] - uv[a * 2]) * (uv[c * 2 + 1] - uv[a * 2 + 1]) -
              (uv[c * 2] - uv[a * 2]) * (uv[b * 2 + 1] - uv[a * 2 + 1]),
          );
          const e1 = [0, 1, 2].map((k) => pos[b * 3 + k] - pos[a * 3 + k]);
          const e2 = [0, 1, 2].map((k) => pos[c * 3 + k] - pos[a * 3 + k]);
          const cross = [
            e1[1] * e2[2] - e1[2] * e2[1],
            e1[2] * e2[0] - e1[0] * e2[2],
            e1[0] * e2[1] - e1[1] * e2[0],
          ];
          const area = Math.hypot(...cross);
          const e3 = [0, 1, 2].map((k) => e2[k] - e1[k]);
          const longest = Math.max(Math.hypot(...e1), Math.hypot(...e2), Math.hypot(...e3));
          const height = longest > 0 ? area / longest : 0;
          total++;
          if (height >= 0.001 && uvArea < 1e-3 * area) bad++;
        }
      }
      expect(total).toBeGreaterThan(0);
      expect(bad).toBe(0);
    });
  }
});
