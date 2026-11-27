// Deterministic proof batches; keep baseline and candidate outputs separate.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runnerImport } from 'vite';
import { proofCases, proofMarkdown, proofReport, summarizeRace } from './racecraft-proof-lib.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log(
    'racecraft-proof.mjs --circuit CIRCUIT --group GROUP --out FILE --label REVISION [--module BUNDLE] [--baseline FILE --baseline-label REVISION --report FILE]',
  );
  process.exit(0);
}
const allowed = new Set([
  'circuit',
  'group',
  'out',
  'label',
  'module',
  'baseline',
  'baseline-label',
  'report',
]);
const options = {};
for (let i = 0; i < args.length; i += 2) {
  const key = args[i]?.slice(2);
  if (!args[i]?.startsWith('--') || !allowed.has(key) || !args[i + 1])
    throw new Error(`invalid option ${args[i]}`);
  options[key] = args[i + 1];
}
for (const key of ['circuit', 'group', 'out', 'label'])
  if (!options[key]) throw new Error(`--${key} is required`);
const cases = proofCases(options.circuit, options.group);
if (options.baseline && (!options['baseline-label'] || !options.report))
  throw new Error('--baseline requires --baseline-label and --report');

function readRows(file) {
  return fs.existsSync(file)
    ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(JSON.parse)
    : [];
}
const rows = readRows(options.out);
if (rows.some((row) => row.revision !== options.label))
  throw new Error('output contains a different revision; use a separate output file');
const module = options.module
  ? await import(pathToFileURL(path.resolve(options.module)).href)
  : (
      await runnerImport(path.join(root, 'packages/race/validation/lib/followup-proof.ts'), {
        root,
        configFile: false,
        logLevel: 'error',
      })
    ).module;
fs.mkdirSync(path.dirname(path.resolve(options.out)), { recursive: true });
for (const spec of cases) {
  if (
    rows.some(
      (row) =>
        row.circuit === spec.circuit &&
        row.seed === spec.seed &&
        row.laps === spec.laps &&
        row.settings === spec.settings,
    )
  )
    continue;
  const row = {
    revision: options.label,
    ...summarizeRace(
      spec,
      spec.settings === 'default'
        ? module.runDefaultRace(spec.circuit, spec.seed, spec.laps)
        : module.runFollowupRace(spec.circuit, spec.seed, spec.laps),
    ),
  };
  fs.appendFileSync(options.out, JSON.stringify(row) + '\n');
  rows.push(row);
  console.log(JSON.stringify(row));
}
if (options.baseline) {
  const report = proofReport(readRows(options.baseline), rows);
  fs.writeFileSync(options.report, proofMarkdown(report, options['baseline-label'], options.label));
  if (report.failures.length) process.exitCode = 1;
}
