import {
  BoxGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  MeshStandardMaterial,
  type Material,
} from 'three';
import { describe, expect, it } from 'vitest';
import { isLitMaterial, unregisteredLitMaterials } from '../src/lighting/registration';
import { PropRegistry } from '../src/props/registry';

describe('cascade registration', () => {
  it('finds lit materials that were not registered, and ignores unlit ones', () => {
    const g = new BoxGeometry();
    const root = new Group();
    const ok = new MeshStandardMaterial({ name: 'ok' });
    const missed = new MeshStandardMaterial({ name: 'missed' });
    const lambert = new MeshLambertMaterial({ name: 'lambert' });
    root.add(
      new Mesh(g, ok),
      new Mesh(g, missed),
      new Mesh(g, lambert),
      new Mesh(g, new MeshBasicMaterial()),
    );
    const registered = new Set<Material>([ok]);
    expect(isLitMaterial(new MeshBasicMaterial())).toBe(false);
    expect(
      unregisteredLitMaterials(root, (m) => registered.has(m))
        .map((m) => m.name)
        .sort(),
    ).toEqual(['lambert', 'missed']);
  });

  it('the prop registry hands its meshes to the registration hook when it builds', () => {
    const seen: unknown[] = [];
    const props = new PropRegistry(1000, 200, (root) => seen.push(root));
    props.define({
      id: 'post',
      lods: [
        { geometry: new BoxGeometry(), material: new MeshStandardMaterial(), maxDistance: 100 },
      ],
    });
    props.place('post', { s: 10, x: 0, y: 0, z: 0 });
    props.build();
    expect(seen).toEqual([props.group]);
  });
});
