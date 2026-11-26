import { createRng } from '@undercut/core';
import {
  DEFAULT_RACE_SKILL,
  REFERENCE_SKILL,
  createRaceDriver,
  createReferenceDriver,
  type Driver,
  type DriverSkill,
  type Envelope,
  type RaceSkill,
  type RacingLineData,
} from '@undercut/ai';
import type { CarParams } from '@undercut/sim';
import type { Track } from '@undercut/track';
import { resolveRules, type RaceRules } from '../rules';
import { AiController } from './controllers';

/**
 * Quick Race's grid noise (`AiFieldOptions.gridNoise`): pace shuffled against the grid about as
 * much as a qualifying session would leave it, so faster cars start behind slower ones and have
 * to pass them.
 */
export const QUICK_RACE_GRID_NOISE = 0.5;

/** Chance per car of a jump start, by default. Small: the field should start cleanly. */
export const JUMP_START_CHANCE = 0.005;

export interface AiFieldOptions {
  track: Track;
  line: RacingLineData;
  envelope: Envelope;
  params: CarParams;
  /** Cars in the field. */
  count: number;
  seed: number;
  /**
   * Spread of skill across the field, 0 to 1: car k drives with pace and braking
   * `1 - spread * k / (count - 1)` (0: every car the same). Default 0.5.
   */
  spread?: number;
  /** The drivers: racing drivers (default) or the reference lap driver, which ignores traffic. */
  driver?: 'race' | 'reference';
  /** Skill every car starts from before the spread (race drivers). */
  skill?: Partial<RaceSkill>;
  /**
   * How far pace is shuffled against the car order (the grid), 0 to 1: 0 gives car 0 the best
   * pace and the last car the worst; 1 shuffles it about as much as the field is long. Default 0.
   */
  gridNoise?: number;
  /** Chance per car of a jump start. Default `JUMP_START_CHANCE`. */
  jumpStartChance?: number;
  /** Seconds every car waits after lights out on top of its reaction (test fixtures). Default 0. */
  startDelay?: number;
  /** A car index that starts without `startDelay` (the player's own pilot). */
  noDelay?: number;
  rules?: Partial<RaceRules>;
}

/**
 * A field of AI cars on a circuit's shipped racing line. Racing drivers by default: car k's
 * pace and braking fall with `spread` from the first car to the last, and its consistency,
 * reaction and aggression vary a little from the seed. Reaction times at lights out are the
 * rules' base plus the driver's lag plus a seeded spread; a few starts (seeded, rare) jump.
 */
export function createAiField(o: AiFieldOptions): AiController[] {
  const rules = resolveRules(o.rules);
  const spread = o.spread ?? 0.5;
  const rng = createRng((o.seed ^ 0x51f15e) >>> 0);
  const jumpChance = o.jumpStartChance ?? JUMP_START_CHANCE;
  const out: AiController[] = [];
  // Pace rank of each car: its index, shuffled by the grid noise from a stream of its own.
  const noise = o.gridNoise ?? 0;
  const gridRng = createRng((o.seed ^ 0x6a1d5) >>> 0);
  const key = Array.from(
    { length: o.count },
    (_, k) => k + noise * o.count * gridRng.range(-0.5, 0.5),
  );
  const byKey = key.map((_, k) => k).sort((a, b) => key[a]! - key[b]! || a - b);
  const rank = new Array<number>(o.count);
  byKey.forEach((car, r) => (rank[car] = r));
  for (let k = 0; k < o.count; k++) {
    const f = o.count > 1 ? (spread * rank[k]!) / (o.count - 1) : 0;
    const seed = (o.seed * 7919 + k * 104729) >>> 0;
    let driver: Driver;
    let lag: number;
    if (o.driver === 'reference') {
      const e = REFERENCE_SKILL.envelope;
      const skill: DriverSkill = {
        ...REFERENCE_SKILL,
        envelope: {
          lateral: e.lateral - 0.04 * f,
          brake: e.brake - 0.04 * f,
          traction: e.traction - 0.04 * f,
        },
        reaction: 0.02 * f,
        seed,
      };
      driver = createReferenceDriver({ ...o, skill });
      lag = skill.reaction;
    } else {
      const base = { ...DEFAULT_RACE_SKILL, ...o.skill };
      const skill: RaceSkill = {
        ...base,
        pace: base.pace * (1 - f),
        braking: base.braking * (1 - f),
        consistency: clamp01(base.consistency + rng.range(-0.1, 0.1)),
        reaction: Math.max(0, base.reaction + 0.02 * f),
        aggression: clamp01(base.aggression + rng.range(-0.2, 0.2)),
        seed,
      };
      driver = createRaceDriver({ ...o, skill });
      lag = skill.reaction;
    }
    const reaction =
      rules.reactionBase +
      lag +
      rng.range(0, rules.reactionSpread) +
      (k === o.noDelay ? 0 : (o.startDelay ?? 0));
    const jumpAfter = rng.next() < jumpChance ? rng.range(0.3, 1.5) : null;
    out.push(new AiController({ driver, params: o.params, reaction, jumpAfter }));
  }
  return out;
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}
