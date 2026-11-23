import {
  EnvelopeModel,
  FULL_ENVELOPE,
  type Envelope,
  type EnvelopeScale,
} from '../../src/envelope/envelope';
import { REFERENCE_SKILL } from '../../src/driver/reference';
import { racingLineOffsets } from '../../src/export/racing-line';
import { Phase, buildPlan, type DrivingPlan } from '../../src/profile/plan';
import { LATERAL_CASES, measureLateral } from '../../../sim/validation/lib/index';
import { loadEnvelope, loadLine } from './artefacts';
import type { CircuitSetup } from './circuits';
import { referenceLap } from './report';
import { CIRCUIT_REFERENCE } from './targets';

/**
 * Where a reference lap's time goes (docs/physics-validation.md 7.10). Three laps on the same
 * committed racing line: the reference driver's driven lap, the speed profile it plans at its
 * skill (`REFERENCE_SKILL`), and the full-envelope profile (every measured limit used). Each is
 * split by sector and by phase of the full-envelope profile:
 *
 * - braking: at the braking limit;
 * - corners: held at the corner limit;
 * - traction exits: full throttle, but held below what the engine gives on that grade by the
 *   tyres (wheelspin, or grip shared with cornering);
 * - straights: full throttle at what the engine gives (power, drag, DRS, the MGU-K).
 *
 * Driven − plan is the driver's cost; plan − full is the planning margin; full − published is
 * the car, the line and the track as modelled. Sensitivities re-plan the full envelope with one
 * term changed, so each says what that term is worth on this line; "need" scales one term until
 * a sector reaches its published time.
 */
export const BUDGET_PHASES = ['braking', 'corners', 'traction exits', 'straights'] as const;

export interface Sensitivity {
  term: string;
  /** Change of the full-envelope lap, s; per sector; per phase (`BUDGET_PHASES` order). */
  lap: number;
  sectors: number[];
  phases: number[];
}

export interface LapBudget {
  circuit: string;
  /** Published sector times (pole lap or session bests, `CIRCUIT_REFERENCE`) and the lap. */
  published: { lap: number; sectors: readonly number[] };
  lap: { driven: number; plan: number; full: number };
  sectors: { driven: number[]; plan: number[]; full: number[] };
  /** Seconds per [sector][phase]. */
  phases: { driven: number[][]; plan: number[][]; full: number[][] };
  sensitivities: Sensitivity[];
  /** Factor on one term alone that brings each sector to its published time (full envelope). */
  need: { lateral: number[]; propulsion: number[] };
  /**
   * The full envelope with lateral grip scaled by the one published fast-corner figure (Pouhon,
   * 5.7 g, doc 2.5 [43]) over the car's measured value there (`pouhonMeasuredG`).
   */
  pouhon: { factor: number; lap: number; sectors: number[] };
}

const G0 = 9.80665;

function segmentTimes(time: Float64Array, lapTime: number): Float64Array {
  const n = time.length;
  const d = new Float64Array(n);
  for (let i = 0; i < n; i++) d[i] = i + 1 < n ? time[i + 1]! - time[i]! : lapTime - time[i]!;
  return d;
}

type Mutator = (e: Mutable) => void;
type Mutable = {
  -readonly [K in keyof Envelope]: Envelope[K] extends readonly (readonly number[])[]
    ? number[][]
    : Envelope[K] extends Record<string, readonly number[]>
      ? Record<string, number[]>
      : Envelope[K];
};

function withEnvelope(envelope: Envelope, change: Mutator): Envelope {
  const e = JSON.parse(JSON.stringify(envelope)) as Mutable;
  change(e);
  return e as unknown as Envelope;
}

const scaleRows = (rows: number[][], k: number): number[][] => rows.map((r) => r.map((x) => x * k));

/** Propulsive force (net drive plus drag) times k: power and traction together. */
function propulsion(k: number): Mutator {
  return (e) => {
    const drive = e.drive as Record<string, number[]>;
    const drag = e.drag as Record<string, number[]>;
    for (const key of Object.keys(drive)) {
      const dr = key.startsWith('open') ? drag.open! : drag.closed!;
      drive[key] = drive[key]!.map((a, i) => a + (k - 1) * (a + dr[i]!));
    }
  };
}

function lessDrag(fraction: number): Mutator {
  return (e) => {
    const drive = e.drive as Record<string, number[]>;
    const drag = e.drag as Record<string, number[]>;
    for (const key of Object.keys(drive)) {
      const dr = key.startsWith('open') ? drag.open! : drag.closed!;
      drive[key] = drive[key]!.map((a, i) => a + fraction * dr[i]!);
    }
    drag.closed = drag.closed!.map((x) => x * (1 - fraction));
    drag.open = drag.open!.map((x) => x * (1 - fraction));
  };
}

/** Pouhon's published lateral acceleration, g (doc 2.5 [43]). */
export const POUHON_PUBLISHED_G = 5.7;

/** The car's lateral limit at Pouhon's published condition (medium trim, 281 km/h), g. */
export function pouhonMeasuredG(): number {
  const c = LATERAL_CASES.find((x) => x.id === 'lateral-pouhon');
  if (!c) throw new Error('no Pouhon lateral case');
  return measureLateral(c).value;
}

