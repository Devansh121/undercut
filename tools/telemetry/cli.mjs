// Telemetry runner: `npm run telemetry -- <manoeuvre|all|bench|list> [--key value ...]`.
// Runs scripted manoeuvres headless against @undercut/sim, prints result against target and
// tolerance, and writes traces (CSV) and a summary (JSON) to artifacts/telemetry/.
// The manoeuvres live in packages/sim/validation/lib, shared with the physics suite; this file
// loads that TypeScript through Vite's module runner, then only does I/O and timing.
import { createHash } from 'node:crypto';
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

async function bench(lib, options) {
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
  // The representative track workload: cars on the Monza surface driven round the racing line
  // by the reference driver (packages/ai/validation/lib/bench.ts), timing the world steps only.
  const ai = await loadAiLib();
  const trackSeconds = Number(options['track-seconds'] ?? 30);
  const track = [];
  for (const cars of [1, 20]) {
    ai.trackBenchWorkload(cars, 2, () => performance.now()); // warm up
    const r = ai.trackBenchWorkload(cars, trackSeconds, () => performance.now());
    track.push(r);
    console.log(
      `${String(cars).padStart(2)} car(s) on the Monza surface (reference driver): ` +
        `${r.msPerTick.toFixed(3)} ms per 240 Hz tick for all cars ` +
        `(${(1000 / 240 / r.msPerTick).toFixed(1)}× real time for the field)`,
    );
  }
  fs.mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, 'bench.json');
  fs.writeFileSync(
    file,
    JSON.stringify({ node: process.version, step: '1/240 s', results, track }, null, 2) + '\n',
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

// Where each reference lap's time goes (docs/physics-validation.md 7.10).
async function budget(options) {
  const ai = await loadAiLib();
  const setups = { monza: ai.MONZA, spa: ai.SPA, singapore: ai.SINGAPORE };
  const ids = (options.circuit ?? 'monza,spa,singapore').split(',');
  const pouhon = ai.pouhonMeasuredG();
  const out = {};
  for (const id of ids) {
    const setup = setups[id];
    if (!setup)
      throw new Error(`no racing line for ${id}; one of ${Object.keys(setups).join(', ')}`);
    const b = ai.lapBudget(setup, pouhon);
    out[id] = b;
    console.log(`\n${ai.formatBudget(b)}`);
  }
  fs.mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, 'budget.json');
  fs.writeFileSync(file, JSON.stringify(out, null, 2) + '\n');
  console.log(`\nwrote ${path.relative(root, file)}`);
}

