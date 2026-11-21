import type { DeltaClass, LapResult } from './timing/lap-timer';

/** Session phase. Safety car, red flag and weather phases slot in here later. */
export type Phase = 'grid' | 'lights' | 'green' | 'chequered' | 'finished';

export type PenaltyReason =
  'jumpStart' | 'trackLimits' | 'leavingTrack' | 'pitSpeeding' | 'blueFlags';

export type PitStage =
  | 'entry'
  | 'stop'
  | 'penaltyStart'
  | 'serviceStart'
  | 'serviceEnd'
  | 'release'
  | 'exit'
  | 'missed'
  | 'speeding';

/** Watchdog findings: the stuck-car definition of the race acceptance test. */
export type AnomalyKind = 'stationary' | 'noProgress' | 'offTrack' | 'wrongWay';

export type FlagKind = 'green' | 'yellow' | 'blue' | 'chequered' | 'blackWhite';

/**
 * Everything the race engine announces, in the order it happened within a tick. `t` is the sim
 * time of the tick that produced it; line crossings also carry their interpolated time.
 */
export type RaceEvent =
  | { type: 'phase'; t: number; phase: Phase }
  /** Start lights: `count` lights on (1 to 5); 0 means lights out. */
  | { type: 'lights'; t: number; count: number }
  | { type: 'lapStart'; t: number; car: number; lap: number; time: number }
  | {
      type: 'sector';
      t: number;
      car: number;
      lap: number;
      index: number;
      time: number;
      at: number;
      class: DeltaClass;
      delta: number | null;
    }
  | { type: 'lap'; t: number; car: number; at: number; result: LapResult }
  /** A lap stopped counting: track limits, a reset, or deleted after a last-corner offence. */
  | {
      type: 'invalidated';
      t: number;
      car: number;
      lap: number;
      reason: 'limits' | 'reset' | 'deleted';
    }
  | { type: 'speedTrap'; t: number; car: number; speed: number; best: boolean }
  | { type: 'fastestLap'; t: number; car: number; lap: number; time: number }
  | { type: 'position'; t: number; car: number; from: number; to: number }
  | {
      type: 'trackLimits';
      t: number;
      car: number;
      strike: number;
      outcome: 'warning' | 'blackWhite' | 'penalty';
    }
  | { type: 'penalty'; t: number; car: number; reason: PenaltyReason; seconds: number }
  | { type: 'penaltyServed'; t: number; car: number; seconds: number }
  /** A rule broken without a time penalty in this session (practice speeding, yellow-flag overtake). */
  | { type: 'warning'; t: number; car: number; reason: string }
  | {
      type: 'flag';
      t: number;
      flag: FlagKind;
      on: boolean;
      /** Marshalling sector (yellow). */
      sector?: number;
      /** Car shown the flag (blue, black and white). */
      car?: number;
      /** Car about to lap it (blue). */
      by?: number;
    }
  | { type: 'drsEnabled'; t: number; enabled: boolean }
  | { type: 'drsEligible'; t: number; car: number; zone: number; gap: number }
  | {
      type: 'pit';
      t: number;
      car: number;
      stage: PitStage;
      /** Service or penalty time for the stages that start one, s. */
      duration?: number;
      /** Actions carried out (serviceEnd). */
      actions?: readonly ServiceAction[];
    }
  | { type: 'finish'; t: number; car: number; position: number; laps: number }
  | { type: 'retired'; t: number; car: number; reason: string }
  | { type: 'anomaly'; t: number; car: number; kind: AnomalyKind; on: boolean; duration: number }
  | { type: 'sessionEnd'; t: number };

/**
 * One thing done at a pit stop. Tyre, fuel and damage systems add their own kinds; for now the
 * only one is a tyre change, which costs its service time and is recorded.
 */
export type ServiceAction = { kind: 'tyres'; compound: string };
