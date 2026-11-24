/**
 * Rebinding rules for the Settings screen, kept apart from the DOM so they are tested directly.
 * A control bound to one action is taken off any other action in the same context (the input
 * layer's `rebind`); the player is told what moved and what was left with nothing. Pause is the
 * one action that may not be left unbound: without it a keyboard or pad player could not leave a
 * session to fix the bindings.
 */
import {
  ANALOG_ACTIONS,
  DRIVING_BUTTONS,
  clearBinding,
  controlLabel,
  controlsFor,
  rebind,
  type ActionId,
  type BindingMap,
  type ControlId,
  type DeviceKind,
} from '@undercut/input';
import { S } from '../strings';

/**
 * The actions a player can rebind: every driving action the input layer has (the analog
 * half-axes, then the driving buttons), so a new one appears here as soon as the input package
 * gains it.
 */
export const REBINDABLE: readonly ActionId[] = [...ANALOG_ACTIONS, ...DRIVING_BUTTONS];

/** Actions that must keep a control. */
const REQUIRED: ReadonlySet<ActionId> = new Set<ActionId>(['pause']);

export type RebindOutcome =
  | {
      kind: 'done';
      map: BindingMap;
      action: ActionId;
      slot: number;
      message: string;
      /** Other actions this change left with no control on the device. */
      newlyUnbound: ActionId[];
    }
  | { kind: 'refused'; action: ActionId; slot: number; message: string };

/** An action's name: its label, or its id in words ("boxThisLap" reads "Box this lap"). */
export function actionName(a: ActionId): string {
  const label = S.settings.actions[a];
  if (label) return label;
  const words = a.replace(/([A-Z])/g, ' $1').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
const name = actionName;

/** Rebindable actions with no control on `device`. */
export function unboundActions(map: BindingMap, device: DeviceKind): ActionId[] {
  return REBINDABLE.filter((a) => controlsFor(map, device, a).length === 0);
}

/**
 * Put `control` in `slot` of `action` on `device`, or clear the slot when `control` is null.
 * Refused when it would leave a required action with nothing.
 */
export function rebindSlot(
  map: BindingMap,
  device: DeviceKind,
  action: ActionId,
  slot: number,
  control: ControlId | null,
): RebindOutcome {
  const before = new Set(unboundActions(map, device));
  let next: BindingMap;
  let message: string;
  if (control === null) {
    next = clearBinding(map, device, action, slot);
    message = S.settings.cleared(name(action));
  } else {
    const r = rebind(map, device, action, slot, control);
    next = r.map;
    message = S.settings.bound(controlLabel(control), name(action));
    const from = r.displaced.map((d) => name(d.action));
    if (from.length > 0) message += ` ${S.settings.moved(from.join(', '))}`;
  }
  const after = unboundActions(next, device);
  for (const a of after) {
    if (REQUIRED.has(a)) {
      return {
        kind: 'refused',
        action,
        slot,
        message: S.settings.required(name(a)),
      };
    }
  }
  return {
    kind: 'done',
    map: next,
    action,
    slot,
    message,
    newlyUnbound: after.filter((a) => !before.has(a)),
  };
}
