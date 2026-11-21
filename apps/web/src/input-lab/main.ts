/**
 * Input lab: a diagnostic page for the input layer. Shows live device state, the ControlInput
 * the game would receive each sim tick, the active device and the bindings, with a working
 * rebind flow. It is the fixture for the browser tests and the seed of the settings screen.
 */
import './lab.css';
import { FixedStepAccumulator, GAME_NAME } from '@undercut/core';
import {
  ACTION_LABELS,
  InputSystem,
  ProfileStore,
  clearBinding,
  controlLabel,
  defaultProfile,
  rebind,
  type ControlInput,
  type DeviceKind,
  type InputProfile,
} from '@undercut/input';
import {
  WebStorageAdapter,
  attachKeyboard,
  mountTouchOverlay,
  navigatorGamepads,
  navigatorRumble,
  type TouchOverlay,
} from '@undercut/input/dom';
import { buildView, describeEvent, renderBindings, type CaptureSlot } from './view';

/** Matches the game loop's sim rate. */
const SIM_STEP = 1 / 240;
const LOG_LENGTH = 12;
const KMH = 3.6;

const mount = document.getElementById('lab');
if (!mount) throw new Error('input-lab.html is missing #lab');

const touchCapable = navigator.maxTouchPoints > 0 || matchMedia('(pointer: coarse)').matches;
const storage = new WebStorageAdapter();
const store = new ProfileStore(storage);
const input = new InputSystem({
  readGamepads: navigatorGamepads(),
  rumble: navigatorRumble(),
  touchCapable,
});
attachKeyboard(input);

const view = buildView(GAME_NAME);
mount.replaceChildren(...view.root.children);

let overlay: TouchOverlay | null = null;
if (touchCapable) {
  document.documentElement.dataset.touch = '';
  overlay = mountTouchOverlay(document.body, input);
}

let tab: DeviceKind = touchCapable ? 'touch' : 'keyboard';
let capture: CaptureSlot | null = null;
let speedKmh = 0;
const counts = { up: 0, down: 0 };
const log: { tick: number; text: string }[] = [];
let tick = 0;

function setNotice(text: string, tone: 'info' | 'warn' = 'info'): void {
  view.notice.textContent = text;
  view.notice.dataset.tone = tone;
}

function drawBindings(): void {
  for (const [kind, el] of Object.entries(view.tabs)) {
    el.setAttribute('aria-selected', String(kind === tab));
  }
  renderBindings(view.binds, input.profile.bindings, tab, capture, (slot) => {
    capture = slot;
    input.startCapture(tab);
    setNotice('Esc cancels. Delete clears the slot.');
    drawBindings();
  });
}

function stopCapture(): void {
  capture = null;
  input.cancelCapture();
  drawBindings();
}

async function apply(profile: InputProfile, message: string): Promise<void> {
  input.setProfile(profile);
  drawBindings();
  const saved = await store.save(profile);
  if (!saved || storage.blocked)
    setNotice(`${message} Storage is blocked, so this lasts until the page closes.`, 'warn');
  else setNotice(message);
}

for (const [kind, el] of Object.entries(view.tabs) as [DeviceKind, HTMLButtonElement][]) {
  el.addEventListener('click', () => {
    if (capture) stopCapture();
    tab = kind;
    setNotice(kind === 'touch' ? 'The touch layout is fixed in this build.' : '');
    drawBindings();
  });
}
view.reset.addEventListener('click', () => {
  if (capture) stopCapture();
  void apply(defaultProfile(), 'Defaults restored.');
});
view.rumble.addEventListener('click', () => input.rumble(0.8, 0.4, 0.3));
view.speed.addEventListener('input', () => {
  speedKmh = Number(view.speed.value);
  view.renderSpeed(speedKmh);
});
// Esc cancels and Delete clears while capturing, whichever device is being captured.
window.addEventListener(
  'keydown',
  (event) => {
    if (!capture) return;
    if (event.code === 'Escape' || event.code === 'Delete') {
      event.preventDefault();
      event.stopImmediatePropagation();
      const slot = capture;
      stopCapture();
      if (event.code === 'Delete') {
        void apply(
          {
            ...input.profile,
            bindings: clearBinding(input.profile.bindings, tab, slot.action, slot.slot),
          },
          'Slot cleared.',
        );
      } else setNotice('');
    }
  },
  { capture: true },
);

function onCaptured(device: DeviceKind, control: string): void {
  const slot = capture;
  capture = null;
  if (!slot || device !== tab) {
    drawBindings();
    return;
  }
  const result = rebind(input.profile.bindings, device, slot.action, slot.slot, control);
  const name = controlLabel(control);
  const moved = result.displaced.map((d) => ACTION_LABELS[d.action]).join(', ');
  void apply(
    { ...input.profile, bindings: result.map },
    moved ? `${name} moved here from ${moved}.` : `${ACTION_LABELS[slot.action]}: ${name}.`,
  );
}

function record(text: string): void {
  log.unshift({ tick, text });
  if (log.length > LOG_LENGTH) log.length = LOG_LENGTH;
  logDirty = true;
}

let logDirty = true;
const clock = new FixedStepAccumulator({ step: SIM_STEP, maxFrameTime: 0.25 });
let last: number | null = null;
let frame = input.sample(0, 0);

function loop(now: number): void {
  const elapsed = last === null ? 0 : (now - last) / 1000;
  last = now;
  const steps = clock.advance(elapsed);
  for (let i = 0; i < steps; i++) {
    tick += 1;
    frame = input.sample(SIM_STEP, speedKmh / KMH);
    if (frame.control.gearShift === 1) counts.up += 1;
    if (frame.control.gearShift === -1) counts.down += 1;
    for (const event of frame.events) {
      if (event.type === 'captured') onCaptured(event.device, event.control);
      else record(describeEvent(event));
    }
  }
  view.renderFrame(frame, input, counts);
  overlay?.update();
  if (logDirty) {
    view.renderLog(log);
    logDirty = false;
  }
  requestAnimationFrame(loop);
}

/** Read-only hook for the browser tests. */
declare global {
  interface Window {
    inputLab?: {
      snapshot(): {
        control: ControlInput;
        device: DeviceKind;
        lookBack: boolean;
        shifts: { up: number; down: number };
        log: string[];
        tick: number;
        pads: string[];
      };
    };
  }
}
window.inputLab = {
  snapshot: () => ({
    control: { ...frame.control },
    device: frame.device,
    lookBack: frame.lookBack,
    shifts: { ...counts },
    log: log.map((e) => e.text),
    tick,
    pads: input.gamepad.connectedIds(),
  }),
};

view.renderSpeed(speedKmh);
setNotice(tab === 'touch' ? 'The touch layout is fixed in this build.' : '');
drawBindings();
void store.load().then(({ profile, problem }) => {
  input.setProfile(profile);
  drawBindings();
  if (problem) setNotice(`${problem}. Using defaults.`, 'warn');
  else if (storage.blocked)
    setNotice('Storage is blocked; changes last until the page closes.', 'warn');
  document.documentElement.dataset.ready = '';
});
requestAnimationFrame(loop);
