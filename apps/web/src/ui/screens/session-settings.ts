/**
 * The session settings a mode offers, as rows of kit controls bound to the menu prefs. Built
 * once per container (the inline card on desktop, the dialog on a phone); `sync` re-reads the
 * prefs so both stay in step. Only settings that change something in this build are offered.
 */
import type { DeviceKind } from '@undercut/input';
import { assistsFor } from '../../game/assists';
import { el } from '../dom';
import type { CircuitSummary } from '../data/circuit-summary';
import type { AssistChoice, MenuPrefs, ModeId, PrefsStore } from '../data/prefs';
import { button, segmented, settingRow, toggle, type Control } from '../kit/components';
import { S } from '../strings';

const LEVELS = [
  { value: 0, label: S.setup.levels.off },
  { value: 1, label: S.setup.levels.low },
  { value: 2, label: S.setup.levels.medium },
  { value: 3, label: S.setup.levels.high },
] as const;

/** ABS level the presets use for "on" (game/assists.ts). */
const ABS_ON = 2;

export interface SettingsContext {
  prefs: PrefsStore;
  mode: () => ModeId;
  circuit: () => CircuitSummary;
  device: () => DeviceKind;
  /** Something changed (repaint the summary and the other panel). */
  changed: () => void;
}

export function timeOfDayOf(p: Readonly<MenuPrefs>, c: CircuitSummary): string {
  const saved = p.timeOfDay[c.id];
  return saved && c.timesOfDay.includes(saved) ? saved : (c.timesOfDay[0] ?? 'monza-afternoon');
}

/** The assists the session will start with on `device`: the preset plus the player's choices. */
export function effectiveAssists(
  p: Readonly<MenuPrefs>,
  device: DeviceKind,
): Required<AssistChoice> {
  const a = assistsFor(device, p.assists[device] ?? {});
  return {
    tractionControl: a.tractionControl,
    abs: a.abs,
    autoGears: a.autoGears,
    steering: a.steering,
    stability: a.stability ?? 0,
    braking: a.braking,
    racingLine: a.racingLine ?? 'off',
  };
}

export function settingsSummary(
  p: Readonly<MenuPrefs>,
  c: CircuitSummary,
  device: DeviceKind,
): string {
  return S.setup.summaryTimeTrial(S.timeOfDay[timeOfDayOf(p, c)] ?? '', S.menu.deviceNames[device]);
}

export class SettingsPanel {
  readonly root: HTMLElement;
  private syncers: (() => void)[] = [];

  constructor(private readonly ctx: SettingsContext) {
    this.root = el('div', 'settings-grid');
    this.build();
  }

  /** Rebuild for another mode, circuit or device. */
  build(): void {
    this.syncers = [];
    const rows: HTMLElement[] = [];
    const { prefs, ctx } = { prefs: this.ctx.prefs, ctx: this.ctx };
    const circuit = ctx.circuit();
    const device = ctx.device();

    // Time of day: the presets the circuit has.
    const tod = segmented({
      label: S.timeOfDay.label ?? '',
      id: 'timeOfDay',
      choices: circuit.timesOfDay.map((t) => ({ value: t, label: S.timeOfDay[t] ?? t })),
      value: timeOfDayOf(prefs.get(), circuit),
      onChange: (v) => {
        prefs.update((p) => {
          p.timeOfDay[circuit.id] = v;
        });
        ctx.changed();
      },
    });
    this.syncers.push(() => tod.set(timeOfDayOf(prefs.get(), circuit)));
    rows.push(settingRow(S.timeOfDay.label ?? '', tod.root));

    const setAssist = <K extends keyof AssistChoice>(key: K, v: AssistChoice[K]): void => {
      prefs.update((p) => {
        p.assists[device] = { ...(p.assists[device] ?? {}), [key]: v };
      });
      ctx.changed();
    };
    const a = (): Required<AssistChoice> => effectiveAssists(prefs.get(), device);

    const tc = segmented({
      label: S.setup.tractionControl,
      id: 'tractionControl',
      choices: LEVELS,
      value: a().tractionControl,
      onChange: (v) => setAssist('tractionControl', v),
    });
    const abs = toggle({
      label: S.setup.abs,
      id: 'abs',
      value: a().abs > 0,
      onChange: (v) => setAssist('abs', v ? ABS_ON : 0),
    });
    const gears = segmented({
      label: S.setup.gears,
      id: 'gears',
      choices: [
        { value: 'auto', label: S.setup.gearChoices.auto },
        { value: 'manual', label: S.setup.gearChoices.manual },
      ],
      value: a().autoGears ? 'auto' : 'manual',
      onChange: (v) => setAssist('autoGears', v === 'auto'),
    });
    const steering = segmented({
      label: S.setup.steering,
      id: 'steering',
      choices: LEVELS,
      value: a().steering,
      onChange: (v) => setAssist('steering', v),
    });
    // The keyboard shapes its own steering (input layer); steering help is for sticks and touch.
    steering.setDisabled(device === 'keyboard');
    const stability = toggle({
      label: S.setup.stability,
      id: 'stability',
      value: a().stability > 0,
      onChange: (v) => setAssist('stability', v ? 1 : 0),
    });
    const braking = segmented({
      label: S.setup.braking,
      id: 'braking',
      choices: LEVELS,
      value: a().braking,
      onChange: (v) => setAssist('braking', v),
    });
    // Braking help follows a driving line built for the player's car: in a race every car runs
    // the trim of the circuit's racing line, so wherever there is one; in time trial the
    // low-drag car, so only where the line was built for it.
    const brakingHelp = ctx.mode() === 'quickRace' ? circuit.raceReady : circuit.brakingHelp;
    braking.setDisabled(!brakingHelp);
    const controls: [Control<unknown>, () => unknown][] = [
      [tc as Control<unknown>, () => a().tractionControl],
      [abs as Control<unknown>, () => a().abs > 0],
      [gears as Control<unknown>, () => (a().autoGears ? 'auto' : 'manual')],
      [steering as Control<unknown>, () => a().steering],
      [stability as Control<unknown>, () => a().stability > 0],
      [braking as Control<unknown>, () => a().braking],
    ];
    this.syncers.push(() => {
      for (const [c, v] of controls) c.set(v());
    });
    rows.push(
      settingRow(S.setup.tractionControl, tc.root),
      settingRow(S.setup.abs, abs.root),
      settingRow(S.setup.stability, stability.root),
      settingRow(S.setup.braking, braking.root, brakingHelp ? undefined : S.setup.brakingNoLine),
      settingRow(S.setup.gears, gears.root),
      settingRow(
        S.setup.steering,
        steering.root,
        device === 'keyboard' ? S.setup.steeringKeyboard : undefined,
      ),
    );
    this.root.replaceChildren(...rows);
  }

  sync(): void {
    for (const s of this.syncers) s();
  }

  /** A "Reset to preset" button for the device's assists. */
  static resetButton(ctx: SettingsContext): HTMLButtonElement {
    return button({
      label: S.setup.resetPreset,
      variant: 'quiet',
      action: 'reset-assists',
      onClick: () => {
        const device = ctx.device();
        ctx.prefs.update((p) => {
          delete p.assists[device];
        });
        ctx.changed();
      },
    });
  }
}
