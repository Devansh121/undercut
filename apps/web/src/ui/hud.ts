import { speedUnit } from './player-settings';
import type { DeltaClass } from '../game/timing';
import { formatDelta, formatGear, formatLapTime, formatSpeedKmh } from '../game/format';
import type { MinimapPlan } from '../game/minimap';
import { Text, el, icon, setClass, setData, svg } from './dom';
import { glyph, refreshGlyphs } from './kit/glyph';
import { S } from './strings';
import { TimingTower, type TowerFlag, type TowerRow } from './hud/tower';
import { StartLightsPanel } from './hud/start-lights';
import type {
  RaceFlagsSnapshot,
  RaceMessage,
  RaceSafetyIndicator,
  StartLightsState,
  TowerGapMode,
} from './hud/race-display-model';
import {
  compoundMark,
  formatFuel,
  formatTyreTemp,
  tyreBand,
  type CompoundMark,
  type HudTyres,
} from './hud/tyres';

export type { HudTyres } from './hud/tyres';
export type { TowerFlag, TowerRow } from './hud/tower';

export type SectorState = DeltaClass | 'run' | 'none';
export type DrsState = 'off' | 'available' | 'open';

export interface HudMessage {
  /** Short tag in the coloured block, e.g. "Lap invalid". */
  tag: string;
  text: string;
  tone: 'invalid' | 'info' | 'personal' | 'overall';
}

export interface HudRaceState {
  lap: number;
  totalLaps: number | null;
  rows: readonly TowerRow[];
  gapMode: TowerGapMode;
  gapLabel?: string;
  startLights: StartLightsState;
  flags: RaceFlagsSnapshot;
  safety: RaceSafetyIndicator | null;
  messages: readonly RaceMessage[];
}

export interface HudSectorState {
  state: SectorState;
  time: number | null;
  delta: number | null;
}

/** Static team, driver and tyre identity for the current session. */
export interface HudIdentity {
  teamColour: string;
  driverCode: string;
  driverNumber: number;
  compoundCode: string;
  compoundColour: string;
  compoundSlots: readonly number[];
}

/** Optional timing-tower override for multi-car sessions (online races). */
export interface HudTowerState {
  lap: number | null;
  total: number | null;
  rows: readonly TowerRow[];
  /** Null hides the footer line completely. */
  footer?: { label: string; value: string; muted?: boolean } | null;
  flag?: { kind: TowerFlag; text: string };
}

/** Everything the HUD shows, updated each frame by the drive screen. */
export interface HudState {
  circuit: string;
  lengthKm: string;
  speed: number;
  gear: number;
  rpm: number;
  /** 0–15 rev lights lit, 16 = at the limiter (flash). */
  revLights: number;
  lap: number;
  running: boolean;
  valid: boolean;
  invalidReason?: string;
  lapTime: number;
  liveDelta: number | null;
  sectors: HudSectorState[];
  last: number | null;
  lastClass: DeltaClass | null;
  best: number | null;
  record: number | null;
  ghost: boolean;
  /** Energy store and this lap's remaining deployment, both 0–1. */
  ers: number;
  ersLap: number;
  ersMode: string;
  drs: DrsState;
  carX: number;
  carZ: number;
  ghostX: number | null;
  ghostZ: number | null;
  wrongWay: boolean;
  stopped: boolean;
  message: HudMessage | null;
  /** Tyre temperatures and wear, when the session models them (else the panel says no data). */
  tyres?: HudTyres | null;
  /** Fuel on board, kg, when the session burns a start load (else not shown). */
  fuel?: number | null;
  /** Other cars on the map (online): world position, team colour and opacity. Optional. */
  others?: readonly { x: number; z: number; colour: string; opacity: number }[];
  /** Custom timing tower rows and header (online races). */
  tower?: HudTowerState | null;
  /** Race display state (start lights, 20-car tower, flags, safety, message queue). */
  race?: HudRaceState | null;
}

/** Shared empty list for sessions with no other cars on the map. */
const NO_OTHERS: NonNullable<HudState['others']> = Object.freeze([]) as unknown as NonNullable<
  HudState['others']
>;

const REV_COLOURS = ['g', 'g', 'g', 'g', 'g', 'r', 'r', 'r', 'r', 'r', 'b', 'b', 'b', 'b', 'b'];
const WHEEL_POSITIONS = ['FL', 'FR', 'RL', 'RR'] as const;

