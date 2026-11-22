import {
  controlLabel,
  controlsFor,
  type ActionId,
  type BindingMap,
  type DeviceKind,
} from '@undercut/input';
import { el } from './dom';
import { button } from './kit/components';
import { icon, type IconKey } from './kit/icons';
import { S } from './strings';

export interface ControlRow {
  id: string;
  action: string;
  input: string;
}

/** The listed actions, in order. Steering is one row built from its two half-axes. */
const R = S.controls.rows;
const ROWS: { id: string; label: string; actions: ActionId[] }[] = [
  { id: 'steer', label: R.steer, actions: ['steerLeft', 'steerRight'] },
  { id: 'throttle', label: R.throttle, actions: ['throttle'] },
  { id: 'brake', label: R.brake, actions: ['brake'] },
  { id: 'gearUp', label: R.gearUp, actions: ['gearUp'] },
  { id: 'gearDown', label: R.gearDown, actions: ['gearDown'] },
  { id: 'drs', label: R.drs, actions: ['drs'] },
  { id: 'overtake', label: R.overtake, actions: ['overtake'] },
  { id: 'pitLimiter', label: R.pitLimiter, actions: ['pitLimiter'] },
  { id: 'camera', label: R.camera, actions: ['nextCamera'] },
  { id: 'lookBack', label: R.lookBack, actions: ['lookBack'] },
  { id: 'resetToTrack', label: R.resetToTrack, actions: ['resetToTrack'] },
  { id: 'pause', label: R.pause, actions: ['pause'] },
];

export const DEVICE_NAMES: Readonly<Record<DeviceKind, string>> = S.menu.deviceNames;

const DEVICE_ICON: Record<DeviceKind, IconKey> = {
  keyboard: 'keyboard',
  gamepad: 'controls',
  touch: 'touch',
};

/**
 * Where an action with no control on a device can still be reached. The touch overlay has no
 * reset button; the pause menu has one.
 */
const ELSEWHERE: Partial<Record<ActionId, string>> = {
  resetToTrack: S.controls.pauseMenu,
};

const NOT_BOUND = S.controls.notBound;

/** The inputs bound to one action on one device, as the game reads them. */
export function inputLabel(map: BindingMap, device: DeviceKind, action: ActionId): string {
  const controls = controlsFor(map, device, action);
  return controls.length > 0 ? controls.map(controlLabel).join(' or ') : NOT_BOUND;
}

/** The last left or right in a control name: the side, e.g. "Left stick *left*". */
const SIDE = /\b(left|right)\b(?!.*\b(?:left|right)\b)/i;

/**
 * One name for a left and right pair: "A/D", or the shared name when the two differ only by
 * side ("Left arrow" and "Right arrow" read "arrow keys", "Left stick left" and "Left stick
 * right" read "Left stick").
 */
export function pairLabel(left: string, right: string): string {
  const strip = (x: string): string => x.replace(SIDE, '').replace(/\s+/g, ' ').trim();
  const shared = strip(left);
  if (SIDE.test(left) && SIDE.test(right) && shared && shared === strip(right)) {
    return shared.toLowerCase() === 'arrow' ? S.controls.arrowKeys : shared;
  }
  return `${left}/${right}`;
}

function capitalise(x: string): string {
  return x.charAt(0).toUpperCase() + x.slice(1);
}

/** Steering as one entry: each binding slot pairs its left and right control. */
function steerLabel(map: BindingMap, device: DeviceKind): string {
  const left = controlsFor(map, device, 'steerLeft').map(controlLabel);
  const right = controlsFor(map, device, 'steerRight').map(controlLabel);
  const parts: string[] = [];
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const l = left[i];
    const r = right[i];
    if (l && r) parts.push(pairLabel(l, r));
    else if (l) parts.push(S.controls.leftOnly(l));
    else if (r) parts.push(S.controls.rightOnly(r));
  }
  return parts.length > 0 ? capitalise(parts.join(' or ')) : NOT_BOUND;
}

/** Action and input rows for `device`, read from the live binding map. */
export function controlRows(map: BindingMap, device: DeviceKind): ControlRow[] {
  return ROWS.map(({ id, label, actions }) => {
    if (id === 'steer') return { id, action: label, input: steerLabel(map, device) };
    const action = actions[0] as ActionId;
    let input = inputLabel(map, device, action);
    if (input === NOT_BOUND) input = ELSEWHERE[action] ?? NOT_BOUND;
    return { id, action: label, input };
  });
}

/**
 * How reverse works with automatic gears, naming the bound controls. The automatic gearbox in
 * `@undercut/sim` assists passes a downshift through in first below 1 m/s, so at a standstill
 * two downshifts go 1 → N → R and two upshifts come back R → N → 1.
 */
