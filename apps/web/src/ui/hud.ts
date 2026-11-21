import type { DeltaClass } from '../game/timing';
import { formatDelta, formatGear, formatLapTime, formatSpeedKmh } from '../game/format';
import type { MinimapPlan } from '../game/minimap';
import { Text, el, icon, setClass, setData, svg } from './dom';

export type SectorState = DeltaClass | 'run' | 'none';
export type DrsState = 'off' | 'available' | 'open';

export interface HudMessage {
  /** Short tag in the coloured block, e.g. "Lap invalid". */
  tag: string;
  text: string;
  tone: 'invalid' | 'info' | 'personal' | 'overall';
}

/** Everything the HUD shows, recomputed each frame by the drive screen. */
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
  lapTime: number;
  liveDelta: number | null;
  sectors: { state: SectorState; time: number | null; delta: number | null }[];
  last: number | null;
  lastClass: DeltaClass | null;
  best: number | null;
  record: number | null;
  /** Energy store and this lap's remaining deployment, both 0–1. */
  ers: number;
  ersLap: number;
  ersMode: string;
  drs: DrsState;
  carX: number;
  carZ: number;
  ghostX: number | null;
  ghostZ: number | null;
  message: HudMessage | null;
  /** Other cars on the map (online): world position, team colour and opacity. Optional. */
  others?: readonly { x: number; z: number; colour: string; opacity: number }[];
}

const REV_COLOURS = ['g', 'g', 'g', 'g', 'g', 'r', 'r', 'r', 'r', 'r', 'b', 'b', 'b', 'b', 'b'];

