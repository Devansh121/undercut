import { assistPresetFor, type AssistLevel, type DeviceKind } from '@undercut/input';
import { speedSensitiveSteer, type AssistSettings } from '@undercut/sim';

/** The assists the session applies: the sim's settings plus the steering help level. */
export interface AssistConfig extends AssistSettings {
  /** Speed-sensitive steering for sticks and touch, 0 (off) to 3. Keyboards shape their own. */
  steering: number;
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
    abs: preset.abs === 'on' ? ABS_ON : 0,
    autoGears: preset.gears === 'automatic',
    steering: LEVEL[preset.steering],
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
