/**
 * The timing tower (top left of the HUD), broadcast style: a lap counter, the flag state,
 * optional race column header with gap/interval toggle, one row per car (position, team bar,
 * driver code, gap/interval or state, tyre compound + age, pit-stop count), and a footer line.
 *
 * A data-in component: the caller hands it ordered, formatted rows (`TowerRow`) whenever
 * something changes; the tower keeps one node per car, writes only text that changed, and when
 * the order changes slides rows to their new places with transforms (FLIP), never by fading. On
 * a phone it shows the compact window (`towerWindow`): the leader and the cars around the player.
 */
import { Text, el, setClass, setData } from '../dom';
import { S } from '../strings';
import { towerWindow, type TowerRow } from './tower-rows';

export type { TowerRow, TowerTone } from './tower-rows';
export { towerWindow } from './tower-rows';

/** Flag states the status banner shows. */
export type TowerFlag = 'green' | 'yellow' | 'red' | 'chequered' | 'blue' | 'neutral';

export interface TimingTowerOptions {
  /** The session label in the header ("Time trial", "Race", "Online race"). */
  label: string;
  /** Rows on a phone (the compact window). Default 4: the leader and three around the player. */
  compactRows?: number;
  /** Enable the 20-car race layout (column header, gap/interval toggle, tyre age, pit count). */
  raceMode?: boolean;
  /** Called when the player toggles gap-to-leader vs interval mode on the tower header. */
  onToggleGapMode?: () => void;
}

interface RowNodes {
  li: HTMLLIElement;
  pos: Text;
  code: Text;
  value: Text;
  valueEl: HTMLElement;
  tyreWrap: HTMLElement;
  compound: HTMLElement;
  compoundCode: Text;
  tyreAge: Text;
  tyreAgeEl: HTMLElement;
  pits: Text;
  pitsEl: HTMLElement;
  bar: HTMLElement;
  colour: string;
  title: string;
}

const COMPACT = '(max-height: 500px) and (orientation: landscape), (max-width: 600px)';

/** Write `hidden` only when it changes: an unchanged write still costs a style recalculation. */
function setHidden(node: HTMLElement, hidden: boolean): void {
  if (node.hidden !== hidden) node.hidden = hidden;
}

export class TimingTower {
  readonly root: HTMLElement;
  private readonly lap: Text;
  private readonly total: Text;
  private readonly statusEl: HTMLElement;
  private readonly statusText: Text;
  private readonly colsEl: HTMLElement;
  private readonly gapBtn: HTMLButtonElement;
  private readonly gapBtnText: Text;
  private readonly list: HTMLOListElement;
  private readonly footLabel: Text;
  private readonly footValue: Text;
  private readonly footValueEl: HTMLElement;
  private readonly foot: HTMLElement;
  private readonly nodes = new Map<string, RowNodes>();
  private order: string[] = [];
  private lastRows: readonly TowerRow[] = [];
  private readonly compactRows: number;
  private readonly phone: MediaQueryList | null;
  private readonly onCompactChange: () => void;
  private raceMode: boolean;

