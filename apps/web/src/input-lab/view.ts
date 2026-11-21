import {
  ACTION_LABELS,
  DRIVING_BUTTONS,
  ANALOG_ACTIONS,
  MENU_BUTTONS,
  controlLabel,
  controlsFor,
  type ActionId,
  type BindingMap,
  type DeviceKind,
  type InputEvent,
  type InputFrame,
  type InputSystem,
} from '@undercut/input';
import { ICONS, type IconName } from '@undercut/input/dom';

type Attrs = Record<string, string | number | boolean | undefined>;

/** Small element builder. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: (Node | string | null)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) continue;
    if (key === 'class') el.className = String(value);
    else el.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children) if (child !== null) el.append(child);
  return el;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
export function svgIcon(name: IconName): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'lab-icon');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', ICONS[name]);
  svg.append(path);
  return svg;
}

export const DEVICE_NAMES: Record<DeviceKind, string> = {
  keyboard: 'Keyboard',
  gamepad: 'Gamepad',
  touch: 'Touch',
};

const PAD_CELLS = [
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
  'Up',
  'Down',
  'Left',
  'Right',
  'Home',
];

function setOn(el: Element, on: boolean): void {
  if (on) el.setAttribute('data-on', '');
  else el.removeAttribute('data-on');
}

function setText(el: Element, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}

const pct = (v: number): string => `${Math.round(v * 100)}`;

/** Describe an input event in plain words for the log. */
export function describeEvent(event: InputEvent): string {
  switch (event.type) {
    case 'action':
      return ACTION_LABELS[event.action];
    case 'activeDevice':
      return `Active device: ${DEVICE_NAMES[event.device]}`;
    case 'connected':
      return `Gamepad connected: ${event.id}`;
    case 'disconnected':
      return `Gamepad disconnected: ${event.id}`;
    case 'captured':
      return `Captured ${controlLabel(event.control)}`;
  }
}

export interface LabView {
  root: HTMLElement;
  speed: HTMLInputElement;
  rumble: HTMLButtonElement;
  reset: HTMLButtonElement;
  tabs: Record<DeviceKind, HTMLButtonElement>;
  binds: HTMLElement;
  notice: HTMLElement;
  renderFrame(frame: InputFrame, input: InputSystem, counts: { up: number; down: number }): void;
  renderLog(entries: readonly { tick: number; text: string }[]): void;
  renderSpeed(speed: number): void;
}

