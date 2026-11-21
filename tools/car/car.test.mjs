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