// The reference driver on the committed racing line: flying lap(s) in the doc 2.1 conditions.
async function lap(options) {
  const ai = await loadAiLib();
  const laps = Number(options.laps ?? 1);
  const setups = { monza: ai.MONZA, spa: ai.SPA, singapore: ai.SINGAPORE };
  const setup = setups[options.circuit ?? 'monza'];
  if (!setup)
    throw new Error(
      `no racing line for ${options.circuit}; one of ${Object.keys(setups).join(', ')}`,
    );
  // Fuel a lap with a margin, as the soak carries (packages/ai/validation/soak).
  const perLap = { monza: 2.2, spa: 2.7, singapore: 2.0 }[setup.id];
  const fuel = Number(options.fuel ?? (laps > 1 ? setup.fuel + perLap * (laps + 1) : setup.fuel));
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
    const report = ai.circuitLapReport(setup.id, l, plan, setup.controlLine);
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

async function loadRaceLib() {
  const { module } = await runnerImport(path.join(root, 'packages/race/validation/lib/index.ts'), {
    root,
    configFile: false,
    logLevel: 'error',
  });
  return module;
}

const fmtTime = (t) => {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(3).padStart(6, '0')}`;
};

/** The event log for the console: everything but positions, sectors and speed traps (counted). */
function printEvents(run, codes) {
  const quiet = new Set(['position', 'sector', 'speedTrap', 'lap', 'lapStart', 'drsEligible']);
  const counts = {};
  for (const e of run.events) {
    counts[e.type] = (counts[e.type] ?? 0) + 1;
    if (quiet.has(e.type)) continue;
    const who = e.car !== undefined ? ` ${codes[e.car]}` : '';
    const rest = Object.entries(e)
      .filter(([k]) => !['type', 't', 'car'].includes(k))
      .map(([k, v]) => `${k}=${typeof v === 'number' ? Number(v.toFixed(3)) : JSON.stringify(v)}`)
      .join(' ');
    console.log(`  ${fmtTime(e.t)}  ${e.type}${who}${rest ? ` ${rest}` : ''}`);
  }
  console.log(
    `  counts: ${Object.entries(counts)
      .map(([k, v]) => `${k} ${v}`)
      .join(', ')}`,
  );
}

function printRun(lib, run) {
  const codes = run.result.entries
    .slice()
    .sort((a, b) => a.car - b.car)
    .map((e) => e.code);
  console.log(lib.formatResult(run));
  console.log('\nEvent log:');
  printEvents(run, codes);
  console.log(
    '\nPer car (lap-1 position, slowest point after the start outside the pit lane, track limits):',
  );
  for (const c of run.cars) {
    console.log(
      `  ${c.code}  after lap 1 P${c.positionAfterLap1 ?? '-'}  min ${c.minSpeedKmh.toFixed(0)} km/h at s=${c.minSpeedAt.toFixed(0)}  ` +
        `max wheels off ${c.maxWheelsOff}  all-off ticks ${c.allOffTicks}  max |d| ${c.maxOffset.toFixed(1)} m  ` +
        `contact ${(c.contactTicks / 240).toFixed(2)} s (longest ${c.longestContact.toFixed(2)} s, ` +
        `${c.maxContactSpeed.toFixed(1)} m/s, ${c.contactImpulse.toFixed(0)} N·s)  spins ${c.spins}  ` +
        `turn one ${c.turnOne}  barrier ${c.beyondBarrier > 0 ? `${c.beyondBarrier.toFixed(1)} m past` : 'clear'}`,
    );
  }
  if (run.result.kind === 'race') {
    const clean = run.cars.filter((c) => c.turnOne === 'clean').length;
    console.log(
      `\nTurn one: ${clean} of ${run.cars.length} clean; longest contact ${Math.max(...run.cars.map((c) => c.longestContact)).toFixed(2)} s; ` +
        `spins ${run.cars.reduce((a, c) => a + c.spins, 0)}; past a barrier line ${run.cars.filter((c) => c.beyondBarrier > 0).length}`,
    );
    const r = run.racing;
    console.log(
      `Racing: ${r.overtakes} on-track position changes; closest gap ${r.closestGap.toFixed(2)} s; ` +
        `at racing speed ${(100 * r.within05).toFixed(1)} % of the time within 0.5 s of the car ahead, ${(100 * r.within10).toFixed(1)} % within 1 s`,
    );
  }
  const a = run.result.anomalies;
  console.log(
    `\nWatchdog: ${a.length === 0 ? 'no stuck cars, no anomalies' : `${a.length} anomalies`}`,
  );
  for (const x of a) {
    console.log(
      `  ${codes[x.car]} ${x.kind} from ${fmtTime(x.start)} to ${x.end === null ? 'the end' : fmtTime(x.end)}`,
    );
  }
  if (run.result.kind === 'race') {
    const o = run.overlaps;
    console.log(
      `First lap, footprints overlapping: ${o.pairs} car pairs overlapped (${o.pairsInFirstCorner} in the first corner), ` +
        `at most ${o.peak} at once near s=${o.peakAtS.toFixed(0)}; last car crossed the line ${run.firstLap ? run.firstLap.spread.toFixed(3) : '-'} s after the leader.`,
    );
  }
}

function digest(run) {
  return createHash('sha256')
    .update(JSON.stringify({ result: run.result, events: run.events }))
    .digest('hex')
    .slice(0, 16);
}

// N AI cars race at Monza; classification, event log, anomalies; JSON to artifacts/telemetry/.
async function race(options, weekend = false) {
  const lib = await loadRaceLib();
  const circuit = options.circuit ?? 'monza';
  if (circuit !== 'monza') throw new Error(`only monza has a racing line so far, not ${circuit}`);
  const o = {
    cars: Number(options.cars ?? 20),
    laps: Number(options.laps ?? 5),
    seed: Number(options.seed ?? 1),
    clock: () => performance.now(),
  };
  if (options.spread !== undefined) o.spread = Number(options.spread);
  if (options['no-pit'] !== undefined) o.pitLap = null;
  if (options['grid-noise'] !== undefined) o.gridNoise = Number(options['grid-noise']);
  fs.mkdirSync(outDir, { recursive: true });
  const runs = [];
  if (weekend) {
    if (options.practice !== undefined) o.practice = Number(options.practice);
    o.qualifying = Number(options.qualifying ?? 600);
    const out = lib.runWeekend(o);
    runs.push(...out.runs);
    console.log(
      `Grid from qualifying: ${out.weekend
        .grid()
        .map((i) => `D${String(i + 1).padStart(2, '0')}`)
        .join(' ')}\n`,
    );
  } else {
    runs.push(lib.runRace(o));
  }
  const files = [];
  for (const run of runs) {
    printRun(lib, run);
    const hash = digest(run);
    console.log(
      `\n${run.simTime.toFixed(1)} s simulated in ${run.wallSeconds.toFixed(1)} s (${(run.simTime / run.wallSeconds).toFixed(1)}× real time); result digest ${hash}\n`,
    );
    const file = path.join(
      outDir,
      `${run.result.kind}-${circuit}-c${o.cars}-l${o.laps}-s${o.seed}.json`,
    );
    const { clock: _c, ...args } = o;
    fs.writeFileSync(
      file,
      JSON.stringify(
        {
          args,
          digest: hash,
          result: run.result,
          cars: run.cars,
          overlaps: run.overlaps,
          firstLap: run.firstLap,
          simTime: run.simTime,
          events: run.events,
        },
        null,
        1,
      ) + '\n',
    );
    files.push(path.relative(root, file));
  }
  console.log(`wrote ${files.join(', ')}`);
}

const { name, options } = parseArgs(process.argv.slice(2));
if (name === 'calibrate') {
  const { calibrate } = await import('./calibrate.mjs');
  await calibrate(process.argv.slice(3));
  process.exit(0);
}
if (name === 'lap') {
  await lap(options);
  process.exit(0);
}
if (name === 'budget') {
  await budget(options);
  process.exit(0);
}
if (name === 'race' || name === 'weekend') {
  await race(options, name === 'weekend');
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
  console.log(
    `  ${'race'.padEnd(15)} AI race at Monza (--cars 20, --laps 5, --seed 1, --spread, --grid-noise, --no-pit)`,
  );
  console.log(
    `  ${'weekend'.padEnd(15)} qualifying then the race (--qualifying 600, --practice, as race)`,
  );
  console.log(
    `  ${'calibrate'.padEnd(15)} every target, the Monza lap and corner speeds for a candidate car (--set file.json, --line rebuild)`,
  );
  console.log(
    `  ${'budget'.padEnd(15)} where each reference lap's time goes: driver, planning margin, car; term sensitivities (--circuit)`,
  );
} else if (name === 'bench') {
  await bench(lib, options);
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