export function lapBudget(setup: CircuitSetup, pouhonG = pouhonMeasuredG()): LapBudget {
  const track = setup.track();
  const envelope = loadEnvelope(setup);
  const line = loadLine(setup);
  const offsets = racingLineOffsets(line);
  const n = track.lap.count;
  const step = track.lap.step;
  const timing = setup.controlLine;
  const ref = CIRCUIT_REFERENCE[setup.id];
  if (!ref) throw new Error(`no published reference for ${setup.id}`);

  const plan = (e: Envelope, scale: EnvelopeScale, opts: { drs?: boolean; budget?: number } = {}) =>
    buildPlan(track, offsets, e, {
      scale,
      ...(opts.drs === undefined ? {} : { drs: opts.drs }),
      ...(opts.budget === undefined ? {} : { deployBudget: opts.budget }),
    });
  const skill = plan(envelope, REFERENCE_SKILL.envelope);
  const full = plan(envelope, FULL_ENVELOPE);
  const model = new EnvelopeModel(envelope);

  // Phase of each segment, from the full-envelope profile.
  const phase = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const ph = full.profile.phase[i]!;
    if (ph === Phase.Brake) phase[i] = 0;
    else if (ph === Phase.Corner) phase[i] = 1;
    else {
      const v = full.profile.v[i]!;
      const engine = model.drive(v, full.profile.drsOpen[i] === 1, full.profile.deploying[i] === 1);
      const grade = full.line.grade[i]!;
      const onGrade = engine - (G0 * grade) / Math.sqrt(1 + grade * grade);
      phase[i] = full.profile.ax[i]! < 0.97 * onGrade ? 2 : 3;
    }
  }
  // Sector of each sample, counted from the timing line.
  const marks = Array.from(track.sectors)
    .slice(1)
    .map((s) => track.forwardDistance(timing, s))
    .sort((a, b) => a - b);
  const sectorOf = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const fd = track.forwardDistance(timing, i * step);
    sectorOf[i] = fd < marks[0]! ? 0 : fd < marks[1]! ? 1 : 2;
  }
  const split = (seg: Float64Array): number[][] => {
    const rows = [0, 1, 2].map(() => [0, 0, 0, 0]);
    for (let i = 0; i < n; i++) rows[sectorOf[i]!]![phase[i]!]! += seg[i]!;
    return rows;
  };
  const sum = (rows: number[][]): number[] => rows.map((r) => r.reduce((a, b) => a + b, 0));
  const profileSplit = (p: DrivingPlan): number[][] =>
    split(segmentTimes(p.profile.time, p.profile.lapTime));

  // The driven lap: time at which the car first passes each sample after the timing line.
  const { result } = referenceLap(setup, { recordEvery: 1 });
  const trace = result.trace!;
  const lapRecord = result.laps[0]!;
  const col = (k: string): number => trace.columns.indexOf(k);
  const [ct, cl, cs] = [col('t'), col('lap'), col('s')];
  const rows = trace.rows.filter((r) => r[cl] === 0);
  const t0 = rows[0]![ct]!;
  const passed = new Float64Array(n).fill(NaN);
  let previous = -1;
  for (const r of rows) {
    const fd = track.forwardDistance(timing, r[cs]!);
    if (fd < previous - 100) break;
    previous = fd;
    const i = Math.floor(track.wrap(r[cs]!) / step) % n;
    if (Number.isNaN(passed[i]!)) passed[i] = r[ct]! - t0;
  }
  const order = Array.from({ length: n }, (_, i) => i).sort(
    (a, b) => track.forwardDistance(timing, a * step) - track.forwardDistance(timing, b * step),
  );
  const driven = new Float64Array(n);
  let last = 0;
  for (let k = 0; k < n; k++) {
    const i = order[k]!;
    const at = Number.isNaN(passed[i]!) ? last : passed[i]!;
    const next = k + 1 < n ? passed[order[k + 1]!]! : lapRecord.time;
    driven[i] = Number.isNaN(next) ? 0 : Math.max(0, next - at);
    last = at;
  }
  // Any rounding left over (a sample the trace stepped across) goes to the last segment.
  const accounted = driven.reduce((a, b) => a + b, 0);
  driven[order[n - 1]!] = driven[order[n - 1]!]! + (lapRecord.time - accounted);

  const fullSplit = profileSplit(full);
  const variant = (term: string, p: DrivingPlan): Sensitivity => {
    const rows2 = profileSplit(p);
    return {
      term,
      lap: p.profile.lapTime - full.profile.lapTime,
      sectors: sum(rows2).map((x, k) => x - sum(fullSplit)[k]!),
      phases: [0, 1, 2, 3].map((ph) =>
        rows2.reduce((a, r, k) => a + r[ph]! - fullSplit[k]![ph]!, 0),
      ),
    };
  };
  const scaled = (change: Mutator): DrivingPlan =>
    plan(withEnvelope(envelope, change), FULL_ENVELOPE);
  const sensitivities = [
    variant(
      'lateral +5 %',
      scaled((e) => (e.lateral = scaleRows(e.lateral, 1.05))),
    ),
    variant(
      'braking +5 %',
      scaled((e) => (e.brake = scaleRows(e.brake, 1.05))),
    ),
    variant(
      'traction +5 %',
      scaled((e) => (e.traction = scaleRows(e.traction, 1.05))),
    ),
    variant('propulsion +5 %', scaled(propulsion(1.05))),
    variant('drag −5 %', scaled(lessDrag(0.05))),
    variant('no DRS', plan(envelope, FULL_ENVELOPE, { drs: false })),
    variant('no MGU-K', plan(envelope, FULL_ENVELOPE, { budget: 0 })),
  ];
  const needFor = (make: (k: number) => DrivingPlan, hi: number): number[] =>
    [0, 1, 2].map((s) => {
      let a = 1;
      let b = hi;
      for (let k = 0; k < 18; k++) {
        const m = (a + b) / 2;
        if (sum(profileSplit(make(m)))[s]! > ref.sectors[s]!) a = m;
        else b = m;
      }
      return b;
    });
  const factor = POUHON_PUBLISHED_G / pouhonG;
  const pouhon = scaled((e) => (e.lateral = scaleRows(e.lateral, factor)));
  return {
    circuit: setup.id,
    published: { lap: ref.reference, sectors: ref.sectors },
    lap: { driven: lapRecord.time, plan: skill.profile.lapTime, full: full.profile.lapTime },
    sectors: {
      driven: sum(split(driven)),
      plan: sum(profileSplit(skill)),
      full: sum(fullSplit),
    },
    phases: { driven: split(driven), plan: profileSplit(skill), full: fullSplit },
    sensitivities,
    need: {
      lateral: needFor((k) => scaled((e) => (e.lateral = scaleRows(e.lateral, k))), 2),
      propulsion: needFor((k) => scaled(propulsion(k)), 3),
    },
    pouhon: { factor, lap: pouhon.profile.lapTime, sectors: sum(profileSplit(pouhon)) },
  };
}

