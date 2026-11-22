/**
 * The interface kit: a small set of components on the design tokens (styles/kit.css). Each one
 * is a plain DOM node with a tiny API, reachable by pointer, touch, keyboard and gamepad
 * (`data-nav`, see nav.ts), with default, hover, focus, pressed, disabled and selected states in
 * CSS. No framework: the menus are a few hundred nodes (ADR 0009).
 */
import type { ActionId } from '@undercut/input';
import { el } from '../dom';
import { glyph } from './glyph';
import { icon, type IconKey } from './icons';
import { focusFirst, focusEl, onNav } from './nav';

let uid = 0;
const nextId = (prefix: string): string => `${prefix}-${++uid}`;

// ---------------------------------------------------------------- Button

export interface ButtonOptions {
  label: string;
  variant?: 'primary' | 'secondary' | 'quiet';
  icon?: IconKey;
  /** Action whose prompt glyph sits in the button (Enter, A, ...). */
  glyph?: ActionId;
  onClick?: () => void;
  /** Stable id for tests and stations (`data-action`). */
  action?: string;
  disabled?: boolean;
  /** Trailing chevron, for buttons that lead to another screen. */
  next?: boolean;
}

export function button(o: ButtonOptions): HTMLButtonElement {
  const b = el('button', `btn btn--${o.variant ?? 'secondary'}`);
  b.type = 'button';
  b.dataset.nav = '';
  if (o.action) b.dataset.action = o.action;
  if (o.glyph && (o.variant ?? 'secondary') !== 'primary') b.append(glyph(o.glyph, 'btn__glyph'));
  if (o.icon) b.append(icon(o.icon, 'icon btn__icon'));
  b.append(el('span', 'btn__label', o.label));
  if (o.glyph && o.variant === 'primary') b.append(glyph(o.glyph, 'btn__glyph'));
  if (o.next) b.append(icon('chevron', 'icon btn__next'));
  if (o.disabled) b.disabled = true;
  if (o.onClick) b.addEventListener('click', () => o.onClick?.());
  return b;
}

export function setButtonLabel(b: HTMLButtonElement, label: string): void {
  const l = b.querySelector('.btn__label');
  if (l && l.textContent !== label) l.textContent = label;
}

export function iconButton(o: {
  icon: IconKey;
  label: string;
  onClick?: () => void;
  action?: string;
}): HTMLButtonElement {
  const b = el('button', 'ibtn');
  b.type = 'button';
  b.dataset.nav = '';
  b.setAttribute('aria-label', o.label);
  b.title = o.label;
  if (o.action) b.dataset.action = o.action;
  b.append(icon(o.icon));
  if (o.onClick) b.addEventListener('click', () => o.onClick?.());
  return b;
}

// ---------------------------------------------------------------- Value controls

export interface Control<T> {
  root: HTMLElement;
  get(): T;
  /** Show a value (does not call onChange). */
  set(value: T): void;
  setDisabled(disabled: boolean): void;
}

/** An on/off switch (role switch). Accept or a click flips it. */
export function toggle(o: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
  id?: string;
}): Control<boolean> {
  const b = el('button', 'switch');
  b.type = 'button';
  b.dataset.nav = '';
  b.setAttribute('role', 'switch');
  b.setAttribute('aria-label', o.label);
  if (o.id) b.dataset.setting = o.id;
  b.append(el('span', 'switch__thumb'));
  let value = o.value;
  const show = (): void => b.setAttribute('aria-checked', String(value));
  show();
  b.addEventListener('click', () => {
    value = !value;
    show();
    o.onChange(value);
  });
  return {
    root: b,
    get: () => value,
    set: (v) => {
      value = v;
      show();
    },
    setDisabled: (d) => {
      b.disabled = d;
    },
  };
}

export interface Choice<T extends string | number> {
  value: T;
  label: string;
}

