/**
 * Binding map: which device controls drive which actions, per device, with up to two controls
 * per action (primary and secondary). Maps are plain data, treated as immutable by the
 * functions here, and saved inside a versioned profile together with the shaping settings.
 */
import {
  ACTIONS,
  DEVICE_KINDS,
  contextOf,
  type ActionId,
  type DeviceKind,
  type InputContext,
} from './actions';
import { deviceOfControl, type ControlId } from './controls';
import { defaultShaping, type InputShaping } from './shaping';

export const MAX_SLOTS = 2;
export const PROFILE_VERSION = 1;

export type DeviceBindings = Partial<Record<ActionId, ControlId[]>>;
export type BindingMap = Record<DeviceKind, DeviceBindings>;

export interface InputProfile {
  version: typeof PROFILE_VERSION;
  bindings: BindingMap;
  shaping: InputShaping;
}

const KEYBOARD_DEFAULTS: Record<ActionId, string[]> = {
  steerLeft: ['KeyA', 'ArrowLeft'],
  steerRight: ['KeyD', 'ArrowRight'],
  throttle: ['KeyW', 'ArrowUp'],
  brake: ['KeyS', 'ArrowDown'],
  gearUp: ['KeyE'],
  gearDown: ['KeyQ'],
  drs: ['KeyF'],
  overtake: ['Space'],
  boxThisLap: ['KeyI'],
  nextCompound: ['KeyO'],
  pitLimiter: ['KeyL'],
  lookBack: ['KeyB'],
  nextCamera: ['KeyC'],
  pause: ['Escape', 'KeyP'],
  resetToTrack: ['Backspace'],
  menuUp: ['ArrowUp', 'KeyW'],
  menuDown: ['ArrowDown', 'KeyS'],
  menuLeft: ['ArrowLeft', 'KeyA'],
  menuRight: ['ArrowRight', 'KeyD'],
  menuAccept: ['Enter', 'Space'],
  menuBack: ['Escape', 'Backspace'],
  menuTabPrev: ['KeyQ'],
  menuTabNext: ['KeyE'],
};

// Standard gamepad mapping: 0 A, 1 B, 2 X, 3 Y, 4 LB, 5 RB, 6 LT, 7 RT, 8 View, 9 Menu,
// 10 LS, 11 RS, 12-15 D-pad up/down/left/right. Axis 0 is the left stick, left negative.
const GAMEPAD_DEFAULTS: Record<ActionId, string[]> = {
  steerLeft: ['pad:a0-'],
  steerRight: ['pad:a0+'],
  throttle: ['pad:b7'],
  brake: ['pad:b6'],
  gearUp: ['pad:b5'],
  gearDown: ['pad:b4'],
  drs: ['pad:b0'],
  overtake: ['pad:b2'],
  boxThisLap: ['pad:b12'],
  nextCompound: ['pad:b13'],
  pitLimiter: ['pad:b10'],
  lookBack: ['pad:b3'],
  nextCamera: ['pad:b1'],
  pause: ['pad:b9'],
  resetToTrack: ['pad:b8'],
  menuUp: ['pad:b12', 'pad:a1-'],
  menuDown: ['pad:b13', 'pad:a1+'],
  menuLeft: ['pad:b14', 'pad:a0-'],
  menuRight: ['pad:b15', 'pad:a0+'],
  menuAccept: ['pad:b0'],
  menuBack: ['pad:b1'],
  menuTabPrev: ['pad:b4'],
  menuTabNext: ['pad:b5'],
};

// The touch overlay has a fixed layout; its controls map one to one.
const TOUCH_DEFAULTS: DeviceBindings = {
  steerLeft: ['touch:steerLeft'],
  steerRight: ['touch:steerRight'],
  throttle: ['touch:throttle'],
  brake: ['touch:brake'],
  gearUp: ['touch:gearUp'],
  gearDown: ['touch:gearDown'],
  drs: ['touch:drs'],
  overtake: ['touch:overtake'],
  boxThisLap: ['touch:boxThisLap'],
  nextCompound: ['touch:nextCompound'],
  pitLimiter: ['touch:pitLimiter'],
  nextCamera: ['touch:camera'],
  pause: ['touch:pause'],
};

function defaultsFor(device: DeviceKind): DeviceBindings {
  const out: DeviceBindings = {};
  for (const action of ACTIONS) {
    if (device === 'keyboard') out[action] = KEYBOARD_DEFAULTS[action].map((code) => `key:${code}`);
    else if (device === 'gamepad') out[action] = [...GAMEPAD_DEFAULTS[action]];
    else out[action] = [...(TOUCH_DEFAULTS[action] ?? [])];
  }
  return out;
}

export function defaultBindings(): BindingMap {
  return {
    keyboard: defaultsFor('keyboard'),
    gamepad: defaultsFor('gamepad'),
    touch: defaultsFor('touch'),
  };
}

export function defaultProfile(): InputProfile {
  return { version: PROFILE_VERSION, bindings: defaultBindings(), shaping: defaultShaping() };
}

export function controlsFor(
  map: BindingMap,
  device: DeviceKind,
  action: ActionId,
): readonly ControlId[] {
  return map[device][action] ?? [];
}

export function cloneBindings(map: BindingMap): BindingMap {
  const out = { keyboard: {}, gamepad: {}, touch: {} } as BindingMap;
  for (const device of DEVICE_KINDS) {
    for (const action of ACTIONS) {
      const controls = map[device][action];
      if (controls) out[device][action] = [...controls];
    }
  }
  return out;
}

