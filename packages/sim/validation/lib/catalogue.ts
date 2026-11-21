import type { AeroTrim } from '../../src/index';
import { CIRCUITS, KMH, type Trace } from './harness';
import {
  absStraightStop,
  braking,
  bestBraking,
  bestStandingStart,
  brakeWhileTurning,
  coastDown,
  lateralLimit,
  liftOffInCorner,
  peakDeceleration,
  standingStart,
  stepSteer,
  throttleOutOfSlowCorner,
  topSpeed,
} from './manoeuvres';
import { KERB_CASES, kerbCrossing } from './kerbs';
import {
  measureAcceleration,
  measureBrakingCurve,
  measureBrakingEvent,
  measureLateral,
  measureTopSpeed,
} from './measure';
import {
  BRAKING_CURVE_SPEEDS,
  BRAKING_EVENTS,
  KNOWN_GAPS,
  LATERAL_CASES,
  TARGETS,
  verdict,
  type Verdict,
} from './targets';

/**
 * The telemetry runner's manoeuvres as pure functions: each returns a table, traces and a
 * summary. The CLI (tools/telemetry) writes them to disk and prints the table.
 */
export interface ReportRow {
  label: string;
  result: string;
  unit: string;
  target: string;
  band: string;
  verdict: Verdict | '';
}

export interface Report {
  name: string;
  title: string;
  rows: ReportRow[];
  traces: { name: string; trace: Trace }[];
  summary: Record<string, unknown>;
}

export type Options = Record<string, string>;

const TRIMS: readonly AeroTrim[] = ['low', 'medium', 'high'];

function num(v: number, digits = 2): string {
  return Number.isFinite(v) ? v.toFixed(digits) : 'n/a';
}

function row(label: string, result: number, unit: string, digits = 2): ReportRow {
  return { label, result: num(result, digits), unit, target: '', band: '', verdict: '' };
}

/** A row judged against a doc target. */
function targetRow(id: string, value: number, digits = 2): ReportRow {
  const t = TARGETS[id]!;
  return {
    label:
      t.role === 'fit'
        ? `${t.label} (fit)`
        : t.role === 'selection'
          ? `${t.label} (selection)`
          : t.label,
    result: num(value, digits),
    unit: t.unit,
    target: t.stated,
    band: `${num(t.low, digits)}–${num(t.high, digits)}`,
    verdict: verdict(id, value),
  };
}

function trims(o: Options): readonly AeroTrim[] {
  const t = o.trim;
  if (!t || t === 'all') return TRIMS;
  if (!TRIMS.includes(t as AeroTrim)) throw new Error(`unknown trim ${t}`);
  return [t as AeroTrim];
}

function speeds(o: Options, fallback: readonly number[]): number[] {
  return o.speeds ? o.speeds.split(',').map(Number) : [...fallback];
}

export interface Manoeuvre {
  describe: string;
  run(o: Options): Report;
}

