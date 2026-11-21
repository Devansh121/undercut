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
import { assistPresetFor, type AssistLevel, type AssistPreset } from './assists';

/** The assists a session applies: the sim's settings plus steering help and driving-line mode. */
export interface AssistConfig extends AssistSettings {
  /** Speed-sensitive steering for sticks and touch, 0 (off) to 3. Keyboards shape their own. */
  steering: number;
  /** On-track driving-line assist display mode. */
  racingLine?: AssistPreset['racingLine'];
}

/** What the player changed in the pause menu; everything else follows the device preset. */
export type AssistOverrides = Partial<AssistConfig>;

const LEVEL: Readonly<Record<AssistLevel, number>> = { off: 0, low: 1, medium: 2, high: 3 };
/** ABS has one "on" in the presets; level 2 holds the tyres just past peak slip. */
const ABS_ON = 2;
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
    racingLine: preset.racingLine,
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
 * One tick of the aids: `control` is the shaped device demand, `out` receives what the car
 * gets. `out` may be `control`.
 */
export function applyDriverAids(
  device: DeviceKind,
  config: AssistConfig,
  memory: AssistState,
  car: CarState,
  control: Readonly<ControlInput>,
  dt: number,
  out: ControlInput,
): ControlInput {
  out.steer = assistSteer(device, config.steering, control.steer, car.vx);
  out.throttle = control.throttle;
  out.brake = control.brake;
  out.gearShift = control.gearShift;
  out.overtake = control.overtake;
  out.pitLimiter = control.pitLimiter;
  out.drs = control.drs;
  return applyAssists(config, memory, car, out, dt, out);
}