/**
 * The in-session HUD over the canvas, laid out as design/mock/hud.html for time trial: session
 * panel top left, message slot top centre, lap timing top right, map bottom left, the driver
 * cluster bottom right (bottom centre on a phone). DOM nodes are built once and only the
 * values that change are written each frame.
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
  private readonly msgEl: HTMLElement;
  private readonly msgTag: Text;
  private readonly msgText: Text;
  private readonly invalidEl: HTMLElement;
  private readonly invalidReason: Text;
  private readonly dot: SVGCircleElement;
  private readonly ghostDot: SVGCircleElement;
  private readonly othersLayer: SVGGElement;
  private readonly otherDots: SVGCircleElement[] = [];
  private readonly plan: MinimapPlan;
  private lastErs = '';
  private lastMark = '';

  /** `mode`: the session panel's title ("Time trial", "Online race"). */
  constructor(plan: MinimapPlan, mode = 'Time trial') {
    this.plan = plan;
    const root = el('div', 'hud');
    root.dataset.testid = 'hud';
    this.root = root;
    const txt = (key: string, node: HTMLElement): HTMLElement => {
      this.t[key] = new Text(node);
      return node;
    };

    // Session panel (top left).
    const session = el('section', 'hud-session panel');
    session.setAttribute('aria-label', 'Session');
    const sHead = el('header', 'panel-head');
    sHead.append(el('span', 'label', mode), txt('circuit', el('span', 'label label--strong')));
    const sBody = el('div', 'hud-session__body');
    const lapRow = el('div', 'hud-row');
    lapRow.append(el('span', 'label', 'Lap'), txt('lap', el('b', 'num')));
    const pbRow = el('div', 'hud-row');
    pbRow.append(el('span', 'label', 'Record'), txt('record', el('b', 'num hud-pb')));
    sBody.append(lapRow, pbRow);
    session.append(sHead, sBody);

    // Message slot (top centre).
    const control = el('div', 'hud-control');
    this.invalidEl = el('div', 'hud-flag');
    this.invalidEl.setAttribute('role', 'status');
    const sw = el('div', 'hud-flag__sw');
    sw.append(icon('flag'));
    const ftxt = el('div', 'hud-flag__txt');
    const reason = el('span', '');
    this.invalidReason = new Text(reason);
    this.invalidReason.set('Track limits');
    ftxt.append(el('strong', '', 'Lap invalid'), reason);
    this.invalidEl.append(sw, ftxt);
    this.invalidEl.dataset.testid = 'lap-invalid';
    this.msgEl = el('div', 'hud-msg');
    this.msgEl.setAttribute('role', 'status');
    this.msgEl.dataset.testid = 'hud-message';
    const tag = el('span', 'hud-msg__tag');
    const body = el('span', 'hud-msg__body');
    this.msgTag = new Text(tag);
    this.msgText = new Text(body);
    this.msgEl.append(tag, body);
    control.append(this.invalidEl, this.msgEl);

    // Lap timing (top right).
    const timing = el('section', 'hud-timing panel');
    timing.setAttribute('aria-label', 'Lap timing');
    timing.dataset.testid = 'timing';
    const top = el('div', 'panel-head');
    top.append(el('span', 'label', 'Current lap'), txt('lapNo', el('span', 'hud-timing__lap num')));
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
      v.append(el('span', 'label', `S${i + 1}`), b);
      s.append(el('i'), v);
      sectors.append(s);
      this.sectorEls.push(s);
      this.sectorText.push(new Text(b));
    }
    const ref = el('div', 'hud-timing__ref');
    const last = el('div');
    this.lastEl = txt('last', el('b', 'num'));
    this.lastEl.dataset.testid = 'last-lap';
    last.append(el('span', 'label', 'Last'), this.lastEl);
    const best = el('div');
    const bestB = txt('best', el('b', 'num hud-pb'));
    bestB.dataset.testid = 'best-lap';
    best.append(el('span', 'label', 'Best'), bestB);
    ref.append(last, best);
    timing.append(top, now, sectors, ref);

    // Minimap (bottom left).
    const map = el('section', 'hud-map panel');
    map.setAttribute('aria-label', 'Track map');
    const mHead = el('header', 'hud-map__head');
    mHead.append(txt('mapName', el('span', 'label')), txt('mapLen', el('span', 'label')));
    const s = svg('svg', { viewBox: `0 0 ${plan.width} ${plan.height}`, 'aria-hidden': 'true' });
    s.append(
      svg('path', {
        d: plan.path,
        fill: 'none',
        stroke: '#3a3f45',
        'stroke-width': 7,
        'stroke-linejoin': 'round',
      }),
      svg('path', {
        d: plan.path,
        fill: 'none',
        stroke: '#c9c7c1',
        'stroke-width': 2.2,
        'stroke-linejoin': 'round',
      }),
      svg('line', {
        x1: plan.startLine[0],
        y1: plan.startLine[1],
        x2: plan.startLine[2],
        y2: plan.startLine[3],
        stroke: '#f2f0eb',
        'stroke-width': 2,
      }),
    );
    this.ghostDot = svg('circle', {
      r: 3.4,
      fill: '#bcd3ff',
      stroke: '#0b0c0e',
      'stroke-width': 1,
      opacity: 0,
    });
    this.dot = svg('circle', { r: 5, fill: '#3d6fe0', stroke: '#f2f0eb', 'stroke-width': 2 });
    this.othersLayer = svg('g', { 'data-testid': 'map-others' });
    s.append(this.ghostDot, this.othersLayer, this.dot);
    map.append(mHead, s);

    // Driver cluster (bottom right).
    const cluster = el('div', 'hud-cluster');
    const drive = el('section', 'hud-drive panel');
    drive.setAttribute('aria-label', 'Car');
    const revs = el('div', 'hud-revs');
    revs.setAttribute('aria-hidden', 'true');
    for (const c of REV_COLOURS) {
      const i = el('i', c);
      revs.append(i);
      this.revs.push(i);
    }
    const sg = el('div', 'hud-speedgear');
    const rpm = el('div', 'hud-rpm');
    rpm.append(txt('rpm', el('b', 'num')), el('span', 'label', 'RPM'));
    const gear = txt('gear', el('div', 'hud-gear num'));
    gear.dataset.testid = 'gear';
    const spd = el('div', 'hud-spd');
    const spdB = txt('speed', el('b', 'num'));
    spdB.dataset.testid = 'speed';
    spd.append(spdB, el('span', 'label', 'km/h'));
    sg.append(rpm, gear, spd);
    const ers = el('div', 'hud-ers');
    const ersLeft = el('div');
    const row1 = el('div', 'hud-ers__row');
    row1.append(
      el('span', 'label', 'ERS'),
      txt('ersMode', el('span', 'hud-ers__mode')),
      txt('ersPct', el('b', 'num')),
    );
    const meter = el('div', 'hud-ers__meter');
    this.ersFill = el('i');
    this.ersMark = el('u');
    meter.append(this.ersFill, this.ersMark);
    ersLeft.append(row1, meter);
    this.drsEl = el('div', 'hud-drs', 'DRS');
    this.drsEl.dataset.testid = 'drs';
    ers.append(ersLeft, this.drsEl);
    drive.append(revs, sg, ers);
    cluster.append(drive);

    root.append(session, control, timing, map, cluster);
  }

  /** Why the running lap is invalid, shown in the flag while it is (track limits, a reset). */
  setInvalidReason(text: string): void {
    this.invalidReason.set(text);
  }

  update(h: HudState): void {
    const t = this.t;
    t.circuit?.set(h.circuit);
    t.mapName?.set(h.circuit);
    t.mapLen?.set(`${h.lengthKm} km`);
    t.lap?.set(h.lap > 0 ? String(h.lap) : 'Out lap');
    t.lapNo?.set(h.lap > 0 ? `Lap ${h.lap}` : 'Out lap');
    t.record?.set(formatLapTime(h.record));
    setClass(this.t.record?.node as HTMLElement, 'is-empty', h.record === null);
    setClass(this.t.best?.node as HTMLElement, 'is-empty', h.best === null);
    setClass(this.lastEl, 'is-empty', h.last === null);
    t.lapTime?.set(h.running ? formatLapTime(h.lapTime) : formatLapTime(0));
    t.speed?.set(formatSpeedKmh(h.speed));
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

    const ersW = `${(h.ers * 100).toFixed(1)}%`;
    if (ersW !== this.lastErs) {
      this.ersFill.style.width = ersW;
      this.lastErs = ersW;
    }
    const mark = `${(h.ersLap * 100).toFixed(1)}%`;
    if (mark !== this.lastMark) {
      this.ersMark.style.left = mark;
      this.lastMark = mark;
    }
    setData(this.drsEl, 'state', h.drs);

    setClass(this.invalidEl, 'is-on', h.running && !h.valid);
    if (h.message) {
      this.msgTag.set(h.message.tag);
      this.msgText.set(h.message.text);
      setData(this.msgEl, 'tone', h.message.tone);
    }
    setClass(this.msgEl, 'is-on', h.message !== null);

    const [x, y] = this.plan.project(h.carX, h.carZ);
    this.dot.setAttribute('cx', x.toFixed(1));
    this.dot.setAttribute('cy', y.toFixed(1));
    if (h.ghostX !== null && h.ghostZ !== null) {
      const [gx, gy] = this.plan.project(h.ghostX, h.ghostZ);
      this.ghostDot.setAttribute('cx', gx.toFixed(1));
      this.ghostDot.setAttribute('cy', gy.toFixed(1));
      this.ghostDot.setAttribute('opacity', '1');
    } else this.ghostDot.setAttribute('opacity', '0');

    const others = h.others ?? [];
    while (this.otherDots.length < others.length) {
      const dot = svg('circle', { r: 4, stroke: '#0b0c0e', 'stroke-width': 1.2 });
      this.othersLayer.append(dot);
      this.otherDots.push(dot);
    }
    this.otherDots.forEach((dot, i) => {
      const o = others[i];
      if (!o) {
        dot.setAttribute('opacity', '0');
        return;
      }
      const [ox, oy] = this.plan.project(o.x, o.z);
      dot.setAttribute('cx', ox.toFixed(1));
      dot.setAttribute('cy', oy.toFixed(1));
      dot.setAttribute('fill', o.colour);
      dot.setAttribute('opacity', o.opacity.toFixed(2));
    });
  }
}
