/**
 * Every rule value the race engine uses, in one place, with where it comes from. SI units.
 * A session takes `DEFAULT_RULES` with any overrides on top (`resolveRules`). Values marked
 * "estimate" have no published figure behind them; the PR that introduced them lists them all.
 */
export interface RaceRules {
  // ---- Start ----
  /** Time on the grid before the first light comes on, s. Estimate (formation is out of scope). */
  gridTime: number;
  /** Interval between the five lights coming on, s. Sporting regulations: one per second. */
  lightInterval: number;
  /** Random hold after the fifth light, s: uniform in [min, max]. Estimate (the published procedure only says "random"). */
  lightsHoldMin: number;
  lightsHoldMax: number;
  /** Forward movement before lights out that counts as a jump start, m. Estimate (transponder sensitivity is not published). */
  jumpStartTolerance: number;
  /** Time penalty for a jump start, s. Stewards' usual range is 5 to 10 s; estimate. */
  jumpStartPenalty: number;
  /** Driver reaction at lights out on top of the skill's lag, s: base plus a uniform spread. Estimate (published reaction times 0.2 to 0.3 s). */
  reactionBase: number;
  reactionSpread: number;

  // ---- Track limits ----
  /** Wheels that must all be wholly past the white line for a lap to be invalid. Sporting regulations: all four. */
  wheelsOffForInvalid: number;
  /** Time back inside the line before a new excursion counts as another strike, s. Estimate. */
  limitsRearm: number;
  /** Race: a strike number that is a multiple of this gives a time penalty; the strike before it shows black and white. Race director's notes: three warnings, then a penalty. */
  strikesPerPenalty: number;
  /** Race: time penalty for track limits, s. Race director's notes: 5 s. */
  limitsPenalty: number;
  /** Race: after gaining a place while off track, time to give it back, s. Estimate. */
  giveBackWindow: number;
  /** Race: an excursion keeps counting position gains this long after the car is back on track, s. Estimate. */
  cutTrailTime: number;
  /** Race: penalty for keeping a place gained off track, s. Estimate (usual 5 s). */
  cutPenalty: number;

  // ---- Flags ----
  /** Length of a marshalling sector for local yellows, m. Estimate (real circuits have 10 to 30 posts). */
  marshalSectorLength: number;
  /** A car this slow for `yellowDelay` sets a yellow, m/s. Estimate. */
  yellowSpeed: number;
  yellowDelay: number;
  /** Lateral reach from the centreline within which a slow car counts as on or near the track, m. Estimate. */
  yellowReach: number;
  /** Time a yellow stays out after the cause has gone, s. Estimate. */
  yellowClearTime: number;
  /** Blue flag: a car about to lap another is within this time behind it, s. Sporting regulations: 1 s (race director practice). */
  blueGap: number;
  /** Time the lapped car has to let the faster car by, s. Estimate (regulation: three flag panels). */
  blueWindow: number;
  /** Penalty for ignoring blue flags, s. Estimate (usual 5 s). */
  bluePenalty: number;

  // ---- DRS ----
  /** Race lap (of the leader) from which DRS is enabled. Sporting regulations: two laps after the start, i.e. from lap 3. */
  drsEnableLap: number;
  /** Gap to the car ahead at the detection point that makes DRS available, s. Sporting regulations: less than 1 s. */
  drsGap: number;
  /** DRS closes when the brake passes this (sim's brake-on threshold) or the throttle falls below `drsLiftThrottle`. */
  drsBrake: number;
  drsLiftThrottle: number;

  // ---- Pit lane ----
  /** Speeding tolerance over the pit-lane limit, m/s. Estimate (about 1 km/h). */
  pitSpeedTolerance: number;
  /** Race: penalty for pit-lane speeding, s. Stewards' usual 5 s; estimate. Other sessions: a warning. */
  pitSpeedPenalty: number;
  /** The car must stop with its reference point this close to the box, along and across the lane, m. Estimate. */
  boxToleranceS: number;
  boxToleranceD: number;
  /** Stopped means slower than this, m/s. */
  stoppedSpeed: number;
  /** Release waits while a car in the fast lane is this far behind the box or less (and this far ahead), m. Estimate. */
  releaseClearBehind: number;
  releaseClearAhead: number;
  /** Seeded spread added to each stop's service time: uniform in [0, spread], s. Estimate. */
  serviceSpread: number;

