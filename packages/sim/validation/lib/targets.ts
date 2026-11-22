/**
 * Validation targets from docs/physics-validation.md section 2, with the doc's tolerances.
 * A target is a band [low, high]; "value ± tol" and "range ± tol" both become bands. Shared by
 * the physics suite and the telemetry runner so both judge with the same numbers.
 */
export interface Target {
  id: string;
  label: string;
  unit: string;
  low: number;
  high: number;
  /** The target as the doc states it, for tables. */
  stated: string;
  /** Doc section and source numbers. */
  source: string;
  /**
   * How the calibration used this quantity (docs/physics-validation.md section 7, the three
   * sets): `fit`, a parameter was solved for it, so it checks the fit, not the model;
   * `selection`, it was looked at while choosing an estimate, so it is not independent;
   * `validation`, withheld from every choice.
   */
  role: TargetRole;
}

export type TargetRole = 'fit' | 'selection' | 'validation';

function band(value: number, tol: number): [number, number] {
  return [value - tol, value + tol];
}

function rel(value: number, fraction: number): [number, number] {
  return [value * (1 - fraction), value * (1 + fraction)];
}

function target(
  id: string,
  label: string,
  unit: string,
  [low, high]: [number, number],
  stated: string,
  source: string,
): Target {
  const fitted = FIT_TARGETS[id];
  const selected = SELECTION_TARGETS[id];
  if (fitted) {
    return {
      id,
      label,
      unit,
      low,
      high,
      stated,
      source: `${source}; fitted: ${fitted}`,
      role: 'fit',
    };
  }
  if (selected) {
    return {
      id,
      label,
      unit,
      low,
      high,
      stated,
      source: `${source}; used in selection: ${selected}`,
      role: 'selection',
    };
  }
  return { id, label, unit, low, high, stated, source, role: 'validation' };
}

/**
 * Direct fits: the targets a parameter was solved for, and what was solved. These check the
 * fit, not the model (docs/physics-validation.md section 7).
 */
export const FIT_TARGETS: Readonly<Record<string, string>> = Object.freeze({
  'accel-0-100': 'tyre μx at the reference load (with the Monza T1 2025 peak)',
  'monza-t1-2025-peak': 'tyre μx at the reference load (with 0–100 km/h)',
  'lateral-slow-low': 'tyre μy at the reference load',
  'top-speed-low-drs': 'low-trim CdA',
  'monza-t1-2025-power': 'brake capacity (master-cylinder bore), one value for the four powers',
  'spa-t5-2025-power': 'brake capacity (master-cylinder bore), one value for the four powers',
  'singapore-t7-2025-power': 'brake capacity (master-cylinder bore), one value for the four powers',
  'singapore-t14-2024-power':
    'brake capacity (master-cylinder bore), one value for the four powers',
});

/**
 * Selection checks: targets looked at while choosing an estimate without being solved for, so
 * they are not independent validation either. The cross-trim braking peaks chose the floor
 * stall's height and loss (first version of the model) and were looked at when the load slopes
 * were questioned; the Monza lap (packages/ai) was consulted when choosing the floor share.
 */
export const SELECTION_TARGETS: Readonly<Record<string, string>> = Object.freeze({
  'monza-t1-2024-peak': 'brake capacity and floor stall (cross-trim braking peaks, section 7.9)',
  'monza-t1-2023-peak': 'brake capacity and floor stall (cross-trim braking peaks, section 7.9)',
  'spa-t5-2025-peak': 'brake capacity and floor stall (cross-trim braking peaks, section 7.9)',
  'spa-t5-2024-peak': 'brake capacity and floor stall (cross-trim braking peaks, section 7.9)',
  'singapore-t7-2025-peak':
    'brake capacity and floor stall (section 7.9); an earlier load-slope fit',
  'singapore-t14-2024-peak':
    'brake capacity and floor stall (cross-trim braking peaks, section 7.9)',
});

