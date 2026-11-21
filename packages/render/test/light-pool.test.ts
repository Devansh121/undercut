import { describe, expect, it } from 'vitest';
import { LightPool, type LocalLight } from '../src/lighting/light-pool';

const light = (x: number, distance = 50): LocalLight => ({
  x,
  y: 10,
  z: 0,
  colour: '#ffffff',
  intensity: 100,
  distance,
});

describe('LightPool.pick', () => {
  it('returns the nearest lights by distance over reach, best first, and the next one as the edge', () => {
    const lights = [light(400), light(30), light(-90), light(10), light(250), light(60, 200)];
    const out: number[] = [];
    const edge = LightPool.pick(lights, { x: 0, y: 10, z: 0 }, 3, out);
    // Scores: 8, 0.6, 1.8, 0.2, 5, 0.3.
    expect(out).toEqual([3, 5, 1]);
    expect(edge).toBeCloseTo(90 / 50, 9);
  });

  it('with fewer lights than slots returns them all and no edge', () => {
    const out: number[] = [];
    const edge = LightPool.pick([light(20), light(5)], { x: 0, y: 10, z: 0 }, 8, out);
    expect(out).toEqual([1, 0]);
    expect(edge).toBe(Infinity);
  });

  it('agrees with a full sort on a large field', () => {
    const lights = Array.from({ length: 300 }, (_, i) =>
      light(((i * 7919) % 6000) - 3000, 40 + (i % 7) * 10),
    );
    const eye = { x: 123, y: 10, z: 0 };
    const score = (l: LocalLight): number =>
      Math.hypot(l.x - eye.x, l.y - eye.y, l.z - eye.z) / l.distance;
    const sorted = lights.map((_, i) => i).sort((a, b) => score(lights[a]!) - score(lights[b]!));
    const out: number[] = [];
    const edge = LightPool.pick(lights, eye, 8, out);
    expect(out).toEqual(sorted.slice(0, 8));
    expect(edge).toBeCloseTo(score(lights[sorted[8]!]!), 9);
  });
});
