/**
 * The menu shell: one screen at a time from a stack, under a top bar (wordmark, breadcrumbs, the
 * input device in use) and over an action bar. Screens are plain objects with a root node; the
 * shell routes menu actions (from MenuInput) to spatial navigation, to the screen, and to Back.
 */
import { GAME_NAME } from '@undercut/core';
import type { DeviceKind } from '@undercut/input';
import { el } from './dom';
import { brandMark, icon, type IconKey } from './kit/icons';
import { refreshGlyphs } from './kit/glyph';
import { activeScope, focusFirst, navigate, showFocusRing, type NavAction } from './kit/nav';
import { S } from './strings';

export interface Screen {
  readonly id: string;
  /** Breadcrumb label; the first screen in the stack shows as "Main". */
  readonly crumb: string;
  readonly root: HTMLElement;
  /** Full-bleed, without the top bar (the launch screen). */
  readonly bare?: boolean;
  /** Called after the screen is shown (again). */
  enter?(): void;
  leave?(): void;
  /** Actions navigation did not use (tabs, accept on nothing). True when handled. */
  action?(a: NavAction): boolean;
  /** Back pressed: true when the screen handled it (closed a dialog), else the shell pops. */
  back?(): boolean;
}

const DEVICE_ICON: Record<DeviceKind, IconKey> = {
  keyboard: 'keyboard',
  gamepad: 'controls',
  touch: 'touch',
};

export class Shell {
  readonly root: HTMLElement;
  private readonly top: HTMLElement;
  private readonly crumbs: HTMLElement;
  private readonly deviceChip: HTMLElement;
  private readonly main: HTMLElement;
  private readonly stack: Screen[] = [];
  /** Where focus was on each screen below the top, to restore it on the way back. */
  private readonly focusMemory = new WeakMap<Screen, HTMLElement>();

  constructor(
    private readonly host: HTMLElement,
    private readonly onEmpty: () => void = () => {},
  ) {
    this.root = el('div', 'shell');
    this.root.dataset.testid = 'menu';
    this.top = el('header', 'shell__top');
    const word = el('div', 'wordmark');
    word.append(brandMark(), el('span', '', GAME_NAME));
    this.crumbs = el('nav', 'crumbs');
    this.crumbs.setAttribute('aria-label', 'Breadcrumb');
    const right = el('div', 'shell__right');
    this.deviceChip = el('span', 'device-chip');
    this.deviceChip.dataset.testid = 'device-chip';
    right.append(this.deviceChip);
    this.top.append(word, this.crumbs, right);
    this.main = el('div', 'shell__main');
    this.root.append(this.top, this.main);
    this.root.addEventListener('pointerdown', () => showFocusRing(false));
    this.setDevice('keyboard');
  }

  get current(): Screen | null {
    return this.stack[this.stack.length - 1] ?? null;
  }

  /** Mount the shell into the host (replacing whatever was there). */
  mount(): void {
    this.host.replaceChildren(this.root);
    document.documentElement.dataset.screen = this.current?.id ?? 'menu';
  }

  push(screen: Screen): void {
    const cur = this.current;
    if (cur) {
      const active = document.activeElement;
      if (active instanceof HTMLElement && cur.root.contains(active))
        this.focusMemory.set(cur, active);
      cur.leave?.();
    }
    this.stack.push(screen);
    this.show(screen, true);
  }

  /** Back one screen. Returns false when there is nowhere to go back to. */
  pop(): boolean {
    if (this.stack.length <= 1) return false;
    this.stack.pop()?.leave?.();
    const cur = this.current as Screen;
    this.show(cur, false);
    return true;
  }

  /** Replace the whole stack with one screen. */
  reset(screen: Screen): void {
    for (const s of this.stack.splice(0)) s.leave?.();
    this.stack.push(screen);
    this.show(screen, true);
  }

  setDevice(device: DeviceKind): void {
    this.deviceChip.replaceChildren(
      icon(DEVICE_ICON[device]),
      el('span', '', S.menu.deviceNames[device]),
    );
    this.deviceChip.title = S.menu.usingDevice(S.menu.deviceNames[device]);
  }

  /** One menu action from the input layer (keyboard, gamepad). */
  handle(action: NavAction, nativeAccept: boolean): void {
    const screen = this.current;
    if (!screen) return;
    if (action !== 'menuAccept' || !nativeAccept) showFocusRing(true);
    if (action === 'menuBack') {
      if (screen.back?.()) return;
      if (!this.pop()) this.onEmpty();
      return;
    }
    const scope = activeScope(screen.root);
    if (navigate(scope, action, nativeAccept)) return;
    screen.action?.(action);
  }

  private show(screen: Screen, fresh: boolean): void {
    this.main.replaceChildren(screen.root);
    refreshGlyphs(screen.root);
    this.root.classList.toggle('is-bare', screen.bare === true);
    this.top.hidden = screen.bare === true;
    document.documentElement.dataset.screen = screen.id;
    this.renderCrumbs();
    screen.root.classList.remove('is-entering');
    // Restart the screen transition (a class, so reduced motion can turn it off in CSS).
    void screen.root.offsetWidth;
    screen.root.classList.add('is-entering');
    screen.enter?.();
    const remembered = fresh ? null : this.focusMemory.get(screen);
    if (remembered && screen.root.contains(remembered)) remembered.focus({ preventScroll: true });
    else if (!screen.root.contains(document.activeElement)) focusFirst(screen.root);
  }

  private renderCrumbs(): void {
    const parts = this.stack.filter((s) => !s.bare);
    const nodes: Node[] = [];
    parts.forEach((s, i) => {
      if (i > 0) nodes.push(icon('chevron'));
      const last = i === parts.length - 1;
      nodes.push(el(last ? 'b' : 'span', '', i === 0 && parts.length > 1 ? S.menu.main : s.crumb));
    });
    this.crumbs.replaceChildren(...nodes);
  }
}
