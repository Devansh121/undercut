import { PerspectiveCamera, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { MirrorCamera, reflectedByName, SLOPE_RANGE, waveSlopes } from '../src/world/water';

describe('water waves', () => {
  const n = 64;
  const s = waveSlopes(n);
  const at = (i: number, j: number, c: number): number =>
    s[((((j % n) + n) % n) * n + (((i % n) + n) % n)) * 3 + c] as number;

  it('tiles without a seam: across the edge the slopes change no more than inside the tile', () => {
    let inside = 0;
    let edge = 0;
    for (let j = 0; j < n; j++) {
      for (let c = 0; c < 2; c++) {
        inside = Math.max(inside, Math.abs(at(n / 2, j, c) - at(n / 2 - 1, j, c)));
        edge = Math.max(edge, Math.abs(at(0, j, c) - at(n - 1, j, c)));
      }
    }
    expect(edge).toBeLessThan(inside * 1.5);
  });

  it('keeps the slopes inside the stored range and averages them to level water', () => {
    let sx = 0;
    let sz = 0;
    let out = 0;
    for (let p = 0; p < n * n; p++) {
      const x = s[p * 3] as number;
      const z = s[p * 3 + 1] as number;
      sx += x;
      sz += z;
      if (Math.abs(x) > SLOPE_RANGE || Math.abs(z) > SLOPE_RANGE) out++;
    }
    expect(Math.abs(sx / (n * n))).toBeLessThan(0.02);
    expect(Math.abs(sz / (n * n))).toBeLessThan(0.02);
    // Clipping at the range may touch the odd extreme texel, no more.
    expect(out / (n * n)).toBeLessThan(0.005);
  });

  it('stores slopes that are the derivative of the stored height', () => {
    // Central difference of the height (per tile unit) against the stored slope.
    let err = 0;
    let mag = 0;
    for (let j = 0; j < n; j += 7) {
      for (let i = 0; i < n; i += 5) {
        const dh = ((at(i + 1, j, 2) - at(i - 1, j, 2)) * n) / 2;
        err += Math.abs(dh - at(i, j, 0));
        mag += Math.abs(at(i, j, 0));
      }
    }
    expect(err / mag).toBeLessThan(0.25);
  });
});

describe('water reflection', () => {
  it('draws a point above the water where the eye sees its mirror image in the water', () => {
    const main = new PerspectiveCamera(50, 16 / 9, 0.1, 5000);
    main.position.set(12, 9, -30);
    main.lookAt(60, 0.5, 40);
    main.updateMatrixWorld();
    main.updateProjectionMatrix();
    const level = 1.2;
    const mirror = new MirrorCamera();
    mirror.update(main, level);
    const tower = new Vector3(80, 40, 90);
    // The eye sees the tower's reflection where the ray to its mirror image meets the water.
    const image = tower.clone().setY(2 * level - tower.y);
    const eye = main.position;
    const t = (eye.y - level) / (eye.y - image.y);
    const onWater = eye.clone().lerp(image, t);
    const screen = onWater.clone().project(main);
    // The reflection target's uv of the water point (the shader's lookup) is the tower's uv in
    // the mirrored camera's image.
    const tc = onWater.clone().applyMatrix4(mirror.texture);
    const towerInMirror = tower.clone().project(mirror.camera);
    expect(tc.x).toBeCloseTo(towerInMirror.x * 0.5 + 0.5, 4);
    expect(tc.y).toBeCloseTo(towerInMirror.y * 0.5 + 0.5, 4);
    // The reflection's image is the frame mirrored left to right: whatever water is on screen
    // is inside it, so the target covers every visible water point.
    expect(tc.x).toBeCloseTo(1 - (screen.x * 0.5 + 0.5), 4);
    expect(tc.y).toBeCloseTo(screen.y * 0.5 + 0.5, 4);
  });

  it('clips everything under the water out of the reflection', () => {
    const main = new PerspectiveCamera(60, 1.5, 0.1, 3000);
    main.position.set(0, 6, 0);
    main.lookAt(0, 0, 100);
    main.updateMatrixWorld();
    const mirror = new MirrorCamera();
    mirror.update(main, 0);
    const depth = (p: Vector3): number => p.clone().project(mirror.camera).z;
    // Above the water: inside the depth range. Below it: in front of the near plane.
    expect(Math.abs(depth(new Vector3(0, 3, 80)))).toBeLessThan(1);
    expect(depth(new Vector3(0, -3, 80))).toBeLessThan(-1);
  });

  it('reflects the sky and the skyline everywhere, the circuit and trees only with scenery', () => {
    const kit = (n: string): boolean => n.startsWith('prop:marina-');
    for (const name of ['sky', 'world:buildings-3', 'world:stands', 'prop:marina-hotel']) {
      expect(reflectedByName(name, false, kit), name).toBe(true);
    }
    for (const name of ['track', 'world:ground-2', 'prop:tree-wood', 'prop:floodlight-mast']) {
      expect(reflectedByName(name, false, kit), name).toBe(false);
      expect(reflectedByName(name, true, kit), name).toBe(true);
    }
    for (const name of ['world:water-0', 'prop:crowd', 'fleet', 'car']) {
      expect(reflectedByName(name, true, kit), name).toBe(false);
    }
  });
});
