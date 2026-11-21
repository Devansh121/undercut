// Budget check for the production client build. Thresholds live in budget.config.json.
//
// - JS: total gzip size of every .js file in dist.
// - First-race transfer: what a player downloads before the first race starts. Until
//   the loader declares a per-race asset list (M1), this is every file in dist except
//   source maps, text gzipped and binaries as stored: an upper bound.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const dist = path.join(root, 'apps/web/dist');
const budget = JSON.parse(fs.readFileSync(path.join(here, 'budget.config.json'), 'utf8'));

const TEXT = new Set([
  '.js',
  '.mjs',
  '.css',
  '.html',
  '.json',
  '.svg',
  '.txt',
  '.webmanifest',
  '.gltf',
]);

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else yield full;
  }
}

if (!fs.existsSync(dist)) {
  console.error('No build in apps/web/dist. Run the client build first.');
  process.exit(1);
}

let jsGzip = 0;
let transfer = 0;
const rows = [];
for (const file of walk(dist)) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.map') continue;
  const raw = fs.readFileSync(file);
  const sent = TEXT.has(ext) ? zlib.gzipSync(raw, { level: 9 }).length : raw.length;
  if (ext === '.js' || ext === '.mjs') jsGzip += sent;
  transfer += sent;
  rows.push([path.relative(dist, file), raw.length, sent]);
}

const kb = (n) => `${(n / 1024).toFixed(1)} KiB`;
const mb = (n) => `${(n / 1024 / 1024).toFixed(2)} MiB`;
rows.sort((a, b) => b[2] - a[2]);
for (const [file, raw, sent] of rows.slice(0, 10)) {
  console.log(`  ${file.padEnd(48)} ${kb(raw).padStart(12)} raw ${kb(sent).padStart(12)} sent`);
}

const checks = [
  ['JS, gzip', jsGzip, budget.jsGzipMaxBytes],
  ['First-race transfer', transfer, budget.firstRaceTransferMaxBytes],
];
let failed = false;
for (const [label, actual, limit] of checks) {
  const ok = actual <= limit;
  failed ||= !ok;
  const pct = ((actual / limit) * 100).toFixed(1);
  console.log(`${ok ? 'ok  ' : 'OVER'} ${label}: ${mb(actual)} of ${mb(limit)} (${pct}%)`);
}
if (failed) {
  console.error(
    'Budget exceeded. Shrink the build, or raise the budget in tools/budget/budget.config.json with a reason.',
  );
  process.exit(1);
}
