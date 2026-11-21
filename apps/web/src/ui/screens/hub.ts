/**
 * The main menu, laid out as design/mock/menu.html: modes and best laps on the left; the circuit
 * and the session settings in the middle; team, car and driver on the right; the choice and the
 * start button in the action bar. On a phone the settings collapse to a one-line summary with an
 * edit button, and secondary text drops out.
 */
import type { DeviceKind } from '@undercut/input';
import { formatLapTime } from '../../game/format';
import type { RecordStore } from '../../game/records';
import { el } from '../dom';
import type { CircuitSummary } from '../data/circuit-summary';
import type { AssistChoice, ModeId, PrefsStore } from '../data/prefs';
import { MODE_IDS } from '../data/prefs';
import { TEAMS, teamById, teamCarImage, type Team } from '../data/teams';
import { button, card, chip, dialog, iconButton, listRow, setButtonLabel } from '../kit/components';
import { icon, type IconKey } from '../kit/icons';
import type { NavAction } from '../kit/nav';
import type { Screen } from '../shell';
import { S } from '../strings';
import { circuitArt } from './circuit-art';
import {
  SettingsPanel,
  settingsSummary,
  timeOfDayOf,
  type SettingsContext,
} from './session-settings';

/** What Start hands to the game. */
export interface SessionChoice {
  mode: ModeId;
  circuit: string;
  team: string;
  driver: 0 | 1;
  timeOfDay: string;
  assists: AssistChoice;
}

export interface HubOptions {
  circuits: readonly CircuitSummary[];
  prefs: PrefsStore;
  records: RecordStore;
  device: () => DeviceKind;
  onStart(choice: SessionChoice): void;
  onCircuits(): void;
  onBack(): void;
}

const MODE_ICON: Record<ModeId, IconKey> = {
  timeTrial: 'stopwatch',
  quickRace: 'flag',
  weekend: 'weekend',
  championship: 'trophy',
  online: 'rooms',
};

/** Modes that start a session in this build. */
const PLAYABLE: ReadonlySet<ModeId> = new Set<ModeId>(['timeTrial']);

const kmText = (m: number): string => (m / 1000).toFixed(3);

export class HubScreen implements Screen {
  readonly id = 'hub';
  readonly crumb = S.menu.main;
  readonly root: HTMLElement;
  private readonly modeRows = new Map<ModeId, HTMLButtonElement>();
  private readonly circuitCard: HTMLElement;
  private readonly centre: HTMLElement;
  private readonly settingsCard: HTMLElement;
  private readonly summaryCard: HTMLElement;
  private readonly summaryText: HTMLElement;
  private readonly noticeCard: HTMLElement;
  private readonly presetLabel: HTMLElement;
  private readonly teamButtons = new Map<string, HTMLButtonElement>();
  private readonly driverRow: HTMLElement;
  private readonly carFigure: HTMLElement;
  private readonly carImage: HTMLImageElement;
  private readonly teamAside: HTMLElement;
  private readonly recordRows = new Map<string, HTMLElement>();
  private readonly start: HTMLButtonElement;
  private readonly barSummary: HTMLElement;
  private readonly inline: SettingsPanel;
  private readonly inDialog: SettingsPanel;
  private readonly settingsDialog: ReturnType<typeof dialog>;
  private readonly resetInline: HTMLButtonElement;
  private device: DeviceKind;