/** Published braking events (doc 2.4) with both speeds known. */
export interface BrakingEvent {
  id: string;
  label: string;
  circuit: 'monza' | 'spa' | 'singapore';
  v1: number;
  v2: number;
  distance: number;
  time: number;
  peak: number;
  /**
   * Published peak braking power of the stop, kW (doc 1.5), where the source gives one: what
   * the friction brakes dissipate, so it bounds the friction force near v1 (P / v1).
   */
  power?: number;
  source: string;
}

export const BRAKING_EVENTS: readonly BrakingEvent[] = [
  {
    id: 'monza-t1-2025',
    label: 'Monza T1 2025',
    circuit: 'monza',
    v1: 337,
    v2: 89,
    distance: 129,
    time: 2.75,
    peak: 4.7,
    power: 2715,
    source: '[21][47]',
  },
  {
    id: 'monza-t1-2024',
    label: 'Monza T1 2024',
    circuit: 'monza',
    v1: 328,
    v2: 90,
    distance: 119,
    time: 2.52,
    peak: 4.6,
    source: '[49]',
  },
  {
    id: 'monza-t1-2023',
    label: 'Monza T1 2023',
    circuit: 'monza',
    v1: 334,
    v2: 89,
    distance: 122,
    time: 2.57,
    peak: 5.2,
    source: '[48]',
  },
  {
    id: 'spa-t5-2025',
    label: 'Spa T5 2025',
    circuit: 'spa',
    v1: 327,
    v2: 176,
    distance: 93,
    time: 1.48,
    peak: 4.7,
    power: 2584,
    source: '[22]',
  },
  {
    id: 'spa-t5-2024',
    label: 'Spa T5 2024',
    circuit: 'spa',
    v1: 320,
    v2: 167,
    distance: 99,
    time: 1.62,
    peak: 4.5,
    source: '[50]',
  },
  {
    id: 'singapore-t7-2025',
    label: 'Singapore T7 2025',
    circuit: 'singapore',
    v1: 308,
    v2: 128,
    distance: 96,
    time: 1.9,
    peak: 4.9,
    power: 2542,
    source: '[23][29]',
  },
  {
    id: 'singapore-t14-2024',
    label: 'Singapore T14 2024',
    circuit: 'singapore',
    v1: 288,
    v2: 93,
    distance: 94,
    time: 2.19,
    peak: 4.6,
    power: 2239,
    source: '[51]',
  },
];

/** Lateral checks (doc 2.5) that a flat constant-speed sweep can make. */
export interface LateralCase {
  id: string;
  label: string;
  trim: 'low' | 'medium' | 'high';
  speedKmh: number;
  circuit: 'monza' | 'spa' | 'singapore';
}

export const LATERAL_CASES: readonly LateralCase[] = [
  {
    id: 'lateral-pouhon',
    label: 'Pouhon, medium trim, 281 km/h',
    trim: 'medium',
    speedKmh: 281,
    circuit: 'spa',
  },
  {
    id: 'lateral-parabolica',
    label: 'Parabolica exit, low trim, 270 km/h',
    trim: 'low',
    speedKmh: 270,
    circuit: 'monza',
  },
  {
    id: 'lateral-slow-low',
    label: 'Slow corner, low trim, 85 km/h',
    trim: 'low',
    speedKmh: 85,
    circuit: 'monza',
  },
  {
    id: 'lateral-slow-medium',
    label: 'Slow corner, medium trim, 85 km/h',
    trim: 'medium',
    speedKmh: 85,
    circuit: 'spa',
  },
  {
    id: 'lateral-slow-high',
    label: 'Slow corner, high trim, 85 km/h',
    trim: 'high',
    speedKmh: 85,
    circuit: 'singapore',
  },
];

/** Speeds for the braking-curve shape test (doc 2.4 test 2), km/h. */
export const BRAKING_CURVE_SPEEDS = [300, 250, 200, 150, 100] as const;

