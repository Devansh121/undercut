/**
 * Settings: controls (rebinding per device, touch layout), assists per device, accessibility,
 * display, audio and graphics, in sections on a tab strip (the shoulder buttons, Q and E, step
 * them). Every value is saved on the device as it changes: bindings in the input profile, the rest
 * in the menu prefs, the audio and graphics stores. Pointer, touch, keyboard and pad all work; a
 * rebinding waits for the next press on the device being bound.
 */
import {
  controlLabel,
  controlsFor,
  defaultBindings,
  parsePadControl,
  type ActionId,
  type ControlId,
  type DeviceKind,
  type InputProfile,
} from '@undercut/input';
import { applyPlayerSettings } from '../apply-settings';
import { el } from '../dom';
import type { AssistChoice, PlayerSettings, PrefsStore } from '../data/prefs';
import {
  button,
  segmented,
  settingRow,
  slider,
  tabStrip,
  toggle,
  type Control,
  type TabStrip,
} from '../kit/components';
import { faceGlyph, padFace } from '../kit/glyph';
import type { NavAction } from '../kit/nav';
import type { Screen } from '../shell';
import { S } from '../strings';
import { effectiveAssists } from './session-settings';
import { rebindSlot, unboundActions, REBINDABLE, type RebindOutcome } from './settings-model';

const T = S.settings;

export type SectionId = 'controls' | 'assists' | 'accessibility' | 'display' | 'audio' | 'graphics';
const SECTIONS: readonly SectionId[] = [
  'controls',
  'assists',
  'accessibility',
  'display',
  'audio',
  'graphics',
];

export type VolumeKey = 'master' | 'engine' | 'effects' | 'ui' | 'ambience';
const VOLUMES: readonly VolumeKey[] = ['master', 'engine', 'effects', 'ui', 'ambience'];

export type GraphicsChoice = 'auto' | 'ultra' | 'high' | 'medium' | 'mobile';
const GRAPHICS: readonly GraphicsChoice[] = ['auto', 'ultra', 'high', 'medium', 'mobile'];

/** Steering travel on touch: finger distance to full lock, px. */
const TRAVEL = { short: 40, standard: 56, long: 72 } as const;
type Travel = keyof typeof TRAVEL;

/** How long a pad rebinding waits for a press (the pad cannot reach Cancel while it waits). */
const PAD_CAPTURE_MS = 5000;

export interface SettingsDeps {
  prefs: PrefsStore;
  /** The live input profile and the device in use. */
  profile(): InputProfile;
  device(): DeviceKind;
  /** Use and save a changed profile. Resolves false when it could not be saved. */
  setProfile(profile: InputProfile): Promise<boolean>;
  startCapture(device: DeviceKind): void;
  cancelCapture(): void;
  volume(key: VolumeKey): number;
  setVolume(key: VolumeKey, value: number): void;
  graphics(): GraphicsChoice;
  setGraphics(value: GraphicsChoice): void;
  units(): 'kmh' | 'mph';
  setUnits(value: 'kmh' | 'mph'): void;
  /** A touch screen: the touch tab and layout are offered. */
  touch: boolean;
  /** The page root the display settings are applied to. */
  page: HTMLElement;
  onCredits(): void;
  onBack(): void;
}

interface Capture {
  device: DeviceKind;
  action: ActionId;
  slot: number;
  timer: ReturnType<typeof setTimeout> | null;
}

/** A pad control as drawn in a slot: its glyph, and the word for sticks. */
function padNodes(control: ControlId): Node[] {
  const face = padFace(control);
  const nodes: Node[] = [];
  if (face.shape !== 'none') nodes.push(faceGlyph(face, 'binds__glyph'));
  const pad = parsePadControl(control);
  if (pad?.kind === 'axis' || face.shape === 'none')
    nodes.push(el('span', 'binds__word', controlLabel(control)));
  return nodes;
}

export class SettingsScreen implements Screen {
  readonly id = 'settings';
  readonly crumb = T.title;
  readonly root: HTMLElement;
  private readonly tabs: TabStrip;
  private readonly panes = new Map<SectionId, HTMLElement>();
  private section: SectionId = 'controls';
  private readonly devices: DeviceKind[];
  private bindDevice: DeviceKind = 'keyboard';
  private assistDevice: DeviceKind = 'keyboard';
  private capture: Capture | null = null;
  private readonly notice: HTMLElement;
  private readonly bindsHost: HTMLElement;
  private readonly bindDeviceSeg: Control<DeviceKind>;
  private readonly assistsHost: HTMLElement;
  private readonly assistDeviceSeg: Control<DeviceKind>;
  /** Re-read every control from the stores (after a reset, or entering again). */
  private readonly syncers: (() => void)[] = [];

