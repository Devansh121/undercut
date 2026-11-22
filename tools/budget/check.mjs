// Budget check for the production client build. Thresholds live in budget.config.json.
//
// Sizes are what the game's own server (tools/serve/static.mjs, with the precompressed siblings
// from tools/serve/precompress.mjs) actually sends: the check starts that handler on a free port
// and requests every file with a browser's Accept-Encoding, counting the body bytes on the wire.
//
// - JS: the JavaScript the game can load, as sent (the input lab and the unused copies of the
//   Draco decoder that three.js's loader drags into the bundle are not counted).
// - First-race transfer, per circuit and quality preset: what a player downloads from opening the
//   page to the first frame of a race at that circuit on that preset. The page, code, styles and
//   fonts (and the menu's team car images, all of them, though the menu shows one at a time),
//   less the other circuits' own chunks (track, racing lines, envelopes, dressing); the asset
//   index; the circuit's first sky and every track texture set at the preset's tiers
//   (packages/render/src/presets.json, apps/web/dist/assets/index.json); the car levels of detail
//   the preset loads and every livery mask (a full grid wears all of them); the Draco decoder;
//   the catalogue props the world places there (packages/render/data/world-props.json: the common
//   ones, the circuit's own, its near-tree models where the preset draws near trees) at the levels
//   the preset loads.
//   The largest circuit and preset must fit the budget.
//
// The inventory (path → bytes sent, per preset; Monza under `presets`, every circuit under
// `circuits`) is written to apps/web/dist/first-race.json; browser tests check it against the
// requests a real first race makes.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { createHandlers } from '../serve/static.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const dist = path.join(root, 'apps/web/dist');
const budget = JSON.parse(fs.readFileSync(path.join(here, 'budget.config.json'), 'utf8'));
const presets = JSON.parse(
  fs.readFileSync(path.join(root, 'packages/render/src/presets.json'), 'utf8'),
);
/**
 * Each circuit's first sky: the sky of its first time of day in the menus
 * (apps/web/src/ui/data/circuit-summary.ts TIMES, render TIMES_OF_DAY).
 */
const CIRCUIT_SKY = { monza: 'monza_afternoon', spa: 'overcast', singapore: 'overcast' };
const CIRCUITS = Object.keys(CIRCUIT_SKY);
/** A circuit's own build outputs (track, racing lines, envelopes, dressing), by file name. */
const ownedBy = (f) => CIRCUITS.find((c) => new RegExp(`^assets/${c}[-.]`).test(f)) ?? null;
const CAR_FILES = {
  high: 'car/car_high.glb',
  mobile: 'car/car_mobile.glb',
  far: 'car/car_far.glb',
};

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

// The game's server, on a free port, serving this build.
const server = http.createServer(createHandlers({ root: dist, roomsPort: 1 }).http);
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const ACCEPT = 'gzip, deflate, br, zstd';
/** Body bytes the server sends for `rel` to a browser, or null when it is not served. */
function fetchSize(rel) {
  return new Promise((resolve, reject) => {
    const req = http.get(
      { host: '127.0.0.1', port, path: `/${rel}`, headers: { 'accept-encoding': ACCEPT } },
      (res) => {
        let n = 0;
        res.on('data', (c) => (n += c.length));
        res.on('end', () => resolve(res.statusCode === 200 ? n : null));
      },
    );
    req.on('error', reject);
  });
}
const sentCache = new Map();
const all = [...walk(dist)]
  .map((f) => path.relative(dist, f).split(path.sep).join('/'))
  .filter((f) => !/\.(br|gz)$/.test(f) && f !== 'first-race.json');
for (const f of all) sentCache.set(f, await fetchSize(f));
await new Promise((resolve) => server.close(resolve));
function sent(rel) {
  return sentCache.has(rel) ? sentCache.get(rel) : null;
}
// Build outputs the game loads: everything outside assets/{tex,env,car,draco,props} and the asset
// index, except source maps, the diagnostic pages (input lab, UI gallery) and the bundler's unused
// Draco decoder copies.
const code = all.filter(
  (f) =>
    !f.endsWith('.map') &&
    !/^assets\/(tex|env|car|draco|props)\//.test(f) &&
    f !== 'assets/index.json' &&
    !/input-?lab/i.test(f) &&
    !/ui-?gallery/i.test(f) &&
    !/^assets\/draco_(decoder|wasm_wrapper)-/.test(f),
);
const index = JSON.parse(fs.readFileSync(path.join(dist, 'assets/index.json'), 'utf8'));
const masks = all.filter((f) => /^assets\/car\/livery\/.*\.png$/.test(f));
const draco = all.filter((f) => f.startsWith('assets/draco/'));