export const MANOEUVRES: Readonly<Record<string, Manoeuvre>> = {
  'standing-start': {
    describe: 'Launch to 300 km/h, medium trim, 105 kg fuel, best of 5 (--slip to fix one)',
    run(o) {
      const trim = (o.trim as AeroTrim | undefined) ?? 'medium';
      const r = o.slip
        ? standingStart({ trim, slipTarget: Number(o.slip), record: true })
        : bestStandingStart({ trim, record: true });
      const rows =
        trim === 'medium'
          ? [
              targetRow('accel-0-100', r.t100),
              targetRow('accel-0-200', r.t200),
              targetRow('accel-0-300', r.t300),
            ]
          : [
              row('0–100 km/h', r.t100, 's'),
              row('0–200 km/h', r.t200, 's'),
              row('0–300 km/h', r.t300, 's'),
            ];
      rows.push(row('Launch slip target', r.slipTarget, '', 2));
      return {
        name: 'standing-start',
        title: `Standing start, ${trim} trim`,
        rows,
        traces: [{ name: `standing-start-${trim}`, trace: r.trace! }],
        summary: { trim, slipTarget: r.slipTarget, t100: r.t100, t200: r.t200, t300: r.t300 },
      };
    },
  },

  'top-speed': {
    describe: 'Maximum speed on a long flat straight per trim, DRS open and closed (Monza air)',
    run(o) {
      const rows: ReportRow[] = [];
      const traces: Report['traces'] = [];
      const summary: Record<string, unknown> = {};
      for (const trim of trims(o)) {
        for (const drs of [true, false]) {
          const r = topSpeed({ trim, drs, airDensity: CIRCUITS.monza.airDensity, record: true });
          const kmh = r.maxSpeed * 3.6;
          const label = `${trim} trim, DRS ${drs ? 'open' : 'closed'}`;
          rows.push(
            trim === 'low' && drs
              ? targetRow('top-speed-low-drs', kmh, 1)
              : { ...row(`Top speed, ${label}`, kmh, 'km/h', 1) },
          );
          traces.push({
            name: `top-speed-${trim}-drs-${drs ? 'open' : 'closed'}`,
            trace: r.trace!,
          });
          summary[`${trim}-${drs ? 'drs' : 'closed'}`] = {
            kmh,
            timeToMax: r.timeToMax,
            deployMJ: r.deployUsed / 1e6,
          };
        }
      }
      return { name: 'top-speed', title: 'Top speed', rows, traces, summary };
    },
  },

  braking: {
    describe: 'Published braking events, then threshold stops from --speeds (default 300…100)',
    run(o) {
      const rows: ReportRow[] = [];
      const traces: Report['traces'] = [];
      const events: unknown[] = [];
      for (const e of BRAKING_EVENTS) {
        const { values, run } = measureBrakingEvent(e);
        rows.push(
          targetRow(`${e.id}-distance`, values[`${e.id}-distance`]!, 1),
          targetRow(`${e.id}-time`, values[`${e.id}-time`]!),
          targetRow(`${e.id}-peak`, values[`${e.id}-peak`]!),
        );
        const traced = bestBraking({
          circuit: e.circuit,
          v1: e.v1 * KMH,
          v2: e.v2 * KMH,
          record: true,
        });
        traces.push({ name: `braking-${e.id}`, trace: traced.trace! });
        events.push({
          id: e.id,
          bias: run.bias,
          distance: run.distance,
          time: run.time,
          peakG: run.peakG,
          meanG: run.meanG,
        });
      }
      const curve: { kmh: number; peakG: number }[] = [];
      for (const v of speeds(o, BRAKING_CURVE_SPEEDS)) {
        const peak = peakDeceleration(v * KMH, 'monza');
        curve.push({ kmh: v, peakG: peak });
        if (v === 300) rows.push(targetRow('brake-peak-300', peak));
        else if (v === 100) rows.push(targetRow('brake-peak-100', peak));
        else rows.push(row(`Peak deceleration from ${v} km/h, Monza trim`, peak, 'g'));
      }
      const full = braking({
        circuit: 'monza',
        v1: 300 * KMH,
        v2: 80 * KMH,
        bias: 0.58,
        record: true,
      });
      traces.push({ name: 'braking-monza-300-80', trace: full.trace! });
      return { name: 'braking', title: 'Braking', rows, traces, summary: { events, curve } };
    },
  },

  cornering: {
    describe: 'Constant-speed sweeps to sustained lateral g, per trim, at --speeds',
    run(o) {
      const rows: ReportRow[] = [];
      const traces: Report['traces'] = [];
      const table: { trim: AeroTrim; kmh: number; latG: number; limit: string }[] = [];
      for (const trim of trims(o)) {
        for (const v of speeds(o, [85, 120, 160, 200, 240, 281, 300])) {
          const r = lateralLimit({ trim, speed: v * KMH, record: true });
          table.push({ trim, kmh: v, latG: r.maxLatG, limit: r.limit });
          rows.push({ ...row(`${trim} trim, ${v} km/h (${r.limit} limit)`, r.maxLatG, 'g') });
          traces.push({ name: `cornering-${trim}-${v}`, trace: r.trace! });
        }
      }
      for (const c of LATERAL_CASES) rows.push(targetRow(c.id, measureLateral(c).value));
      return {
        name: 'cornering',
        title: 'Sustained lateral acceleration (sea-level air, 10 kg fuel)',
        rows,
        traces,
        summary: { table },
      };
    },
  },

  'step-steer': {
    describe: 'Step steer at 80, 150 and 250 km/h: yaw response and settling',
    run() {
      const rows: ReportRow[] = [];
      const traces: Report['traces'] = [];
      const out: unknown[] = [];
      for (const v of [80, 150, 250]) {
        const r = stepSteer({ speed: v * KMH, steer: v > 200 ? 0.06 : 0.12, record: true });
        rows.push(
          row(`${v} km/h: steady lateral`, r.steadyLatG, 'g'),
          row(`${v} km/h: yaw-rate rise time 10–90 %`, r.riseTime, 's', 3),
          row(`${v} km/h: yaw-rate overshoot`, r.overshoot * 100, '%', 1),
          row(`${v} km/h: max sideslip`, r.maxSideslipDeg, 'deg'),
        );
        traces.push({ name: `step-steer-${v}`, trace: r.trace! });
        out.push({ ...r, trace: undefined });
      }
      return { name: 'step-steer', title: 'Step steer', rows, traces, summary: { runs: out } };
    },
  },

  'lift-off': {
    describe: 'Lift-off mid-corner at 60, 80 and 95 % of the limit at 150 km/h, 90 % at 250 km/h',
    run() {
      const rows: ReportRow[] = [];
      const traces: Report['traces'] = [];
      const out: unknown[] = [];
      for (const [v, f] of [
        [150, 0.6],
        [150, 0.8],
        [150, 0.95],
        [250, 0.9],
      ] as const) {
        const r = liftOffInCorner({ speed: v * KMH, fraction: f, record: true });
        const at = `${v} km/h, ${num(r.achievedLatG)} g (${f * 100} % of limit)`;
        rows.push(row(`${at}: yaw-rate rise after lift`, r.yawRateRise * 100, '%', 1), {
          ...row(`${at}: max sideslip`, r.maxSideslipDeg, 'deg'),
          verdict: r.spun ? 'fail' : 'pass',
        });
        traces.push({ name: `lift-off-${v}-${f * 100}`, trace: r.trace! });
        out.push({ ...r, trace: undefined });
      }
      return {
        name: 'lift-off',
        title: 'Lift-off in a corner (pass = no spin)',
        rows,
        traces,
        summary: { runs: out },
      };
    },
  },

  'coast-down': {
    describe: 'Coast in neutral from 320 km/h, medium trim: deceleration against speed',
    run() {
      const r = coastDown({ record: true });
      const rows = r.speeds.map((v, i) => row(`Deceleration at ${v} km/h`, r.decelG[i]!, 'g', 3));
      return {
        name: 'coast-down',
        title: 'Coast-down, medium trim, neutral',
        rows,
        traces: [{ name: 'coast-down', trace: r.trace! }],
        summary: { speeds: r.speeds, decelG: r.decelG },
      };
    },
  },

  assists: {
    describe:
      'Keyboard sanity: throttle out of a slow corner (TC 0–3), brake in a turn and in a straight line (ABS 0–3)',
    run() {
      const rows: ReportRow[] = [];
      const traces: Report['traces'] = [];
      const out: unknown[] = [];
      for (const level of [0, 1, 2, 3]) {
        const r = throttleOutOfSlowCorner({ tractionControl: level, record: true });
        rows.push({
          ...row(
            `${r.label}: max sideslip (max rear slip ${num(r.maxRearSlip)}, exit ${num(r.endSpeedKmh, 0)} km/h)`,
            r.maxSideslipDeg,
            'deg',
            1,
          ),
          verdict: level === 0 ? '' : r.spun ? 'fail' : 'pass',
        });
        traces.push({ name: `assists-tc-${level}`, trace: r.trace! });
        out.push({ ...r, trace: undefined });
      }
      for (const level of [0, 1, 2, 3]) {
        const r = brakeWhileTurning({ abs: level, record: true });
        rows.push({
          ...row(
            `${r.label}: max sideslip (min slip ${num(r.minSlip)}, ${num(r.endSpeedKmh, 0)} km/h after)`,
            r.maxSideslipDeg,
            'deg',
            1,
          ),
          verdict: level === 0 ? '' : r.spun ? 'fail' : 'pass',
        });
        traces.push({ name: `assists-abs-${level}`, trace: r.trace! });
        out.push({ ...r, trace: undefined });
      }
      for (const level of [0, 1, 2, 3]) {
        const r = absStraightStop({ abs: level, record: true });
        rows.push({
          ...row(
            `straight stop 300→100 km/h, high trim, ABS ${level}: distance (min slip ${num(r.minSlip)})`,
            r.distance,
            'm',
            1,
          ),
          verdict: level === 0 ? '' : r.minSlip > -0.3 && !r.spun ? 'pass' : 'fail',
        });
        traces.push({ name: `assists-abs-straight-${level}`, trace: r.trace! });
        out.push({ ...r, trace: undefined });
      }
      return {
        name: 'assists',
        title: 'Assist sanity at the limit (pass = no spin)',
        rows,
        traces,
        summary: { runs: out },
      };
    },
  },

  kerbs: {
    describe:
      'Kerb crossings (flat, exit, chicane profiles) at fixed speed and lateral speed: wheel loads, contact loss, damping force, plank, yaw',
    run() {
      const rows: ReportRow[] = [];
      const traces: Report['traces'] = [];
      const out: unknown[] = [];
      for (const c of KERB_CASES) {
        const r = kerbCrossing({ ...c, record: true });
        const tag = `${c.profile} ${num(c.speed / KMH, 0)} km/h, ${num(c.lateral, 0)} m/s across`;
        const fl = (a: number[]) => `${num(a[0]!, 0)} / ${num(a[2]!, 0)}`;
        rows.push(
          { ...row(`${tag}: left loads min (front / rear), N`, 0, ''), result: fl(r.minLoad) },
          { ...row(`${tag}: left loads max (front / rear), N`, 0, ''), result: fl(r.maxLoad) },
          {
            ...row(`${tag}: largest carcass damping force, N`, Math.max(...r.maxDamping), 'N', 0),
          },
          {
            ...row(`${tag}: largest load step in one tick, N`, Math.max(...r.maxLoadStep), 'N', 0),
          },
          { ...row(`${tag}: time airborne, any wheel`, Math.max(...r.airborne), 's', 3) },
          { ...row(`${tag}: plank force`, r.maxPlankForce, 'N', 0) },
          { ...row(`${tag}: yaw-rate excursion`, r.maxYawRateDev, 'deg/s', 2) },
        );
        traces.push({
          name: `kerb-${c.profile}-${num(c.speed / KMH, 0)}-${num(c.lateral, 0)}`,
          trace: r.trace!,
        });
        out.push({ ...r, trace: undefined });
      }
      return {
        name: 'kerbs',
        title: 'Kerb crossings (contact model)',
        rows,
        traces,
        summary: { runs: out },
      };
    },
  },

  validate: {
    describe: 'Every doc section 2 target this suite covers: result, target, band, verdict',
    run() {
      const values: Record<string, number> = {};
      Object.assign(values, measureAcceleration().values, measureTopSpeed().values);
      for (const e of BRAKING_EVENTS) Object.assign(values, measureBrakingEvent(e).values);
      const curve = measureBrakingCurve();
      values['brake-peak-300'] = curve.peaks[0]!;
      values['brake-peak-100'] = curve.peaks[curve.peaks.length - 1]!;
      for (const c of LATERAL_CASES) values[c.id] = measureLateral(c).value;
      const rows: ReportRow[] = [];
      const targets: unknown[] = [];
      for (const id of Object.keys(TARGETS)) {
        const v = values[id]!;
        const digits = TARGETS[id]!.unit === 'km/h' || TARGETS[id]!.unit === 'm' ? 1 : 2;
        rows.push(targetRow(id, v, digits));
        const t = TARGETS[id]!;
        targets.push({
          id,
          label: t.label,
          unit: t.unit,
          result: v,
          low: t.low,
          high: t.high,
          stated: t.stated,
          source: t.source,
          role: t.role,
          verdict: verdict(id, v),
          knownGap: KNOWN_GAPS[id]?.measured ?? null,
        });
      }
      const counts = { pass: 0, gap: 0, fail: 0 };
      for (const r of rows) if (r.verdict) counts[r.verdict]++;
      const monotonic = curve.peaks.every((p, i) => i === 0 || p < curve.peaks[i - 1]!);
      return {
        name: 'validate',
        title: 'Validation targets (docs/physics-validation.md section 2)',
        rows,
        traces: [],
        summary: { counts, monotonicBrakingCurve: monotonic, curve, targets },
      };
    },
  },
};