  constructor(private readonly o: HubOptions) {
    this.device = o.device();
    const root = el('div', 'screen hub');
    this.root = root;
    const body = el('div', 'hub__body');

    // ---- Modes and records (left)
    const left = el('div', 'hub__col hub__col--modes');
    const modes = el('div', 'modes');
    modes.setAttribute('role', 'list');
    modes.setAttribute('aria-label', S.menu.modes);
    for (const m of MODE_IDS) {
      const copy = S.modes[m];
      const row = listRow({
        title: copy.name,
        desc: copy.desc,
        icon: MODE_ICON[m],
        action: `mode-${m}`,
        onClick: () => this.selectMode(m),
      });
      row.setAttribute('role', 'listitem');
      this.modeRows.set(m, row);
      modes.append(row);
    }
    const records = card({ title: S.menu.records, className: 'records' });
    for (const c of o.circuits) {
      const r = el('div', 'records__row');
      const t = el('b', 'num', S.menu.noRecord);
      r.append(el('span', 'label', c.name), t);
      this.recordRows.set(c.id, t);
      records.body.append(r);
    }
    if (!o.records.persistent) records.body.append(el('p', 'records__note', S.menu.recordsMemory));
    left.append(modes, records.root);

    // ---- Circuit and settings (centre)
    this.centre = el('div', 'hub__col hub__col--centre');
    this.circuitCard = el('section', 'card circuit');
    this.circuitCard.setAttribute('aria-label', S.circuit.title);
    this.circuitCard.dataset.testid = 'circuit-card';
    this.presetLabel = el('span', 'label');
    this.resetInline = SettingsPanel.resetButton(this.settingsContext());
    const settingsAside = el('div', 'settings__aside');
    settingsAside.append(this.presetLabel, this.resetInline);
    const settings = card({ title: S.setup.title, aside: settingsAside, className: 'settings' });
    this.settingsCard = settings.root;
    this.inline = new SettingsPanel(this.settingsContext());
    settings.body.append(this.inline.root);

    this.summaryCard = el('section', 'card settings-summary');
    this.summaryCard.setAttribute('aria-label', S.setup.title);
    this.summaryText = el('span', 'settings-summary__vals');
    this.inDialog = new SettingsPanel(this.settingsContext());
    this.settingsDialog = dialog({
      title: S.setup.title,
      testid: 'settings-dialog',
      actions: [SettingsPanel.resetButton(this.settingsContext())],
    });
    this.settingsDialog.body.append(this.inDialog.root);
    const edit = iconButton({
      icon: 'edit',
      label: S.setup.edit,
      action: 'edit-settings',
      onClick: () => {
        this.inDialog.sync();
        this.settingsDialog.show();
      },
    });
    this.summaryCard.append(this.summaryText, edit);

    this.noticeCard = el('section', 'card notice');
    this.noticeCard.dataset.testid = 'mode-notice';
    this.centre.append(this.circuitCard, this.settingsCard, this.summaryCard, this.noticeCard);

    // ---- Team, car and driver (right)
    const right = el('div', 'hub__col hub__col--team');
    this.teamAside = el('span', 'label');
    const teamCard = card({ title: S.team.title, aside: this.teamAside, className: 'team-card' });
    teamCard.root.dataset.testid = 'team-card';
    this.carFigure = el('figure', 'team-car');
    this.carImage = el('img', 'team-car__img');
    this.carImage.decoding = 'async';
    this.carImage.addEventListener('error', () => this.carFigure.classList.add('is-missing'));
    this.carImage.addEventListener('load', () => this.carFigure.classList.remove('is-missing'));
    this.carFigure.append(this.carImage);
    const grid = el('div', 'teams');
    grid.dataset.navGroup = '';
    grid.setAttribute('role', 'radiogroup');
    grid.setAttribute('aria-label', S.team.title);
    for (const t of TEAMS) grid.append(this.teamButton(t));
    const driverHead = el('h3', 'card__title team-card__sub', S.team.driver);
    this.driverRow = el('div', 'drivers');
    this.driverRow.dataset.navGroup = '';
    this.driverRow.setAttribute('role', 'radiogroup');
    this.driverRow.setAttribute('aria-label', S.team.driver);
    teamCard.body.append(this.carFigure, grid, driverHead, this.driverRow);
    right.append(teamCard.root);

    body.append(left, this.centre, right);

    // ---- Action bar
    const bar = el('footer', 'actionbar');
    this.barSummary = el('div', 'actionbar__summary');
    const buttons = el('div', 'actionbar__buttons');
    const back = button({
      label: S.menu.back,
      glyph: 'menuBack',
      action: 'back',
      onClick: () => o.onBack(),
    });
    this.start = button({
      label: S.modes.timeTrial.start,
      variant: 'primary',
      glyph: 'menuAccept',
      action: 'start',
      onClick: () => this.startSession(),
    });
    this.start.dataset.navDefault = '';
    buttons.append(back, this.start);
    bar.append(this.barSummary, buttons);

    root.append(body, bar, this.settingsDialog.root);
    this.render();
  }

  enter(): void {
    this.setDevice(this.o.device());
    this.render();
    void this.loadRecords();
  }

  back(): boolean {
    if (this.settingsDialog.open) {
      this.settingsDialog.hide();
      return true;
    }
    this.o.onBack();
    return true;
  }

