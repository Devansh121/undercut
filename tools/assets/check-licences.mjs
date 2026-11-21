// Asset licence check. Every file under assets/, apps/web/public/ and design/mock/fonts/
// (other than the manifest itself) must have an entry in assets/MANIFEST.json with a matching sha256
// and an allowed licence; every entry must point at a file that exists.
//
// Manifest entry: { file, source_url, author, licence, changes, sha256 }
// `file` is relative to the repository root.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIELDS = ['file', 'source_url', 'author', 'licence', 'changes', 'sha256'];
// Directories that hold third-party files. design/mock/fonts holds the committed UI fonts.
export const SCAN_DIRS = ['assets', 'apps/web/public', 'design/mock/fonts'];

function* walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else yield full;
  }
}

/** Returns a list of problems; empty means the check passed. */
export function checkAssets(
  root,
  { manifestPath = 'assets/MANIFEST.json', allowed, scanDirs = SCAN_DIRS },
) {
  const problems = [];
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(path.join(root, manifestPath), 'utf8'));
  } catch (error) {
    return [`${manifestPath}: cannot read: ${error.message}`];
  }
  if (!Array.isArray(manifest)) return [`${manifestPath}: must be a JSON array`];

  const byFile = new Map();
  manifest.forEach((entry, i) => {
    const where = `${manifestPath}[${i}]`;
    for (const field of FIELDS) {
      if (typeof entry?.[field] !== 'string' || entry[field].trim() === '') {
        problems.push(`${where}: missing or empty "${field}"`);
      }
    }
    if (typeof entry?.file !== 'string') return;
    if (byFile.has(entry.file)) problems.push(`${where}: duplicate entry for ${entry.file}`);
    byFile.set(entry.file, entry);
    if (typeof entry.licence === 'string' && !allowed.includes(entry.licence)) {
      problems.push(`${where}: licence "${entry.licence}" is not in tools/assets/licences.json`);
    }
    if (typeof entry.sha256 === 'string' && !/^[0-9a-f]{64}$/.test(entry.sha256)) {
      problems.push(`${where}: sha256 must be 64 lowercase hex characters`);
    }
    if (!fs.existsSync(path.join(root, entry.file)))
      problems.push(`${where}: ${entry.file} does not exist`);
  });

  for (const dir of scanDirs) {
    for (const full of walk(path.join(root, dir))) {
      const rel = path.relative(root, full).split(path.sep).join('/');
      if (rel === manifestPath) continue;
      const entry = byFile.get(rel);
      if (!entry) {
        problems.push(`${rel}: not in ${manifestPath}`);
        continue;
      }
      const sha = crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex');
      if (entry.sha256 !== sha)
        problems.push(`${rel}: sha256 is ${sha}, manifest says ${entry.sha256}`);
    }
  }
  return problems;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = path.resolve(here, '../..');
  const { allowed } = JSON.parse(fs.readFileSync(path.join(here, 'licences.json'), 'utf8'));
  const problems = checkAssets(root, { allowed });
  if (problems.length > 0) {
    console.error(problems.join('\n'));
    process.exit(1);
  }
  console.log('Asset licence check passed.');
}
