import {
  controlLabel,
  controlsFor,
  parsePadControl,
  type ActionId,
  type BindingMap,
  type ControlId,
  type DeviceKind,
} from '@undercut/input';
import { el } from './dom';
import { button, tabStrip, type TabStrip } from './kit/components';
import { faceGlyph, padFace } from './kit/glyph';
import { focusables, navigate, type NavAction } from './kit/nav';
import { S } from './strings';

export interface ControlRow {
  id: string;
  action: string;
  /** Everything bound, as text ("S or Down arrow"); also the row's accessible name. */
  input: string;
  /**
   * The bound controls, one entry per alternative: one control, or for steering the left and
   * right pair. Empty when nothing is bound on the device.
   */
  slots: ControlId[][];
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
  { id: 'boxThisLap', label: 'Box this lap / cancel', actions: ['boxThisLap'] },
  { id: 'nextCompound', label: 'Next tyre compound', actions: ['nextCompound'] },
  { id: 'pitLimiter', label: R.pitLimiter, actions: ['pitLimiter'] },
  { id: 'camera', label: R.camera, actions: ['nextCamera'] },
  { id: 'lookBack', label: R.lookBack, actions: ['lookBack'] },
  { id: 'resetToTrack', label: R.resetToTrack, actions: ['resetToTrack'] },
  { id: 'pause', label: R.pause, actions: ['pause'] },
];

export const DEVICE_NAMES: Readonly<Record<DeviceKind, string>> = S.menu.deviceNames;

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

/** Steering's binding slots: the n-th left control with the n-th right one. */
function steerSlots(map: BindingMap, device: DeviceKind): ControlId[][] {
  const left = controlsFor(map, device, 'steerLeft');
  const right = controlsFor(map, device, 'steerRight');
  const slots: ControlId[][] = [];
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    slots.push([left[i], right[i]].filter((c): c is ControlId => c !== undefined));
  }
  return slots;
}

/** Action and input rows for `device`, read from the live binding map. */
export function controlRows(map: BindingMap, device: DeviceKind): ControlRow[] {
  return ROWS.map(({ id, label, actions }) => {
    if (id === 'steer') {
      return { id, action: label, input: steerLabel(map, device), slots: steerSlots(map, device) };
    }
    const action = actions[0] as ActionId;
    let input = inputLabel(map, device, action);
    if (input === NOT_BOUND) input = ELSEWHERE[action] ?? NOT_BOUND;
    return { id, action: label, input, slots: controlsFor(map, device, action).map((c) => [c]) };
  });
}

/** What the panel needs to know about the devices on this machine. */
export interface DevicePresence {
  /** A touch screen (phones, tablets). */
  touch: boolean;
  /** Devices used since the page opened. */
  used: ReadonlySet<DeviceKind>;
}

/**
 * The devices the controls list has a tab for, in a fixed order. The controller is always
 * listed (with a note while none is connected), so its bindings can be read before plugging one
 * in. Touch is listed on touch screens; the keyboard everywhere except on a touch screen that has
 * never had a key pressed. The device in use is always listed.
 */
export function controlsTabs(active: DeviceKind, presence: DevicePresence): DeviceKind[] {
  const has = (d: DeviceKind): boolean => d === active || presence.used.has(d);
  const list: DeviceKind[] = [];
  if (!presence.touch || has('keyboard')) list.push('keyboard');
  list.push('gamepad');
  if (presence.touch || has('touch')) list.push('touch');
  return list;
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
  /** The device in use. */
  device(): DeviceKind;
  /** A controller is connected now. */
  padConnected?(): boolean;
  /** The screen takes touch. */
  touchCapable?(): boolean;
}

