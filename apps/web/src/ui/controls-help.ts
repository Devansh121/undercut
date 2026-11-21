import {
  controlLabel,
  controlsFor,
  type ActionId,
  type BindingMap,
  type DeviceKind,
} from '@undercut/input';
import { el } from './dom';

export interface ControlRow {
  id: string;
  action: string;
  input: string;
}

/** The listed actions, in order. Steering is one row built from its two half-axes. */
const ROWS: { id: string; label: string; actions: ActionId[] }[] = [
  { id: 'steer', label: 'Steer', actions: ['steerLeft', 'steerRight'] },
  { id: 'throttle', label: 'Throttle', actions: ['throttle'] },
  { id: 'brake', label: 'Brake', actions: ['brake'] },
  { id: 'gearUp', label: 'Gear up', actions: ['gearUp'] },
  { id: 'gearDown', label: 'Gear down', actions: ['gearDown'] },
  { id: 'drs', label: 'DRS', actions: ['drs'] },
  { id: 'overtake', label: 'Overtake', actions: ['overtake'] },
  { id: 'pitLimiter', label: 'Pit limiter', actions: ['pitLimiter'] },
  { id: 'camera', label: 'Camera', actions: ['nextCamera'] },
  { id: 'lookBack', label: 'Look back', actions: ['lookBack'] },
  { id: 'resetToTrack', label: 'Reset to track', actions: ['resetToTrack'] },
  { id: 'pause', label: 'Pause', actions: ['pause'] },
];

export const DEVICE_NAMES: Readonly<Record<DeviceKind, string>> = {
  keyboard: 'Keyboard',
  gamepad: 'Gamepad',
  touch: 'Touch',
};

/** Matches the automatic gearbox in `@undercut/sim` assists: 1 → N → R when stopped, and back. */
export const REVERSE_NOTE =
  'With automatic gears, gear down twice at a standstill selects reverse; gear up twice returns to first.';

const NOT_BOUND = 'Not bound';

/** The inputs bound to one action on one device, as the game reads them. */
export function inputLabel(map: BindingMap, device: DeviceKind, action: ActionId): string {
  const controls = controlsFor(map, device, action);
  return controls.length > 0 ? controls.map(controlLabel).join(' or ') : NOT_BOUND;
}

/** Action and input rows for `device`, read from the live binding map. */
export function controlRows(map: BindingMap, device: DeviceKind): ControlRow[] {
  return ROWS.map(({ id, label, actions }) => {
    const parts = actions.map((a) => inputLabel(map, device, a));
    const input = parts.every((p) => p === NOT_BOUND) ? NOT_BOUND : parts.join(' / ');
    return { id, action: label, input };
  });
}

/** The short first-drive hint: brake, throttle and how to reach the controls list. */
export function controlsHint(map: BindingMap, device: DeviceKind): string {
  const first = (action: ActionId): string => {
    const c = controlsFor(map, device, action)[0];
    return c ? controlLabel(c) : NOT_BOUND;
  };
  return `Brake: ${first('brake')} · Throttle: ${first('throttle')} · ${first('pause')}, then Controls for all inputs`;
}

let hintShown = false;
/** True the first time it is called in this page session, false after. */
export function takeFirstStartHint(): boolean {
  if (hintShown) return false;
  hintShown = true;
  return true;
}

export interface ControlsSource {
  bindings(): BindingMap;
  device(): DeviceKind;
}

/**
 * The controls list: a modal over the pause menu or the launch screen, in the pause menu's
 * style. Rows are rebuilt from the live bindings each time it opens.
 */
export class ControlsPanel {
  readonly root: HTMLElement;
  private readonly list: HTMLElement;
  private readonly sub: HTMLElement;
  private readonly close: HTMLButtonElement;
  private returnFocus: HTMLElement | null = null;

  constructor(
    private readonly source: ControlsSource,
    private readonly onClose: () => void = () => {},
  ) {
    const root = el('div', 'pause controls');
    root.dataset.testid = 'controls-panel';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-labelledby', 'controls-title');
    root.hidden = true;
    this.root = root;

    const card = el('div', 'pause__card controls__card');
    const head = el('header', 'pause__head');
    const title = el('h2', 'pause__title', 'Controls');
    title.id = 'controls-title';
    this.sub = el('span', 'label controls__device');
    head.append(title, this.sub);

    this.list = el('dl', 'controls__list');
    const note = el('p', 'controls__note', REVERSE_NOTE);

    this.close = el('button', 'pause__quit');
    this.close.type = 'button';
    this.close.dataset.action = 'close-controls';
    this.close.append(el('span', '', 'Back'));
    this.close.addEventListener('click', () => this.hide());

    card.append(head, this.list, note, this.close);
    root.append(card);
  }

  get open(): boolean {
    return !this.root.hidden;
  }

  show(): void {
    const device = this.source.device();
    this.sub.textContent = DEVICE_NAMES[device];
    const rows = controlRows(this.source.bindings(), device).map((r) => {
      const row = el('div', 'pause__setting controls__row');
      row.dataset.row = r.id;
      row.append(el('dt', 'pause__key', r.action), el('dd', 'controls__input', r.input));
      return row;
    });
    this.list.replaceChildren(...rows);
    this.returnFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.root.hidden = false;
    this.close.focus({ preventScroll: true });
  }

  hide(): void {
    if (!this.open) return;
    this.root.hidden = true;
    this.returnFocus?.focus({ preventScroll: true });
    this.returnFocus = null;
    this.onClose();
  }
}
