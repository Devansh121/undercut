import { Phase, type DrivingPlan } from '../profile/plan';

/**
 * The racing line as the game ships it: one small JSON file per circuit and trim with the
 * line's offset and target speed at every centreline sample, and the brake, throttle, DRS and
 * deployment zones by s. The app draws the racing-line assist from it and seeds the grid AI
 * without recomputing anything; `inputsHash` lets CI see when it no longer matches the car,
 * the track or the code that made it.
 */
export const RACING_LINE_FORMAT = 'undercut-racing-line';
export const RACING_LINE_VERSION = 1;

/** A zone along the lap: [start s, end s), metres; end may exceed the lap length (wraps). */
export type Zone = readonly [number, number];

export interface RacingLineData {
  readonly format: typeof RACING_LINE_FORMAT;
  readonly version: typeof RACING_LINE_VERSION;
  readonly circuit: string;
  readonly trim: string;
  /** Hash of everything that produced this file (car, track, code); see the build tool. */
  readonly inputsHash: string;
  readonly envelopeHash: string;
  /** Centreline sample spacing (m) and count: sample i is at s = i · step. */
  readonly step: number;
  readonly count: number;
  /** Planned lap time of the line at the reference driver's skill, s. */
  readonly lapTime: number;
  /**
   * Lateral offset per sample in units of 0.1 mm, positive left. The line's curvature is the
   * offset's second difference over 2 m samples, so coarser rounding shows up as curvature
   * noise (1 cm would add 0.0025 1/m, the curvature of a 400 m bend).
   */
  readonly offsetTenthMm: readonly number[];
  /** Target speed per sample, centimetres per second. */
  readonly speedCms: readonly number[];
  readonly brakeZones: readonly Zone[];
  readonly throttleZones: readonly Zone[];
  readonly drsZones: readonly Zone[];
  readonly deployZones: readonly Zone[];
}

export class RacingLineError extends Error {}

/** Runs of set flags as [start, end) zones in s; a run through sample 0 is joined across it. */
export function zonesFromFlags(flags: ArrayLike<boolean | number>, step: number): Zone[] {
  const n = flags.length;
  const on = (i: number): boolean => Boolean(flags[((i % n) + n) % n]);
  let first = -1;
  for (let i = 0; i < n; i++) {
    if (on(i) && !on(i - 1)) {
      first = i;
      break;
    }
  }
  if (first < 0) return on(0) ? [[0, n * step]] : [];
  const zones: Zone[] = [];
  for (let k = 0; k < n; k++) {
    const i = first + k;
    if (on(i) && !on(i - 1)) {
      let j = i;
      while (on(j + 1) && j + 1 < first + n) j++;
      const start = (i % n) * step;
      zones.push([round3(start), round3(start + (j - i + 1) * step)]);
    }
  }
  return zones.sort((a, b) => a[0] - b[0]);
}

function round3(x: number): number {
  return Math.round(x * 1000) / 1000;
}

/** Encode a plan as the shipped artefact. */
export function encodeRacingLine(
  plan: DrivingPlan,
  meta: { circuit: string; trim: string; inputsHash: string; envelopeHash: string },
): RacingLineData {
  const n = plan.line.count;
  const step = plan.track.lap.step;
  const prof = plan.profile;
  const brake = new Uint8Array(n);
  const throttle = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    brake[i] = prof.phase[i] === Phase.Brake ? 1 : 0;
    throttle[i] = prof.phase[i] === Phase.Throttle ? 1 : 0;
  }
  return {
    format: RACING_LINE_FORMAT,
    version: RACING_LINE_VERSION,
    circuit: meta.circuit,
    trim: meta.trim,
    inputsHash: meta.inputsHash,
    envelopeHash: meta.envelopeHash,
    step: round3(step),
    count: n,
    lapTime: round3(prof.lapTime),
    offsetTenthMm: Array.from(plan.line.d, (d) => Math.round(d * 1e4)),
    speedCms: Array.from(prof.v, (v) => Math.round(v * 100)),
    brakeZones: zonesFromFlags(brake, step),
    throttleZones: zonesFromFlags(throttle, step),
    drsZones: zonesFromFlags(prof.drsOpen, step),
    deployZones: zonesFromFlags(prof.deploying, step),
  };
}

/** Validate a parsed artefact. Throws `RacingLineError` with the first problem found. */
export function decodeRacingLine(raw: unknown): RacingLineData {
  const fail = (msg: string): never => {
    throw new RacingLineError(`racing line: ${msg}`);
  };
  if (!raw || typeof raw !== 'object') return fail('not an object');
  const r = raw as Record<string, unknown>;
  if (r.format !== RACING_LINE_FORMAT) fail(`format is ${String(r.format)}`);
  if (r.version !== RACING_LINE_VERSION) fail(`unsupported version ${String(r.version)}`);
  for (const k of ['circuit', 'trim', 'inputsHash', 'envelopeHash'] as const) {
    if (typeof r[k] !== 'string') fail(`${k} missing`);
  }
  const count = r.count;
  if (typeof count !== 'number' || !Number.isInteger(count) || count < 3) fail('bad count');
  if (typeof r.step !== 'number' || !(r.step > 0)) fail('bad step');
  if (typeof r.lapTime !== 'number' || !(r.lapTime > 0)) fail('bad lap time');
  for (const k of ['offsetTenthMm', 'speedCms'] as const) {
    const a = r[k];
    if (!Array.isArray(a) || a.length !== count) fail(`${k} must have ${String(count)} entries`);
    for (const x of a as unknown[])
      if (typeof x !== 'number' || !Number.isFinite(x)) fail(`${k} not numeric`);
  }
  for (const v of r.speedCms as number[]) if (v <= 0) fail('speeds must be positive');
  for (const k of ['brakeZones', 'throttleZones', 'drsZones', 'deployZones'] as const) {
    const a = r[k];
    if (!Array.isArray(a)) fail(`${k} missing`);
    for (const z of a as unknown[]) {
      if (!Array.isArray(z) || z.length !== 2 || !(z[1] > z[0])) fail(`${k} has a bad zone`);
    }
  }
  return raw as RacingLineData;
}

/** Offsets in metres, one per centreline sample. */
export function racingLineOffsets(data: RacingLineData): Float64Array {
  return Float64Array.from(data.offsetTenthMm, (c) => c / 1e4);
}

/** Target speeds in m/s, one per centreline sample. */
export function racingLineSpeeds(data: RacingLineData): Float64Array {
  return Float64Array.from(data.speedCms, (c) => c / 100);
}

/** Whether s lies in one of `zones` (zones may run past the lap length). */
export function inZone(zones: readonly Zone[], s: number, length: number): boolean {
  for (const [a, b] of zones) {
    if ((s >= a && s < b) || (s + length >= a && s + length < b)) return true;
  }
  return false;
}
