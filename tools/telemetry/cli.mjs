// Telemetry runner: `npm run telemetry -- <manoeuvre|all|bench|list> [--key value ...]`.
// Runs scripted manoeuvres headless against @undercut/sim, prints result against target and
// tolerance, and writes traces (CSV) and a summary (JSON) to artifacts/telemetry/.
// The manoeuvres live in packages/sim/validation/lib, shared with the physics suite; this file
// loads that TypeScript through Vite's module runner, then only does I/O and timing.
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { runnerImport } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const outDir = path.join(root, 'artifacts', 'telemetry');

function parseArgs(argv) {
  const [name = 'list', ...rest] = argv;
  const options = {};
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (!arg.startsWith('--')) throw new Error(`unexpected argument ${arg}`);
    const key = arg.slice(2);
    const next = rest[i + 1];
    if (next === undefined || next.startsWith('--')) options[key] = 'true';
    else options[key] = rest[++i];
  }
  return { name, options };
}

async function loadLib() {
  const { module } = await runnerImport(path.join(root, 'packages/sim/validation/lib/index.ts'), {
    root,
    configFile: false,
    logLevel: 'error',
  });
  return module;
}

function writeReport(lib, report) {
  fs.mkdirSync(outDir, { recursive: true });
  const files = [];
  for (const { name, trace } of report.traces) {
    const file = path.join(outDir, `${name}.csv`);
    fs.writeFileSync(file, lib.traceToCsv(trace));
    files.push(path.relative(root, file));
  }
  const summaryFile = path.join(outDir, `${report.name}.json`);
  const summary = {
    manoeuvre: report.name,
    title: report.title,
    rows: report.rows,
    summary: report.summary,
    traces: files,
  };
  fs.writeFileSync(summaryFile, JSON.stringify(summary, null, 2) + '\n');
  files.push(path.relative(root, summaryFile));
  return files;
}

function bench(lib, options) {
  const seconds = Number(options.seconds ?? 300);
  const results = [];
  for (const cars of [1, 20]) {
    lib.benchWorkload(cars, 5); // warm up the JIT
    const t0 = performance.now();
    const { simSeconds, checksum } = lib.benchWorkload(cars, cars === 1 ? seconds : seconds / 10);
    const wall = (performance.now() - t0) / 1000;
    const perCar = (simSeconds * cars) / wall;
    results.push({
      cars,
      simSeconds,
      wallSeconds: wall,
      realTimeFactorPerCar: perCar,
      realTimeFactorWorld: simSeconds / wall,
      checksum,
    });
    console.log(
      `${String(cars).padStart(2)} car(s): ${simSeconds.toFixed(0)} s simulated in ${wall.toFixed(2)} s ` +
        `→ ${perCar.toFixed(0)}× real time per car, ${(simSeconds / wall).toFixed(1)}× for the whole field ` +
        `(one step of all ${cars} car(s): ${((wall / (simSeconds * 240)) * 1e3).toFixed(3)} ms)`,
    );
  }
  fs.mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, 'bench.json');
  fs.writeFileSync(
    file,
    JSON.stringify({ node: process.version, step: '1/240 s', results }, null, 2) + '\n',
  );
  console.log(`wrote ${path.relative(root, file)}`);
}

const { name, options } = parseArgs(process.argv.slice(2));
const lib = await loadLib();
const names = Object.keys(lib.MANOEUVRES);
if (name === 'list' || options.help) {
  console.log('Manoeuvres:');
  for (const n of names) console.log(`  ${n.padEnd(15)} ${lib.MANOEUVRES[n].describe}`);
  console.log(`  ${'all'.padEnd(15)} every manoeuvre above`);
  console.log(
    `  ${'bench'.padEnd(15)} real-time factor for 1 and 20 cars (--seconds, default 300)`,
  );
} else if (name === 'bench') {
  bench(lib, options);
} else {
  const todo = name === 'all' ? names : [name];
  let failures = 0;
  for (const n of todo) {
    const m = lib.MANOEUVRES[n];
    if (!m) {
      console.error(`unknown manoeuvre "${n}"; try: npm run telemetry -- list`);
      process.exit(2);
    }
    const report = m.run(options);
    console.log(lib.formatTable(report));
    const files = writeReport(lib, report);
    console.log(`wrote ${files.length} file(s) to ${path.relative(root, outDir)}/\n`);
    failures += report.rows.filter((r) => r.verdict === 'fail').length;
  }
  if (failures > 0)
    console.log(`${failures} row(s) outside their target band and not recorded as known gaps.`);
}
