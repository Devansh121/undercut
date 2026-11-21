import type { CircuitInfo } from './circuit';

/**
 * Session types are strategies over one race core: they decide how cars start, what track
 * limits cost, how DRS works, whether time penalties apply, when the chequered flag falls and
 * how cars are classified. Everything else (timing, flags, pit lane, watchdog) is shared.
 */
export type SessionKind = 'timeTrial' | 'practice' | 'qualifying' | 'race';

export interface SessionSpec {
  kind: SessionKind;
  /** Practice and qualifying: session length, s. */
  duration?: number;
  /** Race: laps (5 to the full distance). Default: the full distance. */
  laps?: number;
  /** Race: a time cap, s. The race ends at the end of the lap on which it expires. */
  timeLimit?: number;
  /** Race: each finisher must have run two different compounds. Default: on for a full-distance race. */
  twoCompoundRule?: boolean;
  /** Practice and qualifying: interval between cars leaving the pit lane at the start, s. */
  releaseInterval?: number;
}

export type StartKind = 'grid' | 'pit' | 'rolling';
export type LimitsPolicy = 'invalidate' | 'qualifying' | 'race';

export interface SessionStrategy {
  readonly kind: SessionKind;
  readonly start: StartKind;
  /** Invalidate laps only; also delete the next lap after a last-corner offence; or race strikes. */
  readonly limits: LimitsPolicy;
  /** DRS free inside the zones, or the race rule (enabled lap, detection gap). */
  readonly drs: 'free' | 'race';
  /** Time penalties apply (race); otherwise offences are warnings. */
  readonly penalties: boolean;
  readonly blueFlags: boolean;
  /** Classified by best valid lap (time trial, practice, qualifying) or by race distance. */
  readonly classifyBy: 'bestLap' | 'distance';
  /** Practice and qualifying: when the chequered flag falls, s after the green; null: never by time. */
  readonly duration: number | null;
  /** Race: laps the leader must complete; null for timed sessions. */
  readonly laps: number | null;
  /** Race: time cap after lights out, s. */
  readonly timeLimit: number | null;
  readonly twoCompoundRule: boolean;
  readonly releaseInterval: number;
}

abstract class BaseStrategy implements SessionStrategy {
  abstract readonly kind: SessionKind;
  abstract readonly start: StartKind;
  abstract readonly limits: LimitsPolicy;
  readonly drs: 'free' | 'race' = 'free';
  readonly penalties: boolean = false;
  readonly blueFlags: boolean = false;
  readonly classifyBy: 'bestLap' | 'distance' = 'bestLap';
  readonly duration: number | null = null;
  readonly laps: number | null = null;
  readonly timeLimit: number | null = null;
  readonly twoCompoundRule: boolean = false;
  readonly releaseInterval: number = 4;
}

/** One car against the clock and its own record: rolling start, laps invalidated, never ends. */
export class TimeTrialStrategy extends BaseStrategy {
  readonly kind = 'timeTrial' as const;
  readonly start = 'rolling' as const;
  readonly limits = 'invalidate' as const;
}

/** Timed, from the pit lane, free DRS; offences are warnings. */
export class PracticeStrategy extends BaseStrategy {
  readonly kind = 'practice' as const;
  readonly start = 'pit' as const;
  readonly limits = 'invalidate' as const;
  override readonly duration: number;
  override readonly releaseInterval: number;
  constructor(spec: SessionSpec) {
    super();
    this.duration = spec.duration ?? 1800;
    this.releaseInterval = spec.releaseInterval ?? 4;
  }
}

/**
 * One timed session (no knockout parts yet): out-laps and flying laps from the pit lane, a lap
 * over the limits deleted (and the next one after a last-corner offence), classified by best lap.
 */
export class QualifyingStrategy extends BaseStrategy {
  readonly kind = 'qualifying' as const;
  readonly start = 'pit' as const;
  readonly limits = 'qualifying' as const;
  override readonly duration: number;
  override readonly releaseInterval: number;
  constructor(spec: SessionSpec) {
    super();
    this.duration = spec.duration ?? 1080;
    this.releaseInterval = spec.releaseInterval ?? 4;
  }
}

/** Standing start from the grid, laps or a time cap, race DRS, strikes and time penalties. */
export class RaceStrategy extends BaseStrategy {
  readonly kind = 'race' as const;
  readonly start = 'grid' as const;
  readonly limits = 'race' as const;
  override readonly drs = 'race' as const;
  override readonly penalties = true;
  override readonly blueFlags = true;
  override readonly classifyBy = 'distance' as const;
  override readonly laps: number;
  override readonly timeLimit: number | null;
  override readonly twoCompoundRule: boolean;
  constructor(spec: SessionSpec, circuit: CircuitInfo) {
    super();
    const laps = spec.laps ?? circuit.raceLaps;
    if (!Number.isInteger(laps) || laps < 1) throw new RangeError(`race laps ${laps}`);
    this.laps = laps;
    this.timeLimit = spec.timeLimit ?? null;
    this.twoCompoundRule = spec.twoCompoundRule ?? laps >= circuit.raceLaps;
  }
}

export function createStrategy(spec: SessionSpec, circuit: CircuitInfo): SessionStrategy {
  switch (spec.kind) {
    case 'timeTrial':
      return new TimeTrialStrategy();
    case 'practice':
      return new PracticeStrategy(spec);
    case 'qualifying':
      return new QualifyingStrategy(spec);
    case 'race':
      return new RaceStrategy(spec, circuit);
  }
}
