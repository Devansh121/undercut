import { ControlsPanel, type ControlsSource } from './controls-help';
import { el, icon, type IconKey } from './dom';

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
}

/** A 0–1 level shown as a percentage, adjusted in tenths. */
export interface PauseSlider {
  id: string;
  label: string;
  get(): number;
  set(value: number): void;
}

export interface PauseActions {
  resume(): void;
  /** Absent: no restart (an online race cannot restart one car's lap). */
  restartLap?: () => void;
  resetToTrack(): void;
  quit(): void;
  /** Label of the quit button; default "Quit to launch". */
  quitLabel?: string;
}

/**
 * The pause menu: actions on the left, settings on the right (camera and assists), over a
 * scrim. Driven by mouse, touch, and by the input layer's menu actions (up, down, left, right,
 * accept, back) for keyboard and gamepad.
 */
export class PauseMenu {
  readonly root: HTMLElement;
  private readonly focusables: HTMLElement[] = [];
  private readonly rows = new Map<
    string,
    { setting: PauseSetting; buttons: HTMLButtonElement[] }
  >();
  private readonly sliders = new Map<
    string,
    { slider: PauseSlider; input: HTMLInputElement; output: HTMLOutputElement }
  >();
  private focusIndex = 0;
  /** The controls list, when the menu was given a bindings source. */
  readonly controls: ControlsPanel | null;

  constructor(
    actions: PauseActions,
    settings: PauseSetting[],
    note: () => string,
    sliders: PauseSlider[] = [],
    controls?: ControlsSource,
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
    const title = el('h2', 'pause__title', 'Paused');
    title.id = 'pause-title';
    const sub = el('span', 'label pause__sub');
    head.append(title, sub);
    this.refreshNote = () => {
      sub.textContent = note();
    };

    const list = el('div', 'pause__actions');
    const action = (
      label: string,
      glyph: IconKey,
      fn: () => void,
      id: string,
      primary = false,
    ): void => {
      const b = el('button', `pause__action${primary ? ' is-primary' : ''}`);
      b.type = 'button';
      b.dataset.action = id;
      b.append(icon(glyph), el('span', '', label));
      b.addEventListener('click', fn);
      list.append(b);
      this.focusables.push(b);
    };
    action('Resume', 'play', actions.resume, 'resume', true);
    if (actions.restartLap) action('Restart lap', 'restart', actions.restartLap, 'restart');
    action('Reset to track', 'reset', actions.resetToTrack, 'reset');
    this.controls = controls ? new ControlsPanel(controls) : null;
    const panel = this.controls;
    if (panel) action('Controls', 'keys', () => panel.show(), 'controls');

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
      this.rows.set(setting.id, { setting, buttons });
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

    const quit = el('button', 'pause__quit');
    quit.type = 'button';
    quit.dataset.action = 'quit';
    quit.append(icon('exit'), el('span', '', actions.quitLabel ?? 'Quit to launch'));
    quit.addEventListener('click', actions.quit);
    this.focusables.push(quit);

    const body = el('div', 'pause__body');
    body.append(list, grid);
    card.append(head, body, quit);
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
    this.root.hidden = false;
    this.focusIndex = 0;
    this.focus();
  }

  hide(): void {
    this.controls?.hide();
    this.root.hidden = true;
  }

  /** Reflect each setting's current value. */
  sync(): void {
    for (const { slider, input, output } of this.sliders.values()) {
      const v = Math.round(slider.get() * 10) / 10;
      input.value = String(v);
      input.style.setProperty('--v', `${v * 100}%`);
      output.textContent = `${Math.round(v * 100)}%`;
    }
    for (const { setting, buttons } of this.rows.values()) {
      const current = String(setting.get());
      for (const b of buttons) {
        const on = b.dataset.value === current;
        b.classList.toggle('is-on', on);
        b.setAttribute('aria-checked', String(on));
      }
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
    // The controls list sits on top: back or pause closes it, accept presses its focused button.
    if (this.controls?.open) {
      if (action === 'menuBack' || action === 'pause') this.controls.hide();
      else if (action === 'menuAccept') this.controls.accept();
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
        this.focusIndex = ((index < 0 ? 0 : index) + step + n) % n;
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
