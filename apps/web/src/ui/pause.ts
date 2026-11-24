import { MENU_BUTTONS, type ActionId, type MenuButton } from '@undercut/input';
import { ControlsPanel, type ControlsSource } from './controls-help';
import { el } from './dom';
import { button } from './kit/components';
import { glyph, refreshGlyphs } from './kit/glyph';
import type { IconKey } from './kit/icons';
import { S } from './strings';

export interface Choice<T extends string | number> {
  value: T;
  label: string;
}

export interface PauseSetting<T extends string | number = string | number> {
  id: string;
  label: string;
  description?: string;
  choices: Choice<T>[];
  get(): T;
  set(value: T): void;
  /** Not available right now (steering help on a keyboard); `hint` says why. */
  disabled?: () => boolean;
  hint?: string;
  /** Shown only while this holds (a setting that means nothing on this device); always if absent. */
  visible?: () => boolean;
}

/** A 0–1 level shown as a percentage, adjusted in tenths. */
export interface PauseSlider {
  id: string;
  label: string;
  get(): number;
  set(value: number): void;
}

/**
 * A one-press command shown as a settings row (replay the intro, reset to defaults), so the
 * action column keeps the driving actions in view on a short phone screen.
 */
export interface PauseCommand {
  /** `data-action` of its button. */
  id: string;
  label: string;
  button: string;
  run(): void;
  /** Absent: always shown. False: hidden (the intro is finished, no fullscreen API). */
  visible?: () => boolean;
}

export interface PauseActions {
  resume(): void;
  /** Absent: no restart (an online race cannot restart one car's lap). */
  restartLap?: () => void;
  /** Label of the restart button; default "Restart lap" (a Quick Race restarts the race). */
  restartLabel?: string;
  resetToTrack(): void;
  quit(): void;
  /** Label of the quit button; default "Quit to launch". */
  quitLabel?: string;
}

const CONTROL_ITEMS: readonly { label: string; actions: readonly ActionId[] }[] = [
  { label: S.pause.controlLabels.steer, actions: ['steerLeft', 'steerRight'] },
  { label: S.pause.controlLabels.throttle, actions: ['throttle'] },
  { label: S.pause.controlLabels.brake, actions: ['brake'] },
  { label: S.pause.controlLabels.shift, actions: ['gearDown', 'gearUp'] },
  { label: S.pause.controlLabels.drs, actions: ['drs'] },
  { label: S.pause.controlLabels.ers, actions: ['overtake'] },
  { label: S.pause.controlLabels.camera, actions: ['nextCamera'] },
  { label: S.pause.controlLabels.reset, actions: ['resetToTrack'] },
  { label: S.pause.controlLabels.pause, actions: ['pause'] },
];

/**
 * The pause menu: actions on the left, settings on the right (camera, graphics, assists and
 * audio), and a live-device controls strip underneath, over a scrim. Driven by mouse, touch, and
 * by the input layer's menu actions (up, down, left, right, accept, back) for keyboard and
 * gamepad.
 */
export class PauseMenu {
  readonly root: HTMLElement;
  private readonly focusables: HTMLElement[] = [];
  private readonly rows = new Map<
    string,
    {
      setting: PauseSetting;
      buttons: HTMLButtonElement[];
      hint: HTMLElement | null;
      row: HTMLElement;
    }
  >();
  private readonly sliders = new Map<
    string,
    { slider: PauseSlider; input: HTMLInputElement; output: HTMLOutputElement }
  >();
  private readonly commands: { command: PauseCommand; row: HTMLElement }[] = [];
  private focusIndex = 0;
  /** The controls list, when the menu was given a bindings source. */
  readonly controls: ControlsPanel | null;