/**
 * The in-session HUD over the canvas, laid out as design/mock/hud.html for time trial: session
 * panel top left, control messages top centre, lap timing top right, track map bottom left, and
 * the driver cluster (tyre panel + speed/gear/ERS/DRS) bottom right (bottom centre on a phone).
 * DOM nodes are built once and only values that change are written each frame, using GPU
 * transforms for meters to avoid layout thrash.
 */
export class Hud {
  readonly root: HTMLElement;
  private readonly t: Record<string, Text> = {};
  private readonly sectorEls: HTMLElement[] = [];
  private readonly sectorText: Text[] = [];
  private readonly revs: HTMLElement[] = [];
  private readonly ersFill: HTMLElement;
  private readonly ersMark: HTMLElement;
  private readonly drsEl: HTMLElement;
  private readonly deltaEl: HTMLElement;
  private readonly lastEl: HTMLElement;
  private readonly tower: TimingTower;
  /** The tower's two rows, reused every frame. */
  private readonly towerRows: [TowerRow, TowerRow];
  private readonly startLights: StartLightsPanel;
  private readonly raceFlagEl: HTMLElement;
  private readonly raceFlagTitle: Text;
  private readonly raceFlagDetail: Text;
  private readonly safetyEl: HTMLElement;
  private readonly safetyTitle: Text;
  private readonly safetyDetail: Text;
  private readonly raceMsgsEl: HTMLElement;
  private readonly raceMsgSlots: { el: HTMLElement; tag: Text; text: Text; lastId: number }[] = [];
  private readonly msgEl: HTMLElement;
  private readonly msgTag: Text;
  private readonly msgText: Text;
  private readonly invalidEl: HTMLElement;
  private readonly invalidReason: Text;
  private readonly wrongWayEl: HTMLElement;
  private readonly stoppedEl: HTMLElement;
  private readonly dot: SVGCircleElement;
  private readonly ghostDot: SVGCircleElement;
  private readonly mapSectorEls: SVGPathElement[] = [];
  private readonly lastYellow: boolean[] = [];
  private readonly othersLayer: SVGGElement;
  private readonly otherDots: SVGCircleElement[] = [];
  private readonly plan: MinimapPlan;
  private lastErs = '';
  private lastMark = '';
  private lastCarX = '';
  private lastCarY = '';
  private lastGhostX = '';
  private lastGhostY = '';
  private lastGhostVis = false;
  /** Reused for every map projection: update() allocates no arrays. */
  private readonly xy: [number, number] = [0, 0];
  private staticSet = false;
  /** Tyre panel (desktop) and the compact tyre strip (phone). */
  private readonly tyreCells: { cell: HTMLElement; temp: Text; wear: HTMLElement; pct: number }[] =
    [];
  private readonly miniCells: HTMLElement[] = [];
  private readonly tyreNote: Text;
  private readonly miniFuel: Text;
  private readonly compoundEls: { root: HTMLElement; code: Text; ticks: HTMLElement[] }[] = [];
  private compoundShown = '';

