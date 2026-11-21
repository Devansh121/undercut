/**
 * What a player can ask for. Analog actions are half-axes in [0, 1]: steering is two of them
 * (left and right), so a key, a stick direction or a touch stick side can each be bound alone.
 * Buttons are held or pressed. Every action belongs to one context; a control may be bound to
 * one action per context (DRS and menu accept can share a button, gear up and DRS cannot).
 */

export type DeviceKind = 'keyboard' | 'gamepad' | 'touch';
export const DEVICE_KINDS: readonly DeviceKind[] = ['keyboard', 'gamepad', 'touch'];

export type AnalogAction = 'steerLeft' | 'steerRight' | 'throttle' | 'brake';
export const ANALOG_ACTIONS: readonly AnalogAction[] = [
  'steerLeft',
  'steerRight',
  'throttle',
  'brake',
];

export type DrivingButton =
  | 'gearUp'
  | 'gearDown'
  | 'drs'
  | 'overtake'
  | 'pitLimiter'
  | 'lookBack'
  | 'nextCamera'
  | 'pause'
  | 'resetToTrack';
export const DRIVING_BUTTONS: readonly DrivingButton[] = [
  'gearUp',
  'gearDown',
  'drs',
  'overtake',
  'pitLimiter',
  'lookBack',
  'nextCamera',
  'pause',
  'resetToTrack',
];

export type MenuButton =
  'menuUp' | 'menuDown' | 'menuLeft' | 'menuRight' | 'menuAccept' | 'menuBack';
export const MENU_BUTTONS: readonly MenuButton[] = [
  'menuUp',
  'menuDown',
  'menuLeft',
  'menuRight',
  'menuAccept',
  'menuBack',
];

export type ButtonAction = DrivingButton | MenuButton;
export type ActionId = AnalogAction | ButtonAction;
export const ACTIONS: readonly ActionId[] = [
  ...ANALOG_ACTIONS,
  ...DRIVING_BUTTONS,
  ...MENU_BUTTONS,
];

export type InputContext = 'driving' | 'menu';

const MENU_SET: ReadonlySet<string> = new Set(MENU_BUTTONS);
const ANALOG_SET: ReadonlySet<string> = new Set(ANALOG_ACTIONS);
const ACTION_SET: ReadonlySet<string> = new Set(ACTIONS);

export function isAction(value: unknown): value is ActionId {
  return typeof value === 'string' && ACTION_SET.has(value);
}

export function isAnalogAction(action: ActionId): action is AnalogAction {
  return ANALOG_SET.has(action);
}

export function contextOf(action: ActionId): InputContext {
  return MENU_SET.has(action) ? 'menu' : 'driving';
}

/** Plain English names for settings and prompts. */
export const ACTION_LABELS: Readonly<Record<ActionId, string>> = Object.freeze({
  steerLeft: 'Steer left',
  steerRight: 'Steer right',
  throttle: 'Throttle',
  brake: 'Brake',
  gearUp: 'Gear up',
  gearDown: 'Gear down',
  drs: 'DRS',
  overtake: 'Overtake',
  pitLimiter: 'Pit limiter',
  lookBack: 'Look back',
  nextCamera: 'Next camera',
  pause: 'Pause',
  resetToTrack: 'Reset to track',
  menuUp: 'Up',
  menuDown: 'Down',
  menuLeft: 'Left',
  menuRight: 'Right',
  menuAccept: 'Accept',
  menuBack: 'Back',
});