  constructor(
    actions: PauseActions,
    settings: PauseSetting[],
    note: () => string,
    sliders: PauseSlider[] = [],
    controls?: ControlsSource,
    commands: PauseCommand[] = [],
  ) {
    const root = el('div', 'pause');
    root.dataset.testid = 'pause-menu';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-labelledby', 'pause-title');
    root.hidden = true;
    this.root = root;

    const card = el('div', 'pause__card');
    const head = el('header', 'pause__head');
    const title = el('h2', 'pause__title', S.pause.title);
    title.id = 'pause-title';
    const sub = el('span', 'label pause__sub');
    head.append(title, sub);
    this.refreshNote = () => {
      sub.textContent = note();
    };

    const list = el('div', 'pause__actions');
    const addAction = (
      label: string,
      iconName: IconKey,
      fn: () => void,
      id: string,
      primary = false,
    ): void => {
      const b = button({
        label,
        icon: iconName,
        variant: primary ? 'primary' : 'secondary',
        ...(primary ? { glyph: 'menuAccept' as const } : {}),
        action: id,
        onClick: fn,
      });
      b.classList.add('pause__action');
      list.append(b);
      this.focusables.push(b);
    };
    addAction(S.pause.resume, 'play', actions.resume, 'resume', true);
    if (actions.restartLap) {
      const label = actions.restartLabel ?? S.pause.restartLap;
      addAction(label, 'restart', actions.restartLap, 'restart');
    }
    addAction(S.pause.resetToTrack, 'reset', actions.resetToTrack, 'reset');
    this.controls = controls ? new ControlsPanel(controls) : null;
    const panel = this.controls;
    if (panel) addAction(S.controls.title, 'keyboard', () => panel.show(), 'controls');

    const grid = el('div', 'pause__settings');
    for (const setting of settings) {
      const row = el('div', 'pause__setting');
      row.dataset.setting = setting.id;
      const name = el('span', 'pause__key', setting.label);
      if (setting.description) {
        const help = el('small', 'pause__help', setting.description);
        help.id = `pause-help-${setting.id}`;
        name.append(help);
        row.setAttribute('aria-describedby', help.id);
      }
      const hint = setting.hint ? el('small', 'pause__hint', setting.hint) : null;
      if (hint) {
        hint.hidden = true;
        name.append(hint);
      }
      const seg = el('div', 'seg');
      seg.setAttribute('role', 'radiogroup');
      seg.setAttribute('aria-label', setting.label);
      const buttons: HTMLButtonElement[] = [];
      for (const choice of setting.choices) {
        const b = el('button', 'seg__opt', choice.label);
        b.type = 'button';
        b.setAttribute('role', 'radio');
        b.dataset.value = String(choice.value);
        b.addEventListener('click', () => {
          setting.set(choice.value);
          this.sync();
        });
        seg.append(b);
        buttons.push(b);
      }
      this.focusables.push(buttons[0] as HTMLButtonElement);
      row.append(name, seg);
      grid.append(row);
      this.rows.set(setting.id, { setting, buttons, hint, row });
    }

    for (const slider of sliders) {
      const row = el('label', 'pause__setting pause__slider');
      row.dataset.slider = slider.id;
      const name = el('span', 'pause__key', slider.label);
      const control = el('span', 'range');
      const input = el('input', 'range__input');
      input.type = 'range';
      input.min = '0';
      input.max = '1';
      input.step = '0.1';
      input.setAttribute('aria-label', slider.label);
      const output = el('output', 'range__value num');
      input.addEventListener('input', () => {
        slider.set(Number(input.value));
        this.sync();
      });
      // Keys step the slider natively (the input layer ignores keys typed into a form control);
      // gamepad left and right arrive as menu actions in `navigate`.
      control.append(input, output);
      row.append(name, control);
      grid.append(row);
      this.focusables.push(input);
      this.sliders.set(slider.id, { slider, input, output });
    }

    for (const command of commands) {
      const row = el('div', 'pause__setting pause__command');
      row.dataset.command = command.id;
      const run = button({
        label: command.button,
        variant: 'secondary',
        action: command.id,
        onClick: () => {
          command.run();
          this.sync();
        },
      });
      run.classList.add('pause__run');
      row.append(el('span', 'pause__key', command.label), run);
      grid.append(row);
      this.focusables.push(run);
      this.commands.push({ command, row });
    }

    const legend = el('section', 'pause__controls');
    legend.setAttribute('aria-label', S.pause.controls);
    const controlsList = el('div', 'pause__controls-list');
    for (const item of CONTROL_ITEMS) {
      const cell = el('span', 'pause__control');
      const keys = el('span', 'pause__control-keys');
      for (const id of item.actions) keys.append(glyph(id));
      cell.append(keys, el('span', 'pause__control-label', item.label));
      controlsList.append(cell);
    }
    legend.append(el('span', 'label', S.pause.controls), controlsList);

    const quit = button({
      label: actions.quitLabel ?? S.pause.quit,
      icon: 'exit',
      variant: 'quiet',
      action: 'quit',
      onClick: actions.quit,
    });
    quit.classList.add('pause__quit');
    this.focusables.push(quit);

    const body = el('div', 'pause__body');
    body.append(list, grid);
    const foot = el('footer', 'pause__foot');
    foot.append(quit);
    card.append(head, body, legend, foot);
    root.append(card);
    if (panel) root.append(panel.root);
  }

