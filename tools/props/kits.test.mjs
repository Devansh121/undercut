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
    expect(card.doubleSided ?? false).toBe(false);
  }
});

it('keeps opposing forest card faces visible from every quadrant', async () => {
  const { decodeGlb } = await import('./draco.mjs');
  for (const id of ['forest-spruce', 'forest-fir']) {
    const mesh = decodeGlb('apps/web/public/' + prop(id).lods[2].file).find((m) =>
      m.material.includes('needles'),
    );
    const signs = new Set();
    const p = mesh.POSITION.values;
    for (let i = 0; i < mesh.indices.length; i += 3) {
      const [a, b, c] = mesh.indices.slice(i, i + 3).map((v) => v * 3);
      const u = [0, 1, 2].map((j) => p[b + j] - p[a + j]);
      const v = [0, 1, 2].map((j) => p[c + j] - p[a + j]);
      const x = u[1] * v[2] - u[2] * v[1];
      const z = u[0] * v[1] - u[1] * v[0];
      if (Math.abs(x) > 0.01) signs.add(x > 0 ? '+X' : '-X');
      if (Math.abs(z) > 0.01) signs.add(z > 0 ? '+Z' : '-Z');
    }
    expect([...signs].sort()).toEqual(['+X', '+Z', '-X', '-Z']);
    // Cards keep their geometric (horizontal) normals; the shading of the near tree comes from
    // the card material's normal atlas, not from tilted vertex normals.
    for (let i = 1; i < mesh.NORMAL.values.length; i += 3)
      expect(Math.abs(mesh.NORMAL.values[i])).toBeLessThan(0.05);
    const bytes = fs.readFileSync('apps/web/public/' + prop(id).lods[2].file);
    const gltf = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
    const leaf = gltf.materials.find((m) => m.name.includes('needles'));
    expect(leaf.normalTexture).toBeDefined();
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
