import type { InstancedMesh } from 'three';
import { BoxGeometry, Matrix4, MeshBasicMaterial, Vector3 } from 'three';
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

describe('breakable instance events', () => {
  it('animates every level and both face and frame identically for local and remote hit data', async () => {
    const { createCarPose } = await import('@undercut/sim');
    const geo = new BoxGeometry(0.1, 0.88, 4.36);
    const mat = new MeshBasicMaterial();
    const o = { id: 7, x: 8, y: 0, z: 0, yaw: 0, halfWidth: 2.18, halfDepth: 0.34, mass: 12 };
    const make = () => {
      const r = new PropRegistry(1000);
      for (const kind of ['face', 'frame']) {
        r.define({
          id: kind,
          lods: [50, 500].map((maxDistance) => ({ geometry: geo, material: mat, maxDistance })),
        });
        r.place(kind, { ...o, s: 8, breakable: o });
      }
      r.build();
      return r;
    };
    const a = make(),
      b = make();
    const pose = createCarPose();
    pose.breakableHits!.set([7, 0.125, 24.51, -2.34], 0);
    const remote = createCarPose();
    remote.breakableHits!.set(pose.breakableHits!);
    const player = createCarPose();
    player.brokenObjects![0] = 1 << 7;
    a.observeCar(player, 2);
    a.observeCar(pose, 2);
    b.observeCar(remote, 2);
    for (const time of [2, 2.1, 2.8, 5, 15]) {
      a.updateDebris(time);
      b.updateDebris(time);
      const matrices = a.group.children.map((m) =>
        Array.from((m as InstancedMesh).instanceMatrix.array),
      );
      if (time === 2) expect(matrices[0]!.slice(0, 12).some((v) => Math.abs(v) > 0.01)).toBe(true);
      expect(matrices).toEqual(
        b.group.children.map((m) => Array.from((m as InstancedMesh).instanceMatrix.array)),
      );
      expect(matrices.every((m) => m.every((v, i) => v === matrices[0]![i]))).toBe(true);
    }
    a.dispose();
    b.dispose();
    geo.dispose();
    mat.dispose();
  });
});

it('keeps shared verge-board contact edges within 0.3 m of both drawn parts', async () => {
  const { vergeBoardFrontGeometry, vergeBoardFrameGeometry } =
    await import('../src/world/furniture');
  for (const g of [vergeBoardFrontGeometry(), vergeBoardFrameGeometry()]) {
    g.computeBoundingBox();
    const b = g.boundingBox!;
    expect(Math.abs(b.max.z - 2.18)).toBeLessThan(0.3);
    expect(Math.abs(b.min.z + 2.18)).toBeLessThan(0.3);
    expect(Math.max(Math.abs(b.min.x), Math.abs(b.max.x))).toBeLessThanOrEqual(0.34 + 1e-6);
    g.dispose();
  }
});

it('draws the shared contact objects even when Lite omits the scenery file', async () => {
  const { placeLightweightFallback } = await import('../src/props/lightweight');
  const { Track, tracksideObjects } = await import('@undercut/track');
  const { syntheticTrackData } = await import('../../track/test/fixtures');
  const track = Track.fromJSON(syntheticTrackData());
  const reg = new PropRegistry(track.length);
  const release = placeLightweightFallback(track, reg);
  expect(reg.instanceCount).toBe(tracksideObjects(track).length);
  expect(reg.instanceCount).toBeGreaterThan(0);
  reg.build();
  reg.dispose();
  release();
});

it('caps moving debris at 32 and retains settled boards in the original instances', async () => {
  const { createCarPose } = await import('@undercut/sim');
  const geo = new BoxGeometry(0.1, 1, 4);
  const material = new MeshBasicMaterial();
  const reg = new PropRegistry(1000, 1000);
  reg.define({ id: 'board', lods: [{ geometry: geo, material, maxDistance: 1000 }] });
  for (let id = 0; id < 40; id++) {
    const o = { id, x: id * 10, y: 0, z: 0, yaw: 0, halfWidth: 2, halfDepth: 0.1, mass: 12 };
    reg.place('board', { ...o, s: o.x, breakable: o });
  }
  reg.build();
  const pose = createCarPose();
  for (let first = 0; first < 40; first += 4) {
    for (let k = 0; k < 4; k++) pose.breakableHits!.set([first + k, 0, 20, 0], k * 4);
    reg.observeCar(pose, 1);
  }
  reg.updateDebris(1.2);
  expect(reg.group.children).toHaveLength(1);
  const matrices = (reg.group.children[0] as InstancedMesh).instanceMatrix.array;
  let visible = 0;
  for (let i = 0; i < 40; i++)
    if (Math.hypot(matrices[i * 16]!, matrices[i * 16 + 1]!, matrices[i * 16 + 2]!) > 0.5)
      visible++;
  expect(visible).toBe(40);
  expect(reg.movingDebrisCount).toBe(32);
  reg.dispose();
  geo.dispose();
  material.dispose();
});

it('lays a settled board flat on the ground, not standing on one end', async () => {
  const { createCarPose } = await import('@undercut/sim');
  const geo = new BoxGeometry(0.68, 0.88, 4.36).translate(0, 0.44, 0);
  const material = new MeshBasicMaterial();
  const reg = new PropRegistry(1000, 1000);
  reg.define({ id: 'board', lods: [{ geometry: geo, material, maxDistance: 1000 }] });
  const o = { id: 0, x: 0, y: 0, z: 0, yaw: 0, halfWidth: 2.18, halfDepth: 0.34, mass: 12 };
  reg.place('board', { ...o, s: 0, breakable: o });
  reg.build();
  const pose = createCarPose();
  pose.breakableHits!.set([0, 0, 25, 0], 0);
  reg.observeCar(pose, 1);
  reg.updateDebris(30);
  const mesh = reg.group.children[0] as InstancedMesh;
  const m = new Matrix4();
  mesh.getMatrixAt(0, m);
  const box = geo.boundingBox ?? (geo.computeBoundingBox(), geo.boundingBox!);
  const world = box.clone().applyMatrix4(m);
  // Resting on the ground at its depth: the 4.36 m width stays level, the face points up or down.
  expect(world.min.y).toBeGreaterThanOrEqual(-0.01);
  expect(world.max.y - world.min.y).toBeLessThan(0.7);
  expect(Math.max(world.max.x - world.min.x, world.max.z - world.min.z)).toBeGreaterThan(4);
  reg.dispose();
  geo.dispose();
  material.dispose();
});
