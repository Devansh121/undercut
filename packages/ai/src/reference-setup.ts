import type { CarParams } from '@undercut/sim';
import type { Track } from '@undercut/track';
import { REFERENCE_SKILL, ReferenceDriver } from './driver/reference';
import type { DriverSkill } from './driver/driver';
import type { Envelope } from './envelope/envelope';
import type { LineConfig } from './line/build';
import { TYRE_HALF_TREAD, type LegalCorridorOptions } from './line/limits';
import { buildPlan, type DrivingPlan } from './profile/plan';
import { racingLineOffsets, type RacingLineData } from './export/racing-line';

/**
 * How the reference line is made: inside the legal corridor (`line/limits.ts`), so the lap stays
 * valid by the four-wheel rule with the car's real footprint, a 10° heading error and a 0.3 m
 * allowance for the driver's tracking, and every tyre stays on track, a kerb up to its crest or
 * asphalt run-off (grass and gravel kept 0.2 m away); then the lap-time refinement on top of
 * the minimum-curvature line, with the surface grip under the wheels in the speed profile.
 */
export function referenceLineConfig(params: CarParams): LineConfig {
  return {
    corridor: referenceCorridor(params),
    scale: { ...REFERENCE_SKILL.envelope },
    refine: { widths: [20, 45], amplitudes: [0.6, 0.25], spacing: 8, reach: 60 },
  };
}

/** The legal corridor for this car (`line/limits.ts`), with the reference allowances. */
export function referenceCorridor(params: CarParams): LegalCorridorOptions {
  const g = params.geometry;
  return {
    rule: 'four-wheels',
    halfTrackInner: Math.min(g.trackFront, g.trackRear) / 2,
    halfTrackOuter: Math.max(g.trackFront, g.trackRear) / 2,
    // Rear tyre, doc 1.2: 440–470 mm wide.
    tyreHalfWidth: 0.2275,
    halfTread: TYRE_HALF_TREAD,
    maxYaw: (10 * Math.PI) / 180,
    allowance: 0.3,
    surfaceMargin: 0.2,
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