const list: Target[] = [
  target('accel-0-100', '0–100 km/h', 's', band(2.6, 0.3), '2.6 ± 0.3', 'doc 2.3 [39]'),
  target('accel-0-200', '0–200 km/h', 's', band(4.8, 0.5), '4.8 ± 0.5', 'doc 2.3 (estimate)'),
  target('accel-0-300', '0–300 km/h', 's', band(10.5, 1.5), '10.5 ± 1.5', 'doc 2.3 (estimate)'),
  target(
    'top-speed-low-drs',
    'Top speed, low trim, DRS open',
    'km/h',
    band(348, 6),
    '348 ± 6',
    'doc 2.2 [11]',
  ),
  target(
    'brake-peak-300',
    'Peak deceleration from 300 km/h, Monza trim',
    'g',
    band(4.6, 0.4),
    '4.6 ± 0.4',
    'doc 2.4 test 2',
  ),
  target(
    'brake-peak-100',
    'Peak deceleration from 100 km/h, Monza trim',
    'g',
    band(2.0, 0.4),
    '2.0 ± 0.4',
    'doc 2.4 test 2 (estimate)',
  ),
];
for (const e of BRAKING_EVENTS) {
  list.push(
    target(
      `${e.id}-distance`,
      `${e.label} ${e.v1}→${e.v2}: distance`,
      'm',
      rel(e.distance, 0.1),
      `${e.distance} ± 10 %`,
      `doc 2.4 ${e.source}`,
    ),
    target(
      `${e.id}-time`,
      `${e.label}: time`,
      's',
      rel(e.time, 0.12),
      `${e.time} ± 12 %`,
      `doc 2.4 ${e.source}`,
    ),
    target(
      `${e.id}-peak`,
      `${e.label}: peak`,
      'g',
      band(e.peak, 0.4),
      `${e.peak} ± 0.4`,
      `doc 2.4 ${e.source}`,
    ),
  );
  if (e.power !== undefined)
    list.push(
      target(
        `${e.id}-power`,
        `${e.label}: peak friction brake power`,
        'kW',
        rel(e.power, 0.1),
        `${e.power} ± 10 %`,
        `doc 1.5 ${e.source}`,
      ),
    );
}
list.push(
  target(
    'lateral-pouhon',
    LATERAL_CASES[0]!.label,
    'g',
    band(5.7, 0.7),
    '5.7 ± 0.7',
    'doc 2.5 [43]',
  ),
  target(
    'lateral-parabolica',
    LATERAL_CASES[1]!.label,
    'g',
    [3.5 - 0.6, 4.0 + 0.6],
    '3.5–4.0 ± 0.6',
    'doc 2.5 (estimate)',
  ),
  target(
    'lateral-slow-low',
    LATERAL_CASES[2]!.label,
    'g',
    [2.0 - 0.4, 2.3 + 0.4],
    '2.0–2.3 ± 0.4',
    'doc 2.5 (estimate)',
  ),
  target(
    'lateral-slow-medium',
    LATERAL_CASES[3]!.label,
    'g',
    [2.0 - 0.4, 2.3 + 0.4],
    '2.0–2.3 ± 0.4',
    'doc 2.5 (estimate)',
  ),
  target(
    'lateral-slow-high',
    LATERAL_CASES[4]!.label,
    'g',
    [2.0 - 0.4, 2.3 + 0.4],
    '2.0–2.3 ± 0.4',
    'doc 2.5 (estimate)',
  ),
);

export const TARGETS: Readonly<Record<string, Target>> = Object.freeze(
  Object.fromEntries(list.map((t) => [t.id, t])),
);

/**
 * Targets the model misses with defensible parameters, with the value measured when the gap
 * was recorded (docs/physics-validation.md, Results and section 5). The suite asserts the gap
 * is still there and has not widened, so it turns red when the gap closes or grows.
 */
export interface KnownGap {
  measured: number;
  reason: string;
}

const BRAKING_TIME =
  "Hypothesis, not established: Brembo's stop times may include the trail-off and turn-in " +
  'into the corner, which the scripted stop (at the limit to v2; its pedal ceiling is an ' +
  'assumed estimate that barely acts) does not reproduce. Every published time at the ' +
  'medium and high-downforce circuits comes out short.';
const SHORT_STOP =
  'With the brake capacity set from the published powers the 2025 stop at the same corner is ' +
  'in band; the 2024 one (99 m from 320 km/h) stays 5 % short. Not separated: the 2024 ' +
  "event's conditions (fuel, wind, tyre) or the published trail-off (see the stop times).";