export function buildView(gameName: string): LabView {
  // Header
  const deviceIcon = h('span', { class: 'lab-device__icon' });
  const deviceName = h('strong', { 'data-field': 'device' }, 'Keyboard');
  const head = h(
    'header',
    { class: 'lab-head' },
    h(
      'div',
      { class: 'lab-head__title' },
      h('span', { class: 'lab-wordmark' }, gameName),
      h('h1', {}, 'Input lab'),
    ),
    h(
      'div',
      { class: 'lab-device', 'aria-live': 'polite' },
      deviceIcon,
      h('span', { class: 'label' }, 'Active'),
      deviceName,
    ),
  );

  // Output
  const meter = (
    label: string,
    field: string,
    kind: string,
  ): [HTMLElement, HTMLElement, HTMLElement] => {
    const fill = h('i');
    const value = h('span', { class: 'meter__value num', 'data-field': field }, '0');
    const row = h(
      'div',
      { class: 'meter' },
      h('span', { class: 'label' }, label),
      h('div', { class: `bar bar--${kind}` }, fill),
      value,
    );
    return [row, fill, value];
  };
  const [steerRow, steerFill, steerValue] = meter('Steer', 'steer', 'steer');
  const [throttleRow, throttleFill, throttleValue] = meter('Throttle', 'throttle', 'throttle');
  const [brakeRow, brakeFill, brakeValue] = meter('Brake', 'brake', 'brake');
  const upCount = h('b', { class: 'num', 'data-field': 'shift-up' }, '0');
  const downCount = h('b', { class: 'num', 'data-field': 'shift-down' }, '0');
  const states = {
    drs: h('span', { class: 'state state--drs', 'data-field': 'drs' }, 'DRS'),
    overtake: h('span', { class: 'state state--ovt', 'data-field': 'overtake' }, 'OVT'),
    pitLimiter: h('span', { class: 'state', 'data-field': 'pit-limiter' }, 'Limiter'),
    lookBack: h('span', { class: 'state', 'data-field': 'look-back' }, 'Look back'),
  };
  const speed = h('input', {
    class: 'range',
    type: 'range',
    min: 0,
    max: 340,
    step: 5,
    value: 0,
    'aria-label': 'Car speed',
  });
  const speedOut = h('output', { class: 'num' });
  const output = h(
    'section',
    { class: 'panel panel--output', 'aria-label': 'Driver demand' },
    h(
      'div',
      { class: 'panel__head' },
      h('h2', {}, 'Driver demand'),
      h('span', { class: 'label' }, 'Per sim tick'),
    ),
    h(
      'div',
      { class: 'panel__body' },
      steerRow,
      throttleRow,
      brakeRow,
      h(
        'div',
        { class: 'facts' },
        h('div', { class: 'fact' }, h('span', { class: 'label' }, 'Gear up'), upCount),
        h('div', { class: 'fact' }, h('span', { class: 'label' }, 'Gear down'), downCount),
      ),
      h(
        'div',
        { class: 'states' },
        states.drs,
        states.overtake,
        states.pitLimiter,
        states.lookBack,
      ),
      h('div', { class: 'speed' }, h('span', { class: 'label' }, 'Car speed'), speed, speedOut),
    ),
  );

  const log = h('ol', { class: 'events', 'data-field': 'events' });
  const events = h(
    'section',
    { class: 'panel panel--fill panel--events', 'aria-label': 'Events' },
    h(
      'div',
      { class: 'panel__head' },
      h('h2', {}, 'Events'),
      h('span', { class: 'label' }, 'Latest first'),
    ),
    log,
  );

  // Devices
  const device = (
    kind: DeviceKind,
    icon: IconName,
    ...body: HTMLElement[]
  ): [HTMLElement, HTMLElement] => {
    const status = h('span', { class: 'device__status', 'data-field': `${kind}-status` });
    const el = h(
      'div',
      { class: 'device', 'data-device': kind },
      h('div', { class: 'device__head' }, svgIcon(icon), h('h3', {}, DEVICE_NAMES[kind]), status),
      ...body,
    );
    return [el, status];
  };
  const keys = h('div', { class: 'keys', 'data-field': 'keys' });
  const [keyboardEl, keyboardStatus] = device('keyboard', 'keyboard', keys);

  const leftDot = h('i');
  const rightDot = h('i');
  const trigger = (name: string, field: string): [HTMLElement, HTMLElement, HTMLElement] => {
    const fill = h('i');
    const value = h('span', { class: 'num', 'data-field': field }, '0');
    return [
      h(
        'div',
        { class: 'trigger' },
        h('span', { class: 'label' }, name),
        h('div', { class: 'bar' }, fill),
        value,
      ),
      fill,
      value,
    ];
  };
  const [ltRow, ltFill, ltValue] = trigger('LT', 'lt');
  const [rtRow, rtFill, rtValue] = trigger('RT', 'rt');
  const cells = PAD_CELLS.map((name) => h('span', {}, name));
  const rumble = h('button', { class: 'lab-btn', type: 'button' }, 'Test rumble');
  const padBody = h(
    'div',
    { class: 'device__pad' },
    h(
      'div',
      { class: 'pad' },
      h('div', { class: 'stick', 'aria-label': 'Left stick' }, leftDot),
      h('div', { class: 'stick', 'aria-label': 'Right stick' }, rightDot),
      h('div', { class: 'triggers' }, ltRow, rtRow),
    ),
  );
  const buttonsRow = h('div', { class: 'buttons' }, ...cells);
  const [gamepadEl, gamepadStatus] = device(
    'gamepad',
    'gamepad',
    padBody,
    buttonsRow,
    h('div', {}, rumble),
  );
  const touchNote = h('span', { class: 'muted', 'data-field': 'touch-note' });
  const [touchEl, touchStatus] = device('touch', 'touch', touchNote);
  const devices = h(
    'section',
    { class: 'panel', 'aria-label': 'Devices' },
    h(
      'div',
      { class: 'panel__head' },
      h('h2', {}, 'Devices'),
      h('span', { class: 'label' }, 'Raw state'),
    ),
    h('div', { class: 'panel__body' }, keyboardEl, gamepadEl, touchEl),
  );

  // Bindings
  const tab = (kind: DeviceKind): HTMLButtonElement =>
    h(
      'button',
      { class: 'tab', type: 'button', role: 'tab', 'data-tab': kind },
      DEVICE_NAMES[kind],
    );
  const tabs = { keyboard: tab('keyboard'), gamepad: tab('gamepad'), touch: tab('touch') };
  const binds = h('div', { class: 'binds', role: 'tabpanel' });
  const notice = h('span', { class: 'notice', 'data-field': 'notice', 'aria-live': 'polite' });
  const reset = h('button', { class: 'lab-btn', type: 'button' }, 'Reset to defaults');
  const bindings = h(
    'section',
    { class: 'panel panel--fill', 'aria-label': 'Controls' },
    h(
      'div',
      { class: 'panel__head' },
      h('h2', {}, 'Controls'),
      h('span', { class: 'label' }, 'Select a slot to rebind'),
    ),
    h('div', { class: 'tabs', role: 'tablist' }, tabs.keyboard, tabs.gamepad, tabs.touch),
    binds,
    h('div', { class: 'binds-foot' }, notice, reset),
  );

  const root = h(
    'div',
    { class: 'lab-root' },
    head,
    h(
      'main',
      { class: 'lab-grid' },
      h('div', { class: 'lab-col lab-col--output' }, output, events),
      h('div', { class: 'lab-col lab-col--devices' }, devices),
      h('div', { class: 'lab-col lab-col--binds' }, bindings),
    ),
  );

  let lastDevice: DeviceKind | null = null;
  const deviceEls = { keyboard: keyboardEl, gamepad: gamepadEl, touch: touchEl };

  return {
    root,
    speed,
    rumble,
    reset,
    tabs,
    binds,
    notice,
    renderSpeed(value) {
      speedOut.replaceChildren(String(value), h('small', {}, 'km/h'));
    },
    renderFrame(frame, input, counts) {
      const c = frame.control;
      if (frame.device !== lastDevice) {
        lastDevice = frame.device;
        setText(deviceName, DEVICE_NAMES[frame.device]);
        deviceIcon.replaceChildren(svgIcon(frame.device));
        for (const kind of ['keyboard', 'gamepad', 'touch'] as const) {
          if (kind === frame.device) deviceEls[kind].setAttribute('data-active', '');
          else deviceEls[kind].removeAttribute('data-active');
        }
      }
      // Positive steer is left: draw it growing to the left of centre.
      steerFill.style.transform = `scaleX(${-c.steer})`;
      setText(
        steerValue,
        c.steer === 0 ? '0' : `${pct(Math.abs(c.steer))} ${c.steer > 0 ? 'L' : 'R'}`,
      );
      throttleFill.style.transform = `scaleX(${c.throttle})`;
      setText(throttleValue, `${pct(c.throttle)} %`);
      brakeFill.style.transform = `scaleX(${c.brake})`;
      setText(brakeValue, `${pct(c.brake)} %`);
      setText(upCount, String(counts.up));
      setText(downCount, String(counts.down));
      setOn(states.drs, c.drs);
      setOn(states.overtake, c.overtake);
      setOn(states.pitLimiter, c.pitLimiter);
      setOn(states.lookBack, frame.lookBack);

      // Keyboard
      const held = input.keyboard.heldCodes();
      const keyText = held.join(' ');
      if (keys.dataset.held !== keyText) {
        keys.dataset.held = keyText;
        keys.replaceChildren(
          ...(held.length
            ? held.map((code) => h('span', { class: 'keycap' }, controlLabel(`key:${code}`)))
            : [h('span', { class: 'muted' }, 'No keys held')]),
        );
      }
      setText(keyboardStatus, held.length ? `${held.length} held` : 'Ready');

      // Gamepad
      const pad = input.gamepad.activePad;
      const ids = input.gamepad.connectedIds();
      setText(gamepadStatus, pad ? pad.id : 'Not connected');
      gamepadEl.toggleAttribute('data-connected', pad !== null);
      const ax = (i: number): number => input.gamepad.rawAxis(i);
      leftDot.style.transform = `translate(${ax(0) * 26}px, ${ax(1) * 26}px)`;
      rightDot.style.transform = `translate(${ax(2) * 26}px, ${ax(3) * 26}px)`;
      const lt = input.gamepad.rawButton(6);
      const rt = input.gamepad.rawButton(7);
      ltFill.style.transform = `scaleX(${lt})`;
      rtFill.style.transform = `scaleX(${rt})`;
      setText(ltValue, `${pct(lt)} %`);
      setText(rtValue, `${pct(rt)} %`);
      cells.forEach((cell, i) => setOn(cell, input.gamepad.rawButton(i) > 0.5));
      rumble.disabled = pad === null;
      gamepadEl.dataset.count = String(ids.length);

      // Touch
      const touch = input.touch;
      if (touch.connected) {
        setText(touchStatus, 'Overlay on');
        const n = touch.activePointers();
        setText(
          touchNote,
          n === 0 ? 'No fingers down' : n === 1 ? '1 finger down' : `${n} fingers down`,
        );
      } else {
        setText(touchStatus, 'Not available');
        setText(touchNote, 'The touch overlay appears on touch screens.');
      }
    },
    renderLog(entries) {
      if (entries.length === 0) {
        log.replaceChildren(
          h(
            'li',
            { class: 'events__empty' },
            'Nothing yet. Press a camera, pause or menu control.',
          ),
        );
        return;
      }
      log.replaceChildren(
        ...entries.map((e) =>
          h('li', {}, h('span', { class: 'num' }, `#${e.tick}`), h('span', {}, e.text)),
        ),
      );
    },
  };
}

