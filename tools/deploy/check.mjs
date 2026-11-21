// Verifies the Cloudflare Workers deployment without authenticating or deploying:
// stages the built client, checks wrangler.jsonc and the staged assets against the
// Workers Free plan limits, runs `wrangler deploy --dry-run --outdir`, and asserts on
// the bundled Worker and Durable Object exports.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { REPO_ROOT, STAGE_DIR, stageAssets } from './stage.mjs';

const require = createRequire(import.meta.url);

// Cloudflare Workers Free plan limits (developers.cloudflare.com/workers/platform/limits/).
const FREE_LIMITS = {
  maxAssetCount: 20_000,
  maxAssetFileBytes: 25 * 1024 * 1024,
  maxWorkerUncompressedBytes: 64 * 1024 * 1024,
};

/** Parse JSONC (single-line // comments and trailing commas, outside strings). */
function parseJsonc(text) {
  let out = '';
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      out += ch;
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }
    if (ch === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      out += '\n';
      continue;
    }
    out += ch;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
}

function listFiles(dir, prefix = '') {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full, rel));
    else if (entry.isFile()) out.push({ path: rel, full, bytes: fs.statSync(full).size });
  }
  return out;
}

function checkConfig() {
  const configPath = path.join(REPO_ROOT, 'wrangler.jsonc');
  const raw = fs.readFileSync(configPath, 'utf8');
  assert(!/@/.test(raw), 'wrangler.jsonc must not contain an email address');
  const config = parseJsonc(raw);

  assert.equal(config.account_id, undefined, 'wrangler.jsonc must not commit an account_id');
  assert.equal(config.zone_id, undefined, 'wrangler.jsonc must not commit a zone_id');
  assert.equal(
    config.assets?.directory,
    'dist/cloudflare',
    'assets.directory must be dist/cloudflare',
  );
  assert.equal(config.assets?.not_found_handling, 'none', 'assets.not_found_handling must be none');
  assert(
    Array.isArray(config.assets?.run_worker_first) &&
      config.assets.run_worker_first.includes('/rooms') &&
      config.assets.run_worker_first.includes('/rooms/*'),
    'assets.run_worker_first must cover /rooms and /rooms/*',
  );

  const bindings = config.durable_objects?.bindings ?? [];
  for (const expected of [
    { name: 'ROOMS', class_name: 'Room' },
    { name: 'LIMITER', class_name: 'CreateLimiter' },
  ]) {
    assert(
      bindings.some((b) => b.name === expected.name && b.class_name === expected.class_name),
      `Missing Durable Object binding ${expected.name} -> ${expected.class_name}`,
    );
  }

  const sqliteClasses = new Set(
    (config.migrations ?? []).flatMap((m) => m.new_sqlite_classes ?? []),
  );
  assert(sqliteClasses.has('Room'), 'Missing SQLite migration for Room');
  assert(sqliteClasses.has('CreateLimiter'), 'Missing SQLite migration for CreateLimiter');

  assert.equal(config.vars?.SAME_ORIGIN_ONLY, 'true', 'SAME_ORIGIN_ONLY must be enabled');
  assert(config.vars?.CREATE_LIMIT, 'CREATE_LIMIT must be set');
  assert(config.vars?.GLOBAL_CREATE_LIMIT, 'GLOBAL_CREATE_LIMIT must be set');
  const timings = JSON.parse(config.vars?.ROOM_TIMINGS ?? '{}');
  assert(
    typeof timings.maxRoomAgeMs === 'number' && timings.maxRoomAgeMs > 0,
    'ROOM_TIMINGS.maxRoomAgeMs must be a positive number',
  );

  return config;
}

function checkStagedAssets(staged) {
  const byPath = new Map(staged.assets.map((f) => [f.path, f]));
  assert(byPath.has('index.html'), 'Staged assets must include index.html');
  assert(fs.existsSync(path.join(STAGE_DIR, '_headers')), 'Staged directory must include _headers');

  // Verify the built client entry assets referenced in index.html are staged.
  const html = fs.readFileSync(path.join(STAGE_DIR, 'index.html'), 'utf8');
  const referenced = [...html.matchAll(/(?:src|href)="\.\/([^"]+)"/g)].map((m) => m[1]);
  assert(referenced.length > 0, 'index.html must reference at least one built asset');
  for (const ref of referenced) {
    assert(byPath.has(ref), `Asset referenced by index.html is missing from staged output: ${ref}`);
  }
  assert(
    referenced.some((r) => /^assets\/main-[^/]+\.js$/.test(r)),
    'index.html must reference a hashed assets/main-*.js entry',
  );
  for (const required of [
    'assets/index.json',
    'assets/draco/draco_decoder.wasm',
    'assets/car/car_high.glb',
  ]) {
    assert(byPath.has(required), `Required runtime asset missing from staged output: ${required}`);
  }

  for (const file of staged.assets) {
    assert(!/\.(br|gz|map)$/i.test(file.path), `Unexpected file in staged output: ${file.path}`);
    assert.notEqual(file.path, 'first-race.json', 'first-race.json must not be deployed');
    assert(
      file.bytes <= FREE_LIMITS.maxAssetFileBytes,
      `Asset ${file.path} (${file.bytes} B) exceeds the 25 MiB Cloudflare per-file limit`,
    );
  }
  assert(
    staged.assets.length <= FREE_LIMITS.maxAssetCount,
    `Staged asset count (${staged.assets.length}) exceeds the 20,000 Free-plan file limit`,
  );
}

