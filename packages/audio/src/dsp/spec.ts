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
 * The gearbox as the transmission whine hears it. Ratios come from docs/physics-validation.md
 * section 1.3 (the sim's `ratios`); the final drive and tooth counts are estimates (none are
 * published): pinions sized so each pair has about 70 teeth in total, as constant centre
 * distance requires.
 */
export interface GearboxSoundSpec {
  /** Overall ratios, engine revs per wheel rev, 1st to 8th. */
  gearRatios: readonly number[];
  /** Final-drive ratio; gearbox ratio = overall / final. */
  finalDrive: number;
  /** Teeth on the input pinion of each gear pair, 1st to 8th. */
  pinionTeeth: readonly number[];
  /** Teeth on the final-drive pinion (on the output shaft). */
  finalPinionTeeth: number;
  /** Time constant of the mesh tone gliding to a new pair during a shift, s. */
  changeTime: number;
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
  gearbox: GearboxSoundSpec;
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
  gearbox: {
    gearRatios: [16.5, 12.4, 10.1, 8.5, 7.3, 6.3, 5.4, 4.6],
    finalDrive: 3.0,
    pinionTeeth: [11, 14, 16, 18, 20, 23, 25, 28],
    finalPinionTeeth: 13,
    changeTime: 0.012,
  },
};
