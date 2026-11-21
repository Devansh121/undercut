// Precompress the built client: for every file that compresses (text, JSON, WASM), write
// `<file>.br` (Brotli, quality 11) and `<file>.gz` (gzip, level 9) beside it. The static server
// (static.mjs) sends the best one a client accepts. Binaries that are already compressed (WebP,
// PNG, GLB, WOFF2) and files that would not shrink by at least 5 % or 256 bytes are left alone.
//
//   node tools/serve/precompress.mjs [dist]    (default apps/web/dist; part of npm run build)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

export const COMPRESSIBLE = new Set([
  '.html',
  '.js',
  '.mjs',
  '.css',
  '.json',
  '.svg',
  '.txt',
  '.webmanifest',
  '.wasm',
  '.map',
  '.hdr',
]);

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else yield full;
  }
}

/** Write the .br and .gz siblings under `root`. Returns how many files were compressed. */
export function precompress(root) {
  let count = 0;
  for (const file of [...walk(root)]) {
    if (!COMPRESSIBLE.has(path.extname(file).toLowerCase())) continue;
    const raw = fs.readFileSync(file);
    const br = zlib.brotliCompressSync(raw, {
      params: {
        [zlib.constants.BROTLI_PARAM_QUALITY]: 11,
        [zlib.constants.BROTLI_PARAM_SIZE_HINT]: raw.length,
      },
    });
    if (raw.length - br.length < Math.max(256, raw.length * 0.05)) continue;
    fs.writeFileSync(`${file}.br`, br);
    fs.writeFileSync(`${file}.gz`, zlib.gzipSync(raw, { level: 9 }));
    count++;
  }
  return count;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const root = path.resolve(process.argv[2] ?? path.join(here, '../../apps/web/dist'));
  console.log(
    `Precompressed ${precompress(root)} files (.br, .gz) in ${path.relative(process.cwd(), root) || '.'}`,
  );
}
