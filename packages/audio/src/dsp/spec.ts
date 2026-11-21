import { rpmToRadPerSecond } from './state';

/** A fixed resonance of the exhaust or intake system. It does not move with rpm. */
export interface Formant {
  /** Centre frequency, Hz. */
  frequency: number;
  q: number;
  /** Peak boost, dB. */
  gainDb: number;
}

/**
 * Sound-design parameters of the power unit voice. Mechanical numbers come from
 * docs/physics-validation.md section 1.3; the acoustic ones are design estimates.
 */
export interface PowerUnitSoundSpec {
  /** Idle speed, rad/s. */
  idleSpeed: number;
  /** Rev-limiter speed, rad/s. */
  limiterSpeed: number;
  /**
   * Extra exhaust delay of the second bank as a fraction of the 720° cycle. Together with
   * `bankImbalance` this gives the uneven-bank character (half and 1.5 orders).
   */
  bankDelay: number;
  /** Second-bank pulse level deficit at full load and on the overrun. */
  bankImbalance: { fullLoad: number; overrun: number };
  /** Fixed exhaust resonances applied to the pulse train. */
  exhaustFormants: readonly Formant[];
  /** Intake (airbox) resonance, fed by the pulse train in proportion to load. */
  intake: Formant;
  /** MGU-K shaft revolutions per crank revolution (estimate). */
  mgukRatio: number;
  /** MGU-K pole pairs; the electrical whine is shaft speed times this. */
  mgukPolePairs: number;
  /** MGU-K rated power, W (±120 kW). */
  mgukMaxPower: number;
  /** Turbo spool time constants, s: up with load, down after a lift. */
  turboSpoolUp: number;
  turboSpoolDown: number;
  /** Turbo whine frequency at zero and full spool, Hz. */
  turboWhine: { idle: number; full: number };
}

export const DEFAULT_POWER_UNIT: PowerUnitSoundSpec = {
  idleSpeed: rpmToRadPerSecond(4500),
  limiterSpeed: rpmToRadPerSecond(12500),
  bankDelay: 0.004,
  bankImbalance: { fullLoad: 0.05, overrun: 0.16 },
  exhaustFormants: [
    { frequency: 170, q: 1.1, gainDb: 4 },
    { frequency: 440, q: 1.6, gainDb: 3 },
    { frequency: 1150, q: 1.8, gainDb: 5 },
    { frequency: 2900, q: 1.6, gainDb: 6 },
  ],
  intake: { frequency: 1300, q: 1.4, gainDb: 0 },
  mgukRatio: 3.3,
  mgukPolePairs: 4,
  mgukMaxPower: 120_000,
  turboSpoolUp: 0.3,
  turboSpoolDown: 1.4,
  turboWhine: { idle: 1800, full: 7200 },
};