/** One of a few values (role radiogroup). Each option is its own focus stop. */
export function segmented<T extends string | number>(o: {
  label: string;
  choices: readonly Choice<T>[];
  value: T;
  onChange: (v: T) => void;
  id?: string;
}): Control<T> {
  const root = el('div', 'seg');
  root.setAttribute('role', 'radiogroup');
  root.setAttribute('aria-label', o.label);
  root.dataset.navGroup = '';
  if (o.id) root.dataset.setting = o.id;
  let value = o.value;
  const buttons = o.choices.map((c) => {
    const b = el('button', 'seg__opt', c.label);
    b.type = 'button';
    b.dataset.nav = '';
    b.dataset.value = String(c.value);
    b.setAttribute('role', 'radio');
    b.addEventListener('click', () => {
      if (value === c.value) return;
      value = c.value;
      show();
      o.onChange(value);
    });
    root.append(b);
    return b;
  });
  const show = (): void => {
    for (const b of buttons)
      b.setAttribute('aria-checked', String(b.dataset.value === String(value)));
  };
  show();
  return {
    root,
    get: () => value,
    set: (v) => {
      value = v;
      show();
    },
    setDisabled: (d) => {
      for (const b of buttons) b.disabled = d;
    },
  };
}

/**
 * A continuous value (role slider): drag or tap on the track; left and right (keys, D-pad or
 * stick) step it while it has focus.
 */
export function slider(o: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
  id?: string;
}): Control<number> {
  const root = el('div', 'slider');
  if (o.id) root.dataset.setting = o.id;
  const track = el('div', 'slider__track');
  track.dataset.nav = '';
  track.tabIndex = 0;
  track.setAttribute('role', 'slider');
  track.setAttribute('aria-label', o.label);
  track.setAttribute('aria-valuemin', String(o.min));
  track.setAttribute('aria-valuemax', String(o.max));
  const fill = el('i', 'slider__fill');
  const thumb = el('u', 'slider__thumb');
  track.append(fill, thumb);
  const out = el('output', 'slider__value num');
  root.append(track, out);
  let value = o.value;
  let disabled = false;
  const clampStep = (v: number): number => {
    const stepped = Math.round((v - o.min) / o.step) * o.step + o.min;
    return Math.min(o.max, Math.max(o.min, Number(stepped.toFixed(6))));
  };
  const show = (): void => {
    const f = (value - o.min) / (o.max - o.min || 1);
    root.style.setProperty('--v', `${(f * 100).toFixed(2)}%`);
    const text = o.format(value);
    track.setAttribute('aria-valuenow', String(value));
    track.setAttribute('aria-valuetext', text);
    if (out.textContent !== text) out.textContent = text;
  };
  const change = (v: number): void => {
    const next = clampStep(v);
    if (next === value || disabled) return;
    value = next;
    show();
    o.onChange(value);
  };
  show();
  onNav(track, (action) => {
    if (action === 'menuLeft') change(value - o.step);
    else if (action === 'menuRight') change(value + o.step);
    else return false;
    return true;
  });
  track.addEventListener('keydown', (e) => {
    if (e.key === 'Home') change(o.min);
    else if (e.key === 'End') change(o.max);
    else return;
    e.preventDefault();
  });
  const fromPointer = (e: PointerEvent): void => {
    const r = track.getBoundingClientRect();
    change(o.min + ((e.clientX - r.left) / r.width) * (o.max - o.min));
  };
  track.addEventListener('pointerdown', (e) => {
    if (disabled) return;
    track.setPointerCapture(e.pointerId);
    fromPointer(e);
  });
  track.addEventListener('pointermove', (e) => {
    if (track.hasPointerCapture(e.pointerId)) fromPointer(e);
  });
  return {
    root,
    get: () => value,
    set: (v) => {
      value = clampStep(v);
      show();
    },
    setDisabled: (d) => {
      disabled = d;
      track.setAttribute('aria-disabled', String(d));
      root.classList.toggle('is-disabled', d);
    },
  };
}

// ---------------------------------------------------------------- Layout

/** A labelled setting: name (and hint) on the left, its control on the right. */
export function settingRow(label: string, control: HTMLElement, hint?: string): HTMLElement {
  const row = el('div', 'setting');
  const k = el('span', 'setting__k', label);
  if (hint) k.append(el('small', 'setting__hint', hint));
  row.append(k, control);
  return row;
}

