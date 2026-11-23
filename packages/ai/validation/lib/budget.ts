import { FULL_ENVELOPE, type Envelope, type EnvelopeScale } from '../../src/envelope/envelope';
import { REFERENCE_SKILL } from '../../src/driver/reference';
import { racingLineOffsets } from '../../src/export/racing-line';
import { buildPlan, type DrivingPlan } from '../../src/profile/plan';
import { SpeedProfiler } from '../../src/profile/speed-profile';
import { LATERAL_CASES, measureLateral } from '../../../sim/validation/lib/index';
import { loadEnvelope, loadLine } from './artefacts';
import type { CircuitSetup } from './circuits';
import { referenceLap } from './report';
import { CIRCUIT_REFERENCE } from './targets';

/**
 * Where a reference lap's time goes (docs/physics-validation.md 7.10). Three laps on the same
 * committed racing line: the reference driver's driven lap, the speed profile it plans at its
 * skill (`REFERENCE_SKILL`), and the full-envelope profile (every measured limit used). Each is
 * split by sector and by the constraint that binds the full-envelope profile on each segment
 * (`BUDGET_PHASES`):
 *
 * - corner limit: the lateral demand uses the lateral grip (within `AT_LIMIT`);
 * - braking limit: decelerating at the deceleration the tyres, drag and grade give there;
 * - grip-limited exit: accelerating at what the tyres give while they also corner (grip shared
 *   along the combined limit), less than the car's straight-line full-throttle run would;
 * - full-throttle run: accelerating at the car's measured straight-line full-throttle
 *   acceleration on that grade (the envelope's drive table: power, drag, DRS, the MGU-K, the
 *   gear shifts and, at low speed, wheelspin held at the tyre's peak);
 * - transition: none of those binds within `AT_LIMIT` (the step from one limit to another, a
 *   speed held below a limit by the passes that meet there).
 *
 * Driven − plan is the driver's cost; plan − full is the planning margin; full − published is
 * the car, the line and the track as modelled. Sensitivities re-plan the full envelope with one
 * term changed, so each says what that term is worth on this line; "need" scales one term until
 * a sector reaches its published time.
 *
 * The published sectors are the pole lap's own where they were published (Monza) and otherwise
 * the session's best sectors, set on different laps (Spa, Singapore). Session-best sectors add up
 * to an ideal lap faster than the pole lap, so sector gaps add up to the gap to that ideal lap;
 * the pole lap's difference from it is reported on its own (`published.poleOverIdeal`).
 */
export const BUDGET_PHASES = [
  'corner limit',
  'braking limit',
  'grip-limited exit',
  'full-throttle run',
  'transition',
] as const;

/** Index into `BUDGET_PHASES`. */
export const BudgetPhase = {
  Corner: 0,
  Braking: 1,
  Traction: 2,
  Power: 3,
  Transition: 4,
} as const;

/** How close to a limit a segment must be to count as held by it (3 %). */
export const AT_LIMIT = 0.03;

export interface Sensitivity {
  term: string;
  /** Change of the full-envelope lap, s; per sector; per phase (`BUDGET_PHASES` order). */
  lap: number;
  sectors: number[];
  phases: number[];
}

export interface LapBudget {
  circuit: string;
  published: {
    /** The pole lap, s. */
    lap: number;
    /** The published sectors and which they are (`CIRCUIT_REFERENCE`). */
    sectors: readonly number[];
    sectorsAre: 'pole lap' | 'session best';
    /** Their sum: the pole lap itself, or the ideal lap of the session-best sectors. */
    ideal: number;
    /** Pole lap − ideal lap, s (0 when the sectors are the pole lap's). */
    poleOverIdeal: number;
  };
  lap: { driven: number; plan: number; full: number };
  sectors: { driven: number[]; plan: number[]; full: number[] };
  /** Seconds per [sector][phase]. */
  phases: { driven: number[][]; plan: number[][]; full: number[][] };
  /** Per centreline sample: its sector (0–2, from the timing line) and its phase. */
  sectorAt: Uint8Array;
  phaseAt: Uint8Array;
  /** The full-envelope plan the phases are read from. */
  full: DrivingPlan;
  sensitivities: Sensitivity[];
  /** Factor on one term alone that brings each sector to its published time (full envelope). */
  need: { lateral: number[]; propulsion: number[] };
  /**
   * The full envelope with lateral grip scaled by the one published fast-corner figure (Pouhon,
   * 5.7 g, doc 2.5 [43]) over the car's measured value there (`pouhonMeasuredG`).
   */
  pouhon: { factor: number; lap: number; sectors: number[] };
}

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