/** Pad controls drawn as their button glyphs; sticks and the D-pad keep a word beside them. */
function padSlot(slot: readonly ControlId[]): Node[] {
  const nodes: Node[] = [];
  const axes = slot.map(parsePadControl).filter((p) => p?.kind === 'axis');
  if (axes.length === slot.length && slot.length > 0) {
    // One stick (or one stick direction): the stick glyph and its name.
    const names = slot.map(controlLabel);
    const text = names.length === 2 ? pairLabel(names[0] as string, names[1] as string) : names[0];
    nodes.push(faceGlyph(padFace(slot[0] as ControlId), 'controls__glyph'));
    nodes.push(el('span', 'controls__word', capitalise(text ?? '')));
    return nodes;
  }
  slot.forEach((c, i) => {
    if (i > 0) nodes.push(el('span', 'controls__sep', '/'));
    const face = padFace(c);
    if (face.shape === 'none') nodes.push(el('span', 'controls__word', controlLabel(c)));
    else nodes.push(faceGlyph(face, 'controls__glyph'));
  });
  return nodes;
}

/**
 * The controls list: a dialog of the interface kit over the pause menu or the main menu, with a
 * tab per input device. It opens on the device in use and follows it: using another device while
 * it is open switches to that device's tab. Rows are rebuilt from the live bindings. While it is
 * open everything beside it is inert, so Tab, pointer and menu navigation (it is a navigation
 * scope) stay in it; the shoulder buttons (Q and E) step the tabs, and Esc, B or the pause
 * button close it.
 */
export class ControlsPanel {
  readonly root: HTMLElement;
  private readonly head: HTMLElement;
  private readonly list: HTMLElement;
  private readonly note: HTMLElement;
  private readonly padNote: HTMLElement;
  private readonly body: HTMLElement;
  private readonly close: HTMLButtonElement;
  private tabs: TabStrip | null = null;
  private tabIds = '';
  /** The tab shown. */
  private view: DeviceKind = 'keyboard';
  /** The device in use when last looked at, to follow a change. */
  private active: DeviceKind = 'keyboard';
  private readonly used = new Set<DeviceKind>();
  /**
   * Set while the frame that switched to the device in use is handled: that device's first
   * press both picks its tab and arrives as an action, and a shoulder button should not then
   * step on past it.
   */
  private followed = false;
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
    this.head = el('header', 'dialog__head controls__head');
    const title = el('h2', 'dialog__title', S.controls.title);
    title.id = 'controls-title';
    this.head.append(title);

    const body = el('div', 'dialog__body');
    this.body = body;
    body.id = 'controls-body';
    body.setAttribute('role', 'tabpanel');
    this.padNote = el('p', 'controls__pad-note', S.controls.noPad);
    this.padNote.dataset.testid = 'controls-no-pad';
    this.list = el('dl', 'controls__list');
    this.note = el('p', 'controls__note');
    body.append(this.padNote, this.list, this.note);

    this.close = button({
      label: S.menu.back,
      glyph: 'menuBack',
      action: 'close-controls',
      onClick: () => this.hide(),
    });
    this.close.dataset.navDefault = '';
    // Tab and Shift+Tab cycle through the dialog's own stops: the selected tab (the tab strip
    // is one stop; the arrows move along it) and Back.
    root.addEventListener('keydown', (e) => {
      if (e.key !== 'Tab') return;
      e.preventDefault();
      const items = focusables(root).filter((x) => x.tabIndex >= 0);
      const at = items.indexOf(document.activeElement as HTMLElement);
      const next = items[(at + (e.shiftKey ? -1 : 1) + items.length) % items.length];
      (next ?? this.close).focus({ preventScroll: true });
    });
    root.addEventListener('pointerdown', (e) => {
      if (e.target === root) this.hide();
    });
    const foot = el('footer', 'dialog__foot');
    foot.append(this.close);

