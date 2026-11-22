import { gapSlack, outside, type Target } from '../../../sim/validation/lib/targets';

/**
 * Reference-lap targets from docs/physics-validation.md section 2.1 and 2.2, with the doc's
 * bands, judged the same way as the physics suite's targets (a recorded gap must stay put).
 */
export const LAP_TARGETS: Readonly<Record<string, Target>> = Object.freeze({
  'monza-lap-m1': {
    id: 'monza-lap-m1',
    label: 'Monza reference lap, low trim, qualifying fuel (M1 band, ±5 %)',
    unit: 's',
    low: 74.852,
    high: 82.732,
    stated: '1:18.792 ± 5 %',
    source: 'doc 2.1 [24]; used in selection: the floor share (doc 7.1)',
    role: 'selection',
  },
  'monza-trap': {
    id: 'monza-trap',
    label: 'Monza speed trap on the flying lap, DRS open, no tow',
    unit: 'km/h',
    low: 342,
    high: 354,
    stated: '348 ± 6',
    source: 'doc 2.2 [11]',
    role: 'validation',
  },
  'spa-lap-m4': {
    id: 'spa-lap-m4',
    label: 'Spa reference lap, medium trim, qualifying fuel (M4 band, ±3 %)',
    unit: 's',
    low: 97.545,
    high: 103.579,
    stated: '1:40.562 ± 3 %',
    source: 'doc 2.1 [25]',
    role: 'validation',
  },
  'spa-trap': {
    id: 'spa-trap',
    label: 'Spa speed trap on the flying lap (30 m after T4), no tow',
    unit: 'km/h',
    low: 309,
    high: 321,
    stated: '315 ± 6',
    source: 'doc 2.2 [13]',
    role: 'validation',
  },
  'spa-s1': {
    id: 'spa-s1',
    label: 'Spa sector 1 against the session best (±3 %)',
    unit: 's',
    low: 28.868,
    high: 30.654,
    stated: '29.761 ± 3 %',
    source: 'doc 2.2 [14]',
    role: 'validation',
  },
  'spa-s2': {
    id: 'spa-s2',
    label: 'Spa sector 2 against the session best (±3 %)',
    unit: 's',
    low: 41.256,
    high: 43.808,
    stated: '42.532 ± 3 %',
    source: 'doc 2.2 [14]',
    role: 'validation',
  },
  'spa-s3': {
    id: 'spa-s3',
    label: 'Spa sector 3 against the session best (±3 %)',
    unit: 's',
    low: 27.021,
    high: 28.693,
    stated: '27.857 ± 3 %',
    source: 'doc 2.2 [14]',
    role: 'validation',
  },
  'singapore-lap-m4': {
    id: 'singapore-lap-m4',
    label: 'Singapore reference lap, high trim, qualifying fuel (M4 band, ±3 %)',
    unit: 's',
    low: 86.483,
    high: 91.833,
    stated: '1:29.158 ± 3 %',
    source: 'doc 2.1 [26]',
    role: 'validation',
  },
  'singapore-trap': {
    id: 'singapore-trap',
    label: 'Singapore speed trap on the flying lap (150 m before T1), no tow',
    unit: 'km/h',
    low: 298,
    high: 310,
    stated: '304 ± 6',
    source: 'doc 2.2 [15]',
    role: 'validation',
  },
  'singapore-s1': {
    id: 'singapore-s1',
    label: 'Singapore sector 1 against the session best (±3 %)',
    unit: 's',
    low: 25.623,
    high: 27.207,
    stated: '26.415 ± 3 %',
    source: 'doc 2.2 [16]',
    role: 'validation',
  },
  'singapore-s2': {
    id: 'singapore-s2',
    label: 'Singapore sector 2 against the session best (±3 %)',
    unit: 's',
    low: 36.209,
    high: 38.449,
    stated: '37.329 ± 3 %',
    source: 'doc 2.2 [16]',
    role: 'validation',
  },
  'singapore-s3': {
    id: 'singapore-s3',
    label: 'Singapore sector 3 against the session best (±3 %)',
    unit: 's',
    low: 24.463,
    high: 25.977,
    stated: '25.22 ± 3 %',
    source: 'doc 2.2 [16]',
    role: 'validation',
  },
});

/** The M4 band (±3 %) the lap must reach later, for the report. */
export const MONZA_M4_BAND: readonly [number, number] = [76.428, 81.156];
export const MONZA_REFERENCE_LAP = 78.792;