  // ---- Session end ----
  /** After the chequered flag, the session ends when everyone has finished, or this long after the flag, s. */
  finishTimeout: number;
  /** Laps completed, as a share of the winner's, to be classified without taking the flag. Sporting regulations: 90 %. */
  classifiedShare: number;

  // ---- Watchdog (stuck-car definition) ----
  /** Stationary: slower than `stuckSpeed` for `stuckTime` outside the pit box, s. */
  stuckSpeed: number;
  stuckTime: number;
  /** No progress: less than `progressDistance` of race distance gained in `progressTime`. */
  progressDistance: number;
  progressTime: number;
  /** Off track: all four wheels past the line, outside the pit lane, for this long, s. */
  offTrackTime: number;
  /** Wrong way: race distance falling faster than `wrongWaySpeed` for `wrongWayTime`. */
  wrongWaySpeed: number;
  wrongWayTime: number;
  /** Retire a car the watchdog has flagged as stuck for this long, s (null: never). */
  retireStuckAfter: number | null;
}

export const DEFAULT_RULES: Readonly<RaceRules> = Object.freeze({
  gridTime: 2,
  lightInterval: 1,
  lightsHoldMin: 0.2,
  lightsHoldMax: 3,
  jumpStartTolerance: 0.5,
  jumpStartPenalty: 5,
  reactionBase: 0.2,
  reactionSpread: 0.1,

  wheelsOffForInvalid: 4,
  limitsRearm: 0.5,
  strikesPerPenalty: 4,
  limitsPenalty: 5,
  giveBackWindow: 15,
  cutTrailTime: 2,
  cutPenalty: 5,

  marshalSectorLength: 300,
  yellowSpeed: 8,
  yellowDelay: 1,
  yellowReach: 25,
  yellowClearTime: 3,
  blueGap: 1,
  blueWindow: 15,
  bluePenalty: 5,

  drsEnableLap: 3,
  drsGap: 1,
  drsBrake: 0.02,
  drsLiftThrottle: 0.3,

  pitSpeedTolerance: 0.3,
  pitSpeedPenalty: 5,
  boxToleranceS: 3,
  boxToleranceD: 2.5,
  stoppedSpeed: 0.3,
  releaseClearBehind: 20,
  releaseClearAhead: 5,
  serviceSpread: 0.8,

  finishTimeout: 240,
  classifiedShare: 0.9,

  stuckSpeed: 1,
  stuckTime: 5,
  progressDistance: 10,
  progressTime: 10,
  offTrackTime: 10,
  wrongWaySpeed: 1,
  wrongWayTime: 3,
  retireStuckAfter: 60,
});

export function resolveRules(overrides: Partial<RaceRules> = {}): RaceRules {
  return { ...DEFAULT_RULES, ...overrides };
}

/**
 * Championship points by finishing position: the scale top-level open-wheel racing has used
 * since 2010 (no point for the fastest lap, which was dropped for 2025).
 */
export const POINTS_TABLE: readonly number[] = Object.freeze([25, 18, 15, 12, 10, 8, 6, 4, 2, 1]);

/** Stationary time each pit service action costs, s. Estimate: tyre stops of 2 to 2.5 s are typical. */
export const SERVICE_TIMES: Readonly<Record<string, number>> = Object.freeze({
  tyres: 2.4,
});

/** Dry tyre compounds the "change tyres" action can fit. Wear and temperature arrive in M4. */
export const COMPOUNDS = ['soft', 'medium', 'hard'] as const;
export type Compound = (typeof COMPOUNDS)[number];