/** A row in a list that leads somewhere: icon, title, description, chevron. */
export function listRow(o: {
  title: string;
  desc?: string;
  icon?: IconKey;
  onClick?: () => void;
  action?: string;
  badge?: string;
  /** A small status line under the title (e.g. "Not yet available"). */
  tag?: string;
}): HTMLButtonElement {
  const b = el('button', 'lrow');
  b.type = 'button';
  b.dataset.nav = '';
  if (o.action) b.dataset.action = o.action;
  if (o.icon) {
    const ic = el('span', 'lrow__ic');
    ic.append(icon(o.icon));
    b.append(ic);
  }
  const text = el('span', 'lrow__text');
  const title = el('span', 'lrow__title', o.title);
  if (o.badge) title.append(el('span', 'badge', o.badge));
  text.append(title);
  if (o.tag) text.append(el('span', 'lrow__tag', o.tag));
  if (o.desc) text.append(el('span', 'lrow__desc', o.desc));
  b.append(text, icon('chevron', 'icon lrow__chev'));
  if (o.onClick) b.addEventListener('click', () => o.onClick?.());
  return b;
}

/** A card: heading row (title and an aside) and a body. */
export function card(o: {
  title?: string;
  aside?: HTMLElement | string;
  className?: string;
  label?: string;
}): {
  root: HTMLElement;
  head: HTMLElement;
  body: HTMLElement;
} {
  const root = el('section', `card${o.className ? ` ${o.className}` : ''}`);
  if (o.label ?? o.title) root.setAttribute('aria-label', (o.label ?? o.title) as string);
  const head = el('header', 'card__head');
  if (o.title) head.append(el('h2', 'card__title', o.title));
  if (o.aside !== undefined) {
    head.append(typeof o.aside === 'string' ? el('span', 'label', o.aside) : o.aside);
  }
  const body = el('div', 'card__body');
  if (o.title || o.aside !== undefined) root.append(head);
  root.append(body);
  return { root, head, body };
}

/** A small status chip: icon and text. */
export function chip(iconName: IconKey | null, text: string): HTMLElement {
  const c = el('span', 'chip');
  if (iconName) c.append(icon(iconName));
  c.append(el('span', '', text));
  return c;
}

// ---------------------------------------------------------------- Tabs

export interface TabStrip {
  root: HTMLElement;
  value(): string;
  select(id: string): void;
  /** Step to the previous or next tab (shoulder buttons, Q and E). */
  step(delta: -1 | 1): void;
}

/** Tabs with the shoulder-button glyphs at either end. */
export function tabStrip(o: {
  label: string;
  tabs: readonly { id: string; label: string }[];
  value: string;
  onChange: (id: string) => void;
  glyphs?: boolean;
}): TabStrip {
  const root = el('div', 'tabs');
  root.setAttribute('role', 'tablist');
  root.setAttribute('aria-label', o.label);
  root.dataset.navGroup = '';
  let value = o.value;
  if (o.glyphs !== false) root.append(glyph('menuTabPrev', 'tabs__glyph'));
  const buttons = o.tabs.map((t) => {
    const b = el('button', 'tab', t.label);
    b.type = 'button';
    b.dataset.nav = '';
    b.dataset.tab = t.id;
    b.setAttribute('role', 'tab');
    b.addEventListener('click', () => select(t.id, true));
    root.append(b);
    return b;
  });
  if (o.glyphs !== false) root.append(glyph('menuTabNext', 'tabs__glyph'));
  const show = (): void => {
    for (const b of buttons) b.setAttribute('aria-selected', String(b.dataset.tab === value));
  };
  const select = (id: string, notify: boolean): void => {
    if (id === value) return;
    value = id;
    show();
    if (notify) o.onChange(id);
  };
  show();
  return {
    root,
    value: () => value,
    select: (id) => select(id, false),
    step: (delta) => {
      const i = o.tabs.findIndex((t) => t.id === value);
      const next = o.tabs[(i + delta + o.tabs.length) % o.tabs.length];
      if (next) select(next.id, true);
    },
  };
}

// ---------------------------------------------------------------- Table

export interface Column<R> {
  label: string;
  /** Cell text (or a node). */
  cell: (row: R, index: number) => string | Node;
  align?: 'start' | 'end';
  /** Numeric column: tabular figures. */
  num?: boolean;
  className?: string;
}

