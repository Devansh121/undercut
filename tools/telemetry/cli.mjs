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

async function loadAiLib() {
  const { module } = await runnerImport(path.join(root, 'packages/ai/validation/lib/index.ts'), {
    root,
    configFile: false,
    logLevel: 'error',
  });
  return module;
}

// The reference driver on the committed racing line: flying lap(s) in the doc 2.1 conditions.
async function lap(options) {
  const ai = await loadAiLib();
  const laps = Number(options.laps ?? 1);
  const setup = ai.MONZA;
  const fuel = Number(options.fuel ?? (laps > 1 ? setup.fuel + 2.2 * (laps + 1) : setup.fuel));
  const every = Number(options.every ?? 6);
  const t0 = performance.now();
  const { result, plan } = ai.referenceLap(setup, {
    laps,
    fuel,
    recordEvery: every,
    clock: () => performance.now(),
  });
  const wall = (performance.now() - t0) / 1000;
  if (result.spun) console.log('The car spun; no lap completed.');
  const summary = { circuit: setup.id, trim: setup.trim, fuel, laps: [], traces: [] };
  result.laps.forEach((l, k) => {
    const report = ai.monzaLapReport(l, plan);
    console.log(`\nLap ${k + 1}\n${ai.formatLapReport(report)}`);
    summary.laps.push(report);
  });
  if (result.laps.length > 1) {
    const times = result.laps.map((l) => l.time);
    console.log(
      `\n${times.length} laps: ${times.map((t) => t.toFixed(3)).join(', ')}; ` +
        `spread ${(Math.max(...times) - Math.min(...times)).toFixed(3)} s`,
    );
  }
  console.log(
    `\n${result.simTime.toFixed(1)} s simulated in ${wall.toFixed(2)} s ` +
      `(${(result.simTime / wall).toFixed(0)}× real time); driver ${result.driverTickUs.toFixed(2)} µs per tick`,
  );
  fs.mkdirSync(outDir, { recursive: true });
  if (result.trace) {
    const file = path.join(outDir, `lap-${setup.id}.csv`);
    fs.writeFileSync(file, ai.lapTraceToCsv(result.trace));
    summary.traces.push(path.relative(root, file));
  }
  const file = path.join(outDir, `lap-${setup.id}.json`);
  fs.writeFileSync(file, JSON.stringify(summary, null, 2) + '\n');
  console.log(`wrote ${summary.traces.length + 1} file(s) to ${path.relative(root, outDir)}/`);
}

const { name, options } = parseArgs(process.argv.slice(2));
if (name === 'lap') {
  await lap(options);
  process.exit(0);
}
const lib = await loadLib();
const names = Object.keys(lib.MANOEUVRES);
if (name === 'list' || options.help) {
  console.log('Manoeuvres:');
  for (const n of names) console.log(`  ${n.padEnd(15)} ${lib.MANOEUVRES[n].describe}`);
  console.log(`  ${'all'.padEnd(15)} every manoeuvre above`);
  console.log(
    `  ${'bench'.padEnd(15)} real-time factor for 1 and 20 cars (--seconds, default 300)`,
  );
  console.log(
    `  ${'lap'.padEnd(15)} reference driver, flying lap(s) at Monza (--laps, --fuel, --every)`,
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
