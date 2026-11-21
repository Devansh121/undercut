import { createRng } from '@undercut/core';
import {
  REFERENCE_SKILL,
  createReferenceDriver,
  type DriverSkill,
  type Envelope,
  type RacingLineData,
} from '@undercut/ai';
import type { CarParams } from '@undercut/sim';
import type { Track } from '@undercut/track';
import { resolveRules, type RaceRules } from '../rules';
import { AiController } from './controllers';

export interface AiFieldOptions {
  track: Track;
  line: RacingLineData;
  envelope: Envelope;
  params: CarParams;
  /** Cars in the field. */
  count: number;
  seed: number;
  /**
   * Spread of skill across the field, 0 to 1: car k plans with
   * `1 - spread * k / (count - 1)` of the reference driver's envelope margin taken off
   * (0: every car is the reference driver). Default 0.5.
   */
  spread?: number;
  rules?: Partial<RaceRules>;
}

/**
 * A field of AI cars on a circuit's shipped racing line: reference drivers whose planned share
 * of the car's envelope falls by up to 4 points from the first car to the last (`spread` 1),
 * with a lag of their hands and feet that grows the same way, and reaction times at lights out
 * from the rules' base plus the driver's lag plus a seeded spread.
 */
export function createAiField(o: AiFieldOptions): AiController[] {
  const rules = resolveRules(o.rules);
  const spread = o.spread ?? 0.5;
  const rng = createRng((o.seed ^ 0x51f15e) >>> 0);
  const out: AiController[] = [];
  for (let k = 0; k < o.count; k++) {
    const f = o.count > 1 ? (spread * k) / (o.count - 1) : 0;
    const e = REFERENCE_SKILL.envelope;
    const skill: DriverSkill = {
      ...REFERENCE_SKILL,
      envelope: {
        lateral: e.lateral - 0.04 * f,
        brake: e.brake - 0.04 * f,
        traction: e.traction - 0.04 * f,
      },
      reaction: 0.02 * f,
      seed: (o.seed * 7919 + k * 104729) >>> 0,
    };
    const driver = createReferenceDriver({
      track: o.track,
      line: o.line,
      envelope: o.envelope,
      params: o.params,
      skill,
    });
    const reaction = rules.reactionBase + skill.reaction + rng.range(0, rules.reactionSpread);
    out.push(new AiController({ driver, params: o.params, reaction }));
  }
  return out;
}
