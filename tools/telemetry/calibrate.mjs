// Calibration harness: `npm run telemetry -- calibrate [--set candidate.json] [--line rebuild]
// [--only targets|lap] [--out name.json]`.
//
// One command that judges a candidate car against everything the calibration looks at: the 32
// component targets of docs/physics-validation.md section 2 (the physics suite's measurements),
// the Monza reference lap (the speed profile the reference driver plans and the lap it drives),
// per-sector times and per-corner minimum speeds against the doc's reference values, and one
// scalar summary. It never edits the repository.
//
// A candidate is a JSON file of parameter values laid out like `CarParams`, with the aero trims
// keyed by name:
//
//   { "tyre": { "muY": 2.0 }, "aero": { "low": { "clA": 3.9 }, "all": { "stallLoss": 0.2 } } }
//
// It is applied by rewriting `createCarParams` in packages/sim/src/params.ts as the module is
// loaded, so every consumer (the physics suite's manoeuvres, the envelope measurement, the lap
// runner's `createCarParams(trim)`) builds exactly the car it would build if params.ts held
// those values. Without --set the harness measures the committed car.
//
// The lap uses a freshly measured envelope. By default the committed racing line's offsets are
// kept and only the speed profile is re-planned (about 2 s); `--line rebuild` recomputes the
// line from the new envelope as `npm run ai:build` does (about 15 s more).
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { runnerImport } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const outDir = path.join(root, 'artifacts', 'telemetry');
const PARAMS = path.join(root, 'packages/sim/src/params.ts');
const ENTRY = 'virtual:undercut-calibrate';

/**
 * Reference minimum speeds per Monza corner, km/h, for the report only: they are secondary,
 * not targets, and never fail anything. `kind` says whether the value is sourced or an estimate;
 * docs/physics-validation.md section 2.6 has the reasoning and sources.
 */
export const CORNER_REFERENCE = [
  { number: 1, low: 75, high: 85, kind: 'estimate' },
  { number: 2, low: 75, high: 85, kind: 'estimate' },
  { number: 4, low: 110, high: 120, kind: 'estimate' },
  { number: 5, low: 115, high: 125, kind: 'estimate' },
  { number: 6, low: 175, high: 190, kind: 'estimate' },
  { number: 7, low: 177, high: 184, kind: 'sourced, 2024 practice [54]' },
  { number: 8, low: 176, high: 190, kind: 'sourced, 2024 practice [54][55]' },
  { number: 11, low: 200, high: 215, kind: 'estimate' },
];

function parseArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) throw new Error(`unexpected argument ${arg}`);
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) options[key] = 'true';
    else options[key] = argv[++i];
  }
  return options;
}

/** Vite plugin: one virtual entry for both validation libraries, and the candidate's params. */
function calibratePlugin(candidate) {
  return {
    name: 'undercut-calibrate',
    resolveId(id) {
      return id === ENTRY ? '\0' + ENTRY : null;
    },
    load(id) {
      if (id !== '\0' + ENTRY) return null;
      const p = (rel) => JSON.stringify(path.join(root, rel));
      return [
        `export * as sim from ${p('packages/sim/validation/lib/index.ts')};`,
        `export * as lap from ${p('packages/ai/validation/lib/index.ts')};`,
        `export * as ai from ${p('packages/ai/src/index.ts')};`,
      ].join('\n');
    },
    transform(code, id) {
      if (!candidate || path.resolve(id.split('?')[0]) !== PARAMS) return null;
      const head = 'export function createCarParams(';
      if (!code.includes(head)) throw new Error('createCarParams not found in params.ts');
      return (
        code.replace(head, 'function baseCreateCarParams(') +
        `
const CANDIDATE = ${JSON.stringify(candidate)};
export function createCarParams(trim = 'medium', overrides = {}) {
  const base = baseCreateCarParams(trim);
  const out = {};
  for (const key of Object.keys(base)) {
    const own = key === 'aero'
      ? { ...(CANDIDATE.aero?.all ?? {}), ...(CANDIDATE.aero?.[trim] ?? {}) }
      : (CANDIDATE[key] ?? {});
    for (const k of Object.keys(own)) {
      if (!(k in base[key])) throw new Error('candidate: unknown parameter ' + key + '.' + k);
    }
    out[key] = { ...base[key], ...own, ...(overrides[key] ?? {}) };
  }
  return out;
}
`
      );
    },
  };
}