/** Published Monza figures the lap report compares against (doc 2.2 and 2.4). */
export const MONZA_PUBLISHED = Object.freeze({
  poleSectors: [26.262, 26.483, 26.047],
  bestSectors: [26.181, 26.34, 26.047],
  trapMedian: 348.3,
  finishLine: 320.7,
  /** Brembo: T1 2025 337 → 89 km/h in 129 m and 2.75 s; T4 2025 107 m and 2.02 s. */
  t1: { v1: 337, v2: 89, distance: 129, time: 2.75 },
  t4: { distance: 107, time: 2.02 },
});

export interface LapGap {
  measured: number;
  reason: string;
}

/**
 * Laps the model misses with the reference driver driving cleanly: the measured value when
 * recorded and why (docs/physics-validation.md section 5 and 7.6).
 */
export const LAP_GAPS: Readonly<Record<string, LapGap>> = Object.freeze({
  'spa-lap-m4': {
    measured: 107.357,
    reason:
      'Spa reference lap (medium trim): 6.8 % over the 2025 pole after the brake and downforce ' +
      'identification (section 7.9). Most of it is sector 2 (+10.8 % on the session best), ' +
      'through the medium-speed corners (Les Combes, Malmedy, Bruxelles, Campus) and Pouhon. ' +
      'docs/physics-validation.md sections 7.8 and 7.9.',
  },
  'spa-s1': {
    measured: 31.584,
    reason: 'Sector 1 on the Spa reference lap, 6.1 % over the session best (section 7.9).',
  },
  'spa-s2': {
    measured: 47.133,
    reason: 'Sector 2 on the Spa reference lap, 10.8 % over the session best (section 7.9).',
  },
});

/**
 * The reference driver's lap exactly as the current car drives it, to the last bit: lap time,
 * speed-trap speed and sim ticks of the run. The drivability suite checks an unassisted car
 * reproduces it exactly (the assist layer leaves the car alone); `LAP_GAPS` holds the same lap
 * rounded, against the target band. A change to the physics updates both.
 */
export interface ExactLap {
  time: number;
  trap: number;
  ticks: number;
}

export const REFERENCE_LAP_EXACT: Readonly<Record<string, ExactLap>> = Object.freeze({
  'monza-lap-m1': Object.freeze({
    time: 82.45467836214588,
    trap: 348.74138129128346,
    ticks: 39617,
  }),
});

export { gapSlack, outside };

/** Per-circuit reference figures for the lap report and the tests (doc 2.1 and 2.2). */
export interface CircuitReference {
  lapTarget: string;
  trapTarget: string;
  /** Sector targets, or null where the doc sets none (Monza's sectors are reported only). */
  sectorTargets: readonly [string, string, string] | null;
  /** The era's pole lap, s, and the M4 (±3 %) band. */
  reference: number;
  m4: readonly [number, number];
  /** Sectors of the pole lap where published, else the session-best sectors, and the best. */
  sectors: readonly number[];
  best: readonly number[];
  sectorsAre: 'pole lap' | 'session best';
  /** Fastest speed published at the timing line, km/h. */
  finishLine: number;
}

export const CIRCUIT_REFERENCE: Readonly<Record<string, CircuitReference>> = Object.freeze({
  monza: {
    lapTarget: 'monza-lap-m1',
    trapTarget: 'monza-trap',
    sectorTargets: null,
    reference: MONZA_REFERENCE_LAP,
    m4: MONZA_M4_BAND,
    sectors: MONZA_PUBLISHED.poleSectors,
    best: MONZA_PUBLISHED.bestSectors,
    sectorsAre: 'pole lap',
    finishLine: MONZA_PUBLISHED.finishLine,
  },
  spa: {
    lapTarget: 'spa-lap-m4',
    trapTarget: 'spa-trap',
    sectorTargets: ['spa-s1', 'spa-s2', 'spa-s3'],
    reference: 100.562,
    m4: [97.545, 103.579],
    // The pole-holder's best sectors came from different laps (doc 2.2): the session bests.
    sectors: [29.761, 42.532, 27.857],
    best: [29.761, 42.532, 27.857],
    sectorsAre: 'session best',
    finishLine: 234.9,
  },
  singapore: {
    lapTarget: 'singapore-lap-m4',
    trapTarget: 'singapore-trap',
    sectorTargets: ['singapore-s1', 'singapore-s2', 'singapore-s3'],
    reference: 89.158,
    m4: [86.483, 91.833],
    sectors: [26.415, 37.329, 25.22],
    best: [26.415, 37.329, 25.22],
    sectorsAre: 'session best',
    finishLine: 264.8,
  },
});
