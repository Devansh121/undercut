// Credits consistency check (npm run check:credits, CI `assets` job). CREDITS.md must agree with
// the asset manifest and the lockfile:
// - every third-party asset in assets/MANIFEST.json is credited: its source page is linked from
//   CREDITS.md (Poly Haven and ambientCG assets, upstream font repositories), or, for
//   OpenStreetMap-derived data, its folder's LICENSE-DATA.md exists and CREDITS.md names it;
// - data derived from those databases but kept out of the manifest (the racing lines, rebuilt
//   without a manifest edit) has an ODbL LICENSE-DATA.md beside it that CREDITS.md names;
// - every first-party entry is by "Project contributors" and sits under a path CREDITS.md names;
// - every repository path CREDITS.md names in backticks exists;
// - every npm package in package-lock.json has a licence from tools/ci/dependency-licences.json
//   (the "shipped" list for production packages), and every direct dependency is named in
//   CREDITS.md, production ones under "Third-party code shipped".
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = 'Project contributors';
const REPO_DIRS = /^(apps|assets|design|docs|packages|services|tools)\//;
const SHIPPED_HEADING = '## Third-party code shipped';
/** Folders of ODbL-derived files that are not in the manifest, and which of their files are. */
const DERIVED_DATA = [{ dir: 'packages/ai/data', files: /\.line\.json$/ }];

/**
 * The text CREDITS.md must contain to credit a third-party manifest entry, or null when the
 * source is one this check does not know (it then reports the entry, so the rule is added here).
 */
export function creditKey(entry) {
  const url = entry.source_url;
  let m =
    /^https:\/\/dl\.polyhaven\.org\/file\/ph-assets\/Textures\/[^/]+\/[^/]+\/([a-z0-9_]+)\//.exec(
      url,
    );
  if (m) return `https://polyhaven.com/a/${m[1]}`;
  m =
    /^https:\/\/dl\.polyhaven\.org\/file\/ph-assets\/HDRIs\/[^/]+\/[^/]+\/([a-z0-9_]+?)_\d+k\.\w+$/.exec(
      url,
    );
  if (m) return `https://polyhaven.com/a/${m[1]}`;
  m = /^https:\/\/ambientcg\.com\/get\?file=([A-Za-z]+\d+)_/.exec(url);
  if (m) return `https://ambientcg.com/view?id=${m[1]}`;
  m = /^https:\/\/raw\.githubusercontent\.com\/([^/]+\/[^/]+)\//.exec(url);
  if (m) return `https://github.com/${m[1]}`;
  if (entry.licence === 'ODbL-1.0' && url.startsWith('https://www.openstreetmap.org')) {
    return `${path.posix.dirname(entry.file)}/LICENSE-DATA.md`;
  }
  return null;
}

