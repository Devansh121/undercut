import { GAME_NAME } from '@undercut/core';
import { formatLapTime } from './game/format';
import { ControlsPanel, type ControlsSource } from './ui/controls-help';
import { el, icon } from './ui/dom';

export interface LaunchScreenOptions {
  buildHash: string;
  /** Best lap at the circuit from storage, if any. */
  record: number | null;
  onStart(): void;
  onOnline?(): void;
  /** Where the controls list reads bindings and the device in use. */
  controls?: ControlsSource;
}

export interface LaunchScreen {
  root: HTMLElement;
  /** Show progress on the start button while the session loads. */
  setLoading(loading: boolean): void;
  setRecord(record: number | null): void;
  /** Start as if the button was pressed (keyboard or gamepad accept). */
  start(): void;
  /** Menu accept from a gamepad: press the focused control in the controls list, else Start. */
  accept(): void;
  /** Close the controls list if it is open (gamepad back). Returns true when it closed it. */
  back(): boolean;
}

/** The launch screen: the name, one mode for M1 (Time Trial at Monza) and the build. */
export function mountLaunchScreen(root: HTMLElement, options: LaunchScreenOptions): LaunchScreen {
  const screen = el('main', 'launch');
  screen.setAttribute('aria-labelledby', 'launch-title');

  const stage = el('div', 'launch__stage');
  const title = el('h1', 'launch__title', GAME_NAME);
  title.id = 'launch-title';
  stage.append(
    title,
    el('p', 'launch__tagline', 'Open-wheel racing. One car, one circuit, the clock.'),
  );

  const bar = el('div', 'launch__bar');
  const mode = el('div', 'launch__mode');
  const modeIcon = el('span', 'launch__mode-icon');
  modeIcon.append(icon('stopwatch'));
  const modeText = el('div', 'launch__mode-text');
  modeText.append(el('span', 'launch__mode-name', 'Time Trial, Monza'));
  const record = el('span', 'launch__mode-desc');
  modeText.append(record);
  mode.append(modeIcon, modeText);

  const start = el('button', 'button button--primary');
  start.type = 'button';
  start.dataset.action = 'start';
  const startLabel = el('span', 'button__label', 'Start');
  const key = el('span', 'key', 'Enter');
  start.append(startLabel, key, icon('chevron'));
  start.addEventListener('click', () => options.onStart());

  const build = el('footer', 'launch__build');
  build.append('Build ', el('code', '', options.buildHash));

  const online = el('button', 'button', 'Online rooms');
  online.type = 'button';
  online.onclick = () => options.onOnline?.();
  const panel = options.controls ? new ControlsPanel(options.controls) : null;
  const help = el('button', 'button');
  help.type = 'button';
  help.dataset.action = 'controls';
  help.append(el('span', 'button__label', 'Controls'));
  help.addEventListener('click', () => panel?.show());
  screen.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && panel?.open) {
      e.preventDefault();
      panel.hide();
    }
  });

  bar.append(mode, start, online, build);
  if (panel) bar.insertBefore(help, start);
  screen.append(stage, bar);
  if (panel) screen.append(panel.root);
  root.replaceChildren(screen);

  const setRecord = (r: number | null): void => {
    record.textContent =
      r === null ? 'No lap set on this device yet' : `Record ${formatLapTime(r)}`;
  };
  setRecord(options.record);
  start.focus({ preventScroll: true });

  return {
    root: screen,
    setLoading(loading) {
      start.disabled = loading;
      startLabel.textContent = loading ? 'Loading' : 'Start';
      screen.setAttribute('aria-busy', String(loading));
    },
    setRecord,
    start() {
      if (!start.disabled && !panel?.open) start.click();
    },
    accept() {
      if (panel?.accept()) return;
      if (!start.disabled) start.click();
    },
    back() {
      if (!panel?.open) return false;
      panel.hide();
      return true;
    },
  };
}