export interface Conflict {
  device: DeviceKind;
  context: InputContext;
  control: ControlId;
  actions: ActionId[];
}

/** Every control bound to more than one action in the same context, in action order. */
export function findConflicts(map: BindingMap): Conflict[] {
  const conflicts: Conflict[] = [];
  for (const device of DEVICE_KINDS) {
    const seen = new Map<string, Conflict>();
    for (const action of ACTIONS) {
      const context = contextOf(action);
      for (const control of controlsFor(map, device, action)) {
        const key = `${context} ${control}`;
        const entry = seen.get(key);
        if (entry) {
          if (!entry.actions.includes(action)) entry.actions.push(action);
        } else seen.set(key, { device, context, control, actions: [action] });
      }
    }
    for (const entry of seen.values()) if (entry.actions.length > 1) conflicts.push(entry);
  }
  return conflicts;
}

export interface RebindResult {
  map: BindingMap;
  /** Bindings removed from other actions in the same context to keep the map conflict-free. */
  displaced: { action: ActionId; control: ControlId }[];
}

/**
 * Put `control` in `slot` of `action` for `device`. The control is removed from any other action
 * in the same context (reported in `displaced`) and from the action's other slot.
 */
export function rebind(
  map: BindingMap,
  device: DeviceKind,
  action: ActionId,
  slot: number,
  control: ControlId,
): RebindResult {
  const owner = deviceOfControl(control);
  if (owner !== device) {
    throw new Error(`Control ${control} belongs to ${owner ?? 'no device'}, not ${device}`);
  }
  const next = cloneBindings(map);
  const context = contextOf(action);
  const displaced: RebindResult['displaced'] = [];
  for (const other of ACTIONS) {
    if (other === action || contextOf(other) !== context) continue;
    const controls = next[device][other];
    if (controls?.includes(control)) {
      next[device][other] = controls.filter((c) => c !== control);
      displaced.push({ action: other, control });
    }
  }
  const own = (next[device][action] ?? []).filter((c) => c !== control);
  if (slot >= 0 && slot < own.length) own[slot] = control;
  else own.push(control);
  next[device][action] = own.slice(0, MAX_SLOTS);
  return { map: next, displaced };
}

export function clearBinding(
  map: BindingMap,
  device: DeviceKind,
  action: ActionId,
  slot: number,
): BindingMap {
  const next = cloneBindings(map);
  next[device][action] = (next[device][action] ?? []).filter((_, i) => i !== slot);
  return next;
}

export function serializeProfile(profile: InputProfile): string {
  return JSON.stringify(profile);
}

export interface LoadedProfile {
  profile: InputProfile;
  /** Why saved data was ignored or repaired, or null when it loaded cleanly (or was absent). */
  problem: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Copy finite, non-negative numbers (and matching strings) from `source` onto `target`. */
function mergeSettings(target: object, source: unknown): void {
  if (!isRecord(source)) return;
  const t = target as Record<string, unknown>;
  for (const [key, current] of Object.entries(t)) {
    const value = source[key];
    if (isRecord(current)) mergeSettings(current, value);
    else if (typeof current === 'number') {
      if (typeof value === 'number' && Number.isFinite(value) && value >= 0) t[key] = value;
    } else if (key === 'drsMode' && (value === 'toggle' || value === 'hold')) t[key] = value;
  }
}

function loadBindings(source: unknown): BindingMap {
  const defaults = defaultBindings();
  const out = { keyboard: {}, gamepad: {}, touch: {} } as BindingMap;
  for (const device of DEVICE_KINDS) {
    const saved = isRecord(source) ? source[device] : undefined;
    const used = new Set<string>();
    for (const action of ACTIONS) {
      const raw = isRecord(saved) && action in saved ? saved[action] : defaults[device][action];
      const list = Array.isArray(raw) ? raw : [];
      const kept: ControlId[] = [];
      for (const control of list) {
        if (deviceOfControl(control) !== device) continue;
        const key = `${contextOf(action)} ${control as string}`;
        if (used.has(key) || kept.length >= MAX_SLOTS) continue;
        used.add(key);
        kept.push(control as string);
      }
      out[device][action] = kept;
    }
  }
  return out;
}

/** Parse a saved profile. Anything unusable falls back to defaults; it never throws. */
export function deserializeProfile(text: string | null | undefined): LoadedProfile {
  try {
    return parseProfile(text);
  } catch {
    // Defence in depth: no saved data may stop the game.
    return { profile: defaultProfile(), problem: 'Saved controls could not be read' };
  }
}

function parseProfile(text: string | null | undefined): LoadedProfile {
  if (text === null || text === undefined || text === '') {
    return { profile: defaultProfile(), problem: null };
  }
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { profile: defaultProfile(), problem: 'Saved controls could not be parsed' };
  }
  if (!isRecord(data))
    return { profile: defaultProfile(), problem: 'Saved controls are not an object' };
  if (data.version !== PROFILE_VERSION) {
    // Never format an arbitrary value: an object with a broken toString would throw here.
    const problem =
      typeof data.version === 'number' && Number.isFinite(data.version)
        ? `Saved controls are version ${data.version}; expected ${PROFILE_VERSION}`
        : 'Saved controls have an invalid version';
    return { profile: defaultProfile(), problem };
  }
  const shaping = defaultShaping();
  mergeSettings(shaping, data.shaping);
  return {
    profile: { version: PROFILE_VERSION, bindings: loadBindings(data.bindings), shaping },
    problem: null,
  };
}
