import fs from 'node:fs';
import { it, expect } from 'vitest';
const catalog = JSON.parse(fs.readFileSync('packages/render/data/props.catalog.json'));
const prop = (id) => catalog.props.find((p) => p.id === id);
function gltf(lod) {
  const bytes = fs.readFileSync('apps/web/public/' + lod.file);
  return JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)));
}
it('keeps street walls and fencing on matching four metre seams', () => {
  for (const id of ['street-block', 'street-fence']) {
    expect(prop(id).moduleLength).toBe(4);
    expect(prop(id).tileAxis).toBe('+Z');
    const p = prop(id);
    expect(p.bounds.min[2]).toBeLessThanOrEqual(-2);
    expect(p.bounds.max[2]).toBeCloseTo(2, 1);
  }
  expect(prop('street-block').attachments.find((a) => a.name === 'fence').position[1]).toBe(1.15);
});
it('retains addressable emissive materials and lamp aim through all LODs', () => {
  for (const id of ['floodlight-mast', 'lighting-truss']) {
    const p = prop(id);
    for (const lod of p.lods) {
      const m = gltf(lod).materials.find((m) => m.name === 'floodlight-emitter');
      expect(m.emissiveFactor.reduce((s, x) => s + x, 0)).toBeGreaterThan(1);
    }
    expect(p.attachments.filter((a) => a.direction).every((a) => a.direction[1] < 0)).toBe(true);
  }
});
it('preserves lit window masks through backdrop LOD changes', () => {
  for (const id of ['marina-office', 'marina-hotel', 'marina-pavilion']) {
    let panes;
    for (const lod of prop(id).lods) {
      const j = gltf(lod);
      const index = j.materials.findIndex((m) => m.name === 'window-emissive-mask');
      expect(index).toBeGreaterThanOrEqual(0);
      expect(j.materials[index].emissiveFactor[0]).toBeGreaterThan(0);
      const count = j.meshes
        .flatMap((m) => m.primitives)
        .filter((p) => p.material === index)
        .reduce((s, p) => s + j.accessors[p.indices].count / 3, 0);
      if (panes === undefined) panes = count;
      expect(count).toBe(panes);
    }
  }
});
