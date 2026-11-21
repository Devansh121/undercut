import type { Track } from '@undercut/track';
import { EnvelopeModel, type Envelope, type EnvelopeScale } from '../envelope/envelope';
import { buildPlan, drsZoneFlags } from '../profile/plan';
import { Phase, SpeedProfiler } from '../profile/speed-profile';
import { buildCorridor, corridorHalfTrack, type CorridorOptions } from './corridor';
import { computeLineGeometry } from './geometry';
import { minimumCurvatureLine } from './min-curvature';
import { refineLine } from './refine';

/**
 * The whole offline racing-line computation for one circuit and trim: corridor, minimum-
 * curvature line, then lap-time refinement with the speed profile of the driver's skill in the
 * loop. What comes out is the line's offsets; the plan (speeds, DRS, ERS) is rebuilt from them.
 */
export interface LineConfig {
  corridor: CorridorOptions;
  /** Envelope fractions the line is optimised for (the reference driver's). */
  scale: EnvelopeScale;
  /** Refinement: bump half-widths (m), amplitudes (m), centre spacing (m), and focus reach (m). */
  refine: {
    widths: readonly number[];
    amplitudes: readonly number[];
    spacing: number;
    reach: number;
  } | null;
}

export interface LineBuildResult {
  d: Float64Array;
  minCurvatureLapTime: number;
  lapTime: number;
  evaluations: number;
  accepted: number;
}

export function buildRacingLine(
  track: Track,
  envelope: Envelope | EnvelopeModel,
  config: LineConfig,
): LineBuildResult {
  const model = envelope instanceof EnvelopeModel ? envelope : new EnvelopeModel(envelope);
  const corridor = buildCorridor(track, config.corridor);
  const mc = minimumCurvatureLine(track, corridor).d;
  const drs = drsZoneFlags(track);
  const halfTrack = corridorHalfTrack(config.corridor);
  const lapTimeOf = (d: Float64Array): number => {
    const line = computeLineGeometry(track, d, { halfTrack });
    return new SpeedProfiler(line, model).compute({ scale: config.scale, drs }).lapTime;
  };
  const start = lapTimeOf(mc);
  if (!config.refine) {
    return { d: mc, minCurvatureLapTime: start, lapTime: start, evaluations: 1, accepted: 0 };
  }
  // Bumps only where the car is cornering or braking (and a little either side).
  const base = buildPlan(track, mc, model, { scale: config.scale });
  const n = track.lap.count;
  const step = track.lap.step;
  const reach = Math.round(config.refine.reach / step);
  const focus = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (base.profile.phase[i] === Phase.Throttle) continue;
    for (let o = -reach; o <= reach; o++) focus[(i + o + n) % n] = 1;
  }
  const r = refineLine(corridor, mc, {
    evaluate: lapTimeOf,
    focus,
    widths: config.refine.widths.map((w) => w / step),
    amplitudes: config.refine.amplitudes,
    spacing: Math.max(1, Math.round(config.refine.spacing / step)),
  });
  return {
    d: r.d,
    minCurvatureLapTime: start,
    lapTime: r.lapTime,
    evaluations: r.evaluations,
    accepted: r.accepted,
  };
}