  action(a: NavAction): boolean {
    if (a === 'menuTabPrev' || a === 'menuTabNext') {
      // Shoulder buttons step through the modes.
      const i = MODE_IDS.indexOf(this.o.prefs.get().mode);
      const next =
        MODE_IDS[(i + (a === 'menuTabNext' ? 1 : -1) + MODE_IDS.length) % MODE_IDS.length];
      if (next) this.selectMode(next);
      return true;
    }
    return false;
  }

  setDevice(device: DeviceKind): void {
    if (device === this.device) return;
    this.device = device;
    this.inline.build();
    this.inDialog.build();
    this.render();
  }

  /** Start as if the start button was pressed (keyboard, gamepad accept, tests). */
  startSession(): void {
    const p = this.o.prefs.get();
    if (!PLAYABLE.has(p.mode) || this.start.disabled) return;
    const c = this.circuit();
    this.o.onStart({
      mode: p.mode,
      circuit: c.id,
      team: p.team,
      driver: p.driver,
      timeOfDay: timeOfDayOf(p, c),
      // Only the player's own choices: the rest follows each device's preset in the session.
      assists: p.assists[this.device] ?? {},
    });
  }

  setLoading(loading: boolean): void {
    this.start.disabled = loading || !PLAYABLE.has(this.o.prefs.get().mode);
    this.root.setAttribute('aria-busy', String(loading));
    setButtonLabel(this.start, loading ? S.menu.loading : S.modes[this.o.prefs.get().mode].start);
  }

  private circuit(): CircuitSummary {
    const id = this.o.prefs.get().circuit;
    return this.o.circuits.find((c) => c.id === id) ?? (this.o.circuits[0] as CircuitSummary);
  }

  private settingsContext(): SettingsContext {
    return {
      prefs: this.o.prefs,
      mode: () => this.o.prefs.get().mode,
      circuit: () => this.circuit(),
      device: () => this.device,
      changed: () => {
        this.inline.sync();
        this.inDialog.sync();
        this.render();
      },
    };
  }

  private selectMode(m: ModeId): void {
    if (this.o.prefs.get().mode !== m) {
      this.o.prefs.update((p) => {
        p.mode = m;
      });
    }
    this.render();
  }

  private teamButton(t: Team): HTMLButtonElement {
    const b = el('button', 'team');
    b.type = 'button';
    b.dataset.nav = '';
    b.dataset.team = t.id;
    b.setAttribute('role', 'radio');
    b.style.setProperty('--team-1', t.colours.primary);
    b.style.setProperty('--team-2', t.colours.secondary);
    b.style.setProperty('--team-bar', t.colours.tower);
    const sw = el('span', 'team__sw');
    const name = el('span', 'team__name');
    name.append(el('b', '', t.name), el('span', 'team__code', t.code));
    b.append(sw, name);
    b.addEventListener('click', () => {
      this.o.prefs.update((p) => {
        p.driver = p.team === t.id ? p.driver : 0;
        p.team = t.id;
      });
      this.render();
    });
    this.teamButtons.set(t.id, b);
    return b;
  }

