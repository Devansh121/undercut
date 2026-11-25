import { BufferAttribute, BufferGeometry, Group, Mesh, MeshStandardMaterial } from 'three';
import { describe, expect, it } from 'vitest';
import { PropKitAssets, type PropCatalog } from '../src/props/catalog';

const catalog: PropCatalog = {
  version: 1,
  units: 'm',
  up: '+Y',
  front: '+X',
  pivot: 'ground-centre',
  props: [
    { id: 'panel', pivot: [0, 0, 0], tiles: false, moduleLength: 1, tileAxis: '+Z', lods: [] },
  ],
};

function triangle(normal = [0, 0, 1], uvOffset = 0): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    'position',
    new BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0]), 3),
  );
  geometry.setAttribute(
    'normal',
    new BufferAttribute(new Float32Array([...normal, ...normal, ...normal]), 3),
  );
  geometry.setAttribute(
    'uv',
    new BufferAttribute(new Float32Array([uvOffset, 0, 1 + uvOffset, 0, 1 + uvOffset, 1]), 2),
  );
  return geometry;
}

function load(root: Group): PropKitAssets {
  return PropKitAssets.fromScenes(
    catalog,
    new Map([['panel', [{ scene: root, maxDistance: 80 }]]]),
  );
}

function expanded(geometry: BufferGeometry, name: string): number[] {
  const attr = geometry.getAttribute(name);
  return Array.from(
    { length: (geometry.index?.count ?? attr.count) * attr.itemSize },
    (_, offset) => {
      const vertex = Math.floor(offset / attr.itemSize);
      const index = geometry.index?.getX(vertex) ?? vertex;
      return attr.getComponent(index, offset % attr.itemSize);
    },
  );
}

describe('prop vertex reuse', () => {
  it('shares identical packed vertices without changing triangle order or any corner attributes', () => {
    const root = new Group();
    const material = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, metalness: 0.25 });
    root.add(new Mesh(triangle(), material), new Mesh(triangle(), material));
    const kit = load(root);
    const lod = kit.lodsFor('panel')![0]!;
    expect(lod.geometry.index?.count).toBe(6);
    expect(lod.geometry.getAttribute('position').count).toBe(3);
    expect(expanded(lod.geometry, 'position')).toEqual([
      0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 0, 0, 1, 0, 0, 1, 1, 0,
    ]);
    expect(expanded(lod.geometry, 'normal')).toEqual(
      Array.from({ length: 6 }, () => [0, 0, 1]).flat(),
    );
    expect(expanded(lod.geometry, 'uv')).toEqual([0, 0, 1, 0, 1, 1, 0, 0, 1, 0, 1, 1]);
    expect(expanded(lod.geometry, 'color')).toEqual(new Array(18).fill(1));
    expect(expanded(lod.geometry, 'aPropPbr')).toEqual(
      Array.from({ length: 6 }, () => [0.5, 0.25, 0]).flat(),
    );
    expect(lod.geometry.groups).toEqual([{ start: 0, count: 6, materialIndex: 0 }]);
    kit.dispose();
  });

  it.each(['normal', 'uv', 'color', 'roughness', 'metalness', 'tint'] as const)(
    'keeps %s seams separate',
    (seam) => {
      const a = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, metalness: 0.25 });
      const b = a.clone();
      if (seam === 'color') b.color.setRGB(0, 1, 0);
      if (seam === 'roughness') b.roughness = 0.75;
      if (seam === 'metalness') b.metalness = 0.5;
      if (seam === 'tint') b.name = 'seat';
      const root = new Group();
      root.add(
        new Mesh(triangle(), a),
        new Mesh(triangle(seam === 'normal' ? [0, 1, 0] : [0, 0, 1], seam === 'uv' ? 0.5 : 0), b),
      );
      const kit = load(root);
      const lod = kit.lodsFor('panel')![0]!;
      expect(lod.geometry.index?.count).toBe(6);
      expect(lod.geometry.getAttribute('position').count).toBe(6);
      kit.dispose();
    },
  );

  it('preserves draw-group ranges and material overrides when corners can be shared across groups', () => {
    const a = new MeshStandardMaterial();
    const b = a.clone();
    b.name = 'board-face';
    const override = new MeshStandardMaterial({ color: 0x123456 });
    const root = new Group();
    root.add(new Mesh(triangle(), a), new Mesh(triangle(), b));
    const kit = load(root);
    const lod = kit.lodsFor('panel', { materialOverrides: { 'board-face': override } })![0]!;
    expect(lod.geometry.index?.count).toBe(6);
    expect(lod.geometry.getAttribute('position').count).toBe(3);
    expect(lod.geometry.groups).toEqual([
      { start: 0, count: 3, materialIndex: 0 },
      { start: 3, count: 3, materialIndex: 1 },
    ]);
    expect(Array.isArray(lod.material) && lod.material[1]).toBe(override);
    kit.dispose();
    override.dispose();
  });
});