  constructor(o: TimingTowerOptions) {
    const root = el('section', 'hud-session hud-tower panel');
    root.setAttribute('aria-label', S.hud.session);
    root.dataset.testid = 'tower';
    this.root = root;
    this.compactRows = o.compactRows ?? 4;
    this.raceMode = o.raceMode ?? false;
    setData(root, 'raceTower', this.raceMode ? 'on' : '');
    this.phone = typeof matchMedia === 'function' ? matchMedia(COMPACT) : null;

    const head = el('header', 'hud-tower__head');
    const lap = el('span', 'hud-tower__lap');
    const lapNo = el('b', 'num');
    const total = el('span', 'hud-tower__total num');
    this.lap = new Text(lapNo);
    this.total = new Text(total);
    lap.append(el('span', 'hud-tower__lapword', S.hud.lap), lapNo, total);
    head.append(lap, el('span', 'label', o.label));

    this.statusEl = el('div', 'hud-tower__status');
    this.statusEl.dataset.testid = 'tower-status';
    const statusText = el('span', '');
    this.statusText = new Text(statusText);
    this.statusEl.append(el('i', 'hud-tower__flag'), statusText);

    // Race column header: Pos, Driver, Gap/Int toggle button, Tyre, Pit.
    this.colsEl = el('div', 'hud-tower__cols');
    this.colsEl.hidden = !this.raceMode;
    this.gapBtn = document.createElement('button');
    this.gapBtn.type = 'button';
    this.gapBtn.className = 'hud-tower__mode';
    this.gapBtn.dataset.testid = 'tower-gap-toggle';
    this.gapBtn.title = 'Toggle gap to leader and interval';
    this.gapBtn.setAttribute('aria-pressed', 'false');
    const gapLabel = el('span', '', 'Gap');
    this.gapBtnText = new Text(gapLabel);
    this.gapBtn.append(gapLabel);
    if (o.onToggleGapMode) {
      const cb = o.onToggleGapMode;
      this.gapBtn.addEventListener('click', () => cb());
    }
    this.colsEl.append(
      el('span', 'hud-tower__col-pos', '#'),
      el('span', 'hud-tower__col-drv', 'Driver'),
      this.gapBtn,
      el('span', 'hud-tower__col-tyre', 'Tyre'),
      el('span', 'hud-tower__col-pit', 'Pit'),
    );

    this.list = el('ol', 'hud-tower__rows');

    this.foot = el('footer', 'hud-tower__foot');
    const footLabel = el('span', 'label');
    this.footValueEl = el('span', 'hud-session__ghost');
    this.footLabel = new Text(footLabel);
    this.footValue = new Text(this.footValueEl);
    this.foot.append(footLabel, this.footValueEl);
    this.foot.hidden = true;

    root.append(head, this.statusEl, this.colsEl, this.list, this.foot);
    this.setStatus('green', S.hud.greenFlag);

    this.onCompactChange = () => {
      if (this.lastRows.length > 0) this.update(this.lastRows);
    };
    this.phone?.addEventListener?.('change', this.onCompactChange);
  }

  /** Switch race-tower mode (column header, tyre age, pit stops) on or off. */
  setRaceMode(on: boolean, showGapToggle = on): void {
    this.raceMode = on;
    setData(this.root, 'raceTower', on ? 'on' : '');
    setHidden(this.colsEl, !on);
    this.gapBtn.disabled = !showGapToggle;
    setData(this.gapBtn, 'static', showGapToggle ? '' : 'on');
  }

  /** Set the gap-column toggle readout (`gap` -> "Gap", `interval` -> "Int", or custom for timed sessions). */
  setGapMode(mode: 'gap' | 'interval', labelOverride?: string): void {
    this.gapBtnText.set(labelOverride ?? (mode === 'interval' ? 'Int' : 'Gap'));
    this.gapBtn.setAttribute('aria-pressed', mode === 'interval' ? 'true' : 'false');
    setData(this.gapBtn, 'mode', mode);
  }

  /** Lap counter: the lap (null: out lap) and, for a race, the total. */
  setLap(current: number | null, total: number | null = null): void {
    this.lap.set(current === null ? S.hud.outLapShort : String(current));
    this.total.set(total === null ? '' : ` / ${total}`);
  }

  setStatus(flag: TowerFlag, text: string): void {
    setData(this.statusEl, 'flag', flag);
    this.statusText.set(text);
  }

  /** A footer line (label and value), or hidden with an empty label. */
  setFooter(label: string, value: string, muted = false): void {
    setHidden(this.foot, label === '');
    this.footLabel.set(label);
    this.footValue.set(value);
    setClass(this.footValueEl, 'is-empty', muted);
  }

  /** Show `rows` (in position order). Cheap when nothing changed. */
  update(rows: readonly TowerRow[]): void {
    this.lastRows = rows;
    const compact = Boolean(this.phone?.matches) && rows.length > this.compactRows;
    const shown = compact ? towerWindow(rows, this.compactRows) : rows;
    for (let i = 0; i < shown.length; i++) {
      const r = shown[i]!;
      const split =
        compact &&
        i === 1 &&
        shown[0]?.position !== null &&
        r.position !== null &&
        r.position > (shown[0]?.position ?? 1) + 1;
      this.write(r, split);
    }
    let same = shown.length === this.order.length;
    for (let i = 0; same && i < shown.length; i++) same = shown[i]?.id === this.order[i];
    if (same) return;
    this.reorder(shown);
  }