/**
 * The constraint that binds each segment of a full-envelope profile (`BudgetPhase`), read from
 * the profile's own limits at the segment's entry speed: the lateral grip used, the braking
 * deceleration, and the full-throttle acceleration with whether the engine or the tyres set it.
 */
export function classifyPhases(plan: DrivingPlan): Uint8Array {
  const profiler = new SpeedProfiler(plan.line, plan.model);
  const p = plan.profile;
  const n = plan.line.count;
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const v = p.v[i]!;
    const ax = p.ax[i]!;
    const drs = p.drsOpen[i] === 1;
    // At the corner limit: the lateral demand uses the lateral grip there (on a straight the
    // profile's "limit" is only the top speed, which is not a corner).
    if (profiler.lateralUse(i, v, FULL_ENVELOPE) >= 1 - AT_LIMIT) out[i] = BudgetPhase.Corner;
    else if (ax < 0 && -ax >= (1 - AT_LIMIT) * profiler.brakeDecel(i, v, FULL_ENVELOPE)) {
      out[i] = BudgetPhase.Braking;
    } else if (
      ax > 0 &&
      ax >= (1 - AT_LIMIT) * profiler.driveAccel(i, v, drs, p.deploying[i] === 1, FULL_ENVELOPE)
    ) {
      out[i] = profiler.engineLimited(i, v, drs, FULL_ENVELOPE)
        ? BudgetPhase.Power
        : BudgetPhase.Traction;
    } else out[i] = BudgetPhase.Transition;
  }
  return out;
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
  const ideal = ref.sectors.reduce((a, b) => a + b, 0);

  const plan = (
    e: Envelope,
    scale: EnvelopeScale,
    opts: { drs?: boolean; budget?: number } = {},
  ): DrivingPlan =>
    buildPlan(track, offsets, e, {
      scale,
      ...(opts.drs === undefined ? {} : { drs: opts.drs }),
      ...(opts.budget === undefined ? {} : { deployBudget: opts.budget }),
    });
  const skill = plan(envelope, REFERENCE_SKILL.envelope);
  const full = plan(envelope, FULL_ENVELOPE);
  const phase = classifyPhases(full);
  const phases = BUDGET_PHASES.length;

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
    const rows = [0, 1, 2].map(() => new Array<number>(phases).fill(0));
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
      phases: BUDGET_PHASES.map((_, ph) =>
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
    published: {
      lap: ref.reference,
      sectors: ref.sectors,
      sectorsAre: ref.sectorsAre,
      ideal,
      poleOverIdeal: ref.reference - ideal,
    },
    lap: { driven: lapRecord.time, plan: skill.profile.lapTime, full: full.profile.lapTime },
    sectors: {
      driven: sum(split(driven)),
      plan: sum(profileSplit(skill)),
      full: sum(fullSplit),
    },
    phases: { driven: split(driven), plan: profileSplit(skill), full: fullSplit },
    sectorAt: sectorOf,
    phaseAt: phase,
    full,
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
  const pub = b.published;
  const base = pub.sectorsAre === 'pole lap' ? 'pole-lap sectors' : 'session-best sectors';
  lines.push(
    `${b.circuit}: driven ${f3(b.lap.driven)} s, plan ${f3(b.lap.plan)} s, full envelope ` +
      `${f3(b.lap.full)} s; pole lap ${f3(pub.lap)} s`,
  );
  lines.push('');
  lines.push(
    `Sectors are measured against the ${base}` +
      (pub.sectorsAre === 'pole lap'
        ? `, which add up to the pole lap.`
        : ` (set on different laps). They add up to an ideal lap of ${f3(pub.ideal)} s, ` +
          `${f3(pub.poleOverIdeal)} s faster than the pole lap, so the sector gaps add up to the ` +
          `gap to that ideal lap, ${signed(b.lap.driven - pub.ideal)} s; the gap to the pole lap ` +
          `is that less ${f3(pub.poleOverIdeal)} s, ${signed(b.lap.driven - pub.lap)} s.`),
  );
  lines.push('');
  lines.push(
    `| Sector | Published (${base}) | Driven | Driver (driven − plan) | Margin (plan − full) | ` +
      `Full − published |`,
  );
  lines.push('| --- | --- | --- | --- | --- | --- |');
  for (let s = 0; s < 3; s++) {
    lines.push(
      `| S${s + 1} | ${f3(pub.sectors[s]!)} | ${f3(b.sectors.driven[s]!)} | ` +
        `${signed(b.sectors.driven[s]! - b.sectors.plan[s]!)} | ` +
        `${signed(b.sectors.plan[s]! - b.sectors.full[s]!)} | ` +
        `${signed(b.sectors.full[s]! - pub.sectors[s]!)} |`,
    );
  }
  const total = (k: 'driven' | 'plan' | 'full'): number => b.sectors[k].reduce((a, x) => a + x, 0);
  lines.push(
    `| Sum (${pub.sectorsAre === 'pole lap' ? 'pole lap' : 'ideal lap'}) | ${f3(pub.ideal)} | ` +
      `${f3(total('driven'))} | ${signed(total('driven') - total('plan'))} | ` +
      `${signed(total('plan') - total('full'))} | ${signed(total('full') - pub.ideal)} |`,
  );
  if (pub.sectorsAre !== 'pole lap') {
    lines.push(
      `| Pole lap − ideal lap | ${signed(pub.poleOverIdeal)} | | | | ` +
        `${signed(-pub.poleOverIdeal)} |`,
    );
    lines.push(
      `| Against the pole lap | ${f3(pub.lap)} | ${f3(b.lap.driven)} | | | ` +
        `${signed(b.lap.full - pub.lap)} |`,
    );
  }
  lines.push('');
  lines.push('| Phase (binding constraint, full envelope) | Full, s | Driver, s | Margin, s |');
  lines.push('| --- | --- | --- | --- |');
  BUDGET_PHASES.forEach((name, p) => {
    const tot = (rows: number[][]): number => rows.reduce((a, r) => a + r[p]!, 0);
    lines.push(
      `| ${name} | ${f3(tot(b.phases.full))} | ` +
        `${signed(tot(b.phases.driven) - tot(b.phases.plan))} | ` +
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
      `| ${x.term} | ${signed(x.lap)} | ${x.sectors.map(signed).join(' / ')} | ` +
        `${x.phases.map(signed).join(' / ')} |`,
    );
  }
  lines.push('');
  lines.push(
    `To reach the ${base} on one term alone: lateral ` +
      `×${b.need.lateral.map((x) => x.toFixed(3)).join(' / ×')}; propulsion ` +
      `×${b.need.propulsion.map((x) => x.toFixed(3)).join(' / ×')} (×3 is the search limit).`,
  );
  lines.push(
    `Lateral ×${b.pouhon.factor.toFixed(3)} (Pouhon published / measured): full envelope ` +
      `${f3(b.pouhon.lap)} s (pole lap ${f3(pub.lap)} s), sectors ` +
      `${b.pouhon.sectors.map(f3).join(' / ')} against ${pub.sectors.map(f3).join(' / ')}.`,
  );
  return lines.join('\n');
}
