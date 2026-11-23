import { DrivingLine } from '@undercut/ai';
import { MONZA } from '../../../ai/validation/lib/index';
import type { DeviceKind } from '../../src/actions';
import { assistsFor, type AssistConfig, type AssistOverrides } from '../../src/driver-aids';
import { CLUMSY, type HumanTraits } from './human';
import { newcomerPlan, runPlayer } from './player-lap';

export const PLAN = newcomerPlan(MONZA);
/** The game's driving line on the same plan: the disciplined driver's cues and the braking help. */
export const GUIDE = new DrivingLine(PLAN);

/** Every assist off, automatic gears kept (a keyboard player cannot shift and steer at once). */
export const ASSISTS_OFF: AssistConfig = {
  tractionControl: 0,
  abs: 0,
  autoGears: true,
  steering: 0,
  stability: 0,
  braking: 0,
};

export interface Tally {
  laps: number;
  spinsPerLap: number;
  wallSpinsPerLap: number;
  /** Seconds per lap off the track or spun (a spin counts its cost, `SPIN_COST`). */
  offPerLap: number;
  /** Seconds per lap the steer reaching the car differed from the driver's by more than 0.15. */
  overridePerLap: number;
  meanLap: number;
}

/** `seeds` × `laps` laps by a human on `device` with `assists` (the preset with overrides). */
export function tally(
  device: DeviceKind,
  assists: AssistConfig | AssistOverrides,
  seeds: number,
  laps: number,
  traits: HumanTraits = CLUMSY,
): Tally {
  const config =
    'braking' in assists && 'steering' in assists && 'abs' in assists
      ? (assists as AssistConfig)
      : assistsFor(device, assists);
  let n = 0;
  let spins = 0;
  let walls = 0;
  let off = 0;
  let override = 0;
  let time = 0;
  for (let seed = 1; seed <= seeds; seed++) {
    const r = runPlayer({
      setup: MONZA,
      device,
      traits,
      assists: config,
      seed,
      laps,
      plan: PLAN,
      cues: GUIDE,
      guide: GUIDE,
    });
    n += r.laps;
    spins += r.spins.length;
    walls += r.wallSpins;
    off += r.offTicks / 240;
    override += r.overrideTicks / 240;
    for (const t of r.lapTimes) time += t;
  }
  const per = (x: number): number => x / Math.max(n, 1);
  return {
    laps: n,
    spinsPerLap: per(spins),
    wallSpinsPerLap: per(walls),
    offPerLap: per(off),
    overridePerLap: per(override),
    meanLap: per(time),
  };
}

/**
 * Drivability targets the brief sets and the model misses, as measured when recorded (five seeds
 * of two laps, `tally`), like the physics suite's lap gaps: a test asserts the recorded value
 * within one incident, so it fails if the gap widens and also if it closes without the record
 * (and docs/STATUS.md, Known gaps) being updated.
 */
export interface DrivabilityGap {
  /** Incidents (spins, barrier strikes, resets) in the ten laps. */
  incidents: number;
  /** Mean lap, s (spins charged). */
  meanLap: number;
  reason: string;
}

export const DRIVABILITY_GAPS = Object.freeze({
  /** Target: no spin, 6–12 % slower than the reference lap. */
  disciplinedKeyboard: Object.freeze({
    incidents: 4,
    meanLap: 114.42,
    reason:
      'Braking at the driving line marks and flooring it on green, on keys: three barrier ' +
      'strikes just past the Lesmo 1 and Lesmo 2 exits (54 and 46 km/h) and one spin out of ' +
      'Vialone over the kerb with the rear unloaded; about 42 s a lap off the asphalt, 35 % ' +
      'slower than the reference.',
  }),
  /** Target: at most 1 spin in 10 laps. */
  clumsyGamepad: Object.freeze({
    incidents: 3,
    meanLap: 95.68,
    reason:
      'All three at the first chicane exit: two on the kerb with the rear unloaded, one stopped ' +
      'against the barrier and reset.',
  }),
} satisfies Record<string, DrivabilityGap>);