  constructor(private readonly deps: SettingsDeps) {
    this.devices = deps.touch ? ['keyboard', 'gamepad', 'touch'] : ['keyboard', 'gamepad'];
    const root = el('div', 'screen settings-screen');
    root.dataset.testid = 'settings';
    this.root = root;

    this.tabs = tabStrip({
      label: T.sections,
      tabs: SECTIONS.map((id) => ({ id, label: T.section[id] })),
      value: this.section,
      onChange: (id) => this.show(id as SectionId),
    });
    this.tabs.root.classList.add('settings-screen__tabs');
    for (const b of this.tabs.root.querySelectorAll<HTMLElement>('[role=tab]')) {
      b.id = `settings-tab-${b.dataset.tab ?? ''}`;
      b.setAttribute('aria-controls', `settings-pane-${b.dataset.tab ?? ''}`);
    }

    const body = el('div', 'settings-screen__body');
    const pane = (id: SectionId): HTMLElement => {
      const p = el('section', 'card settings-pane');
      p.id = `settings-pane-${id}`;
      p.dataset.section = id;
      p.setAttribute('role', 'tabpanel');
      p.setAttribute('aria-labelledby', `settings-tab-${id}`);
      this.panes.set(id, p);
      body.append(p);
      return p;
    };

    // ---- Controls
    const controls = pane('controls');
    this.notice = el('p', 'settings__notice');
    this.notice.setAttribute('role', 'status');
    this.notice.setAttribute('aria-live', 'polite');
    this.bindDeviceSeg = segmented<DeviceKind>({
      label: T.device,
      id: 'bindDevice',
      choices: this.devices.map((d) => ({ value: d, label: S.menu.deviceNames[d] })),
      value: this.bindDevice,
      onChange: (d) => {
        this.cancelCapture();
        this.bindDevice = d;
        this.notice.textContent = '';
        this.renderBinds();
      },
    });
    this.bindsHost = el('div', 'settings__binds');
    // The status line sits above the list, in view while a long list scrolls.
    controls.append(settingRow(T.device, this.bindDeviceSeg.root), this.notice, this.bindsHost);

    // ---- Assists
    const assists = pane('assists');
    this.assistDeviceSeg = segmented<DeviceKind>({
      label: T.device,
      id: 'assistDevice',
      choices: this.devices.map((d) => ({ value: d, label: S.menu.deviceNames[d] })),
      value: this.assistDevice,
      onChange: (d) => {
        this.assistDevice = d;
        this.renderAssists();
      },
    });
    this.assistsHost = el('div', 'settings-grid');
    assists.append(
      el('p', 'settings__lede', T.assistsNote),
      settingRow(T.device, this.assistDeviceSeg.root),
      this.assistsHost,
    );

    this.buildAccessibility(pane('accessibility'));
    this.buildDisplay(pane('display'));
    this.buildAudio(pane('audio'));
    this.buildGraphics(pane('graphics'));

    const foot = el('footer', 'actionbar');
    const btns = el('div', 'actionbar__buttons');
    btns.append(
      button({
        label: T.credits,
        icon: 'credits',
        action: 'credits',
        next: true,
        onClick: () => deps.onCredits(),
      }),
      button({
        label: S.menu.back,
        glyph: 'menuBack',
        action: 'back',
        onClick: () => deps.onBack(),
      }),
    );
    foot.append(el('div', 'actionbar__summary'), btns);

    root.append(this.tabs.root, body, foot);
    this.show(this.section);
  }

  // ------------------------------------------------------------------ Screen

  enter(): void {
    const active = this.deps.device();
    const device = this.devices.includes(active) ? active : 'keyboard';
    this.bindDevice = device;
    this.assistDevice = device;
    this.bindDeviceSeg.set(device);
    this.assistDeviceSeg.set(device);
    this.notice.textContent = '';
    for (const s of this.syncers) s();
    this.renderBinds();
    this.renderAssists();
  }

  leave(): void {
    this.cancelCapture();
  }

