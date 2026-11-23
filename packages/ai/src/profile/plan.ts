import type { Track } from '@undercut/track';
import { EnvelopeModel, type Envelope, type EnvelopeScale } from '../envelope/envelope';
import { computeLineGeometry, type LineGeometry } from '../line/geometry';
import { Phase, SpeedProfiler, type SpeedProfile } from './speed-profile';

/**
 * Everything a driver needs to lap a circuit: the racing line, the speed profile it can drive
 * on that line at its skill, where DRS is open and where the MGU-K deploys. Built from the
 * track, the line's offsets and the measured envelope; a few milliseconds of work.
 */
export interface DrivingPlan {
  readonly track: Track;
  readonly line: LineGeometry;
  readonly profile: SpeedProfile;
  readonly model: EnvelopeModel;
  /** Per sample: inside a DRS zone (qualifying rules: DRS free there). */
  readonly drsZone: Uint8Array;
  /** Per sample: the MGU-K may deploy here at full throttle (within the budget). */
  readonly deployMask: Uint8Array;
  /** Energy the plan draws from the store per lap, J, and the budget it was planned for. */
  readonly deployEnergy: number;
  readonly deployBudget: number;
}

export interface PlanOptions {
  scale: EnvelopeScale;
  /** Energy the MGU-K may draw from the store per lap, J. Default: the car's per-lap limit. */
  deployBudget?: number;
  /** Use the DRS zones (qualifying). Default true. */
  drs?: boolean;
}

/** DRS-zone flags per centreline sample. */
export function drsZoneFlags(track: Track): Uint8Array {
  const n = track.lap.count;
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = track.drsZoneAt(i * track.lap.step) >= 0 ? 1 : 0;
  return out;
}

/**
 * Build a plan. The MGU-K deploys at full throttle wherever the car is engine-limited; if that
 * draws more than the budget, deployment stops above a speed cap (the extra force P/v is worth
 * least at the highest speeds), found by bisection.
 */
export function buildPlan(
  track: Track,
  offsets: ArrayLike<number>,
  envelope: Envelope | EnvelopeModel,
  options: PlanOptions,
): DrivingPlan {
  const model = envelope instanceof EnvelopeModel ? envelope : new EnvelopeModel(envelope);
  const line = computeLineGeometry(track, offsets);
  const profiler = new SpeedProfiler(line, model);
  const n = line.count;
  const drsZone = options.drs === false ? new Uint8Array(n) : drsZoneFlags(track);
  const budget = options.deployBudget ?? model.envelope.ers.deployPerLap;
  const ers = new Uint8Array(n).fill(1);
  let profile = profiler.compute({ scale: options.scale, drs: drsZone, ers });
  if (profile.deployEnergy > budget) {
    let lo = 0;
    let hi = model.envelope.topSpeed.open;
    for (let k = 0; k < 24; k++) {
      const cap = 0.5 * (lo + hi);
      for (let i = 0; i < n; i++) ers[i] = profile.v[i]! < cap ? 1 : 0;
      const trial = profiler.compute({ scale: options.scale, drs: drsZone, ers });
      if (trial.deployEnergy > budget) hi = cap;
      else lo = cap;
    }
    for (let i = 0; i < n; i++) ers[i] = profile.v[i]! < lo ? 1 : 0;
    profile = profiler.compute({ scale: options.scale, drs: drsZone, ers });
  }
  return {
    track,
    line,
    profile,
    model,
    drsZone,
    deployMask: ers,
    deployEnergy: profile.deployEnergy,
    deployBudget: budget,
  };
}

export { Phase };