  private refreshNote: () => void;

  get open(): boolean {
    return !this.root.hidden;
  }

  show(): void {
    this.sync();
    this.refreshNote();
    refreshGlyphs(this.root);
    this.root.hidden = false;
    // Open at the top, with Resume and the driving actions in view, wherever it was scrolled.
    for (const node of this.root.querySelectorAll<HTMLElement>(
      '.pause__card, .pause__body, .pause__actions, .pause__settings',
    ))
      node.scrollTop = 0;
    this.root.scrollTop = 0;
    this.focusIndex = 0;
    this.focus();
  }

  hide(): void {
    this.controls?.hide();
    this.root.hidden = true;
  }

  /** Reflect each setting's current value. */
  sync(): void {
    for (const { command, row } of this.commands) row.hidden = !(command.visible?.() ?? true);
    for (const { slider, input, output } of this.sliders.values()) {
      const v = Math.round(slider.get() * 10) / 10;
      input.value = String(v);
      input.style.setProperty('--v', `${v * 100}%`);
      output.textContent = `${Math.round(v * 100)}%`;
    }
    for (const { setting, buttons, hint, row } of this.rows.values()) {
      row.hidden = !(setting.visible?.() ?? true);
      const current = String(setting.get());
      const disabled = setting.disabled?.() ?? false;
      for (const b of buttons) {
        const on = b.dataset.value === current;
        b.classList.toggle('is-on', on);
        b.setAttribute('aria-checked', String(on));
        b.disabled = disabled;
      }
      if (hint) hint.hidden = !disabled;
    }
  }

  private focus(): void {
    const target = this.focusables[this.focusIndex];
    target?.focus({ preventScroll: true });
  }

  /** Menu navigation from the input layer. Returns true when it handled the action. */
  navigate(action: string): boolean {
    if (!this.open) return false;
    const active = document.activeElement;
    // The controls list sits on top: pause closes it, and it takes every menu action.
    if (this.controls?.open) {
      if (action === 'pause') this.controls.hide();
      else if (MENU_BUTTONS.includes(action as MenuButton))
        this.controls.handle(action as MenuButton);
      return true;
    }
    const rowOf = (
      node: Element | null,
    ): { setting: PauseSetting; buttons: HTMLButtonElement[] } | undefined => {
      const id = (node?.closest('[data-setting]') as HTMLElement | null)?.dataset.setting;
      return id ? this.rows.get(id) : undefined;
    };
    switch (action) {
      case 'menuDown':
      case 'menuUp': {
        const index = this.focusables.findIndex(
          (f) => f === active || (rowOf(active) === rowOf(f) && rowOf(f) !== undefined),
        );
        const step = action === 'menuDown' ? 1 : -1;
        const n = this.focusables.length;
        // Skip what cannot take focus now (a disabled setting).
        let next = index < 0 ? 0 : index;
        for (let k = 0; k < n; k++) {
          next = (next + step + n) % n;
          const f = this.focusables[next] as HTMLButtonElement;
          if (!f.disabled && !f.closest('[hidden]')) break;
        }
        this.focusIndex = next;
        this.focus();
        return true;
      }
      case 'menuLeft':
      case 'menuRight': {
        const slid = [...this.sliders.values()].find((x) => x.input === active);
        if (slid) {
          const step = action === 'menuRight' ? 0.1 : -0.1;
          const next = Math.round(Math.min(1, Math.max(0, slid.slider.get() + step)) * 10) / 10;
          slid.slider.set(next);
          this.sync();
          return true;
        }
        const row = rowOf(active);
        if (!row) return false;
        if (row.setting.disabled?.()) return true;
        const values = row.setting.choices.map((c) => c.value);
        const i = values.findIndex((v) => String(v) === String(row.setting.get()));
        const next =
          values[Math.min(values.length - 1, Math.max(0, i + (action === 'menuRight' ? 1 : -1)))];
        if (next !== undefined) row.setting.set(next);
        this.sync();
        const on = row.buttons.find((b) => b.classList.contains('is-on'));
        on?.focus({ preventScroll: true });
        return true;
      }
      case 'menuAccept':
        if (active instanceof HTMLButtonElement && this.root.contains(active)) active.click();
        return true;
      default:
        return false;
    }
  }
}
