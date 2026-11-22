import type { InstancedMesh } from 'three';
import { BoxGeometry, MeshBasicMaterial, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { PropRegistry, bucketBySector, chunkLod, sectorOf } from '../src/props/registry';

describe('prop registry', () => {
  it('buckets placements by lap sector, wrapping past the line', () => {
    const lap = 1000;
    expect(sectorOf(0, lap, 200)).toBe(0);
    expect(sectorOf(199.9, lap, 200)).toBe(0);
    expect(sectorOf(200, lap, 200)).toBe(1);
    expect(sectorOf(1050, lap, 200)).toBe(0);
    expect(sectorOf(-10, lap, 200)).toBe(4);
    const b = bucketBySector([{ s: 10 }, { s: 950 }, { s: 210 }, { s: 1010 }], lap, 200);
    expect(b.get(0)).toEqual([0, 3]);
    expect(b.get(1)).toEqual([2]);
    expect(b.get(4)).toEqual([1]);
  });

  it('picks the nearest level that reaches, and culls beyond the last', () => {
    const lods = [{ maxDistance: 60 }, { maxDistance: 400 }];
    expect(chunkLod(10, lods)).toBe(0);
    expect(chunkLod(60, lods)).toBe(1);
    expect(chunkLod(399, lods)).toBe(1);
    expect(chunkLod(400, lods)).toBe(-1);
  });

  it('culls chunks on spheres that hold every instance whole', () => {
    // A 10 m tower whose geometry sits above its origin (bounding sphere centred at y = 5), two
    // of them 10 m apart at scale 2: the geometry, not the spread, decides the sphere.
    const tower = new BoxGeometry(1, 10, 1).translate(0, 5, 0);
    const mat = new MeshBasicMaterial();
    const reg = new PropRegistry(1000, 200);
    reg.define({ id: 'tower', lods: [{ geometry: tower, material: mat, maxDistance: 400 }] });
    reg.place('tower', { x: 0, y: 0, z: 0, s: 0, scale: 2 });
    reg.place('tower', { x: 10, y: 0, z: 0, s: 10, scale: 2 });
    reg.build();
    const sphere = (reg.group.children[0] as InstancedMesh).boundingSphere!;
    for (const x of [0, 10]) {
      for (const p of [new Vector3(x - 1, 20, 1), new Vector3(x + 1, 20, -1), new Vector3(x, 0, 1)])
        expect(p.distanceTo(sphere.center)).toBeLessThanOrEqual(sphere.radius + 1e-6);
    }
    reg.dispose();
    tower.dispose();
    mat.dispose();
  });

  it("picks a chunk's level by its near edge, so props beside the eye draw at the top level", () => {
    const post = new BoxGeometry(0.2, 1, 0.2);
    const near = new MeshBasicMaterial();
    const far = new MeshBasicMaterial();
    const reg = new PropRegistry(1000, 200);
    reg.define({
      id: 'post',
      lods: [
        { geometry: post, material: near, maxDistance: 50 },
        { geometry: post, material: far, maxDistance: 400 },
      ],
    });
    // One chunk (s 0 to 200) spread over 180 m along x.
    for (let x = 0; x <= 180; x += 20) reg.place('post', { x, y: 0, z: 0, s: x });
    reg.build();
    const [lod0, lod1] = reg.group.children as InstancedMesh[];
    // An eye beside the first post, about 95 m from the chunk's centre.
    reg.update(new Vector3(-5, 1.2, 3));
    expect(lod0!.visible).toBe(true);
    expect(lod1!.visible).toBe(false);
    reg.dispose();
    post.dispose();
    near.dispose();
    far.dispose();
  });
});