  action(a: NavAction): boolean {
    if (a === 'menuTabPrev' || a === 'menuTabNext') {
      this.cancelCapture();
      this.tabs.step(a === 'menuTabPrev' ? -1 : 1);
      return true;
    }
    return false;
  }

  back(): boolean {
    if (!this.capture) return false;
    this.cancelCapture(T.captureCancelled);
    return true;
  }

  /** The section shown. */
  get current(): SectionId {
    return this.section;
  }

  /** The device in use changed: the controls follow it (not while a rebinding waits). */
  setDevice(device: DeviceKind): void {
    if (this.capture || !this.devices.includes(device) || device === this.bindDevice) return;
    this.bindDevice = device;
    this.bindDeviceSeg.set(device);
    this.notice.textContent = '';
    this.renderBinds();
  }

  /** A press captured by the input layer for the waiting rebinding. */
  captured(device: DeviceKind, control: ControlId): void {
    const c = this.capture;
    if (!c || c.device !== device) return;
    this.endCapture();
    void this.apply(rebindSlot(this.deps.profile().bindings, device, c.action, c.slot, control));
  }

  // ------------------------------------------------------------------ Sections

  private show(id: SectionId): void {
    this.section = id;
    this.tabs.select(id);
    for (const [k, p] of this.panes) p.hidden = k !== id;
    // One Tab stop for the strip (roving tabindex): the selected section.
    for (const b of this.tabs.root.querySelectorAll<HTMLElement>('[role=tab]'))
      b.tabIndex = b.dataset.tab === id ? 0 : -1;
  }

  private settings(): Readonly<PlayerSettings> {
    return this.deps.prefs.get().settings;
  }

  private setSetting<K extends keyof PlayerSettings>(key: K, value: PlayerSettings[K]): void {
    this.deps.prefs.update((p) => {
      p.settings[key] = value;
    });
    applyPlayerSettings(this.settings(), this.deps.page);
  }

  private buildAccessibility(host: HTMLElement): void {
    const cb = toggle({
      label: T.colourBlind,
      id: 'colourBlind',
      value: this.settings().colourBlind,
      onChange: (v) => this.setSetting('colourBlind', v),
    });
    const motion = segmented<'system' | 'on'>({
      label: T.reducedMotion,
      id: 'reducedMotion',
      choices: [
        { value: 'system', label: T.motionChoices.system },
        { value: 'on', label: T.motionChoices.on },
      ],
      value: this.settings().reducedMotion === 'on' ? 'on' : 'system',
      onChange: (v) => this.setSetting('reducedMotion', v),
    });
    const text = segmented({
      label: T.textSize,
      id: 'textSize',
      choices: (['default', 'large', 'larger'] as const).map((v) => ({
        value: v,
        label: T.textChoices[v],
      })),
      value: this.settings().textSize,
      onChange: (v) => this.setSetting('textSize', v),
    });
    this.syncers.push(() => {
      cb.set(this.settings().colourBlind);
      motion.set(this.settings().reducedMotion === 'on' ? 'on' : 'system');
      text.set(this.settings().textSize);
    });

    const preview = el('div', 'settings__swatches');
    preview.setAttribute('aria-label', T.preview);
    const P = T.previewItems;
    for (const [key, label] of [
      ['overall', P.overall],
      ['personal', P.personal],
      ['slower', P.slower],
      ['invalid', P.invalid],
      ['green', P.green],
      ['yellow', P.yellow],
      ['blue', P.blue],
      ['red', P.red],
    ] as const) {
      const sw = el('span', 'swatch');
      sw.dataset.swatch = key;
      sw.append(el('i', 'swatch__chip'), el('span', '', label));
      preview.append(sw);
    }
    host.append(
      settingRow(T.colourBlind, cb.root, T.colourBlindHint),
      preview,
      settingRow(T.reducedMotion, motion.root, T.reducedMotionHint),
      settingRow(T.textSize, text.root),
    );
  }