let jsSent = 0;
for (const f of code) if (/\.m?js$/.test(f)) jsSent += sent(f) ?? 0;

const propCatalogue = JSON.parse(
  fs.readFileSync(path.join(root, 'packages/render/data/props.catalog.json'), 'utf8'),
);
const worldProps = JSON.parse(
  fs.readFileSync(path.join(root, 'packages/render/data/world-props.json'), 'utf8'),
);
/** The catalogue ids a circuit's world places on a preset (catalog.ts worldCatalogPropIds). */
function worldPropIds(circuit, q) {
  const own = worldProps.circuits?.[circuit] ?? {};
  return [
    ...worldProps.ids,
    ...(own.ids ?? []),
    ...((q.world?.treeCloud ?? 0) > 0 ? (own.nearTrees ?? []) : []),
  ];
}
const mb = (n) => `${(n / 1024 / 1024).toFixed(2)} MiB`;
let failed = false;
const missing = [];
const results = [];
for (const circuit of CIRCUITS)
  for (const [name, q] of Object.entries(presets)) {
    if (name.startsWith('$') || name === 'lite') continue;
    const own = code.filter((f) => [null, circuit].includes(ownedBy(f)));
    const files = new Set([
      ...own,
      'manifest.webmanifest',
      'assets/index.json',
      ...masks,
      ...draco,
    ]);
    const sky = index.skies[CIRCUIT_SKY[circuit]];
    files.add(`assets/${sky[q.skyTier]}`);
    for (const t of Object.values(index.textures))
      for (const f of Object.values(t[q.textureTier])) files.add(`assets/${f}`);
    for (const lod of new Set([...q.carLods, q.playerLod])) files.add(`assets/${CAR_FILES[lod]}`);
    // The catalogue props the world places, at the levels this preset loads (catalog.ts).
    const ids = worldPropIds(circuit, q);
    for (const entry of propCatalogue.props) {
      if (!ids.includes(entry.id)) continue;
      const light = entry.lods.filter((l) => !/_high\.glb$/i.test(l.file));
      const lods = (name === 'mobile' || name === 'lite') && light.length > 0 ? light : entry.lods;
      for (const l of lods) files.add(l.file);
    }
    const groups = { code: 0, sky: 0, textures: 0, car: 0, props: 0, draco: 0, menu: 0, other: 0 };
    let total = 0;
    const inventory = {};
    for (const f of files) {
      const n = sent(f);
      if (n === null) {
        missing.push(f);
        continue;
      }
      inventory[f] = n;
      total += n;
      const g = /assets\/env\//.test(f)
        ? 'sky'
        : /assets\/tex\//.test(f)
          ? 'textures'
          : /assets\/car\//.test(f)
            ? 'car'
            : /assets\/props\//.test(f)
              ? 'props'
              : /assets\/draco\//.test(f)
                ? 'draco'
                : /assets\/ui\//.test(f)
                  ? 'menu'
                  : code.includes(f)
                    ? 'code'
                    : 'other';
      groups[g] += n;
    }
    results.push({ circuit, name, total, groups, inventory });
  }

for (const r of results) {
  const parts = Object.entries(r.groups)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${k} ${mb(n)}`)
    .join(', ');
  console.log(
    `     First race at ${r.circuit.padEnd(9)} ${r.name.padEnd(6)} ${mb(r.total).padStart(10)}  (${parts})`,
  );
}
if (missing.length) {
  console.error(
    `Files the first race fetches are missing from the build:\n  ${[...new Set(missing)].join('\n  ')}`,
  );
  failed = true;
}
const worst = results.reduce((a, b) => (b.total > a.total ? b : a));
fs.writeFileSync(
  path.join(dist, 'first-race.json'),
  `${JSON.stringify(
    {
      $comment:
        'Written by tools/budget/check.mjs: what the first race fetches per preset, path to bytes the game server sends (Accept-Encoding: gzip, deflate, br, zstd). `presets` is Monza; `circuits` has every circuit.',
      presets: Object.fromEntries(
        results
          .filter((r) => r.circuit === 'monza')
          .map((r) => [r.name, { total: r.total, files: r.inventory }]),
      ),
      circuits: Object.fromEntries(
        CIRCUITS.map((c) => [
          c,
          {
            presets: Object.fromEntries(
              results
                .filter((r) => r.circuit === c)
                .map((r) => [r.name, { total: r.total, files: r.inventory }]),
            ),
          },
        ]),
      ),
    },
    null,
    2,
  )}\n`,
);
const checks = [
  ['JS, as sent', jsSent, budget.jsGzipMaxBytes],
  [
    `First-race transfer (${worst.circuit}, ${worst.name}: the largest)`,
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