  /** `mode`: the tower's session label ("Time trial", "Online race"). */
  constructor(
    plan: MinimapPlan,
    identity?: HudIdentity,
    mode: string = S.hud.timeTrial,
    onToggleGapMode?: () => void,
  ) {
    this.plan = plan;
    const root = el('div', 'hud');
    root.dataset.testid = 'hud';
    this.root = root;
    const teamColour = identity?.teamColour ?? '#3d6fe0';
    root.style.setProperty('--hud-team', teamColour);

    const txt = (key: string, node: HTMLElement): HTMLElement => {
      this.t[key] = new Text(node);
      return node;
    };

    // Timing tower (top left): in time trial, the player's best and the record (the ghost's lap).
    const tower = new TimingTower({
      label: mode,
      ...(onToggleGapMode ? { onToggleGapMode } : {}),
    });
    this.tower = tower;
    this.towerRows = [
      {
        id: 'player',
        position: 1,
        code: identity?.driverCode ?? S.hud.you,
        teamColour: teamColour,
        value: S.hud.noTime,
        tone: 'empty',
        player: true,
      },
      {
        id: 'record',
        position: null,
        code: S.hud.recordCode,
        teamColour: 'var(--c-time-overall)',
        value: S.hud.noTime,
        tone: 'empty',
        reference: true,
      },
    ];
    const session = tower.root;

    // Control and prompt slot (top centre).
    const control = el('div', 'hud-control');
    this.startLights = new StartLightsPanel();

    this.raceFlagEl = el('div', 'hud-flag hud-flag--race');
    this.raceFlagEl.setAttribute('role', 'status');
    this.raceFlagEl.dataset.testid = 'race-flag';
    this.raceFlagEl.hidden = true;
    const rfSw = el('div', 'hud-flag__sw');
    rfSw.append(icon('flag'));
    const rfTxt = el('div', 'hud-flag__txt');
    const rfTitle = el('strong', '');
    const rfDetail = el('span', '');
    this.raceFlagTitle = new Text(rfTitle);
    this.raceFlagDetail = new Text(rfDetail);
    rfTxt.append(rfTitle, rfDetail);
    this.raceFlagEl.append(rfSw, rfTxt);

    this.safetyEl = el('div', 'hud-prompt hud-prompt--safety');
    this.safetyEl.setAttribute('role', 'status');
    this.safetyEl.dataset.testid = 'race-safety';
    this.safetyEl.hidden = true;
    const sfSw = el('div', 'hud-prompt__sw');
    sfSw.append(icon('warning'));
    const sfTxt = el('div', 'hud-prompt__txt');
    const sfTitle = el('strong', '');
    const sfDetail = el('span', '');
    this.safetyTitle = new Text(sfTitle);
    this.safetyDetail = new Text(sfDetail);
    sfTxt.append(sfTitle, sfDetail);
    this.safetyEl.append(sfSw, sfTxt);

    this.invalidEl = el('div', 'hud-flag');
    this.invalidEl.setAttribute('role', 'status');
    const sw = el('div', 'hud-flag__sw');
    sw.append(icon('flag'));
    const ftxt = el('div', 'hud-flag__txt');
    const reasonEl = el('span', '', S.hud.trackLimits);
    this.invalidReason = new Text(reasonEl);
    ftxt.append(el('strong', '', S.hud.lapInvalid), reasonEl);
    this.invalidEl.append(sw, ftxt);
    this.invalidEl.dataset.testid = 'lap-invalid';

    this.wrongWayEl = el('div', 'hud-prompt hud-prompt--warn');
    this.wrongWayEl.setAttribute('role', 'status');
    this.wrongWayEl.dataset.testid = 'hud-wrong-way';
    const wSw = el('div', 'hud-prompt__sw');
    wSw.append(icon('warning'));
    const wTxt = el('div', 'hud-prompt__txt');
    wTxt.append(el('strong', '', S.hud.wrongWay), el('span', '', S.hud.turnAround));
    this.wrongWayEl.append(wSw, wTxt);

    this.stoppedEl = el('div', 'hud-prompt');
    this.stoppedEl.setAttribute('role', 'status');
    this.stoppedEl.dataset.testid = 'hud-stopped';
    const stTxt = el('div', 'hud-prompt__txt');
    stTxt.append(
      el('strong', '', S.hud.stopped),
      glyph('resetToTrack', 'hud-prompt__glyph'),
      el('span', '', S.hud.resetPrompt),
    );
    this.stoppedEl.append(stTxt);

    this.msgEl = el('div', 'hud-msg');
    this.msgEl.setAttribute('role', 'status');
    this.msgEl.dataset.testid = 'hud-message';
    const tag = el('span', 'hud-msg__tag');
    const body = el('span', 'hud-msg__body');
    this.msgTag = new Text(tag);
    this.msgText = new Text(body);
    this.msgEl.append(tag, body);

    this.raceMsgsEl = el('div', 'hud-messages');
    this.raceMsgsEl.setAttribute('role', 'log');
    this.raceMsgsEl.setAttribute('aria-live', 'polite');
    this.raceMsgsEl.dataset.testid = 'race-messages';
    this.raceMsgsEl.hidden = true;
    for (let i = 0; i < 3; i++) {
      const row = el('div', 'hud-msg hud-msg--queue');
      row.hidden = true;
      const mTag = el('span', 'hud-msg__tag');
      const mBody = el('span', 'hud-msg__body');
      row.append(mTag, mBody);
      this.raceMsgsEl.append(row);
      this.raceMsgSlots.push({ el: row, tag: new Text(mTag), text: new Text(mBody), lastId: -1 });
    }

    control.append(
      this.startLights.root,
      this.raceFlagEl,
      this.invalidEl,
      this.wrongWayEl,
      this.stoppedEl,
      this.safetyEl,
      this.msgEl,
      this.raceMsgsEl,
    );

    // Lap timing (top right).
    const timing = el('section', 'hud-timing panel');
    timing.setAttribute('aria-label', S.hud.lapTiming);
    timing.dataset.testid = 'timing';
    const top = el('div', 'panel-head');
    top.append(
      el('span', 'label', S.hud.currentLap),
      txt('lapNo', el('span', 'hud-timing__lap num')),
    );
    const now = el('div', 'hud-timing__now');
    const lapTime = txt('lapTime', el('span', 'hud-timing__t num'));
    lapTime.dataset.testid = 'lap-time';
    this.deltaEl = txt('delta', el('span', 'hud-delta num'));
    now.append(lapTime, this.deltaEl);
    const sectors = el('div', 'hud-sectors');
    for (let i = 0; i < 3; i++) {
      const s = el('div', 'hud-sector');
      s.dataset.testid = `sector-${i + 1}`;
      const v = el('div', 'hud-sector__v');
      const b = el('b', 'num');
      v.append(el('span', 'label', S.hud.sectors(i + 1)), b);
      s.append(el('i'), v);
      sectors.append(s);
      this.sectorEls.push(s);
      this.sectorText.push(new Text(b));
    }
    const ref = el('div', 'hud-timing__ref');
    const last = el('div');
    this.lastEl = txt('last', el('b', 'num'));
    this.lastEl.dataset.testid = 'last-lap';
    last.append(el('span', 'label', S.hud.last), this.lastEl);
    const best = el('div');
    const bestB = txt('best', el('b', 'num hud-pb'));
    bestB.dataset.testid = 'best-lap';
    best.append(el('span', 'label', S.hud.best), bestB);
    ref.append(last, best);
    timing.append(top, now, sectors, ref);

    // Minimap (right, under the lap timing).
    const map = el('section', 'hud-map panel');
    map.setAttribute('aria-label', S.hud.trackMap);
    const mHead = el('header', 'hud-map__head');
    mHead.append(txt('mapName', el('span', 'label')), txt('mapLen', el('span', 'label')));
    const s = svg('svg', { viewBox: `0 0 ${plan.width} ${plan.height}`, 'aria-hidden': 'true' });
    s.append(
      svg('path', {
        d: plan.path,
        fill: 'none',
        stroke: '#0e1013',
        'stroke-width': 9,
        'stroke-linejoin': 'round',
      }),
      svg('path', {
        d: plan.path,
        fill: 'none',
        stroke: '#3a3f45',
        'stroke-width': 6.5,
        'stroke-linejoin': 'round',
      }),
      svg('path', {
        d: plan.path,
        fill: 'none',
        stroke: '#dcdad4',
        'stroke-width': 2.2,
        'stroke-linejoin': 'round',
      }),
      svg('line', {
        x1: plan.startLine[0],
        y1: plan.startLine[1],
        x2: plan.startLine[2],
        y2: plan.startLine[3],
        stroke: '#f2f0eb',
        'stroke-width': 2.4,
      }),
    );
    const sectorsLayer = svg('g', {
      class: 'hud-map__sectors',
      'data-testid': 'map-yellow-sectors',
    });
    for (let i = 0; i < plan.sectorPaths.length; i++) {
      const seg = svg('path', {
        d: plan.sectorPaths[i] as string,
        fill: 'none',
        class: 'hud-map__sector',
        'data-sector': String(i),
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
      });
      sectorsLayer.append(seg);
      this.mapSectorEls.push(seg);
      this.lastYellow.push(false);
    }
    this.ghostDot = svg('circle', {
      r: 3.4,
      fill: '#bcd3ff',
      stroke: '#0b0c0e',
      'stroke-width': 1,
      opacity: 0,
    });
    this.dot = svg('circle', {
      r: 5.2,
      fill: teamColour,
      stroke: '#f2f0eb',
      'stroke-width': 2,
    });
    this.othersLayer = svg('g', { 'data-testid': 'map-others' });
    s.append(sectorsLayer, this.ghostDot, this.othersLayer, this.dot);
    map.append(mHead, s);

    // Driver cluster (bottom right): tyre panel (desktop) + drive panel.
    const cluster = el('div', 'hud-cluster');

    // The compound the session starts on (identity), until the tyres say otherwise.
    const startMark: CompoundMark = identity
      ? {
          code: identity.compoundCode,
          colour: identity.compoundColour,
          slots: identity.compoundSlots,
        }
      : compoundMark('medium');
    const tyres = el('section', 'hud-tyres panel');
    tyres.setAttribute('aria-label', S.hud.tyres);
    tyres.dataset.testid = 'hud-tyres';
    const tHead = el('div', 'hud-tyres__head');
    tHead.append(el('span', 'label', S.hud.tyres), this.compoundMark(startMark));
    const tGrid = el('div', 'hud-tyres__grid');
    for (const pos of WHEEL_POSITIONS) {
      const w = el('div', 'hud-tyre');
      const temp = el('b', 'num is-empty', '—');
      const bar = el('span', 'hud-tyre__wear');
      const wear = el('i');
      bar.append(wear);
      w.append(el('span', 'hud-tyre__pos', pos), temp, bar);
      tGrid.append(w);
      this.tyreCells.push({ cell: w, temp: new Text(temp), wear, pct: -1 });
    }
    const note = el('span', 'hud-tyres__note', S.hud.noData);
    this.tyreNote = new Text(note);
    tyres.append(tHead, tGrid, note);

    const drive = el('section', 'hud-drive panel');
    drive.setAttribute('aria-label', S.hud.car);
    const revs = el('div', 'hud-revs');
    revs.setAttribute('aria-hidden', 'true');
    for (const c of REV_COLOURS) {
      const i = el('i', c);
      revs.append(i);
      this.revs.push(i);
    }
    const sg = el('div', 'hud-speedgear');
    const rpm = el('div', 'hud-rpm');
    rpm.append(txt('rpm', el('b', 'num')), el('span', 'label', S.hud.rpm));
    const gear = txt('gear', el('div', 'hud-gear num'));
    gear.dataset.testid = 'gear';
    const spd = el('div', 'hud-spd');
    const spdB = txt('speed', el('b', 'num'));
    spdB.dataset.testid = 'speed';
    spd.append(spdB, txt('speedUnit', el('span', 'label', S.hud.kmh)));
    sg.append(rpm, gear, spd);
    const ers = el('div', 'hud-ers');
    const ersLeft = el('div');
    const row1 = el('div', 'hud-ers__row');
    row1.append(
      el('span', 'label', S.hud.ers),
      txt('ersMode', el('span', 'hud-ers__mode')),
      txt('ersPct', el('b', 'num')),
    );
    const meter = el('div', 'hud-ers__meter');
    this.ersFill = el('i');
    this.ersMark = el('u');
    meter.append(this.ersFill, this.ersMark);
    ersLeft.append(row1, meter);
    this.drsEl = el('div', 'hud-drs', S.hud.drs);
    this.drsEl.dataset.testid = 'drs';
    ers.append(ersLeft, this.drsEl);
    // Phone: the tyre panel is hidden; a compact strip in the drive panel instead.
    const mini = el('div', 'hud-mini-tyres');
    mini.dataset.testid = 'hud-mini-tyres';
    const cells = el('span', 'hud-mini-tyres__cells');
    cells.setAttribute('aria-hidden', 'true');
    for (let i = 0; i < 4; i++) {
      const c = el('i');
      cells.append(c);
      this.miniCells.push(c);
    }
    const miniFuel = el('b', 'num');
    this.miniFuel = new Text(miniFuel);
    mini.append(this.compoundMark(startMark), cells, miniFuel);
    drive.append(revs, sg, ers, mini);
    cluster.append(tyres, drive);

    const right = el('div', 'hud-right');
    right.append(timing, map);
    root.append(session, control, right, cluster);
    refreshGlyphs(root);
  }