  private buildDisplay(host: HTMLElement): void {
    const scale = slider({
      label: T.hudScale,
      id: 'hudScale',
      min: 0.8,
      max: 1.2,
      step: 0.05,
      value: this.settings().hudScale,
      format: T.percent,
      onChange: (v) => this.setSetting('hudScale', v),
    });
    const units = segmented<'kmh' | 'mph'>({
      label: T.units,
      id: 'units',
      choices: [
        { value: 'kmh', label: T.unitChoices.kmh },
        { value: 'mph', label: T.unitChoices.mph },
      ],
      value: this.deps.units(),
      onChange: (v) => {
        this.deps.setUnits(v);
        this.setSetting('units', v);
      },
    });
    this.syncers.push(() => {
      scale.set(this.settings().hudScale);
      units.set(this.deps.units());
    });
    host.append(settingRow(T.hudScale, scale.root), settingRow(T.units, units.root));
  }

  private buildAudio(host: HTMLElement): void {
    for (const key of VOLUMES) {
      const s = slider({
        label: T.volumes[key],
        id: `volume-${key}`,
        min: 0,
        max: 1,
        step: 0.05,
        value: this.deps.volume(key),
        format: T.percent,
        onChange: (v) => this.deps.setVolume(key, v),
      });
      this.syncers.push(() => s.set(this.deps.volume(key)));
      host.append(settingRow(T.volumes[key], s.root));
    }
  }

  private buildGraphics(host: HTMLElement): void {
    const g = segmented<GraphicsChoice>({
      label: T.graphics,
      id: 'graphics',
      choices: GRAPHICS.map((q) => ({ value: q, label: T.qualities[q] })),
      value: this.deps.graphics(),
      onChange: (v) => this.deps.setGraphics(v),
    });
    this.syncers.push(() => g.set(this.deps.graphics()));
    host.append(settingRow(T.graphics, g.root, T.graphicsHint));
  }

  // ------------------------------------------------------------------ Assists

  private renderAssists(): void {
    const device = this.assistDevice;
    const prefs = this.deps.prefs;
    const a = (): Required<AssistChoice> => effectiveAssists(prefs.get(), device);
    const set = <K extends keyof AssistChoice>(key: K, v: AssistChoice[K]): void => {
      prefs.update((p) => {
        p.assists[device] = { ...(p.assists[device] ?? {}), [key]: v };
      });
    };
    const levels = [
      { value: 0, label: S.setup.levels.off },
      { value: 1, label: S.setup.levels.low },
      { value: 2, label: S.setup.levels.medium },
      { value: 3, label: S.setup.levels.high },
    ];
    const tc = segmented({
      label: S.setup.tractionControl,
      id: 'tractionControl',
      choices: levels,
      value: a().tractionControl,
      onChange: (v) => set('tractionControl', v),
    });
    const abs = toggle({
      label: S.setup.abs,
      id: 'abs',
      value: a().abs > 0,
      // The presets' "on" level (game/assists.ts).
      onChange: (v) => set('abs', v ? 2 : 0),
    });
    const stability = toggle({
      label: S.setup.stability,
      id: 'stability',
      value: a().stability > 0,
      onChange: (v) => set('stability', v ? 1 : 0),
    });
    const braking = segmented({
      label: S.setup.braking,
      id: 'braking',
      choices: levels,
      value: a().braking,
      onChange: (v) => set('braking', v),
    });
    const gears = segmented({
      label: S.setup.gears,
      id: 'gears',
      choices: [
        { value: 'auto', label: S.setup.gearChoices.auto },
        { value: 'manual', label: S.setup.gearChoices.manual },
      ],
      value: a().autoGears ? 'auto' : 'manual',
      onChange: (v) => set('autoGears', v === 'auto'),
    });
    const steering = segmented({
      label: S.setup.steering,
      id: 'steering',
      choices: levels,
      value: a().steering,
      onChange: (v) => set('steering', v),
    });
    steering.setDisabled(device === 'keyboard');
    const line = segmented({
      label: S.setup.drivingLine,
      id: 'racingLine',
      choices: (['off', 'braking', 'full'] as const).map((v) => ({
        value: v,
        label: S.setup.lineChoices[v],
      })),
      value: a().racingLine,
      onChange: (v) => set('racingLine', v),
    });
    const reset = button({
      label: S.setup.resetPreset,
      variant: 'quiet',
      action: 'reset-assists',
      onClick: () => {
        prefs.update((p) => {
          delete p.assists[device];
        });
        this.renderAssists();
      },
    });
    const foot = el('div', 'settings__foot');
    foot.append(reset);
    this.assistsHost.replaceChildren(
      settingRow(S.setup.tractionControl, tc.root, S.setup.help.tractionControl),
      settingRow(S.setup.abs, abs.root, S.setup.help.abs),
      settingRow(S.setup.stability, stability.root, S.setup.help.stability),
      settingRow(S.setup.braking, braking.root, T.brakingHint),
      settingRow(S.setup.gears, gears.root, S.setup.help.gears),
      settingRow(
        S.setup.steering,
        steering.root,
        device === 'keyboard' ? S.setup.steeringKeyboard : S.setup.help.steering,
      ),
      settingRow(S.setup.drivingLine, line.root, S.setup.help.drivingLine),
      foot,
    );
  }