export function reverseNote(map: BindingMap, device: DeviceKind): string {
  const name = (action: ActionId, fallback: string): string => {
    const c = controlsFor(map, device, action)[0];
    return c ? controlLabel(c) : fallback;
  };
  const down = name('gearDown', S.controls.gearDownWord);
  const up = name('gearUp', S.controls.gearUpWord);
  return S.controls.reverse(down, up);
}

/** The short first-drive hint: brake, throttle and how to reach the controls list. */
export function controlsHint(map: BindingMap, device: DeviceKind): string {
  const first = (action: ActionId): string => {
    const c = controlsFor(map, device, action)[0];
    return c ? controlLabel(c) : NOT_BOUND;
  };
  return S.controls.hint(first('brake'), first('throttle'), first('pause'));
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
 * The controls list: a dialog of the interface kit over the pause menu or the main menu. Rows
 * are rebuilt from the live bindings each time it opens. While it is open everything beside it
 * is inert, so Tab, pointer and menu navigation (it is a navigation scope) stay in it; Back is
 * its one control, and Esc, B or the pause button close it.
 */
export class ControlsPanel {
  readonly root: HTMLElement;
  private readonly list: HTMLElement;
  private readonly sub: HTMLElement;
  private readonly note: HTMLElement;
  private readonly close: HTMLButtonElement;
  private returnFocus: HTMLElement | null = null;
  /** Siblings made inert while the panel is open, so focus and pointer stay in the dialog. */
  private inerted: HTMLElement[] = [];

  constructor(
    private readonly source: ControlsSource,
    private readonly onClose: () => void = () => {},
  ) {
    const root = el('div', 'dialog controls');
    root.dataset.testid = 'controls-panel';
    root.dataset.navScope = '';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-labelledby', 'controls-title');
    root.hidden = true;
    this.root = root;

    const card = el('div', 'dialog__card controls__card');
    const head = el('header', 'dialog__head');
    const title = el('h2', 'dialog__title', S.controls.title);
    title.id = 'controls-title';
    this.sub = el('span', 'label controls__device');
    head.append(title, this.sub);

    const body = el('div', 'dialog__body');
    this.list = el('dl', 'controls__list');
    this.note = el('p', 'controls__note');
    body.append(this.list, this.note);

    this.close = button({
      label: S.menu.back,
      glyph: 'menuBack',
      action: 'close-controls',
      onClick: () => this.hide(),
    });
    this.close.dataset.navDefault = '';
    // Back is the dialog's only focusable control: Tab and Shift+Tab stay on it.
    root.addEventListener('keydown', (e) => {
      if (e.key !== 'Tab') return;
      e.preventDefault();
      this.close.focus({ preventScroll: true });
    });
    root.addEventListener('pointerdown', (e) => {
      if (e.target === root) this.hide();
    });
    const foot = el('footer', 'dialog__foot');
    foot.append(this.close);

    card.append(head, body, foot);
    root.append(card);
  }

  /**
   * Menu accept from a gamepad (a keyboard Enter is already a native click): press the focused
   * control inside the panel. Returns true when the panel was open and took it.
   */
  accept(): boolean {
    if (!this.open) return false;
    const active = document.activeElement;
    if (active instanceof HTMLButtonElement && this.root.contains(active)) active.click();
    return true;
  }

  get open(): boolean {
    return !this.root.hidden;
  }

  show(): void {
    const device = this.source.device();
    const map = this.source.bindings();
    this.sub.replaceChildren(icon(DEVICE_ICON[device]), el('span', '', DEVICE_NAMES[device]));
    this.note.textContent = reverseNote(map, device);
    const rows = controlRows(map, device).map((r) => {
      const row = el('div', 'setting controls__row');
      row.dataset.row = r.id;
      const input = el('dd', 'controls__input', r.input);
      if (r.input === NOT_BOUND) input.classList.add('is-empty');
      row.append(el('dt', 'setting__k', r.action), input);
      return row;
    });
    this.list.replaceChildren(...rows);
    this.returnFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.root.hidden = false;
    const parent = this.root.parentElement;
    this.inerted = parent
      ? [...parent.children].filter(
          (c): c is HTMLElement => c instanceof HTMLElement && c !== this.root && !c.inert,
        )
      : [];
    for (const c of this.inerted) c.inert = true;
    this.close.focus({ preventScroll: true });
  }

  hide(): void {
    if (!this.open) return;
    this.root.hidden = true;
    for (const c of this.inerted) c.inert = false;
    this.inerted = [];
    this.returnFocus?.focus({ preventScroll: true });
    this.returnFocus = null;
    this.onClose();
  }
}
