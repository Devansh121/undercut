/**
 * Device controls: the physical things a binding points at. A control id is a string with a
 * device prefix, stable across sessions so it can be saved:
 *
 * - keyboard `key:<KeyboardEvent.code>`, e.g. `key:KeyW` (layout-independent);
 * - gamepad `pad:b<index>` for a button (triggers are analog buttons 6 and 7 in the standard
 *   mapping) and `pad:a<index>-` / `pad:a<index>+` for one direction of an axis;
 * - touch `touch:<name>` for the fixed controls of the touch overlay.
 *
 * Every control reads as a level in [0, 1].
 */
import type { DeviceKind } from './actions';

export type ControlId = string;

export const TOUCH_CONTROLS = [
  'steerLeft',
  'steerRight',
  'throttle',
  'brake',
  'gearUp',
  'gearDown',
  'drs',
  'overtake',
  'boxThisLap',
  'nextCompound',
  'pitLimiter',
  'camera',
  'pause',
] as const;
export type TouchControl = (typeof TOUCH_CONTROLS)[number];
const TOUCH_SET: ReadonlySet<string> = new Set(TOUCH_CONTROLS);

const KEY_RE = /^key:[A-Za-z0-9]+$/;
const PAD_BUTTON_RE = /^pad:b(\d{1,2})$/;
const PAD_AXIS_RE = /^pad:a(\d{1,2})([+-])$/;

export const keyControl = (code: string): ControlId => `key:${code}`;
export const padButton = (index: number): ControlId => `pad:b${index}`;
export const padAxis = (index: number, direction: -1 | 1): ControlId =>
  `pad:a${index}${direction < 0 ? '-' : '+'}`;
export const touchControl = (name: TouchControl): ControlId => `touch:${name}`;

/** The device a control belongs to, or null when the id is not a valid control. */
export function deviceOfControl(control: unknown): DeviceKind | null {
  if (typeof control !== 'string') return null;
  if (KEY_RE.test(control)) return 'keyboard';
  if (PAD_BUTTON_RE.test(control) || PAD_AXIS_RE.test(control)) return 'gamepad';
  if (control.startsWith('touch:') && TOUCH_SET.has(control.slice(6))) return 'touch';
  return null;
}

export type PadControl =
  { kind: 'button'; index: number } | { kind: 'axis'; index: number; direction: -1 | 1 };

export function parsePadControl(control: ControlId): PadControl | null {
  const button = PAD_BUTTON_RE.exec(control);
  if (button) return { kind: 'button', index: Number(button[1]) };
  const axis = PAD_AXIS_RE.exec(control);
  if (axis) return { kind: 'axis', index: Number(axis[1]), direction: axis[2] === '-' ? -1 : 1 };
  return null;
}

const KEY_NAMES: Record<string, string> = {
  ArrowLeft: 'Left arrow',
  ArrowRight: 'Right arrow',
  ArrowUp: 'Up arrow',
  ArrowDown: 'Down arrow',
  Space: 'Space',
  Escape: 'Esc',
  Enter: 'Enter',
  NumpadEnter: 'Num Enter',
  Backspace: 'Backspace',
  Tab: 'Tab',
  ShiftLeft: 'Left Shift',
  ShiftRight: 'Right Shift',
  ControlLeft: 'Left Ctrl',
  ControlRight: 'Right Ctrl',
  AltLeft: 'Left Alt',
  AltRight: 'Right Alt',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backslash: '\\',
  BracketLeft: '[',
  BracketRight: ']',
  Minus: '-',
  Equal: '=',
  Backquote: '`',
};

const PAD_BUTTON_NAMES = [
  'A',
  'B',
  'X',
  'Y',
  'LB',
  'RB',
  'LT',
  'RT',
  'View',
  'Menu',
  'LS',
  'RS',
  'D-pad up',
  'D-pad down',
  'D-pad left',
  'D-pad right',
  'Home',
];

const PAD_AXIS_NAMES: Record<string, string> = {
  'a0-': 'Left stick left',
  'a0+': 'Left stick right',
  'a1-': 'Left stick up',
  'a1+': 'Left stick down',
  'a2-': 'Right stick left',
  'a2+': 'Right stick right',
  'a3-': 'Right stick up',
  'a3+': 'Right stick down',
};

const TOUCH_NAMES: Record<TouchControl, string> = {
  steerLeft: 'Stick left',
  steerRight: 'Stick right',
  throttle: 'Throttle pedal',
  brake: 'Brake pedal',
  gearUp: 'Gear up button',
  gearDown: 'Gear down button',
  drs: 'DRS button',
  boxThisLap: 'Box button',
  nextCompound: 'Tyre button',
  pitLimiter: 'Limiter button',
  overtake: 'Overtake button',
  camera: 'Camera button',
  pause: 'Pause button',
};

/** A short name for prompts and the bindings list. */
export function controlLabel(control: ControlId): string {
  const device = deviceOfControl(control);
  if (device === 'keyboard') {
    const code = control.slice(4);
    if (KEY_NAMES[code]) return KEY_NAMES[code];
    if (/^Key[A-Z]$/.test(code)) return code.slice(3);
    if (/^Digit\d$/.test(code)) return code.slice(5);
    if (/^Numpad\d$/.test(code)) return `Num ${code.slice(6)}`;
    return code;
  }
  if (device === 'gamepad') {
    const pad = parsePadControl(control);
    if (pad?.kind === 'button') return PAD_BUTTON_NAMES[pad.index] ?? `Button ${pad.index}`;
    if (pad?.kind === 'axis') {
      const key = control.slice(4);
      return PAD_AXIS_NAMES[key] ?? `Axis ${pad.index} ${pad.direction < 0 ? '-' : '+'}`;
    }
  }
  if (device === 'touch') return TOUCH_NAMES[control.slice(6) as TouchControl];
  return control;
}