const f3 = (x: number): string => x.toFixed(3);
const signed = (x: number): string => (x >= 0 ? '+' : '') + x.toFixed(3);

/** The budget as Markdown tables, as `npm run telemetry -- budget` prints it. */
export function formatBudget(b: LapBudget): string {
  const lines: string[] = [];
  lines.push(
    `${b.circuit}: driven ${f3(b.lap.driven)} s, plan ${f3(b.lap.plan)} s, full envelope ` +
      `${f3(b.lap.full)} s, published ${f3(b.published.lap)} s`,
  );
  lines.push('');
  lines.push(
    '| Sector | Published | Driven | Driver (driven − plan) | Margin (plan − full) | Full − published |',
  );
  lines.push('| --- | --- | --- | --- | --- | --- |');
  for (let s = 0; s < 3; s++) {
    lines.push(
      `| S${s + 1} | ${f3(b.published.sectors[s]!)} | ${f3(b.sectors.driven[s]!)} | ` +
        `${signed(b.sectors.driven[s]! - b.sectors.plan[s]!)} | ` +
        `${signed(b.sectors.plan[s]! - b.sectors.full[s]!)} | ` +
        `${signed(b.sectors.full[s]! - b.published.sectors[s]!)} |`,
    );
  }
  lines.push('');
  lines.push('| Phase (full envelope) | Full, s | Driver, s | Margin, s |');
  lines.push('| --- | --- | --- | --- |');
  BUDGET_PHASES.forEach((name, p) => {
    const tot = (rows: number[][]): number => rows.reduce((a, r) => a + r[p]!, 0);
    lines.push(
      `| ${name} | ${f3(tot(b.phases.full))} | ${signed(tot(b.phases.driven) - tot(b.phases.plan))} | ` +
        `${signed(tot(b.phases.plan) - tot(b.phases.full))} |`,
    );
  });
  lines.push('');
  lines.push(
    `| Term (full envelope) | Lap, s | S1 / S2 / S3, s | ${BUDGET_PHASES.join(' / ')}, s |`,
  );
  lines.push('| --- | --- | --- | --- |');
  for (const x of b.sensitivities) {
    lines.push(
      `| ${x.term} | ${signed(x.lap)} | ${x.sectors.map(signed).join(' / ')} | ${x.phases.map(signed).join(' / ')} |`,
    );
  }
  lines.push('');
  lines.push(
    `To reach the published sectors on one term alone: lateral ×${b.need.lateral.map((x) => x.toFixed(3)).join(' / ×')}; ` +
      `propulsion ×${b.need.propulsion.map((x) => x.toFixed(3)).join(' / ×')} (×3 is the search limit).`,
  );
  lines.push(
    `Lateral ×${b.pouhon.factor.toFixed(3)} (Pouhon published / measured): full envelope ` +
      `${f3(b.pouhon.lap)} s, sectors ${b.pouhon.sectors.map(f3).join(' / ')} against ` +
      `${b.published.sectors.map(f3).join(' / ')}.`,
  );
  return lines.join('\n');
}