  private write(r: TowerRow, gapSplit: boolean): void {
    let n = this.nodes.get(r.id);
    if (!n) n = this.create(r);
    n.pos.set(r.position === null ? '' : String(r.position));
    n.code.set(r.code);
    n.value.set(r.value);
    const title = r.name ?? r.code;
    if (n.title !== title) {
      n.title = title;
      n.li.title = title;
    }
    if (n.colour !== r.teamColour) {
      n.colour = r.teamColour;
      n.li.style.setProperty('--row-team', r.teamColour);
    }
    setData(n.valueEl, 'tone', r.tone ?? '');
    setClass(n.valueEl, 'is-empty', r.tone === 'empty');
    setClass(n.li, 'is-player', r.player === true);
    setClass(n.li, 'is-record', r.reference === true);
    setClass(n.li, 'is-fastest', r.fastest === true);
    setClass(n.li, 'is-in-pit', r.inPit === true);
    setClass(n.li, 'is-retired', r.retired === true);
    setClass(n.li, 'is-gap-split', gapSplit);

    const c = r.compound ?? null;
    setHidden(n.tyreWrap, c === null);
    if (c) {
      n.compoundCode.set(c.code);
      n.compound.style.setProperty('--compound', c.colour);
    }
    const showAge = c !== null && r.tyreAge !== undefined && r.tyreAge !== null;
    setHidden(n.tyreAgeEl, !showAge);
    if (showAge) n.tyreAge.set(String(r.tyreAge));

    const showPits = r.pitStops !== undefined && r.pitStops !== null;
    setHidden(n.pitsEl, !showPits);
    if (showPits) n.pits.set(String(r.pitStops));
  }

  private create(r: TowerRow): RowNodes {
    const li = el('li', 'hud-tower__row');
    li.dataset.car = r.id;
    const pos = el('span', 'hud-tower__pos num');
    const bar = el('i', 'hud-tower__bar');
    const code = el('strong', 'hud-tower__code');
    const valueEl = el('b', 'hud-tower__time num');

    const tyreWrap = el('span', 'hud-tower__tyre-cell');
    const compound = el('span', 'hud-tower__tyre');
    const compoundCode = el('b', '');
    compound.append(compoundCode);
    const tyreAgeEl = el('span', 'hud-tower__age num');
    tyreAgeEl.hidden = true;
    tyreWrap.append(compound, tyreAgeEl);
    tyreWrap.hidden = true;

    const pitsEl = el('span', 'hud-tower__pits num');
    pitsEl.hidden = true;

    li.append(pos, bar, code, valueEl, tyreWrap, pitsEl);
    const nodes: RowNodes = {
      li,
      pos: new Text(pos),
      code: new Text(code),
      value: new Text(valueEl),
      valueEl,
      tyreWrap,
      compound,
      compoundCode: new Text(compoundCode),
      tyreAge: new Text(tyreAgeEl),
      tyreAgeEl,
      pits: new Text(pitsEl),
      pitsEl,
      bar,
      colour: '',
      title: '',
    };
    this.nodes.set(r.id, nodes);
    return nodes;
  }

  /** Put rows in their new order, sliding each from where it was (FLIP). */
  private reorder(shown: readonly TowerRow[]): void {
    const before = new Map<string, number>();
    for (const id of this.order) {
      const n = this.nodes.get(id);
      if (n?.li.isConnected) before.set(id, n.li.offsetTop);
    }
    const keep = new Set<string>();
    for (const r of shown) {
      const n = this.nodes.get(r.id);
      if (!n) continue;
      keep.add(r.id);
      this.list.append(n.li);
    }
    for (const [id, n] of this.nodes) if (!keep.has(id)) n.li.remove();
    this.order = shown.map((r) => r.id);
    const moved: HTMLElement[] = [];
    for (const r of shown) {
      const n = this.nodes.get(r.id);
      const from = before.get(r.id);
      if (!n || from === undefined) continue;
      const dy = from - n.li.offsetTop;
      if (dy === 0) continue;
      n.li.style.transition = 'none';
      n.li.style.transform = `translateY(${dy}px)`;
      moved.push(n.li);
    }
    if (moved.length === 0) return;
    // One reflow, then every moved row slides home together.
    void this.list.offsetHeight;
    for (const li of moved) {
      li.style.transition = '';
      li.style.transform = '';
    }
  }
}