  /** A compound mark (code letter and ticks), kept to follow the compound fitted. */
  private compoundMark(m: CompoundMark): HTMLElement {
    const root = el('span', 'hud-compound');
    const code = el('b', '', m.code);
    const ticks = el('span', 'hud-compound__ticks');
    const tickEls: HTMLElement[] = [];
    for (const slot of [-1, 0, 1]) {
      const tick = el('i', m.slots.includes(slot) ? 'is-on' : '');
      ticks.append(tick);
      tickEls.push(tick);
    }
    root.style.setProperty('--compound', m.colour);
    root.append(code, ticks);
    this.compoundEls.push({ root, code: new Text(code), ticks: tickEls });
    return root;
  }

  /** The tyre panel, the phone strip and fuel. Writes only what changed. */
  private updateTyres(h: HudState): void {
    const t = h.tyres ?? null;
    if (t && t.compound !== this.compoundShown) {
      this.compoundShown = t.compound;
      const m = compoundMark(t.compound);
      for (const c of this.compoundEls) {
        c.code.set(m.code);
        c.root.style.setProperty('--compound', m.colour);
        c.ticks.forEach((tick, k) => setClass(tick, 'is-on', m.slots.includes(k - 1)));
      }
    }
    for (let i = 0; i < 4; i++) {
      const cell = this.tyreCells[i]!;
      const mini = this.miniCells[i]!;
      if (!t) {
        cell.temp.set('—');
        setClass(cell.temp.node, 'is-empty', true);
        setData(cell.cell, 'band', '');
        setData(mini, 'band', '');
        continue;
      }
      const band = tyreBand(t.temp[i]!, t.low, t.high);
      cell.temp.set(formatTyreTemp(t.temp[i]!));
      setClass(cell.temp.node, 'is-empty', false);
      setData(cell.cell, 'band', band);
      setData(mini, 'band', band);
      // Tread left, whole per cent: a style write only when it changes.
      const pct = Math.round(100 * (1 - Math.min(1, Math.max(0, t.wear[i]!))));
      if (pct !== cell.pct) {
        cell.pct = pct;
        cell.wear.style.setProperty('--left', `${pct}%`);
        cell.wear.title = S.hud.treadLeft(pct);
      }
    }
    const fuel = h.fuel ?? null;
    this.tyreNote.set(fuel !== null ? S.hud.fuelOnBoard(formatFuel(fuel)) : t ? '' : S.hud.noData);
    this.miniFuel.set(fuel !== null ? formatFuel(fuel) : '');
  }

