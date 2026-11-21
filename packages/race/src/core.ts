import type { Rng } from '@undercut/core';
import type { CircuitInfo } from './circuit';
import type { PenaltyReason, Phase, RaceEvent } from './events';
import type { CarFacts } from './facts';
import type { SessionStrategy } from './kinds';
import type { RaceRules } from './rules';
import type { GapTower } from './timing/tower';
import type { LapTimer } from './timing/lap-timer';

export type CarStatus = 'running' | 'finished' | 'dnf' | 'dsq';

export interface Penalty {
  reason: PenaltyReason;
  seconds: number;
  /** Served at a pit stop (held before service); unserved ones are added at the finish. */
  served: boolean;
  at: number;
}

/** Per-car state the core keeps and every system may read. Plain data. */
export interface CoreCar {
  status: CarStatus;
  reason: string | null;
  /** Team index: decides the pit box. */
  team: number;
  /** Lap s where the car stood at the start (jump-start reference). */
  startS: number | null;
  finishTime: number | null;
  finishDist: number | null;
  finishOrder: number | null;
  finishLaps: number | null;
  /** 1-based position in the live classification. */
  position: number;
  penalties: Penalty[];
  warnings: number;
  compound: string;
  compounds: string[];
  pitStops: number;
  speedTrapBest: number | null;
  jumpStart: boolean;
  /** Sim time the car set its current best valid lap (classification tie-break). */
  bestAt: number | null;
  /** Lap number of the current best valid lap. */
  bestLapNumber: number | null;
  /** Race distance this tick and last tick, m (the lap timer's). */
  dist: number;
  prevDist: number;
}

/**
 * What the systems see of the race: the rules, the circuit, the session strategy, every car's
 * facts and state, the timers, and the few session-wide values. Systems add events through
 * `emit` and penalties through `penalise`, which turns them into warnings outside a race.
 */
export interface RaceCore {
  readonly rules: RaceRules;
  readonly circuit: CircuitInfo;
  readonly strategy: SessionStrategy;
  readonly rng: Rng;
  readonly cars: readonly CoreCar[];
  readonly facts: readonly CarFacts[];
  readonly prevFacts: readonly CarFacts[];
  readonly timers: readonly LapTimer[];
  readonly tower: GapTower;
  /** Sim time at the end of this tick and of the last one. */
  readonly time: number;
  readonly prevTime: number;
  readonly phase: Phase;
  readonly lightsOutAt: number | null;
  /** Car indices in classification order. */
  readonly order: readonly number[];
  emit(e: RaceEvent): void;
  penalise(car: number, reason: PenaltyReason, seconds: number): void;
  invalidate(car: number, reason: 'limits' | 'reset' | 'deleted'): void;
  /** Take the car out of the session (did not finish). */
  retire(car: number, reason: string): void;
  /** Running, not finished, and the session is under way (after lights out). */
  racing(car: number): boolean;
  /** Unserved penalty time, s. */
  unservedPenalty(car: number): number;
}

/** A rules system: runs once per tick over the core, owns its own serialisable state. */
export interface RaceSystem<S> {
  tick(core: RaceCore): void;
  getState(): S;
  setState(state: S): void;
}

export function forward(length: number, from: number, to: number): number {
  const d = (to - from) % length;
  return d < 0 ? d + length : d;
}

/** Signed shortest move on a loop, in (-length/2, length/2]. */
export function signedDelta(length: number, from: number, to: number): number {
  const f = forward(length, from, to);
  return f > length / 2 ? f - length : f;
}

/** Is lap s inside [from, to) going forward (wrapping)? */
export function inRange(length: number, s: number, from: number, to: number): boolean {
  return forward(length, from, s) < forward(length, from, to);
}
