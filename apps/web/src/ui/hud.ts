import { speedUnit } from './player-settings';
import type { DeltaClass } from '../game/timing';
import { formatDelta, formatGear, formatLapTime, formatSpeedKmh } from '../game/format';
import type { MinimapPlan } from '../game/minimap';
import { Text, el, icon, setClass, setData, svg } from './dom';
import { glyph, refreshGlyphs } from './kit/glyph';
import { S } from './strings';
import { TimingTower, type TowerRow } from './hud/tower';

export type SectorState = DeltaClass | 'run' | 'none';
export type DrsState = 'off' | 'available' | 'open';

export interface HudMessage {
  /** Short tag in the coloured block, e.g. "Lap invalid". */
  tag: string;
  text: string;
  tone: 'invalid' | 'info' | 'personal' | 'overall';
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
  /** Other cars on the map (online): world position, team colour and opacity. Optional. */
  others?: readonly { x: number; z: number; colour: string; opacity: number }[];
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
  private readonly msgEl: HTMLElement;
  private readonly msgTag: Text;
  private readonly msgText: Text;
  private readonly invalidEl: HTMLElement;
  private readonly invalidReason: Text;
  private readonly wrongWayEl: HTMLElement;
  private readonly stoppedEl: HTMLElement;
  private readonly dot: SVGCircleElement;
  private readonly ghostDot: SVGCircleElement;
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

  /** `mode`: the tower's session label ("Time trial", "Online race"). */
  constructor(plan: MinimapPlan, identity?: HudIdentity, mode: string = S.hud.timeTrial) {
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
    const tower = new TimingTower({ label: mode });
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
    control.append(this.invalidEl, this.wrongWayEl, this.stoppedEl, this.msgEl);

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
    s.append(this.ghostDot, this.othersLayer, this.dot);
    map.append(mHead, s);

    // Driver cluster (bottom right): tyre panel (desktop) + drive panel.
    const cluster = el('div', 'hud-cluster');

    const tyres = el('section', 'hud-tyres panel');
    tyres.setAttribute('aria-label', S.hud.tyres);
    tyres.title = S.hud.tyreModel;
    const tHead = el('div', 'hud-tyres__head');
    const compound = el('span', 'hud-compound');
    const cCode = el('b', '', identity?.compoundCode ?? 'M');
    const cColour = identity?.compoundColour ?? '#F2902F';
    const cSlots = identity?.compoundSlots ?? [-1, 1];
    compound.style.setProperty('--compound', cColour);
    const ticks = el('span', 'hud-compound__ticks');
    for (const slot of [-1, 0, 1]) {
      const tick = el('i', cSlots.includes(slot) ? 'is-on' : '');
      ticks.append(tick);
    }
    compound.append(cCode, ticks);
    tHead.append(el('span', 'label', S.hud.tyres), compound);
    const tGrid = el('div', 'hud-tyres__grid');
    for (const pos of WHEEL_POSITIONS) {
      const w = el('div', 'hud-tyre');
      w.append(el('span', 'hud-tyre__pos', pos), el('b', 'num is-empty', '—'));
      tGrid.append(w);
    }
    tyres.append(tHead, tGrid, el('span', 'hud-tyres__note', S.hud.noData));

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
    drive.append(revs, sg, ers);
    cluster.append(tyres, drive);

    const right = el('div', 'hud-right');
    right.append(timing, map);
    root.append(session, control, right, cluster);
    refreshGlyphs(root);
  }

  /** Show or hide the HUD layer (used for HUD-on vs HUD-off frame-time measurement). */
  setVisible(on: boolean): void {
    this.root.hidden = !on;
  }

  /** Why the running lap is invalid, shown in the flag while it is (track limits, a reset). */
  setInvalidReason(text: string): void {
    this.invalidReason.set(text);
  }

  update(h: HudState): void {
    const t = this.t;
    if (!this.staticSet) {
      // Circuit name and length do not change during a session: written once.
      this.staticSet = true;
      t.mapName?.set(h.circuit);
      t.mapLen?.set(`${h.lengthKm} ${S.circuit.km}`);
    }
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

    // Compositor-only transform updates so the ERS bar never triggers layout.
    const ersScale = h.ers.toFixed(3);
    if (ersScale !== this.lastErs) {
      this.ersFill.style.transform = `scaleX(${ersScale})`;
      this.lastErs = ersScale;
    }
    const markShift = `${((h.ersLap - 1) * 100).toFixed(1)}%`;
    if (markShift !== this.lastMark) {
      this.ersMark.style.transform = `translateX(${markShift})`;
      this.lastMark = markShift;
    }
    setData(this.drsEl, 'state', h.drs);

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
}