export function table<R>(o: {
  label: string;
  columns: readonly Column<R>[];
  rows: readonly R[];
  rowClass?: (row: R) => string;
  empty?: string;
}): HTMLTableElement {
  const t = el('table', 'table');
  t.setAttribute('aria-label', o.label);
  const head = el('thead');
  const hr = el('tr');
  for (const c of o.columns) {
    const th = el('th', c.align === 'end' ? 'is-end' : '', c.label);
    th.scope = 'col';
    hr.append(th);
  }
  head.append(hr);
  const body = el('tbody');
  o.rows.forEach((r, i) => {
    const tr = el('tr', o.rowClass?.(r) ?? '');
    for (const c of o.columns) {
      const td = el(
        'td',
        [c.align === 'end' ? 'is-end' : '', c.num ? 'num' : '', c.className ?? '']
          .filter(Boolean)
          .join(' '),
      );
      const v = c.cell(r, i);
      if (typeof v === 'string') td.textContent = v;
      else td.append(v);
      tr.append(td);
    }
    body.append(tr);
  });
  if (o.rows.length === 0 && o.empty) {
    const tr = el('tr', 'table__empty');
    const td = el('td', '', o.empty);
    td.colSpan = o.columns.length;
    tr.append(td);
    body.append(tr);
  }
  t.append(head, body);
  return t;
}

// ---------------------------------------------------------------- Dialog

export interface Dialog {
  root: HTMLElement;
  body: HTMLElement;
  readonly open: boolean;
  show(): void;
  hide(): void;
}

/**
 * A modal over the current screen: a scrim and a card with a title, a body and actions. It is a
 * navigation scope: focus stays inside while it is open and returns where it was on close.
 * Back (Esc, B, the close button) closes it.
 */
export function dialog(o: {
  title: string;
  subtitle?: string;
  actions?: HTMLElement[];
  onClose?: () => void;
  className?: string;
  testid?: string;
}): Dialog {
  const root = el('div', `dialog${o.className ? ` ${o.className}` : ''}`);
  root.hidden = true;
  root.dataset.navScope = '';
  if (o.testid) root.dataset.testid = o.testid;
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  const titleId = nextId('dlg');
  root.setAttribute('aria-labelledby', titleId);
  const panel = el('div', 'dialog__card');
  const head = el('header', 'dialog__head');
  const title = el('h2', 'dialog__title', o.title);
  title.id = titleId;
  head.append(title);
  if (o.subtitle) head.append(el('span', 'label dialog__sub', o.subtitle));
  const body = el('div', 'dialog__body');
  const foot = el('footer', 'dialog__foot');
  const close = button({
    label: 'Back',
    glyph: 'menuBack',
    action: 'dialog-close',
    onClick: () => api.hide(),
  });
  foot.append(...(o.actions ?? []), close);
  panel.append(head, body, foot);
  root.append(panel);
  root.addEventListener('pointerdown', (e) => {
    if (e.target === root) api.hide();
  });
  let returnTo: HTMLElement | null = null;
  const api: Dialog = {
    root,
    body,
    get open() {
      return !root.hidden;
    },
    show() {
      returnTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      root.hidden = false;
      focusFirst(panel);
    },
    hide() {
      if (root.hidden) return;
      root.hidden = true;
      focusEl(returnTo);
      returnTo = null;
      o.onClose?.();
    },
  };
  return api;
}

// ---------------------------------------------------------------- Toast

/** Short notices at the bottom of the screen, one at a time, gone after a few seconds. */
export class Toaster {
  readonly root: HTMLElement;
  private timer = 0;
  constructor() {
    this.root = el('div', 'toast');
    this.root.setAttribute('role', 'status');
    this.root.setAttribute('aria-live', 'polite');
    this.root.hidden = true;
  }
  show(text: string, tone: 'info' | 'warn' = 'info', seconds = 3.5): void {
    this.root.dataset.tone = tone;
    this.root.replaceChildren(icon(tone === 'warn' ? 'warning' : 'info'), el('span', '', text));
    this.root.hidden = false;
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      this.root.hidden = true;
    }, seconds * 1000);
  }
}

// ---------------------------------------------------------------- Tooltip

/**
 * A short explanation attached to a control: shown on hover and on keyboard or gamepad focus,
 * above the control. Text only; never the only place information lives.
 */
export function tooltip(target: HTMLElement, text: string): HTMLElement {
  const tip = el('span', 'tip', text);
  tip.id = nextId('tip');
  tip.setAttribute('role', 'tooltip');
  target.setAttribute('aria-describedby', tip.id);
  const wrap = el('span', 'tip-wrap');
  target.replaceWith(wrap);
  wrap.append(target, tip);
  return wrap;
}
