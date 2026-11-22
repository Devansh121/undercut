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
it('ships alpha-tested forest cards with the same physical albedo as near needles', () => {
  for (const id of ['forest-spruce', 'forest-fir']) {
    const [high, , far] = prop(id).lods.map(gltf);
    const near = high.materials.find((m) => m.name === id + '-needles');
    const card = far.materials.find((m) => m.name === id + '-needles');
    expect(card.alphaMode).toBe('MASK');
    expect(card.pbrMetallicRoughness.roughnessFactor).toBe(
      near.pbrMetallicRoughness.roughnessFactor,
    );
    expect(card.emissiveFactor).toBeUndefined();
    expect(card.doubleSided).toBe(true);
  }
});