  // ------------------------------------------------------------------ Bindings

  private renderBinds(): void {
    const device = this.bindDevice;
    if (device === 'touch') {
      this.renderTouch();
      return;
    }
    const map = this.deps.profile().bindings;
    const table = el('div', 'binds');
    table.setAttribute('role', 'table');
    table.setAttribute('aria-label', S.controls.title);
    for (const action of REBINDABLE) {
      const row = el('div', 'binds__row');
      row.setAttribute('role', 'row');
      row.dataset.action = action;
      const name = T.actions[action] ?? action;
      const k = el('span', 'binds__action', name);
      k.setAttribute('role', 'rowheader');
      row.append(k);
      const controls = controlsFor(map, device, action);
      for (const slot of [0, 1]) {
        const control = controls[slot];
        const waiting = this.capture?.action === action && this.capture.slot === slot;
        const b = el('button', 'binds__slot');
        b.type = 'button';
        b.dataset.nav = '';
        b.dataset.slot = String(slot);
        b.setAttribute('role', 'cell');
        if (waiting) {
          b.classList.add('is-capturing');
          b.textContent = device === 'keyboard' ? T.pressKey : T.pressButton;
        } else if (control) {
          if (device === 'gamepad') b.append(...padNodes(control));
          else b.textContent = controlLabel(control);
        } else {
          b.classList.add('is-empty');
          b.textContent = S.controls.notBound;
        }
        b.setAttribute(
          'aria-label',
          `${name}, ${T.slot(slot)}: ${waiting ? b.textContent : control ? controlLabel(control) : S.controls.notBound}`,
        );
        // Slots fill in order: an empty secondary after an empty primary binds the primary.
        b.addEventListener('click', () =>
          this.startCapture(action, Math.min(slot, controls.length)),
        );
        row.append(b);
      }
      table.append(row);
    }

    const shaping = this.deps.profile().shaping;
    const drs = segmented<'toggle' | 'hold'>({
      label: T.drsMode,
      id: 'drsMode',
      choices: [
        { value: 'toggle', label: T.drsChoices.toggle },
        { value: 'hold', label: T.drsChoices.hold },
      ],
      value: shaping.drsMode,
      onChange: (v) => {
        const p = this.deps.profile();
        void this.save({ ...p, shaping: { ...p.shaping, drsMode: v } });
      },
    });
    const reset = button({
      label: T.resetDevice(S.menu.deviceNames[device]),
      variant: 'quiet',
      action: 'reset-bindings',
      onClick: () => {
        this.cancelCapture();
        const p = this.deps.profile();
        const bindings = { ...p.bindings, [device]: defaultBindings()[device] };
        void this.save({ ...p, bindings }).then(() => {
          this.say(T.resetDone(S.menu.deviceNames[device]));
          this.renderBinds();
        });
      },
    });
    const foot = el('div', 'settings__foot');
    foot.append(reset);
    this.bindsHost.replaceChildren(table, settingRow(T.drsMode, drs.root), foot);
    this.warnUnbound();
  }

  private renderTouch(): void {
    const s = this.settings();
    const layout = segmented({
      label: T.touchLayout,
      id: 'touchLayout',
      choices: (['standard', 'mirrored'] as const).map((v) => ({
        value: v,
        label: T.touchChoices[v],
      })),
      value: s.touchLayout,
      onChange: (v) => this.setSetting('touchLayout', v),
    });
    const radius = this.deps.profile().shaping.touch.stickRadius;
    const nearest = (Object.keys(TRAVEL) as Travel[]).reduce((best, k) =>
      Math.abs(TRAVEL[k] - radius) < Math.abs(TRAVEL[best] - radius) ? k : best,
    );
    const travel = segmented<Travel>({
      label: T.stickTravel,
      id: 'stickTravel',
      choices: (Object.keys(TRAVEL) as Travel[]).map((k) => ({
        value: k,
        label: T.travelChoices[k],
      })),
      value: nearest,
      onChange: (k) => {
        const p = this.deps.profile();
        void this.save({
          ...p,
          shaping: { ...p.shaping, touch: { ...p.shaping.touch, stickRadius: TRAVEL[k] } },
        });
      },
    });
    this.bindsHost.replaceChildren(
      el('p', 'settings__lede', T.touchFixed),
      settingRow(T.touchLayout, layout.root, T.touchLayoutHint),
      settingRow(T.stickTravel, travel.root, T.stickTravelHint),
    );
  }

