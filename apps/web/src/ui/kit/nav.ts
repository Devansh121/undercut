/**
 * Menu navigation for keyboard and gamepad, on top of the browser's own focus. Every control a
 * player can reach carries `data-nav`; the input layer's menu actions move focus between them by
 * screen position (spatial navigation), so a grid of team cards, a column of settings and an
 * action bar all work with a D-pad without per-screen wiring. Pointer and touch use the same
 * elements natively.
 *
 * - A control may take an action before navigation does (a slider takes left and right) with
 *   `onNav`.
 * - A group (`data-nav-group`) is entered at its selected item, not the geometrically nearest
 *   one, so moving into a segmented control lands on the current value.
 * - The scope is the top-most open dialog (`data-nav-scope`), else the screen: focus never leaves
 *   an open dialog and is never lost (nothing focusable in a direction: it stays put).
 */
import type { MenuButton } from '@undercut/input';

export type NavAction = MenuButton;
type Direction = 'up' | 'down' | 'left' | 'right';
type Handler = (action: NavAction) => boolean;

const handlers = new WeakMap<Element, Handler>();

/** Let `el` take menu actions while focused (return true when it used the action). */
export function onNav(el: Element, handler: Handler): void {
  handlers.set(el, handler);
}

const DIRECTIONS: Partial<Record<NavAction, Direction>> = {
  menuUp: 'up',
  menuDown: 'down',
  menuLeft: 'left',
  menuRight: 'right',
};

function visible(el: HTMLElement): boolean {
  if (el.closest('[hidden], [inert]')) return false;
  if (el.getClientRects().length === 0) return false;
  const style = getComputedStyle(el);
  return style.visibility !== 'hidden' && style.display !== 'none';
}

/** Reachable controls in `scope`, in document order. */
export function focusables(scope: ParentNode): HTMLElement[] {
  return [...scope.querySelectorAll<HTMLElement>('[data-nav]')].filter(
    (el) => !(el as HTMLButtonElement).disabled && visible(el),
  );
}

/** The innermost open dialog, or `fallback`. */
export function activeScope(fallback: HTMLElement): HTMLElement {
  const scopes = [...document.querySelectorAll<HTMLElement>('[data-nav-scope]')].filter(
    (s) => !s.hidden && !s.closest('[hidden]'),
  );
  return scopes[scopes.length - 1] ?? fallback;
}

function selectedIn(group: Element): HTMLElement | null {
  return group.querySelector<HTMLElement>(
    '[data-nav][aria-checked="true"], [data-nav][aria-selected="true"], [data-nav][aria-current="true"], [data-nav][aria-pressed="true"]',
  );
}

/**
 * The best control from `from` in `dir`: anything whose near edge lies beyond `from`'s far edge,
 * scored by the distance along the direction plus twice the misalignment across it.
 */
export function pickInDirection(
  from: DOMRect,
  candidates: readonly { el: HTMLElement; rect: DOMRect }[],
  dir: Direction,
): HTMLElement | null {
  let best: HTMLElement | null = null;
  let bestScore = Infinity;
  const fx = (from.left + from.right) / 2;
  const fy = (from.top + from.bottom) / 2;
  for (const { el, rect: r } of candidates) {
    let along: number;
    let across: number;
    const cx = (r.left + r.right) / 2;
    const cy = (r.top + r.bottom) / 2;
    if (dir === 'right' || dir === 'left') {
      along = dir === 'right' ? r.left - from.right : from.left - r.right;
      if (along < -2 || (dir === 'right' ? cx <= fx : cx >= fx)) continue;
      across =
        r.bottom < from.top ? from.top - r.bottom : r.top > from.bottom ? r.top - from.bottom : 0;
    } else {
      along = dir === 'down' ? r.top - from.bottom : from.top - r.bottom;
      if (along < -2 || (dir === 'down' ? cy <= fy : cy >= fy)) continue;
      across =
        r.right < from.left ? from.left - r.right : r.left > from.right ? r.left - from.right : 0;
    }
    const centre = dir === 'right' || dir === 'left' ? Math.abs(cy - fy) : Math.abs(cx - fx);
    const score = Math.max(0, along) + 2 * across + 0.01 * centre;
    if (score < bestScore) {
      bestScore = score;
      best = el;
    }
  }
  return best;
}

/** Show the focus ring for keyboard and gamepad; hide it again on pointer use. */
export function showFocusRing(on: boolean): void {
  const root = document.documentElement;
  if (on) root.dataset.focusRing = '';
  else delete root.dataset.focusRing;
}

export function focusEl(el: HTMLElement | null): void {
  if (!el) return;
  el.focus({ preventScroll: true });
  el.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
}

/** Focus the first reachable control in `scope` (its `data-nav-default` one when present). */
export function focusFirst(scope: HTMLElement): void {
  const items = focusables(scope);
  const preferred = items.find((el) => el.hasAttribute('data-nav-default'));
  focusEl(preferred ?? items[0] ?? null);
}

/**
 * Move focus for one menu action in `scope`. Returns true when the action was used (moved,
 * activated or taken by the focused control).
 */
export function navigate(scope: HTMLElement, action: NavAction, nativeAccept = false): boolean {
  const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const inScope = active !== null && scope.contains(active) && active.hasAttribute('data-nav');
  if (inScope && active) {
    const handler = handlers.get(active);
    if (handler?.(action)) return true;
  }
  if (action === 'menuAccept') {
    if (!inScope || !active) return false;
    if (!nativeAccept) active.click();
    return true;
  }
  const dir = DIRECTIONS[action];
  if (!dir) return false;
  const items = focusables(scope);
  if (!inScope || !active) {
    focusFirst(scope);
    return items.length > 0;
  }
  const from = active.getBoundingClientRect();
  const fromGroup = active.closest('[data-nav-group]');
  const candidates = items
    .filter((el) => el !== active)
    .map((el) => ({ el, rect: el.getBoundingClientRect() }));
  let next = pickInDirection(from, candidates, dir);
  if (next) {
    const group = next.closest('[data-nav-group]');
    if (group && group !== fromGroup) next = selectedIn(group) ?? next;
    focusEl(next);
  }
  return true;
}