  /** Show or hide the HUD layer (used for HUD-on vs HUD-off frame-time measurement). */
  setVisible(on: boolean): void {
    this.root.hidden = !on;
  }

  /** Why the running lap is invalid, shown in the flag while it is (track limits, a reset). */
  setInvalidReason(text: string): void {
    this.invalidReason.set(text);
  }

  private updateRace(r: HudRaceState | null): void {
    this.startLights.update(r?.startLights ?? null);
    if (!r) {
      if (!this.raceFlagEl.hidden) this.raceFlagEl.hidden = true;
      if (!this.safetyEl.hidden) this.safetyEl.hidden = true;
      if (!this.raceMsgsEl.hidden) this.raceMsgsEl.hidden = true;
      return;
    }

    const banner = r.flags.banner;
    const showFlag = banner !== null;
    if (this.raceFlagEl.hidden !== !showFlag) this.raceFlagEl.hidden = !showFlag;
    setClass(this.raceFlagEl, 'is-on', showFlag);
    if (banner) {
      setData(this.raceFlagEl, 'flag', banner.flag);
      this.raceFlagTitle.set(banner.title);
      this.raceFlagDetail.set(banner.detail);
    }

    const safety = r.safety;
    const showSafety = safety !== null;
    if (this.safetyEl.hidden !== !showSafety) this.safetyEl.hidden = !showSafety;
    setClass(this.safetyEl, 'is-on', showSafety);
    if (safety) {
      setData(this.safetyEl, 'safety', safety.kind);
      this.safetyTitle.set(safety.title);
      this.safetyDetail.set(safety.detail);
    }

    const ys = r.flags.yellowSectors;
    for (let i = 0; i < this.mapSectorEls.length; i++) {
      const on = Boolean(ys[i]);
      if (on !== this.lastYellow[i]) {
        this.lastYellow[i] = on;
        const seg = this.mapSectorEls[i]!;
        seg.classList.toggle('is-yellow', on);
        if (on) seg.setAttribute('data-yellow', 'on');
        else seg.removeAttribute('data-yellow');
      }
    }

    const msgs = r.messages;
    const hasMsgs = msgs.length > 0;
    if (this.raceMsgsEl.hidden !== !hasMsgs) this.raceMsgsEl.hidden = !hasMsgs;
    for (let i = 0; i < this.raceMsgSlots.length; i++) {
      const slot = this.raceMsgSlots[i]!;
      const m = msgs[i];
      if (!m) {
        if (!slot.el.hidden) slot.el.hidden = true;
        slot.lastId = -1;
        continue;
      }
      if (slot.el.hidden) slot.el.hidden = false;
      if (slot.lastId !== m.id) {
        slot.lastId = m.id;
        slot.tag.set(m.tag);
        slot.text.set(m.text);
        setData(slot.el, 'tone', m.tone);
      }
    }
  }