/** Load both validation libraries with `candidate` applied (null: the committed car). */
export async function load(candidate) {
  const { module } = await runnerImport(ENTRY, {
    root,
    configFile: false,
    logLevel: 'error',
    plugins: [calibratePlugin(candidate)],
  });
  return module;
}

/** Normalised miss: distance outside the band in half-widths (0 inside). */
function miss(t, value) {
  const half = (t.high - t.low) / 2;
  return t.low <= value && value <= t.high
    ? 0
    : Math.min(Math.abs(value - t.low), Math.abs(value - t.high)) / half;
}

function measureTargets(sim) {
  const values = {};
  Object.assign(values, sim.measureAcceleration().values);
  Object.assign(values, sim.measureTopSpeed().values);
  for (const e of sim.BRAKING_EVENTS) Object.assign(values, sim.measureBrakingEvent(e).values);
  const curve = sim.measureBrakingCurve();
  values['brake-peak-300'] = curve.peaks[0];
  values['brake-peak-100'] = curve.peaks[curve.peaks.length - 1];
  for (const c of sim.LATERAL_CASES) values[c.id] = sim.measureLateral(c).value;
  const rows = Object.values(sim.TARGETS).map((t) => {
    const value = values[t.id];
    return {
      id: t.id,
      label: t.label,
      unit: t.unit,
      value,
      low: t.low,
      high: t.high,
      pass: t.low <= value && value <= t.high,
      miss: miss(t, value),
      role: t.role,
      recordedGap: sim.KNOWN_GAPS[t.id]?.measured ?? null,
    };
  });
  return { rows, curve };
}

function measureLap(m, options, clock) {
  const { lap, ai } = m;
  const setup = lap.MONZA;
  const params = lap.carFor(setup);
  const track = setup.track();
  const t0 = clock();
  const report = ai.measureEnvelope({ params, airDensity: setup.airDensity, fuel: setup.fuel });
  const envelope = JSON.parse(JSON.stringify(report.envelope));
  const t1 = clock();
  const skill = ai.REFERENCE_SKILL;
  let offsets;
  if (options.line === 'rebuild') {
    offsets = ai.buildRacingLine(track, envelope, ai.referenceLineConfig(params)).d;
  } else {
    offsets = ai.racingLineOffsets(lap.loadLine(setup));
  }
  const plan = ai.buildPlan(track, offsets, envelope, { scale: skill.envelope });
  const full = ai.buildPlan(track, offsets, envelope, { scale: ai.FULL_ENVELOPE });
  const t2 = clock();
  const run = lap.runLaps({
    track,
    plan,
    trim: setup.trim,
    airDensity: setup.airDensity,
    fuel: setup.fuel,
    laps: Number(options.laps ?? 1),
    recordEvery: Number(options.every ?? 0),
    stops: { 1: [lap.MONZA_PUBLISHED.t1.v1, lap.MONZA_PUBLISHED.t1.v2] },
    timingLine: setup.controlLine,
    driver: (p) => new ai.ReferenceDriver({ plan, params: p, skill, deployBeforeLine: false }),
  });
  const t3 = clock();
  return {
    envelope,
    plan,
    fullPlanLap: full.profile.lapTime,
    run,
    reports: run.laps.map((l) => lap.monzaLapReport(l, plan, setup.controlLine)),
    ms: { envelope: t1 - t0, plan: t2 - t1, lap: t3 - t2 },
  };
}

function fmt(v, d = 3) {
  return Number.isFinite(v) ? v.toFixed(d) : 'n/a';
}

