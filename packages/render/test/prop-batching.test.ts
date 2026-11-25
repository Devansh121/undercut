import { BoxGeometry, Matrix4, MeshBasicMaterial, Scene, Vector3, type InstancedMesh } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { PropRegistry, SHADOW_CASTER_LAYER } from '../src/props/registry';
import { markReflected, REFLECT_LAYER } from '../src/world/water';

function instances(reg: PropRegistry, shadow = false): string[] {
  const rows: string[] = [];
  const matrix = new Matrix4();
  for (const object of reg.group.children) {
    const mesh = object as InstancedMesh;
    if (!mesh.visible || mesh.layers.isEnabled(SHADOW_CASTER_LAYER) !== shadow) continue;
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, matrix);
      const colour = mesh.instanceColor
        ? Array.from(mesh.instanceColor.array.slice(i * 3, i * 3 + 3))
        : [1, 1, 1];
      rows.push(JSON.stringify([mesh.geometry.uuid, matrix.elements, colour]));
    }
  }
  return rows.sort();
}

describe('far and shadow batches', () => {
  it.each([
    [false, false, false],
    [true, false, false],
    [true, true, false],
    [true, true, true],
  ])(
    'keeps every matrix, tint, LOD and fine-cell shadow selection (shadows %s, shadowBatch %s, nearBatch %s)',
    (shadows, shadowBatch, nearBatch) => {
      const geometries = [
        new BoxGeometry(1, 2, 1),
        new BoxGeometry(1, 2, 1),
        new BoxGeometry(1, 2, 1),
      ];
      const material = new MeshBasicMaterial();
      const make = (batch: boolean) => {
        const reg = new PropRegistry(2000);
        reg.define({
          id: 'bank',
          gridCell: 40,
          ...(batch && { farBatchCell: 200 }),
          ...(batch && nearBatch && { nearBatchCell: 200 }),
          ...(batch && shadowBatch && { shadowBatchCell: 200 }),
          reflect: 'skyline',
          castShadow: shadows,
          shadowLevel: 2,
          shadowMaxDistance: 100,
          lods: geometries.map((geometry, i) => ({
            geometry,
            material,
            maxDistance: [8, 25, 650][i]!,
          })),
        });
        for (let i = 0; i < 30; i++)
          reg.place('bank', {
            x: i * 12,
            y: i % 2,
            z: (i % 3) * 8,
            s: i * 12,
            yaw: i * 0.1,
            stretch: [1 + i / 20, 1, 1],
            ...(i % 3 ? { colour: [i / 30, 0.5, 0.8] as const } : {}),
          });
        reg.build();
        return reg;
      };
      const control = make(false),
        batch = make(true);
      expect(batch.group.children.length).toBeLessThan(control.group.children.length);
      const scene = new Scene();
      scene.add(batch.group);
      markReflected(scene, false);
      const visualBatches = batch.group.children.filter((m) => m.name === 'prop:bank');
      expect(visualBatches.length).toBeGreaterThan(0);
      expect(visualBatches.every((m) => m.layers.isEnabled(REFLECT_LAYER))).toBe(true);
      const eyes = [
        -100, -99.999, -99.998, 0, 1, 2, 8, 24.99, 25, 100, 500, 1000, 1200, 0, 50, 180,
      ].map((x) => new Vector3(x, 2, 0));
      for (let i = 0; i < 40; i++) eyes.push(new Vector3(Math.sin(i) * 600, 3, Math.cos(i) * 80));
      for (const eye of eyes) {
        const cold = make(false);
        cold.update(eye);
        batch.update(eye);
        expect(instances(batch), `visuals at ${eye.toArray()}`).toEqual(instances(cold));
        expect(instances(batch, true), `shadows at ${eye.toArray()}`).toEqual(
          instances(cold, true),
        );
        // A stationary frame must retain the same packed contents without duplication.
        batch.update(eye);
        expect(instances(batch)).toEqual(instances(cold));
        expect(instances(batch, true)).toEqual(instances(cold, true));
        cold.dispose();
      }
      const eye = new Vector3(-100, 2, 0);
      control.update(eye);
      batch.update(eye);
      const draws = (r: PropRegistry, shadow = false) =>
        r.group.children.filter(
          (m) => m.visible && m.layers.isEnabled(SHADOW_CASTER_LAYER) === shadow,
        ).length;
      expect(draws(batch, false)).toBeLessThan(draws(control, false));
      if (shadows && shadowBatch) {
        const nearEye = new Vector3(120, 2, 0);
        control.update(nearEye);
        batch.update(nearEye);
        expect(draws(batch, true)).toBeLessThan(draws(control, true));
      }
      for (const object of batch.group.children) {
        const mesh = object as InstancedMesh;
        if (!mesh.visible) continue;
        const matrix = new Matrix4();
        for (let i = 0; i < mesh.count; i++) {
          mesh.getMatrixAt(i, matrix);
          const point = new Vector3().setFromMatrixPosition(matrix);
          expect(mesh.boundingSphere!.containsPoint(point)).toBe(true);
        }
      }
      control.dispose();
      batch.dispose();
      geometries.forEach((g) => g.dispose());
      material.dispose();
    },
  );

  it('allows farBatchCell when direct shadows stop before the far level', () => {
    const nearGeo = new BoxGeometry(1, 3, 1);
    const farGeo = new BoxGeometry(1, 2, 1);
    const material = new MeshBasicMaterial();
    const reg = new PropRegistry(2000);
    reg.define({
      id: 'tree-wood',
      gridCell: 100,
      farBatchCell: 500,
      reflect: 'scenery',
      castShadow: true,
      shadowMaxDistance: 120,
      lods: [
        { geometry: nearGeo, material, maxDistance: 200 },
        { geometry: farGeo, material, maxDistance: 1000 },
      ],
    });
    for (let i = 0; i < 10; i++) reg.place('tree-wood', { x: i * 100, y: 0, z: 0, s: i * 100 });
    reg.build();
    reg.update(new Vector3(0, 2, 0));
    const visible = reg.group.children.filter((m) => m.visible) as InstancedMesh[];
    const nearCasting = visible.filter((m) => m.geometry === nearGeo && m.castShadow);
    const farVisible = visible.filter((m) => m.geometry === farGeo);
    expect(nearCasting.length).toBeGreaterThan(0);
    expect(farVisible.length).toBeGreaterThan(0);
    expect(farVisible.every((m) => !m.castShadow)).toBe(true);
    reg.dispose();
    nearGeo.dispose();
    farGeo.dispose();
    material.dispose();
  });

  it('skips per-frame child matrixWorld walks when props world transform is unchanged', () => {
    const geometry = new BoxGeometry(1, 1, 1);
    const material = new MeshBasicMaterial();
    const reg = new PropRegistry(1000);
    reg.define({ id: 'post', lods: [{ geometry, material, maxDistance: 200 }] });
    reg.place('post', { x: 10, y: 0, z: 0, s: 10 });
    reg.build();
    const scene = new Scene();
    scene.add(reg.group);
    scene.updateMatrixWorld();
    const child = reg.group.children[0] as InstancedMesh;
    const spy = vi.spyOn(child, 'updateMatrixWorld');
    // Normal render-loop calls (even with default Scene.matrixAutoUpdate = true) skip static children.
    scene.updateMatrixWorld();
    expect(spy).not.toHaveBeenCalled();
    // Moving an ancestor still propagates down to children.
    scene.position.set(5, 0, 0);
    scene.updateMatrixWorld();
    expect(spy).toHaveBeenCalledOnce();
    expect(child.matrixWorld.elements[12]).toBe(5);
    reg.dispose();
    geometry.dispose();
    material.dispose();
  });
});
