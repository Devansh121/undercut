/**
 * Assist presets per input device, as data. The assists themselves (steering help, ABS,
 * traction control, automatic gears, braking help, racing line) live in the sim and change
 * what reaches the car, never the physics. These are the levels a fresh player starts with on
 * each device; the settings screen lets them change every one.
 *
 * The level types belong next to the sim's assist implementation once it exists; they are
 * defined here until then and should move into `@undercut/sim` contracts.
 */
import type { DeviceKind } from './actions';

export type AssistLevel = 'off' | 'low' | 'medium' | 'high';

export interface AssistPreset {
  steering: AssistLevel;
  braking: AssistLevel;
  abs: 'off' | 'on';
  tractionControl: AssistLevel;
  gears: 'manual' | 'automatic';
  racingLine: 'off' | 'braking' | 'full';
}

export const ASSIST_PRESETS: Readonly<Record<DeviceKind, Readonly<AssistPreset>>> = Object.freeze({
  // Digital steering and pedals: help with steering and traction, braking line shown.
  keyboard: Object.freeze({
    steering: 'medium',
    braking: 'off',
    abs: 'on',
    tractionControl: 'medium',
    gears: 'automatic',
    racingLine: 'braking',
  }),
  // Analog stick and triggers: the least help.
  gamepad: Object.freeze({
    steering: 'low',
    braking: 'off',
    abs: 'on',
    tractionControl: 'low',
    gears: 'automatic',
    racingLine: 'braking',
  }),
  // A thumb on glass: the most help.
  touch: Object.freeze({
    steering: 'high',
    braking: 'medium',
    abs: 'on',
    tractionControl: 'high',
    gears: 'automatic',
    racingLine: 'full',
  }),
});

/** A fresh, editable copy of the preset for `device`. */
export function assistPresetFor(device: DeviceKind): AssistPreset {
  return { ...ASSIST_PRESETS[device] };
}
