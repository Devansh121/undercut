import fs from 'node:fs';
import crypto from 'node:crypto';
import { it, expect } from 'vitest';
import { decodeGlb } from './draco.mjs';

for (const id of ['forest-spruce', 'forest-fir']) {
  const file = `apps/web/public/assets/props/${id}_far.glb`;
  it(`${id} aligns both normal-atlas hemispheres with exported tangent frames`, () => {
    const mesh = decodeGlb(file).find((m) => m.material.endsWith('-needles'));
    expect(mesh.TANGENT).toBeDefined();
    const tiles = new Set();
    for (let i = 0; i < mesh.indices.length; i += 3) {
      const vertices = mesh.indices.slice(i, i + 3);
      const tile = Math.floor(vertices.reduce((s, v) => s + mesh.TEXCOORD_0.values[v * 2], 0) * 2);
      tiles.add(tile);
      const angle = ((tile % 3) * Math.PI) / 3;
      const sign = tile < 3 ? 1 : -1;
      const v = vertices[0];
      const n = mesh.NORMAL.values.slice(v * 3, v * 3 + 3);
      const t = mesh.TANGENT.values.slice(v * 4, v * 4 + 4);
      expect((n[0] * Math.cos(angle) + n[2] * Math.sin(angle)) * sign).toBeGreaterThan(0.999);
      expect(-t[0] * Math.sin(angle) + t[2] * Math.cos(angle)).toBeGreaterThan(0.999);
      // glTF TANGENT.w must preserve +Y as the V/green direction after lateral reflection.
      const bitangentY = (n[2] * t[0] - n[0] * t[2]) * t[3];
      expect(bitangentY).toBeGreaterThan(0.999);
    }
    expect([...tiles].sort()).toEqual([0, 1, 2, 3, 4, 5]);
  });
  it(`${id} ships its card atlases as lossless WebP`, () => {
    // Lossy WebP blurs the normal atlas and darkened the shadowed side by up to 43% (measured).
    const bytes = fs.readFileSync(file);
    const json = bytes.readUInt32LE(12);
    const gltf = JSON.parse(bytes.subarray(20, 20 + json).toString());
    const bin = bytes.subarray(28 + json);
    const images = gltf.images.filter((im) => im.name.startsWith(`${id}-authored-`));
    expect(images.map((im) => im.name).sort()).toEqual([
      `${id}-authored-normals`,
      `${id}-authored-views`,
    ]);
    for (const image of images) {
      const view = gltf.bufferViews[image.bufferView];
      const webp = bin.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength);
      expect(webp.subarray(0, 4).toString()).toBe('RIFF');
      expect(webp.subarray(12, 16).toString()).toBe('VP8L');
    }
  });
  it(`${id} passes the complete three-lighting sweep for the shipped files`, () => {
    const sweep = JSON.parse(fs.readFileSync('docs/evidence/m2-models/forest-sweep.json'));
    for (const lighting of ['overcast', 'afternoon', 'night']) {
      const r = sweep[lighting][id];
      expect(r.assetSha256).toBe(
        crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),
      );
      expect(r.samples).toHaveLength(12);
      expect(r.samples.map((s) => Math.round((s.angle * 180) / Math.PI))).toEqual(
        Array.from({ length: 12 }, (_, i) => i * 30),
      );
      for (const sample of r.samples) {
        expect(sample.near).toBeGreaterThan(0);
        expect(sample.card).toBeGreaterThan(0);
        expect(Math.abs(sample.near - sample.card) / sample.near).toBeLessThanOrEqual(0.15);
      }
    }
  });
}
