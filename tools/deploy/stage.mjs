// Stages apps/web/dist into dist/cloudflare for Cloudflare Workers Static Assets.
// Excludes local-only precompressed siblings (.br, .gz), source maps (.map) and the
// build-budget report (first-race.json), and copies tools/deploy/_headers.
// apps/web/dist is never modified so ./start.sh and the budget check stay byte-for-byte identical.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const WEB_DIST = path.join(REPO_ROOT, 'apps/web/dist');
export const STAGE_DIR = path.join(REPO_ROOT, 'dist/cloudflare');
export const HEADERS_SRC = path.join(REPO_ROOT, 'tools/deploy/_headers');

const SKIP_EXTENSION = /\.(br|gz|map)$/i;
const SKIP_TOP_LEVEL = new Set(['first-race.json']);

function shouldCopy(relPosix) {
  if (SKIP_TOP_LEVEL.has(relPosix)) return false;
  if (SKIP_EXTENSION.test(relPosix)) return false;
  return true;
}

/**
 * Copy the built client into `dist/cloudflare` along with `_headers`.
 *
 * @returns {{
 *   directory: string,
 *   assets: { path: string, bytes: number }[],
 *   totalBytes: number,
 *   largest: { path: string, bytes: number },
 * }}
 */
export function stageAssets() {
  if (!fs.existsSync(path.join(WEB_DIST, 'index.html'))) {
    throw new Error('apps/web/dist/index.html is missing; run `npm run build` first.');
  }
  if (!fs.existsSync(HEADERS_SRC)) {
    throw new Error(`Missing headers file: ${HEADERS_SRC}`);
  }

  fs.rmSync(STAGE_DIR, { recursive: true, force: true });
  fs.mkdirSync(STAGE_DIR, { recursive: true });

  /** @type {{ path: string, bytes: number }[]} */
  const assets = [];

  function walk(dir, prefix) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      const src = path.join(dir, entry.name);
      const dst = path.join(STAGE_DIR, rel);
      if (entry.isDirectory()) {
        fs.mkdirSync(dst, { recursive: true });
        walk(src, rel);
      } else if (entry.isFile() && shouldCopy(rel)) {
        fs.copyFileSync(src, dst);
        assets.push({ path: rel, bytes: fs.statSync(dst).size });
      }
    }
  }

  walk(WEB_DIST, '');
  fs.copyFileSync(HEADERS_SRC, path.join(STAGE_DIR, '_headers'));

  assets.sort((a, b) => a.path.localeCompare(b.path));
  if (assets.length === 0) {
    throw new Error('Staging produced no asset files.');
  }
  let totalBytes = 0;
  let largest = assets[0];
  for (const file of assets) {
    totalBytes += file.bytes;
    if (file.bytes > largest.bytes) largest = file;
  }

  return { directory: STAGE_DIR, assets, totalBytes, largest };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const result = stageAssets();
  const mib = (n) => `${(n / (1024 * 1024)).toFixed(2)} MiB`;
  console.log(
    `Staged ${result.assets.length} assets (${mib(result.totalBytes)}, largest ${result.largest.path} at ${mib(result.largest.bytes)}) -> dist/cloudflare`,
  );
}
