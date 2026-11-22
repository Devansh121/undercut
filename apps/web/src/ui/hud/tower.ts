/**
 * The timing tower (top left of the HUD), broadcast style: a lap counter, the flag state, one
 * row per car, and a footer line. A data-in component: the caller (the time-trial HUD now, the
 * race session next) hands it ordered, formatted rows (`TowerRow`) whenever something changes;
 * the tower keeps one node per car, writes only text that changed, and when the order changes
 * slides rows to their new places with transforms (FLIP), never by fading. On a phone it shows
 * the compact window (`towerWindow`): the leader and the cars around the player.
 *
 *   const tower = new TimingTower({ label: 'Race' });
 *   hud.root.append(tower.root);
 *   tower.setLap(14, 53);
 *   tower.setStatus('yellow', 'Yellow flag · Sector 2');
 *   tower.update(rows); // TowerRow[] in position order
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
}

interface RowNodes {
  li: HTMLLIElement;
  pos: Text;
  code: Text;
  value: Text;
  valueEl: HTMLElement;
  compound: HTMLElement;
  compoundCode: Text;
  bar: HTMLElement;
  colour: string;
}

const PHONE = '(max-height: 500px) and (orientation: landscape)';

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
  private readonly list: HTMLOListElement;
  private readonly footLabel: Text;
  private readonly footValue: Text;
  private readonly footValueEl: HTMLElement;
  private readonly foot: HTMLElement;
  private readonly nodes = new Map<string, RowNodes>();
  private order: string[] = [];
  private readonly compactRows: number;
  private readonly phone: MediaQueryList | null;

  constructor(o: TimingTowerOptions) {
    const root = el('section', 'hud-session hud-tower panel');
    root.setAttribute('aria-label', S.hud.session);
    root.dataset.testid = 'tower';
    this.root = root;
    this.compactRows = o.compactRows ?? 4;
    this.phone = typeof matchMedia === 'function' ? matchMedia(PHONE) : null;

    const head = el('header', 'hud-tower__head');
    const lap = el('span', 'hud-tower__lap');
    const lapNo = el('b', 'num');
    const total = el('span', 'hud-tower__total num');
    this.lap = new Text(lapNo);
    this.total = new Text(total);
    lap.append(el('span', 'hud-tower__lapword', S.hud.lap), lapNo, total);
    head.append(lap, el('span', 'label', o.label));

    this.statusEl = el('div', 'hud-tower__status');
    const statusText = el('span', '');
    this.statusText = new Text(statusText);
    this.statusEl.append(el('i', 'hud-tower__flag'), statusText);

    this.list = el('ol', 'hud-tower__rows');

    this.foot = el('footer', 'hud-tower__foot');
    const footLabel = el('span', 'label');
    this.footValueEl = el('span', 'hud-session__ghost');
    this.footLabel = new Text(footLabel);
    this.footValue = new Text(this.footValueEl);
    this.foot.append(footLabel, this.footValueEl);
    this.foot.hidden = true;

    root.append(head, this.statusEl, this.list, this.foot);
    this.setStatus('green', S.hud.greenFlag);
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
    const shown =
      this.phone?.matches && rows.length > this.compactRows
        ? towerWindow(rows, this.compactRows)
        : rows;
    for (const r of shown) this.write(r);
    let same = shown.length === this.order.length;
    for (let i = 0; same && i < shown.length; i++) same = shown[i]?.id === this.order[i];
    if (same) return;
    this.reorder(shown);
  }

  private write(r: TowerRow): void {
    let n = this.nodes.get(r.id);
    if (!n) n = this.create(r);
    n.pos.set(r.position === null ? '' : String(r.position));
    n.code.set(r.code);
    n.value.set(r.value);
    if (n.colour !== r.teamColour) {
      n.colour = r.teamColour;
      n.li.style.setProperty('--row-team', r.teamColour);
    }
    setData(n.valueEl, 'tone', r.tone ?? '');
    setClass(n.valueEl, 'is-empty', r.tone === 'empty');
    setClass(n.li, 'is-player', r.player === true);
    setClass(n.li, 'is-record', r.reference === true);
    setClass(n.li, 'is-fastest', r.fastest === true);
    const c = r.compound ?? null;
    setHidden(n.compound, c === null);
    if (c) {
      n.compoundCode.set(c.code);
      n.compound.style.setProperty('--compound', c.colour);
    }
  }

  private create(r: TowerRow): RowNodes {
    const li = el('li', 'hud-tower__row');
    li.dataset.car = r.id;
    const pos = el('span', 'hud-tower__pos num');
    const bar = el('i', 'hud-tower__bar');
    const code = el('strong', 'hud-tower__code');
    const valueEl = el('b', 'hud-tower__time num');
    const compound = el('span', 'hud-tower__tyre');
    const compoundCode = el('b', '');
    compound.append(compoundCode);
    compound.hidden = true;
    li.append(pos, bar, code, valueEl, compound);
    const nodes: RowNodes = {
      li,
      pos: new Text(pos),
      code: new Text(code),
      value: new Text(valueEl),
      valueEl,
      compound,
      compoundCode: new Text(compoundCode),
      bar,
      colour: '',
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
