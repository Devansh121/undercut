// Budget check for the production client build. Thresholds live in budget.config.json.
//
// - JS: total gzip size of the JavaScript the game can load (the input lab and the unused copies
//   of the Draco decoder that three.js's loader drags into the bundle are not counted).
// - First-race transfer, per quality preset: exactly what a player downloads from pressing Start to
//   the first frame of a race at Monza on that preset. Code, styles and fonts of the game; the
//   asset index; the sky and every track texture set at the preset's tiers
//   (packages/render/src/presets.json, apps/web/dist/assets/index.json); the car levels of detail
//   the preset loads and every livery mask (a full grid wears all of them); the Draco decoder.
//   Text is counted gzipped (the server compresses it), binaries as stored. The largest preset
//   must fit the budget.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const dist = path.join(root, 'apps/web/dist');
const budget = JSON.parse(fs.readFileSync(path.join(here, 'budget.config.json'), 'utf8'));
const presets = JSON.parse(
  fs.readFileSync(path.join(root, 'packages/render/src/presets.json'), 'utf8'),
);
const CIRCUIT_SKY = { monza: 'monza_afternoon' };
const CAR_FILES = {
  high: 'car/car_high.glb',
  mobile: 'car/car_mobile.glb',
  far: 'car/car_far.glb',
};

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

const sentCache = new Map();
function sent(rel) {
  if (sentCache.has(rel)) return sentCache.get(rel);
  const file = path.join(dist, rel);
  if (!fs.existsSync(file)) return null;
  const raw = fs.readFileSync(file);
  const ext = path.extname(file).toLowerCase();
  const n = TEXT.has(ext) ? zlib.gzipSync(raw, { level: 9 }).length : raw.length;
  sentCache.set(rel, n);
  return n;
}

const all = [...walk(dist)].map((f) => path.relative(dist, f).split(path.sep).join('/'));
// Build outputs the game loads: everything outside assets/{tex,env,car,draco} and the asset index,
// except source maps, the input lab and the bundler's unused Draco decoder copies.
const code = all.filter(
  (f) =>
    !f.endsWith('.map') &&
    !/^assets\/(tex|env|car|draco)\//.test(f) &&
    f !== 'assets/index.json' &&
    !/input-?lab/i.test(f) &&
    !/^assets\/draco_(decoder|wasm_wrapper)-/.test(f),
);
const index = JSON.parse(fs.readFileSync(path.join(dist, 'assets/index.json'), 'utf8'));
const masks = all.filter((f) => /^assets\/car\/livery\/.*\.png$/.test(f));
const draco = all.filter((f) => f.startsWith('assets/draco/'));

let jsGzip = 0;
for (const f of code) if (/\.m?js$/.test(f)) jsGzip += sent(f) ?? 0;

const mb = (n) => `${(n / 1024 / 1024).toFixed(2)} MiB`;
let failed = false;
const missing = [];
const results = [];
for (const [name, q] of Object.entries(presets)) {
  if (name.startsWith('$') || name === 'lite') continue;
  const files = new Set([...code, 'assets/index.json', ...masks, ...draco]);
  const sky = index.skies[CIRCUIT_SKY.monza];
  files.add(`assets/${sky[q.skyTier]}`);
  for (const t of Object.values(index.textures))
    for (const f of Object.values(t[q.textureTier])) files.add(`assets/${f}`);
  for (const lod of new Set([...q.carLods, q.playerLod])) files.add(`assets/${CAR_FILES[lod]}`);
  const groups = { code: 0, sky: 0, textures: 0, car: 0, draco: 0, other: 0 };
  let total = 0;
  for (const f of files) {
    const n = sent(f);
    if (n === null) {
      missing.push(f);
      continue;
    }
    total += n;
    const g = /assets\/env\//.test(f)
      ? 'sky'
      : /assets\/tex\//.test(f)
        ? 'textures'
        : /assets\/car\//.test(f)
          ? 'car'
          : /assets\/draco\//.test(f)
            ? 'draco'
            : code.includes(f)
              ? 'code'
              : 'other';
    groups[g] += n;
  }
  results.push({ name, total, groups });
}

for (const r of results) {
  const parts = Object.entries(r.groups)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${k} ${mb(n)}`)
    .join(', ');
  console.log(
    `     First race at Monza, ${r.name.padEnd(6)} ${mb(r.total).padStart(10)}  (${parts})`,
  );
}
if (missing.length) {
  console.error(
    `Files the first race fetches are missing from the build:\n  ${[...new Set(missing)].join('\n  ')}`,
  );
  failed = true;
}
const worst = results.reduce((a, b) => (b.total > a.total ? b : a));
const checks = [
  ['JS, gzip', jsGzip, budget.jsGzipMaxBytes],
  [
    `First-race transfer (${worst.name}, the largest preset)`,
    worst.total,
    budget.firstRaceTransferMaxBytes,
  ],
];
for (const [label, actual, limit] of checks) {
  const ok = actual <= limit;
  failed ||= !ok;
  const pct = ((actual / limit) * 100).toFixed(1);
  console.log(`${ok ? 'ok  ' : 'OVER'} ${label}: ${mb(actual)} of ${mb(limit)} (${pct}%)`);
}
if (failed) {
  console.error(
    'Budget exceeded or incomplete. Shrink the build, or raise the budget in tools/budget/budget.config.json with a reason.',
  );
  process.exit(1);
}