  private say(text: string, tone: 'info' | 'warn' = 'info'): void {
    this.notice.textContent = text;
    this.notice.dataset.tone = tone;
  }

  /** Any rebindable action left with nothing on this device, said after the last message. */
  private warnUnbound(): void {
    if (this.bindDevice === 'touch') return;
    const unbound = unboundActions(this.deps.profile().bindings, this.bindDevice);
    this.bindsHost.querySelectorAll<HTMLElement>('.binds__row').forEach((r) => {
      r.classList.toggle('is-unbound', unbound.includes(r.dataset.action as ActionId));
    });
  }

  private startCapture(action: ActionId, slot: number): void {
    this.cancelCapture();
    const device = this.bindDevice;
    this.capture = { device, action, slot, timer: null };
    this.deps.startCapture(device);
    if (device === 'gamepad') {
      this.capture.timer = setTimeout(() => this.cancelCapture(T.captureCancelled), PAD_CAPTURE_MS);
      this.say(T.captureButtons);
    } else {
      this.say(T.captureKeys);
      window.addEventListener('keydown', this.onCaptureKey, true);
      window.addEventListener('pointerdown', this.onCapturePointer, true);
    }
    this.renderBinds();
    this.focusSlot(action, slot);
  }

  /** Esc cancels and Delete clears, before the input layer sees the key. */
  private readonly onCaptureKey = (e: KeyboardEvent): void => {
    const c = this.capture;
    if (!c || (e.code !== 'Escape' && e.code !== 'Delete')) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.code === 'Escape') {
      this.cancelCapture(T.captureCancelled);
      return;
    }
    this.endCapture();
    void this.apply(rebindSlot(this.deps.profile().bindings, c.device, c.action, c.slot, null));
  };

  private readonly onCapturePointer = (e: PointerEvent): void => {
    if (!this.capture) return;
    if ((e.target as Element | null)?.closest?.('.binds__slot')) return;
    this.cancelCapture(T.captureCancelled);
  };

  private endCapture(): void {
    const c = this.capture;
    if (!c) return;
    if (c.timer) clearTimeout(c.timer);
    window.removeEventListener('keydown', this.onCaptureKey, true);
    window.removeEventListener('pointerdown', this.onCapturePointer, true);
    this.capture = null;
    this.deps.cancelCapture();
  }

  private cancelCapture(message?: string): void {
    const c = this.capture;
    if (!c) return;
    this.endCapture();
    this.renderBinds();
    this.focusSlot(c.action, c.slot);
    if (message) this.say(message);
  }

  private focusSlot(action: ActionId, slot: number): void {
    this.bindsHost
      .querySelector<HTMLElement>(`.binds__row[data-action=${action}] [data-slot="${slot}"]`)
      ?.focus({ preventScroll: true });
  }

  private async apply(outcome: RebindOutcome): Promise<void> {
    const c = outcome;
    if (c.kind === 'refused') {
      this.renderBinds();
      this.focusSlot(c.action, c.slot);
      this.say(c.message, 'warn');
      return;
    }
    const p = this.deps.profile();
    const saved = await this.save({ ...p, bindings: c.map });
    this.renderBinds();
    this.focusSlot(c.action, c.slot);
    const parts = [c.message];
    if (c.newlyUnbound.length > 0)
      parts.push(T.nowUnbound(c.newlyUnbound.map((a) => T.actions[a] ?? a).join(', ')));
    if (!saved) parts.push(T.savedNot);
    this.say(parts.join(' '), c.newlyUnbound.length > 0 || !saved ? 'warn' : 'info');
  }

  private async save(profile: InputProfile): Promise<boolean> {
    const ok = await this.deps.setProfile(profile);
    if (!ok) this.say(T.savedNot, 'warn');
    return ok;
  }
}
