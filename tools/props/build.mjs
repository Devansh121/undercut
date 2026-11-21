import { format, resolveConfig } from 'prettier';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = process.cwd();
const out = 'apps/web/public/assets/props';
const scratch = path.join(os.homedir(), '.cache/undercut/scratch/m2-3d-models');
fs.mkdirSync(scratch, { recursive: true });
fs.mkdirSync(out, { recursive: true });
const log = execFileSync(
  path.join(os.homedir(), '.cache/undercut/blender/blender-5.2.4-linux-x64/blender'),
  [
    '-b',
    '--factory-startup',
    // A Python exception must fail the build (Blender otherwise exits 0 and logs to stderr).
    '--python-exit-code',
    '1',
    '-t',
    '2',
    '-P',
    'tools/props/props.py',
    '--',
    '--out',
    path.resolve(out),
  ],
  { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
);
fs.writeFileSync(path.join(scratch, 'build.log'), log);
if (/Traceback|Error:/.test(log)) throw new Error(`Blender failed; see ${scratch}/build.log`);
const catalog = JSON.parse(fs.readFileSync(`${out}/catalog.json`, 'utf8'));
fs.unlinkSync(`${out}/catalog.json`);
const manifest = JSON.parse(fs.readFileSync('assets/MANIFEST.json', 'utf8')).filter(
  (e) => !e.file.startsWith(`${out}/`),
);
let total = 0;
for (const prop of catalog.props) {
  for (const lod of prop.lods) {
    const file = `apps/web/public/${lod.file}`;
    const bytes = fs.readFileSync(file);
    const gltf = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
    lod.triangles = gltf.meshes.reduce(
      (n, mesh) => n + mesh.primitives.reduce((s, p) => s + gltf.accessors[p.indices].count / 3, 0),
      0,
    );
    lod.bytes = bytes.length;
    if (lod.triangles > lod.triangleBudget)
      throw new Error(`${lod.file}: ${lod.triangles} exceeds ${lod.triangleBudget}`);
    total += bytes.length;
    manifest.push({
      file,
      source_url: 'tools/props/props.py (this repository)',
      author: 'Project contributors',
      licence: 'MIT',
      changes:
        'Scripted modular geometry, metric surface grain, vertex ambient occlusion, Draco compression',
      sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    });
  }
}
catalog.totalBytes = total;
fs.writeFileSync(
  'packages/render/data/props.catalog.json',
  await format(JSON.stringify(catalog), {
    ...(await resolveConfig('packages/render/data/props.catalog.json')),
    parser: 'json',
  }),
);
fs.writeFileSync('assets/MANIFEST.json', `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`${catalog.props.length} props, ${total} bytes; root ${root}`);