    card.append(this.head, body, foot);
    root.append(card);
  }

  get open(): boolean {
    return !this.root.hidden;
  }

  /** The device whose controls are listed. */
  get shown(): DeviceKind {
    return this.view;
  }

  /**
   * Menu actions while the panel is open: Back closes it, the shoulder buttons step the tabs,
   * and the rest move focus inside it (accept presses the focused tab or Back). Returns false
   * when the panel is closed.
   */
  handle(action: NavAction, nativeAccept = false): boolean {
    if (!this.open) return false;
    if (action === 'menuBack') this.hide();
    else if (action === 'menuTabPrev' || action === 'menuTabNext') {
      if (!this.followed) this.tabs?.step(action === 'menuTabPrev' ? -1 : 1);
    } else navigate(this.root, action, nativeAccept);
    return true;
  }

  /**
   * Menu accept from a gamepad (a keyboard Enter is already a native click): press the focused
   * control inside the panel. Returns true when the panel was open and took it.
   */
  accept(): boolean {
    return this.handle('menuAccept');
  }

  /** Follow the device in use: call when it may have changed. Switches tab when it did. */
  sync(): void {
    if (!this.open) return;
    const device = this.source.device();
    if (device === this.active) return;
    this.active = device;
    this.used.add(device);
    this.view = device;
    this.render();
    this.followed = true;
    queueMicrotask(() => {
      this.followed = false;
    });
  }

  show(): void {
    this.active = this.source.device();
    this.used.add(this.active);
    this.view = this.active;
    this.render();
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
    window.addEventListener('gamepadconnected', this.onPadChange);
    window.addEventListener('gamepaddisconnected', this.onPadChange);
    this.close.focus({ preventScroll: true });
  }

  /**
   * A controller plugged in or out: redraw (the no-controller note) once the input layer has
   * polled the change, a couple of frames on.
   */
  private readonly onPadChange = (): void => {
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (this.open) this.render();
      }),
    );
  };

  hide(): void {
    if (!this.open) return;
    this.root.hidden = true;
    window.removeEventListener('gamepadconnected', this.onPadChange);
    window.removeEventListener('gamepaddisconnected', this.onPadChange);
    for (const c of this.inerted) c.inert = false;
    this.inerted = [];
    this.returnFocus?.focus({ preventScroll: true });
    this.returnFocus = null;
    this.onClose();
  }

  /** Build the tabs (when the set of devices changed) and the rows for the shown device. */
  private render(): void {
    const devices = controlsTabs(this.active, {
      touch: this.source.touchCapable?.() ?? false,
      used: this.used,
    });
    if (!devices.includes(this.view)) this.view = this.active;
    const ids = devices.join(' ');
    if (ids !== this.tabIds || !this.tabs) {
      const focusedTab = this.tabs?.root.contains(document.activeElement) ?? false;
      this.tabs?.root.remove();
      this.tabIds = ids;
      this.tabs = tabStrip({
        label: S.controls.devices,
        tabs: devices.map((d) => ({ id: d, label: DEVICE_NAMES[d] })),
        value: this.view,
        onChange: (id) => {
          this.view = id as DeviceKind;
          this.render();
        },
      });
      this.tabs.root.classList.add('controls__tabs');
      for (const b of this.tabs.root.querySelectorAll<HTMLElement>('[role=tab]')) {
        b.id = `controls-tab-${b.dataset.tab ?? ''}`;
        b.setAttribute('aria-controls', 'controls-body');
      }
      this.head.append(this.tabs.root);
      if (focusedTab) this.close.focus({ preventScroll: true });
    } else {
      this.tabs.select(this.view);
    }
    // One Tab stop for the strip (roving tabindex): the selected tab.
    for (const b of this.tabs.root.querySelectorAll<HTMLElement>('[role=tab]'))
      b.tabIndex = b.dataset.tab === this.view ? 0 : -1;
    this.body.setAttribute('aria-labelledby', `controls-tab-${this.view}`);

    const device = this.view;
    const map = this.source.bindings();
    this.root.dataset.device = device;
    this.padNote.hidden = device !== 'gamepad' || (this.source.padConnected?.() ?? false);
    this.note.textContent = reverseNote(map, device);
    const rows = controlRows(map, device).map((r) => {
      const row = el('div', 'setting controls__row');
      row.dataset.row = r.id;
      const input = el('dd', 'controls__input');
      input.setAttribute('aria-label', r.input);
      if (device === 'gamepad' && r.slots.length > 0) {
        r.slots.forEach((slot, i) => {
          if (i > 0) input.append(el('span', 'controls__or', S.controls.or));
          input.append(...padSlot(slot));
        });
      } else {
        input.textContent = r.input;
        if (r.input === NOT_BOUND) input.classList.add('is-empty');
      }
      row.append(el('dt', 'setting__k', r.action), input);
      return row;
    });
    this.list.replaceChildren(...rows);
  }
}
