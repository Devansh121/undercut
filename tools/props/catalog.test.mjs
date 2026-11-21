import fs from 'node:fs';
import { describe, it, expect } from 'vitest';

const catalog = JSON.parse(fs.readFileSync('packages/render/data/props.catalog.json', 'utf8'));
describe('shipped prop catalogue', () => {
  it('defines the delivery frame and unique ids', () => {
    expect([catalog.units, catalog.up, catalog.front, catalog.pivot]).toEqual([
      'm',
      '+Y',
      '+X',
      'ground-centre',
    ]);
    expect(new Set(catalog.props.map((p) => p.id)).size).toBe(catalog.props.length);
  });
  for (const prop of catalog.props)
    it(`${prop.id} has measured compressed LODs and sane attachment data`, () => {
      expect(prop.pivot).toEqual([0, 0, 0]);
      if (prop.id.includes('seated')) {
        // Seat contact (thigh undersides) measured at build time: chair height, below the 0.50 m hip joint.
        const seat = prop.attachments.find((a) => a.name === 'seat');
        expect(seat).toMatchObject({ name: 'seat', front: '+X' });
        expect([seat.position[0], seat.position[2]]).toEqual([0, 0]);
        expect(seat.position[1]).toBeGreaterThan(0.36);
        expect(seat.position[1]).toBeLessThan(0.47);
      }
      expect(prop.bounds.min[1]).toBeGreaterThanOrEqual(-0.005);
      for (let i = 0; i < 3; i++) {
        expect(prop.bounds.max[i]).toBeGreaterThan(prop.bounds.min[i]);
        expect(Number.isFinite(prop.bounds.max[i])).toBe(true);
        expect(prop.bounds.max[i] - prop.bounds.min[i]).toBeLessThan(30);
      }
      expect(prop.lods).toHaveLength(3);
      let last = 0;
      let triangles = Infinity;
      for (const lod of prop.lods) {
        expect(lod.file).toMatch(/^assets\/props\/[a-z0-9_-]+\.glb$/);
        const data = fs.readFileSync(`apps/web/public/${lod.file}`);
        expect(data.readUInt32LE(0)).toBe(0x46546c67);
        expect(data.readUInt32LE(8)).toBe(data.length);
        const gltf = JSON.parse(data.subarray(20, 20 + data.readUInt32LE(12)).toString());
        for (const node of gltf.nodes) {
          expect(node.translation ?? [0, 0, 0]).toEqual([0, 0, 0]);
          expect(node.rotation ?? [0, 0, 0, 1]).toEqual([0, 0, 0, 1]);
          expect(node.scale ?? [1, 1, 1]).toEqual([1, 1, 1]);
        }
        if (lod === prop.lods[0]) {
          const positions = gltf.meshes.flatMap((m) =>
            m.primitives.map((p) => gltf.accessors[p.attributes.POSITION]),
          );
          for (let axis = 0; axis < 3; axis++) {
            expect(Math.min(...positions.map((a) => a.min[axis]))).toBeCloseTo(
              prop.bounds.min[axis],
              4,
            );
            expect(Math.max(...positions.map((a) => a.max[axis]))).toBeCloseTo(
              prop.bounds.max[axis],
              4,
            );
          }
          expect(gltf.materials.map((m) => m.name).sort()).toEqual([...prop.materials].sort());
        }
        if (prop.id.startsWith('crew-') || prop.id.startsWith('crowd-')) {
          expect(gltf.materials.some((m) => m.name === 'dark-steel')).toBe(false);
          const fabric = gltf.materials.find((m) => m.name === 'dark-fabric');
          if (!prop.id.includes('mechanic')) {
            expect(fabric).toBeDefined();
            expect(fabric.pbrMetallicRoughness.metallicFactor).toBe(0);
          }
        }
        const count = gltf.meshes.reduce(
          (n, m) =>
            n +
            m.primitives.reduce((s, p) => {
              expect(p.extensions.KHR_draco_mesh_compression).toBeDefined();
              expect(p.attributes.COLOR_0).toBeDefined();
              return s + gltf.accessors[p.indices].count / 3;
            }, 0),
          0,
        );
        expect(count).toBe(lod.triangles);
        expect(count).toBeLessThanOrEqual(lod.triangleBudget);
        expect(count).toBeLessThanOrEqual(triangles);
        expect(data.length).toBe(lod.bytes);
        expect(lod.maxDistance).toBeGreaterThan(last);
        last = lod.maxDistance;
        triangles = count;
        if (prop.id === 'start-gantry') {
          for (let i = 0; i < 5; i++)
            expect(gltf.nodes.some((n) => n.name === `start-light-${i}`)).toBe(true);
        }
      }
      for (const point of prop.attachments) {
        expect(point.name.length).toBeGreaterThan(0);
        for (let i = 0; i < 3; i++) expect(Number.isFinite(point.position[i])).toBe(true);
      }
      expect(prop.tiles ? prop.moduleLength > 0 : prop.moduleLength === 0).toBe(true);
    });
  it('keeps the complete kit below 4 MB', () => {
    const total = catalog.props.flatMap((p) => p.lods).reduce((n, l) => n + l.bytes, 0);
    expect(catalog.totalBytes).toBe(total);
    expect(total).toBeLessThan(4_000_000);
  });
});