/** Fixed-width table: label, result, unit, target, band, verdict. */
export function formatTable(report: Report): string {
  const head: ReportRow = {
    label: 'Test',
    result: 'Result',
    unit: 'Unit',
    target: 'Target',
    band: 'Band',
    verdict: '',
  };
  const all = [head, ...report.rows];
  const w = (k: keyof ReportRow) => Math.max(...all.map((r) => String(r[k]).length));
  const widths = {
    label: w('label'),
    result: w('result'),
    unit: w('unit'),
    target: w('target'),
    band: w('band'),
  };
  const line = (r: ReportRow) =>
    [
      r.label.padEnd(widths.label),
      r.result.padStart(widths.result),
      r.unit.padEnd(widths.unit),
      r.target.padEnd(widths.target),
      r.band.padEnd(widths.band),
      r.verdict === '' && r === head ? 'Verdict' : r.verdict,
    ]
      .join('  ')
      .trimEnd();
  const rule = '-'.repeat(line(head).length);
  return [report.title, rule, line(head), rule, ...report.rows.map(line), rule].join('\n');
}

/** CSV text for a trace: header row, then numbers with six significant digits. */
export function traceToCsv(trace: Trace): string {
  const lines = [trace.columns.join(',')];
  for (const r of trace.rows)
    lines.push(
      r
        .map((v) => (Number.isInteger(v) ? String(v) : Number(v.toPrecision(6)).toString()))
        .join(','),
    );
  return lines.join('\n') + '\n';
}
