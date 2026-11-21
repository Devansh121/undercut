import fs from 'node:fs';
import vm from 'node:vm';

// The decoder shipped with the renderer, so tests inspect the compressed output as the game reads it.
const context = { module: { exports: {} }, exports: {}, console, setTimeout, clearTimeout };
vm.runInNewContext(
  fs.readFileSync('node_modules/three/examples/jsm/libs/draco/gltf/draco_decoder.js', 'utf8'),
  context,
);
const draco = await context.module.exports({});

function attribute(decoder, mesh, id) {
  const attr = decoder.GetAttributeByUniqueId(mesh, id);
  const values = new draco.DracoFloat32Array();
  decoder.GetAttributeFloatForAllPoints(mesh, attr, values);
  const out = Array.from({ length: values.size() }, (_, i) => values.GetValue(i));
  draco.destroy(values);
  return { values: out, size: attr.num_components() };
}

/**
 * Decode every Draco primitive of a GLB: `[{ material, POSITION, NORMAL, TEXCOORD_0, ... }]`,
 * each attribute as `{ values, size }`, in the mesh's local frame.
 */
export function decodeGlb(file) {
  const bytes = fs.readFileSync(file);
  const jsonSize = bytes.readUInt32LE(12);
  const gltf = JSON.parse(bytes.subarray(20, 20 + jsonSize).toString());
  const bin = bytes.subarray(28 + jsonSize);
  const out = [];
  for (const primitive of gltf.meshes.flatMap((m) => m.primitives)) {
    const extension = primitive.extensions.KHR_draco_mesh_compression;
    const view = gltf.bufferViews[extension.bufferView];
    const encoded = bin.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength);
    const buffer = new draco.DecoderBuffer();
    buffer.Init(new Int8Array(encoded), encoded.length);
    const decoder = new draco.Decoder();
    const mesh = new draco.Mesh();
    const status = decoder.DecodeBufferToMesh(buffer, mesh);
    try {
      if (!status.ok()) throw new Error(`${file}: ${status.error_msg()}`);
      const entry = { material: gltf.materials[primitive.material].name };
      for (const [name, id] of Object.entries(extension.attributes))
        entry[name] = attribute(decoder, mesh, id);
      out.push(entry);
    } finally {
      draco.destroy(mesh);
      draco.destroy(decoder);
      draco.destroy(buffer);
      draco.destroy(status);
    }
  }
  return out;
}
