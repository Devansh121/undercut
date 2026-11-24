// Real-world name check, run by `npm run lint`: no real racing series, team, driver, sponsor or
// official circuit name in code, data, assets' text files or repo metadata. The list and the few
// allowed citations are in tools/ci/trademarks.json. Of docs/, only the two research documents are
// skipped, because they cite real data sources throughout; any other citation in docs needs an
// `allow` entry with its reason. The real series' own name and abbreviation are checked by
// check-names.mjs.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const LIST_FILE = 'tools/ci/trademarks.json';
const SKIP = /^(docs\/(physics-validation|track-data)\.md|package-lock\.json)$/;
const BINARY =
  /\.(png|jpe?g|webp|avif|gif|ico|glb|gltf|bin|ktx2|hdr|exr|woff2?|ttf|otf|ogg|mp3|wav|flac|wasm|pdf|blend|zip|gz|br)$/i;

/** A whole-word matcher for one term: case-insensitive, or exact case with a leading '='. */
export function termPattern(term) {
  const exact = term.startsWith('=');
  const body = (exact ? term.slice(1) : term).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![\\p{L}\\p{N}_])${body}(?![\\p{L}\\p{N}_])`, exact ? 'u' : 'iu');
}

/**
 * Returns `file:line: names <term> (<group>)` for every hit outside the allowed citations.
 * `files` are repo-relative paths; `read(file)` returns the text.
 */
export function findNames(files, read, list) {
  const terms = Object.entries(list.terms).flatMap(([group, ts]) =>
    ts.map((term) => ({ term, group, re: termPattern(term) })),
  );
  const allow = (list.allow ?? []).map((a) => ({ term: a.term, files: new RegExp(a.files) }));
  const problems = [];
  for (const file of files) {
    if (file === LIST_FILE || SKIP.test(file) || BINARY.test(file)) continue;
    const allowed = new Set(allow.filter((a) => a.files.test(file)).map((a) => a.term));
    const active = terms.filter((t) => !allowed.has(t.term));
    read(file)
      .split('\n')
      .forEach((line, i) => {
        for (const t of active) {
          if (t.re.test(line)) {
            problems.push(`${file}:${i + 1}: names ${t.term.replace(/^=/, '')} (${t.group})`);
          }
        }
      });
  }
  return problems;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = path.resolve(here, '../..');
  const list = JSON.parse(fs.readFileSync(path.join(root, LIST_FILE), 'utf8'));
  const files = execFileSync('git', ['ls-files', '-co', '--exclude-standard'], {
    cwd: root,
    encoding: 'utf8',
  })
    .split('\n')
    .filter((f) => f && fs.statSync(path.join(root, f), { throwIfNoEntry: false })?.isFile());
  const problems = findNames(files, (f) => fs.readFileSync(path.join(root, f), 'utf8'), list);
  if (problems.length > 0) {
    console.error(problems.join('\n'));
    console.error(
      `\n${problems.length} real-world name(s). Rename them, or, for a citation of a data source ` +
        `only, add an entry with its reason to ${LIST_FILE}.`,
    );
    process.exit(1);
  }
  console.log(`Real-name check passed (${files.length} files).`);
}
