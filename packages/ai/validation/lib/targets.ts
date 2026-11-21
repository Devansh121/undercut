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
  'monza-lap-m1': {
    measured: 84.036,
    reason:
      'On the footprint-checked legal corridor, with the low-trim ClA at the top of its range, ' +
      'the lap is 1.30 s outside the M1 band (1.21 s with DRS zone 2 opening where the map puts ' +
      'it). The quasi-steady full-envelope profile on that line is 82.55 s; the ideal reference ' +
      'controller loses 0.80 s to its own plan and plans at 98/95/98 %. ' +
      'docs/physics-validation.md section 7.6.',
  },
});

export { gapSlack, outside };