  update(h: HudState): void {
    this.updateTyres(h);
    const t = this.t;
    if (!this.staticSet) {
      // Circuit name and length do not change during a session: written once.
      this.staticSet = true;
      t.mapName?.set(h.circuit);
      t.mapLen?.set(`${h.lengthKm} ${S.circuit.km}`);
    }
    const r = h.race ?? null;
    if (r) {
      this.tower.setRaceMode(true, r.gapLabel === undefined);
      this.tower.setLap(r.lap > 0 ? r.lap : null, r.totalLaps);
      this.tower.setGapMode(r.gapMode, r.gapLabel);
      this.tower.setStatus(r.flags.towerStatus.flag, r.flags.towerStatus.text);
      this.tower.setFooter('', '');
      this.tower.update(r.rows);
    } else if (h.tower) {
      this.tower.setRaceMode(false);
      this.tower.setLap(h.tower.lap, h.tower.total);
      if (h.tower.flag) this.tower.setStatus(h.tower.flag.kind, h.tower.flag.text);
      this.tower.update(h.tower.rows);
      if (h.tower.footer === null || h.tower.footer === undefined) {
        this.tower.setFooter('', '', true);
      } else {
        this.tower.setFooter(
          h.tower.footer.label,
          h.tower.footer.value,
          h.tower.footer.muted ?? false,
        );
      }
    } else {
      this.tower.setRaceMode(false);
      this.tower.setLap(h.lap > 0 ? h.lap : null);
      const mine = this.towerRows[0];
      const rec = this.towerRows[1];
      mine.value = h.best === null ? S.hud.noTime : formatLapTime(h.best);
      mine.tone = h.best === null ? 'empty' : '';
      rec.value = h.record === null ? S.hud.noTime : formatLapTime(h.record);
      rec.tone = h.record === null ? 'empty' : 'overall';
      this.tower.update(this.towerRows);
      // The map names the circuit; the footer says whether the ghost of the record is out.
      this.tower.setFooter(S.hud.ghost, h.ghost ? S.hud.ghostOnTrack : S.hud.ghostOff, !h.ghost);
    }
    this.updateRace(r);
    t.lapNo?.set(h.lap > 0 ? S.hud.lapN(h.lap) : S.hud.outLap);
    setClass(this.t.best?.node as HTMLElement, 'is-empty', h.best === null);
    setClass(this.lastEl, 'is-empty', h.last === null);
    t.lapTime?.set(h.running ? formatLapTime(h.lapTime) : formatLapTime(0));
    t.speed?.set(
      speedUnit() === 'mph'
        ? String(Math.max(0, Math.round(Math.abs(h.speed) / 0.44704)))
        : formatSpeedKmh(h.speed),
    );
    t.speedUnit?.set(speedUnit() === 'mph' ? S.pause.mph : S.hud.kmh);
    t.gear?.set(formatGear(h.gear));
    t.rpm?.set(String(Math.round(h.rpm / 10) * 10).replace(/\B(?=(\d{3})+$)/, ' '));
    t.last?.set(formatLapTime(h.last));
    t.best?.set(formatLapTime(h.best));
    t.ersMode?.set(h.ersMode);
    t.ersPct?.set(`${Math.round(h.ers * 100)}%`);

    const d = h.liveDelta;
    t.delta?.set(d === null ? '' : formatDelta(d));
    setClass(this.deltaEl, 'is-hidden', d === null);
    setData(this.deltaEl, 'tone', d === null ? '' : d <= 0 ? 'good' : 'bad');
    setData(this.lastEl, 'tone', h.lastClass ?? '');

    for (let i = 0; i < 3; i++) {
      const s = h.sectors[i];
      const node = this.sectorEls[i] as HTMLElement;
      setData(node, 'state', s?.state ?? 'none');
      const text =
        !s || s.time === null
          ? '—'
          : s.delta !== null
            ? formatDelta(s.delta)
            : formatLapTime(s.time, true);
      this.sectorText[i]?.set(text);
    }

    const flash = h.revLights > 15;
    for (let i = 0; i < 15; i++) {
      setClass(this.revs[i] as HTMLElement, 'on', flash ? true : i < h.revLights);
    }
    setClass(this.root, 'is-limiter', flash);

    // The fill uses a compositor transform; the two-pixel lap marker stays inside the meter.
    const ersScale = h.ers.toFixed(3);
    if (ersScale !== this.lastErs) {
      this.ersFill.style.transform = `scaleX(${ersScale})`;
      this.lastErs = ersScale;
    }
    const markShift = `${(h.ersLap * 100).toFixed(1)}%`;
    if (markShift !== this.lastMark) {
      this.ersMark.style.left = `clamp(2px, ${markShift}, 100%)`;
      this.lastMark = markShift;
    }
    setData(this.drsEl, 'state', h.drs);
    // The phone's DRS touch button shows the same state (styles.css), so the cluster can drop
    // its own DRS box there: one DRS control on screen.
    setData(document.documentElement, 'drs', h.drs);

    setClass(this.invalidEl, 'is-on', h.running && !h.valid);
    if (h.running && !h.valid) this.invalidReason.set(h.invalidReason ?? S.hud.trackLimits);
    setClass(this.wrongWayEl, 'is-on', h.wrongWay);
    setClass(this.stoppedEl, 'is-on', !h.wrongWay && h.stopped);
    if (h.message) {
      this.msgTag.set(h.message.tag);
      this.msgText.set(h.message.text);
      setData(this.msgEl, 'tone', h.message.tone);
    }
    setClass(this.msgEl, 'is-on', h.message !== null);

    this.plan.project(h.carX, h.carZ, this.xy);
    const x = this.xy[0];
    const y = this.xy[1];
    const cx = x.toFixed(1);
    const cy = y.toFixed(1);
    if (cx !== this.lastCarX) {
      this.dot.setAttribute('cx', cx);
      this.lastCarX = cx;
    }
    if (cy !== this.lastCarY) {
      this.dot.setAttribute('cy', cy);
      this.lastCarY = cy;
    }

    const ghostOn = h.ghostX !== null && h.ghostZ !== null;
    if (ghostOn) {
      this.plan.project(h.ghostX as number, h.ghostZ as number, this.xy);
      const gx = this.xy[0];
      const gy = this.xy[1];
      const gxs = gx.toFixed(1);
      const gys = gy.toFixed(1);
      if (gxs !== this.lastGhostX) {
        this.ghostDot.setAttribute('cx', gxs);
        this.lastGhostX = gxs;
      }
      if (gys !== this.lastGhostY) {
        this.ghostDot.setAttribute('cy', gys);
        this.lastGhostY = gys;
      }
    }
    if (ghostOn !== this.lastGhostVis) {
      this.ghostDot.setAttribute('opacity', ghostOn ? '1' : '0');
      this.lastGhostVis = ghostOn;
    }
    const others = h.others ?? NO_OTHERS;
    while (this.otherDots.length < others.length) {
      const dot = svg('circle', { r: 4, stroke: '#0b0c0e', 'stroke-width': 1.2 });
      this.othersLayer.append(dot);
      this.otherDots.push(dot);
    }
    for (let i = 0; i < this.otherDots.length; i++) {
      const dot = this.otherDots[i] as SVGCircleElement;
      const o = others[i];
      if (!o) {
        dot.setAttribute('opacity', '0');
        continue;
      }
      this.plan.project(o.x, o.z, this.xy);
      dot.setAttribute('cx', this.xy[0].toFixed(1));
      dot.setAttribute('cy', this.xy[1].toFixed(1));
      dot.setAttribute('fill', o.colour);
      dot.setAttribute('opacity', o.opacity.toFixed(2));
    }
  }

  /** Release listeners and observers held by child HUD modules. */
  destroy(): void {
    this.tower.destroy();
  }
}
