// Repository name checks, run by `npm run lint`:
// - the game's display name is spelled in exactly one constant (packages/core/src/name.ts);
// - no real racing-series name or abbreviation in code, UI or repo metadata.
// Docs may cite real-world data sources by name, so docs/ is not scanned for the second rule.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const NAME_FILE = 'packages/core/src/name.ts';
const nameSource = fs.readFileSync(NAME_FILE, 'utf8');
const match = /export const GAME_NAME = '([^']+)'/.exec(nameSource);
if (!match) {
  console.error(`${NAME_FILE}: could not find the GAME_NAME constant.`);
  process.exit(1);
}
const gameName = match[1];
// Display spellings: all caps and title case. Lowercase is allowed for identifiers
// such as the @undercut/* package scope.
const displayForms = [
  gameName.toUpperCase(),
  gameName[0].toUpperCase() + gameName.slice(1).toLowerCase(),
];

const files = execFileSync('git', ['ls-files', '-co', '--exclude-standard'], { encoding: 'utf8' })
  .split('\n')
  .filter((f) => f && fs.existsSync(f));

const CODE =
  /^(apps|packages|services|tools)\/.*\.(ts|tsx|mjs|js|cjs|html|css|json|jsonc)$|^[^/]+\.(json|jsonc|js|ts|sh)$|^\.github\/.*\.ya?ml$/;
// Built from parts so that this file does not itself contain the words it bans.
const F = 'F';
const SERIES = new RegExp(`\\b${F}1\\b|\\b${F}ormula[\\s-]?(1|One)\\b`, 'i');
const SKIP_SERIES = /^(docs\/|package-lock\.json$)/;

const problems = [];
for (const file of files) {
  const scanName = CODE.test(file) && file !== NAME_FILE && file !== 'tools/ci/check-names.mjs';
  const scanSeries =
    !SKIP_SERIES.test(file) &&
    !/\.(png|jpe?g|webp|avif|glb|bin|ktx2|hdr|exr|woff2?|ogg|mp3|wav|ico)$/i.test(file);
  if (!scanName && !scanSeries) continue;
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    if (scanName && displayForms.some((form) => line.includes(form))) {
      problems.push(
        `${file}:${i + 1}: spells the game name; import GAME_NAME from @undercut/core instead`,
      );
    }
    if (scanSeries && SERIES.test(line)) {
      problems.push(`${file}:${i + 1}: names a real racing series`);
    }
  });
}

if (problems.length > 0) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log(`Name checks passed (${files.length} files).`);