export interface CaptureSlot {
  action: ActionId;
  slot: number;
}

const GROUPS: { title: string; actions: readonly ActionId[] }[] = [
  { title: 'Driving', actions: [...ANALOG_ACTIONS, ...DRIVING_BUTTONS] },
  { title: 'Menus', actions: MENU_BUTTONS },
];

const PROMPT: Record<DeviceKind, string> = {
  keyboard: 'Press a key',
  gamepad: 'Press or move',
  touch: 'Tap a control',
};

/** Render the binding rows for one device. */
export function renderBindings(
  container: HTMLElement,
  map: BindingMap,
  device: DeviceKind,
  capture: CaptureSlot | null,
  onSlot: (slot: CaptureSlot) => void,
): void {
  const editable = device !== 'touch';
  const rows: HTMLElement[] = [];
  for (const group of GROUPS) {
    rows.push(h('h4', { class: 'label' }, group.title));
    for (const action of group.actions) {
      const controls = controlsFor(map, device, action);
      if (!editable && controls.length === 0) continue;
      const slots = [0, 1].map((slot) => {
        const control = controls[slot];
        const capturing = capture?.action === action && capture.slot === slot;
        const button = h(
          'button',
          {
            class: 'slot',
            type: 'button',
            'data-action': action,
            'data-slot': slot,
            'data-empty': control === undefined && !capturing,
            'data-capturing': capturing,
            disabled: !editable,
            'aria-label': `${ACTION_LABELS[action]}, slot ${slot + 1}`,
          },
          capturing ? PROMPT[device] : control !== undefined ? controlLabel(control) : 'Not set',
        );
        if (editable) button.addEventListener('click', () => onSlot({ action, slot }));
        return button;
      });
      rows.push(
        h(
          'div',
          { class: 'bind', 'data-bind': action },
          h('span', {}, ACTION_LABELS[action]),
          ...slots,
        ),
      );
    }
  }
  container.replaceChildren(...rows);
}