const BRAKE_LIMITED_PEAK =
  'The full-pedal capacity is set from the published peak brake powers, so these stops are ' +
  'brake-limited at speed and the 50 ms peak (race fuel 50 kg, the doc 2.4 test) is ' +
  '4.1–4.3 g. The published peak at the published power would need more friction force than ' +
  'P / v1 allows near v1 with that mass: either it comes later in the stop at lower speed, ' +
  'with more force than at the start (carbon pads gaining bite as they heat; the model has ' +
  'one capacity for the whole stop), or the event cars carried less fuel than 50 kg.';
const MONZA_2023 =
  'The 2023 figure (5.2 g) stands apart from 2024 (4.6 g) and 2025 (4.7 g) at the same corner ' +
  'and speed; the model gives about 4.7–4.8 g for all three.';
const PARABOLICA =
  'The band is an estimate derived from the superseded low-trim ClA 3.6 (doc 2.5). With ClA ' +
  "from the team's top-speed figure [57] the flat limit is 4.7 g; the sourced Monza practice " +
  'speeds (Lesmo 2, Ascari, [54][55]) ask for more grip at 180 km/h, not less.';
const POUHON =
  'Flat constant-speed sweep in Spa air; the 5.7 g figure is a single secondary source for a ' +
  'downhill double-apex corner, with no trace, filter or duration.';

export const KNOWN_GAPS: Readonly<Record<string, KnownGap>> = Object.freeze({
  'monza-t1-2025-time': { measured: 2.344, reason: BRAKING_TIME },
  'monza-t1-2025-peak': { measured: 4.209, reason: BRAKE_LIMITED_PEAK },
  'monza-t1-2024-peak': { measured: 4.171, reason: BRAKE_LIMITED_PEAK },
  'monza-t1-2023-peak': { measured: 4.196, reason: `${MONZA_2023} ${BRAKE_LIMITED_PEAK}` },
  'spa-t5-2025-time': { measured: 1.263, reason: BRAKING_TIME },
  'spa-t5-2025-peak': { measured: 4.218, reason: BRAKE_LIMITED_PEAK },
  'spa-t5-2024-distance': { measured: 84.924, reason: SHORT_STOP },
  'spa-t5-2024-time': { measured: 1.295, reason: BRAKING_TIME },
  'singapore-t7-2025-time': { measured: 1.534, reason: BRAKING_TIME },
  'singapore-t7-2025-peak': { measured: 4.295, reason: BRAKE_LIMITED_PEAK },
  'singapore-t14-2024-time': { measured: 1.823, reason: BRAKING_TIME },
  'singapore-t14-2024-peak': { measured: 4.184, reason: BRAKE_LIMITED_PEAK },
  'brake-peak-300': { measured: 4.053, reason: BRAKE_LIMITED_PEAK },
  'lateral-pouhon': { measured: 4.948, reason: POUHON },
  'lateral-parabolica': { measured: 4.712, reason: PARABOLICA },
});

export type Verdict = 'pass' | 'gap' | 'fail';

export function inBand(t: Target, value: number): boolean {
  return value >= t.low && value <= t.high;
}

/** Distance of `value` outside the band (0 inside). */
export function outside(t: Target, value: number): number {
  return value < t.low ? t.low - value : value > t.high ? value - t.high : 0;
}

/**
 * How far a known gap may drift before the suite calls it changed: 5 % of the band's
 * half-width. The sim is deterministic, so a real change moves the value far more.
 */
export function gapSlack(t: Target): number {
  return 0.05 * ((t.high - t.low) / 2);
}

export function verdict(id: string, value: number): Verdict {
  const t = TARGETS[id];
  if (!t) throw new Error(`unknown target ${id}`);
  if (inBand(t, value)) return 'pass';
  const gap = KNOWN_GAPS[id];
  if (gap && Math.abs(value - gap.measured) <= gapSlack(t) && outside(t, value) > 0) return 'gap';
  return 'fail';
}