/** Repository paths named in backticks: `apps/web/public/assets/props/`, `design/mock/fonts/X-*.woff2`. */
export function namedPaths(credits) {
  return [...credits.matchAll(/`([^`\s]+)`/g)].map((m) => m[1]).filter((p) => REPO_DIRS.test(p));
}

function pathExists(root, p) {
  if (!p.includes('*')) return fs.existsSync(path.join(root, p));
  const dir = path.join(root, path.posix.dirname(p));
  const re = new RegExp(`^${path.posix.basename(p).split('*').map(escape).join('.*')}$`);
  return fs.existsSync(dir) && fs.readdirSync(dir).some((f) => re.test(f));
}
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const licenceOf = (pkg) => (pkg.license ?? '').replace(/^\((.*)\)$/, '$1');

/** Returns a list of problems; empty means CREDITS.md, the manifest and the lockfile agree. */
export function checkCredits(root, { allowed }) {
  const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
  const credits = read('CREDITS.md');
  const manifest = JSON.parse(read('assets/MANIFEST.json'));
  const lock = JSON.parse(read('package-lock.json'));
  const named = namedPaths(credits);
  const problems = [];

  for (const entry of manifest) {
    if (entry.licence === 'MIT') {
      if (entry.author !== PROJECT) {
        problems.push(`${entry.file}: first-party author should read "${PROJECT}"`);
      }
      if (!named.some((p) => p === entry.file || (p.endsWith('/') && entry.file.startsWith(p)))) {
        problems.push(`${entry.file}: no path in CREDITS.md covers this first-party file`);
      }
      continue;
    }
    const key = creditKey(entry);
    if (key === null) {
      problems.push(
        `${entry.file}: unknown source ${entry.source_url}; teach creditKey in tools/ci/check-credits.mjs`,
      );
    } else if (!credits.includes(key)) {
      problems.push(`${entry.file}: CREDITS.md does not name ${key}`);
    } else if (key.endsWith('LICENSE-DATA.md') && !fs.existsSync(path.join(root, key))) {
      problems.push(`${entry.file}: ${key} is missing`);
    }
  }

  for (const { dir, files } of DERIVED_DATA) {
    const abs = path.join(root, dir);
    const derived = fs.existsSync(abs) ? fs.readdirSync(abs).filter((f) => files.test(f)) : [];
    if (derived.length === 0) continue;
    const notice = `${dir}/LICENSE-DATA.md`;
    const first = `${dir}/${derived.sort()[0]}`;
    if (!fs.existsSync(path.join(root, notice))) {
      problems.push(`${first}: ODbL-derived data needs ${notice}`);
    } else if (!read(notice).includes('Open Database License')) {
      problems.push(`${notice}: does not carry the Open Database License notice`);
    }
    if (!named.includes(notice)) problems.push(`${first}: CREDITS.md does not name ${notice}`);
  }

  for (const p of named) {
    if (!pathExists(root, p)) problems.push(`CREDITS.md names ${p}, which does not exist`);
  }

  const shippedStart = credits.indexOf(SHIPPED_HEADING);
  const shippedEnd = credits.indexOf('\n## ', shippedStart + 1);
  const shippedSection =
    shippedStart < 0 ? '' : credits.slice(shippedStart, shippedEnd < 0 ? undefined : shippedEnd);
  const direct = new Map();
  for (const [key, pkg] of Object.entries(lock.packages)) {
    if (key.includes('node_modules/') || !pkg) continue;
    for (const name of Object.keys(pkg.dependencies ?? {})) direct.set(name, 'shipped');
    for (const name of Object.keys(pkg.devDependencies ?? {})) {
      if (!direct.has(name)) direct.set(name, 'tools');
    }
  }
  for (const [name, use] of direct) {
    if (name.startsWith('@undercut/')) continue;
    const mention = `\`${name}\``;
    if (use === 'shipped' && !shippedSection.includes(mention)) {
      problems.push(`CREDITS.md: production dependency ${name} is not under "${SHIPPED_HEADING}"`);
    } else if (!credits.includes(mention)) {
      problems.push(`CREDITS.md: direct dependency ${name} is not named (as ${mention})`);
    }
  }

  for (const [key, pkg] of Object.entries(lock.packages)) {
    if (!key.includes('node_modules/') || pkg.link) continue;
    const licence = licenceOf(pkg);
    const list = pkg.dev ? allowed.tools : allowed.shipped;
    if (!list.includes(licence)) {
      problems.push(
        `${key}@${pkg.version}: licence "${licence || 'none'}" is not allowed for ${pkg.dev ? 'tools' : 'shipped'} packages (tools/ci/dependency-licences.json)`,
      );
    }
  }
  return problems;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = path.resolve(here, '../..');
  const allowed = JSON.parse(fs.readFileSync(path.join(here, 'dependency-licences.json'), 'utf8'));
  const problems = checkCredits(root, { allowed });
  if (problems.length > 0) {
    console.error(problems.join('\n'));
    process.exit(1);
  }
  console.log('Credits check passed.');
}
