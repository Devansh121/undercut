import type { CarParams } from '@undercut/sim';
import type { Track } from '@undercut/track';
import { REFERENCE_SKILL, ReferenceDriver } from './driver/reference';
import type { DriverSkill } from './driver/driver';
import type { Envelope } from './envelope/envelope';
import type { LineConfig } from './line/build';
import { buildPlan, type DrivingPlan } from './profile/plan';
import { racingLineOffsets, type RacingLineData } from './export/racing-line';

/**
 * How the reference line is made: the car's wheels stay inside the white lines (kerbs unused:
 * in this model a kerb's leading edge throws the wheel load around enough to unsettle the car
 * at the limit, so the reference driver keeps off them), a 0.3 m margin for tracking error, and
 * the lap-time refinement on top of the minimum-curvature line.
 */
export function referenceLineConfig(params: CarParams): LineConfig {
  return {
    corridor: {
      halfTrack: Math.max(params.geometry.trackFront, params.geometry.trackRear) / 2,
      margin: 0.3,
      kerbUse: {},
    },
    scale: { ...REFERENCE_SKILL.envelope },
    refine: { widths: [20, 45], amplitudes: [0.6, 0.25], spacing: 8, reach: 60 },
  };
}

/** The plan a driver of `skill` drives on a shipped racing line. */
export function planFromRacingLine(
  track: Track,
  line: RacingLineData,
  envelope: Envelope,
  skill: DriverSkill = REFERENCE_SKILL,
): DrivingPlan {
  if (line.count !== track.lap.count) {
    throw new Error(`racing line has ${line.count} samples, track ${track.lap.count}`);
  }
  return buildPlan(track, racingLineOffsets(line), envelope, { scale: skill.envelope });
}

export interface ReferenceDriverSetup {
  track: Track;
  line: RacingLineData;
  envelope: Envelope;
  params: CarParams;
  skill?: DriverSkill;
  /** Deploy the MGU-K before the first timing-line crossing (true on a flying lap's run-up). */
  deployBeforeLine?: boolean;
}

/** A driver on a shipped racing line, as the game and the validation suite build it. */
export function createReferenceDriver(setup: ReferenceDriverSetup): ReferenceDriver {
  const skill = setup.skill ?? REFERENCE_SKILL;
  return new ReferenceDriver({
    plan: planFromRacingLine(setup.track, setup.line, setup.envelope, skill),
    params: setup.params,
    skill,
    ...(setup.deployBeforeLine === undefined ? {} : { deployBeforeLine: setup.deployBeforeLine }),
  });
}