function printTargets(rows) {
  console.log('| Target | Role | Result | Band | Verdict | Miss | Recorded gap |');
  console.log('| --- | --- | --- | --- | --- | --- | --- |');
  for (const r of rows) {
    console.log(
      `| ${r.label} | ${r.role} | ${fmt(r.value)} ${r.unit} | ${fmt(r.low, 2)}–${fmt(r.high, 2)} | ` +
        `${r.pass ? 'pass' : 'out'} | ${fmt(r.miss, 2)} | ${r.recordedGap ?? ''} |`,
    );
  }
}

function printLap(m, result) {
  const { lap } = m;
  const r = result.reports[0];
  if (!r) {
    console.log('\nNo lap completed (spin or timeout).');
    return;
  }
  console.log(`\n${lap.formatLapReport(r)}`);
  console.log(
    `\nFull-envelope profile on the same line: ${fmt(result.fullPlanLap)} s; ` +
      `driver's profile ${fmt(result.plan.profile.lapTime)} s; driven ${fmt(r.lap)} s.`,
  );
  console.log(
    '\n| Corner | Driven min | Plan min | Reference (km/h) | Kind | Driven − reference |',
  );
  console.log('| --- | --- | --- | --- | --- | --- |');
  for (const ref of CORNER_REFERENCE) {
    const c = r.corners.find((x) => x.number === ref.number);
    if (!c) continue;
    const delta =
      c.minSpeed < ref.low
        ? c.minSpeed - ref.low
        : c.minSpeed > ref.high
          ? c.minSpeed - ref.high
          : 0;
    console.log(
      `| T${c.number} ${c.name} | ${fmt(c.minSpeed, 1)} | ${fmt(c.planMin, 1)} | ${ref.low}–${ref.high} | ${ref.kind} | ${fmt(delta, 1)} |`,
    );
  }
}

/** Run the harness with CLI arguments (after the `calibrate` word). */
export async function calibrate(argv) {
  const options = parseArgs(argv);
  const candidate = options.set
    ? JSON.parse(fs.readFileSync(path.resolve(options.set), 'utf8'))
    : null;
  const clock = () => performance.now();
  const t0 = clock();
  const m = await load(candidate);
  const t1 = clock();
  const out = { candidate, targets: null, lap: null };
  let score = 0;
  if (options.only !== 'lap') {
    const { rows } = measureTargets(m.sim);
    out.targets = rows;
    printTargets(rows);
    const passed = rows.filter((r) => r.pass).length;
    const missSum = rows.reduce((a, r) => a + r.miss, 0);
    score += missSum;
    console.log(
      `\n${passed} of ${rows.length} targets in band; summed miss ${fmt(missSum, 2)} half-widths.`,
    );
  }
  const t2 = clock();
  if (options.only !== 'targets') {
    const result = measureLap(m, options, clock);
    printLap(m, result);
    const r = result.reports[0];
    const band = m.lap.LAP_TARGETS['monza-lap-m1'];
    const lapMiss = r ? miss(band, r.lap) : 10;
    score += lapMiss;
    out.lap = {
      reports: result.reports,
      spun: result.run.spun,
      plan: result.plan.profile.lapTime,
      fullPlan: result.fullPlanLap,
      envelope: result.envelope,
      ms: result.ms,
    };
    console.log(
      `\nLap: ${r ? fmt(r.lap) : 'none'} s (M1 miss ${fmt(lapMiss, 2)} half-widths); ` +
        `envelope ${fmt(result.ms.envelope / 1000, 1)} s, plan ${fmt(result.ms.plan / 1000, 1)} s, ` +
        `lap ${fmt(result.ms.lap / 1000, 1)} s.`,
    );
  }
  const t3 = clock();
  out.score = score;
  console.log(
    `\nScore ${fmt(score, 3)} (sum of misses in band half-widths, lower is better; 0 = every target ` +
      `and the M1 lap band met). Load ${fmt((t1 - t0) / 1000, 1)} s, targets ` +
      `${fmt((t2 - t1) / 1000, 1)} s, lap ${fmt((t3 - t2) / 1000, 1)} s.`,
  );
  fs.mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, options.out ?? 'calibrate.json');
  fs.writeFileSync(file, JSON.stringify(out, null, 2) + '\n');
  console.log(`wrote ${path.relative(root, file)}`);
  return out;
}
