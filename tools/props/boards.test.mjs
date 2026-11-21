import fs from 'node:fs';
import vm from 'node:vm';
import { describe, it, expect } from 'vitest';

// Use the decoder shipped with the renderer. Inspect compressed output, not generator metadata.
const context = { module: { exports: {} }, exports: {}, console, setTimeout, clearTimeout };
vm.runInNewContext(
  fs.readFileSync('node_modules/three/examples/jsm/libs/draco/gltf/draco_decoder.js', 'utf8'),
  context,
);
const module = await context.module.exports({});
const catalogue = JSON.parse(fs.readFileSync('packages/render/data/props.catalog.json', 'utf8'));
const ids = [
  'braking-board',
  'zone-board',
  'corner-board',
  'kilometre-board',
  'hoarding',
  'pit-garage',
  'start-gantry',
  'bridge-banner',
  'pedestrian-bridge',
  'screen-tower',
];

function attribute(decoder, mesh, id) {
  const attr = decoder.GetAttributeByUniqueId(mesh, id);
  const values = new module.DracoFloat32Array();
  decoder.GetAttributeFloatForAllPoints(mesh, attr, values);
  const out = Array.from({ length: values.size() }, (_, i) => values.GetValue(i));
  module.destroy(values);
  return { values: out, size: attr.num_components() };
}
// Asymmetric test art: red stripe on the left, blue on the right, white centre.
const art = (u) => (u < 0.35 ? 'red' : u > 0.65 ? 'blue' : 'white');
describe('board artwork seen from +X, +Y camera up', () => {
  for (const id of ids)
    it(`${id}: red left and blue right in every shipped LOD`, () => {
      const prop = catalogue.props.find((p) => p.id === id);
      for (const lod of prop.lods) {
        const bytes = fs.readFileSync(`apps/web/public/${lod.file}`);
        const jsonSize = bytes.readUInt32LE(12);
        const gltf = JSON.parse(bytes.subarray(20, 20 + jsonSize).toString());
        const bin = bytes.subarray(28 + jsonSize);
        const materialName = id === 'screen-tower' ? 'glazing' : 'board-face';
        const front = [];
        for (const primitive of gltf.meshes.flatMap((m) => m.primitives)) {
          if (gltf.materials[primitive.material].name !== materialName) continue;
          const extension = primitive.extensions.KHR_draco_mesh_compression;
          const view = gltf.bufferViews[extension.bufferView];
          const encoded = bin.subarray(
            view.byteOffset ?? 0,
            (view.byteOffset ?? 0) + view.byteLength,
          );
          const buffer = new module.DecoderBuffer();
          buffer.Init(new Int8Array(encoded), encoded.length);
          const decoder = new module.Decoder();
          const mesh = new module.Mesh();
          const status = decoder.DecodeBufferToMesh(buffer, mesh);
          expect(status.ok()).toBe(true);
          try {
            const p = attribute(decoder, mesh, extension.attributes.POSITION);
            const n = attribute(decoder, mesh, extension.attributes.NORMAL);
            const uv = attribute(decoder, mesh, extension.attributes.TEXCOORD_0);
            for (let i = 0; i < mesh.num_points(); i++) {
              if (n.values[i * n.size] > 0.9)
                front.push({ z: p.values[i * p.size + 2], u: uv.values[i * uv.size] });
            }
          } finally {
            module.destroy(mesh);
            module.destroy(decoder);
            module.destroy(buffer);
            module.destroy(status);
          }
        }
        expect(front.length).toBeGreaterThanOrEqual(4);
        // Looking from +X, screen-left is +Z. Sample the same asymmetric artwork on those corners.
        const left = front.filter((v) => v.z > Math.max(...front.map((v) => v.z)) - 0.01);
        const right = front.filter((v) => v.z < Math.min(...front.map((v) => v.z)) + 0.01);
        expect(left.map((v) => art(v.u))).toEqual(left.map(() => 'red'));
        expect(right.map((v) => art(v.u))).toEqual(right.map(() => 'blue'));
      }
    });
});