function runDryRun() {
  const wrangler = require.resolve('wrangler/bin/wrangler.js', { paths: [REPO_ROOT] });
  const outdir = fs.mkdtempSync(path.join(os.tmpdir(), 'undercut-deploy-check-'));
  // Strip any ambient Cloudflare credentials so this check proves offline, unauthenticated execution.
  const env = { ...process.env };
  for (const key of [
    'CLOUDFLARE_API_TOKEN',
    'CLOUDFLARE_ACCOUNT_ID',
    'CLOUDFLARE_EMAIL',
    'CLOUDFLARE_API_KEY',
  ]) {
    delete env[key];
  }
  env.XDG_CONFIG_HOME = path.join(outdir, '.config');
  env.WRANGLER_SEND_METRICS = 'false';
  env.WRANGLER_HIDE_BANNER = 'true';
  env.NO_UPDATE_NOTIFIER = '1';
  env.FORCE_COLOR = '0';

  try {
    const result = spawnSync(
      process.execPath,
      [wrangler, 'deploy', '--config', 'wrangler.jsonc', '--dry-run', '--outdir', outdir],
      { cwd: REPO_ROOT, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    const combined = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
    assert.equal(
      result.status,
      0,
      `wrangler deploy --dry-run failed (exit ${result.status}):\n${combined}`,
    );

    assert(
      !/_headers.*warning|invalid.*_headers|▲ \[WARNING\]/i.test(combined),
      `Wrangler emitted warnings during dry-run:\n${combined}`,
    );
    assert(
      combined.includes('dist/cloudflare'),
      `Wrangler dry-run output did not confirm reading dist/cloudflare:\n${combined}`,
    );
    assert(
      combined.includes('env.ROOMS (Room)') && combined.includes('env.LIMITER (CreateLimiter)'),
      `Wrangler dry-run output did not list both Durable Object bindings:\n${combined}`,
    );

    const emitted = listFiles(outdir).filter(
      (f) => !f.path.startsWith('.config/') && !f.path.endsWith('.map'),
    );
    assert(emitted.length > 0, 'Dry-run produced no Worker bundle files');
    const jsFile =
      emitted.find((f) => f.path === 'index.js') ?? emitted.find((f) => f.path.endsWith('.js'));
    assert(jsFile, `Dry-run produced no .js entry in ${outdir}`);

    const bundleBytes = emitted.reduce((sum, f) => sum + f.bytes, 0);
    assert(
      bundleBytes <= FREE_LIMITS.maxWorkerUncompressedBytes,
      `Worker bundle (${bundleBytes} B) exceeds the 64 MiB Free-plan uncompressed limit`,
    );

    const code = fs.readFileSync(jsFile.full, 'utf8');
    const gzipBytes = gzipSync(code).byteLength;
    // Check that the bundled Worker exports both Durable Object classes and the default handler.
    const exportMatch = /export\s*\{([^}]+)\}/.exec(code);
    assert(exportMatch, 'Could not find ES module export block in bundled Worker');
    const exported = exportMatch[1];
    assert(/\bRoom\b/.test(exported), 'Bundled Worker does not export Durable Object class Room');
    assert(
      /\bCreateLimiter\b/.test(exported),
      'Bundled Worker does not export Durable Object class CreateLimiter',
    );
    assert(/\bdefault\b/.test(exported), 'Bundled Worker does not export a default fetch handler');

    return { output: combined, bundleBytes, gzipBytes, entryFile: jsFile.path };
  } finally {
    fs.rmSync(outdir, { recursive: true, force: true });
  }
}

export function runDeployCheck() {
  const config = checkConfig();
  const staged = stageAssets();
  checkStagedAssets(staged);
  const dryRun = runDryRun();

  const kib = (n) => `${(n / 1024).toFixed(1)} KiB`;
  const mib = (n) => `${(n / (1024 * 1024)).toFixed(2)} MiB`;
  console.log(dryRun.output);
  console.log('');
  console.log(`Deploy check passed for Worker "${config.name}":`);
  console.log(
    `  Worker bundle: ${kib(dryRun.bundleBytes)} uncompressed (${kib(dryRun.gzipBytes)} gzip), limit 64 MiB`,
  );
  console.log(
    `  Static assets: ${staged.assets.length} files (${mib(staged.totalBytes)}), limit 20,000 files`,
  );
  console.log(
    `  Largest asset: ${staged.largest.path} (${mib(staged.largest.bytes)}), limit 25 MiB`,
  );
  console.log('  Durable Objects: Room (SQLite v1), CreateLimiter (SQLite v2)');
  return { config, staged, dryRun };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) runDeployCheck();
