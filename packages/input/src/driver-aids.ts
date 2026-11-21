/**
 * The player's driver aids as the game applies them: the device preset turned into the sim's
 * assist settings, the steering help for analog devices, and one function that runs the whole
 * chain for a tick. The game session and the validation harness both call `applyDriverAids`,
 * so what the harness measures is what the player drives.
 */
import {
  applyAssists,
  speedSensitiveSteer,
  type AssistSettings,
  type AssistState,
  type CarState,
  type ControlInput,
} from '@undercut/sim';
import type { DeviceKind } from './actions';
import { assistPresetFor, type AssistLevel } from './assists';

/** The assists a session applies: the sim's settings plus the steering and braking help levels. */
export interface AssistConfig extends AssistSettings {
  /** Speed-sensitive steering for sticks and touch, 0 (off) to 3. Keyboards shape their own. */
  steering: number;
  /**
   * Braking help, 0 (off) to 3: brakes for the corner ahead when the car is faster than the
   * driving line's speed there (see `brakeHelp`). Needs the circuit's guide; off without it.
   */
  braking: number;
}

/** Where the advised speeds come from: the driving line (`DrivingLine` in `@undercut/ai`). */
export interface SpeedGuide {
  /** Advised speed at centreline `s`, m/s. */
  speedAt(s: number): number;
}

/** The guide and the car's centreline position this tick, for the braking help. */
export interface GuidePosition {
  guide: SpeedGuide;
  s: number;
}

/** What the player changed in the pause menu; everything else follows the device preset. */
export type AssistOverrides = Partial<AssistConfig>;

const LEVEL: Readonly<Record<AssistLevel, number>> = { off: 0, low: 1, medium: 2, high: 3 };
/** ABS has one "on" in the presets; level 2 holds the tyres just past peak slip. */
const ABS_ON = 2;
/**
 * Braking help per level: speed over the guide tolerated (m/s) and brake pedal per m/s beyond
 * it. The guide is read `BRAKE_HELP_LEAD` seconds ahead at the car's speed, so the brakes come
 * on where the driving line's braking zone starts for a car this fast.
 */
const BRAKE_HELP = [
  { margin: Infinity, gain: 0 },
  { margin: 3, gain: 0.3 },
  { margin: 1.5, gain: 0.4 },
  { margin: 0.5, gain: 0.5 },
] as const;
const BRAKE_HELP_LEAD = 0.5;
/** Steering scale at high speed per steering level, for `speedSensitiveSteer`. */
const STEER_HIGH_SPEED_SCALE = [1, 0.55, 0.35, 0.22] as const;

/** The active device's preset, with the player's overrides on top. */
export function assistsFor(device: DeviceKind, overrides: AssistOverrides): AssistConfig {
  const preset = assistPresetFor(device);
  return {
    tractionControl: LEVEL[preset.tractionControl],
    stability: preset.stability ? 1 : 0,
    abs: preset.abs === 'on' ? ABS_ON : 0,
    autoGears: preset.gears === 'automatic',
    steering: LEVEL[preset.steering],
    braking: LEVEL[preset.braking],
    ...overrides,
  };
}

/**
 * Steering help for analog devices: less lock as speed rises, so a full stick deflection asks
 * for a sensible angle at 300 km/h. The keyboard's axis shaper already does this for digital
 * keys, so keyboards pass straight through.
 */
export function assistSteer(
  device: DeviceKind,
  level: number,
  steer: number,
  speed: number,
): number {
  if (device === 'keyboard') return steer;
  const l = Math.max(0, Math.min(3, Math.round(level)));
  if (l === 0) return steer;
  return speedSensitiveSteer(steer, speed, 15, STEER_HIGH_SPEED_SCALE[l as 1 | 2 | 3]);
}

/** The gain `assistSteer` applies at `speed`: steer out per unit of steer in. */
export function steerHelpScale(device: DeviceKind, level: number, speed: number): number {
  return assistSteer(device, level, 1, speed);
}

/**
 * Brake pedal the braking help asks for at `level` with the car at centreline `s` doing
 * `speed` m/s: proportional to how far the car is over the guide's speed a moment ahead, 0
 * when it is not. Like a driving instructor's foot on a dual-control pedal: it never brakes
 * less than the driver, and the ABS still holds the wheels.
 */
export function brakeHelp(level: number, guide: SpeedGuide, s: number, speed: number): number {
  const l = Math.max(0, Math.min(3, Math.round(level))) as 0 | 1 | 2 | 3;
  if (l === 0 || speed <= 0) return 0;
  const help = BRAKE_HELP[l];
  const over = speed - guide.speedAt(s + speed * BRAKE_HELP_LEAD) - help.margin;
  return over > 0 ? Math.min(1, help.gain * over) : 0;
}

/**
 * One tick of the aids: `control` is the shaped device demand, `out` receives what the car
 * gets. `out` may be `control`. `at` places the car against the driving line for the braking
 * help; without it there is no braking help.
 */
export function applyDriverAids(
  device: DeviceKind,
  config: AssistConfig,
  memory: AssistState,
  car: CarState,
  control: Readonly<ControlInput>,
  dt: number,
  out: ControlInput,
  at?: GuidePosition,
): ControlInput {
  const help = at ? brakeHelp(config.braking ?? 0, at.guide, at.s, car.vx) : 0;
  out.steer = assistSteer(device, config.steering, control.steer, car.vx);
  out.throttle = help > control.brake ? 0 : control.throttle;
  out.brake = help > control.brake ? help : control.brake;
  out.gearShift = control.gearShift;
  out.overtake = control.overtake;
  out.pitLimiter = control.pitLimiter;
  out.drs = control.drs;
  return applyAssists(config, memory, car, out, dt, out);
}