  private render(): void {
    const p = this.o.prefs.get();
    const c = this.circuit();
    const mode = p.mode;
    const playable = PLAYABLE.has(mode);
    for (const [m, row] of this.modeRows) row.setAttribute('aria-current', String(m === mode));
    this.root.dataset.mode = mode;

    // Circuit card.
    const head = el('header', 'card__head');
    head.append(el('h2', 'card__title', S.circuit.title));
    const change = button({
      label: S.circuit.change,
      variant: 'quiet',
      action: 'change-circuit',
      next: true,
      onClick: () => this.o.onCircuits(),
    });
    head.append(change);
    const hero = el('div', 'circuit__hero');
    const art = el('div', 'circuit__art');
    art.append(circuitArt(c.plan));
    const title = el('div', 'circuit__title');
    title.append(el('span', 'label', c.country), el('span', 'circuit__name', c.name));
    const stats = el('div', 'stats');
    const stat = (label: string, value: string, unit?: string): HTMLElement => {
      const s = el('div', 'stat');
      const b = el('b', 'num', value);
      if (unit) b.append(el('small', '', unit));
      s.append(el('span', 'label', label), b);
      return s;
    };
    stats.append(
      stat(S.circuit.length, kmText(c.length), S.circuit.km),
      stat(S.circuit.turns, String(c.corners)),
      stat(S.circuit.laps, String(c.raceLaps)),
      stat(S.circuit.drs, String(c.drsZones)),
    );
    title.append(stats);
    hero.append(art, title);
    const tod = timeOfDayOf(p, c);
    const chips = el('div', 'conditions');
    chips.append(
      chip(
        tod === 'night-floodlit' ? 'moon' : tod === 'overcast-day' ? 'cloud' : 'sun',
        S.timeOfDay[tod] ?? tod,
      ),
      chip('route', c.direction === 'clockwise' ? S.circuit.clockwise : S.circuit.anticlockwise),
      chip('drop', S.circuit.dry),
    );
    if (c.airTemperature !== null)
      chips.append(chip('temp', S.circuit.air(Math.round(c.airTemperature - 273.15))));
    // Keep focus on the change button across a re-render.
    const hadFocus = this.circuitCard.contains(document.activeElement);
    this.circuitCard.replaceChildren(head, hero, chips);
    if (hadFocus) change.focus({ preventScroll: true });

    // Settings or the notice for modes that are not in this build.
    this.settingsCard.hidden = !playable;
    this.summaryCard.hidden = !playable;
    this.noticeCard.hidden = playable;
    if (!playable) {
      const online = mode === 'online';
      const h = el('header', 'notice__head');
      h.append(
        icon('info'),
        el('h2', 'notice__title', online ? S.notices.onlineTitle : S.notices.racesTitle),
      );
      this.noticeCard.replaceChildren(
        h,
        el('p', 'notice__body', online ? S.notices.onlineBody : S.notices.racesBody),
      );
    }
    this.presetLabel.textContent = S.setup.preset(S.menu.deviceNames[this.device]);
    this.resetInline.hidden = p.assists[this.device] === undefined;
    this.summaryText.textContent = settingsSummary(p, c, this.device);

    // Team and driver.
    const team = teamById(p.team);
    for (const [id, b] of this.teamButtons) b.setAttribute('aria-checked', String(id === team.id));
    this.teamAside.textContent = team.code;
    const src = teamCarImage(team.id, p.driver);
    if (this.carImage.getAttribute('src') !== src) {
      this.carImage.src = src;
      this.carImage.alt = S.team.livery(team.name);
    }
    this.carFigure.style.setProperty('--team-1', team.colours.primary);
    const hadDriverFocus = this.driverRow.contains(document.activeElement);
    const drivers = team.drivers.map((d, i) => {
      const b = el('button', 'driver');
      b.type = 'button';
      b.dataset.nav = '';
      b.dataset.driver = String(i);
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(p.driver === i));
      b.style.setProperty('--team-bar', team.colours.tower);
      const names = el('span', 'driver__names');
      names.append(el('span', 'driver__first', d.first), el('span', 'driver__last', d.last));
      b.append(el('span', 'driver__no num', String(d.number)), names);
      b.addEventListener('click', () => {
        this.o.prefs.update((q) => {
          q.driver = i === 1 ? 1 : 0;
        });
        this.render();
      });
      return b;
    });
    this.driverRow.replaceChildren(...drivers);
    if (hadDriverFocus) drivers[p.driver]?.focus({ preventScroll: true });

    // Action bar.
    const driver = team.drivers[p.driver];
    this.barSummary.replaceChildren(
      this.summaryPart(c.name, S.modes[mode].name),
      this.summaryPart(team.name, driver ? `#${driver.number} ${driver.last}` : ''),
      ...(playable
        ? [
            this.summaryPart(
              S.timeOfDay[tod] ?? '',
              S.setup.assistsFor(S.menu.deviceNames[this.device]),
            ),
          ]
        : []),
    );
    setButtonLabel(this.start, S.modes[mode].start);
    this.start.disabled = !playable;
    this.start.title = playable ? '' : S.notices.unavailable;
  }

  private summaryPart(a: string, b: string): HTMLElement {
    const s = el('span', 'actionbar__part');
    s.append(`${a} · `, el('b', '', b));
    return s;
  }

  private async loadRecords(): Promise<void> {
    for (const [id, node] of this.recordRows) {
      const r = await this.o.records.load(id);
      node.textContent = r ? formatLapTime(r.lap) : S.menu.noRecord;
      node.classList.toggle('is-empty', !r);
    }
  }
}
