/** Tiny DOM helpers for the HUD and screens. No framework: the UI is a few dozen nodes. */

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = '',
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

export function svg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number> = {},
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

/** Game icons on the 24 px grid (1.75 px square-cap strokes), as in design/mock. */
export const ICON_PATHS = {
  flag: 'M5 21V4 M5 4h13l-3 4.5 3 4.5H5',
  camera: 'M3 8h4l2-3h6l2 3h4v11H3z M15.5 13a3.5 3.5 0 1 1-7 0a3.5 3.5 0 1 1 7 0z',
  pause: 'M8 5v14M16 5v14',
  play: 'M7 5l12 7-12 7z',
  restart: 'M5 12a7 7 0 1 0 2.05-4.95 M5 4v4h4',
  reset: 'M12 3v6 M8 7l4 4 4-4 M4 15h16 M6 19h12',
  exit: 'M14 4h6v16h-6 M10 8l-4 4 4 4 M6 12h10',
  stopwatch: 'M12 21a8 8 0 1 0 0-16a8 8 0 1 0 0 16z M12 9v4l2.5 2.5 M9.5 2.5h5',
  chevron: 'M9 6l6 6-6 6',
} as const;

export type IconKey = keyof typeof ICON_PATHS;

export function icon(name: IconKey, className = 'icon'): SVGSVGElement {
  const s = svg('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true', class: className });
  s.append(svg('path', { d: ICON_PATHS[name] }));
  return s;
}

/** A text node holder that only touches the DOM when the value changes. */
export class Text {
  private value = '';
  constructor(readonly node: HTMLElement) {}
  set(text: string): void {
    if (text !== this.value) {
      this.value = text;
      this.node.textContent = text;
    }
  }
}

/** Toggle a class only when it changes. */
export function setClass(node: Element, name: string, on: boolean): void {
  if (node.classList.contains(name) !== on) node.classList.toggle(name, on);
}

/** Set a data attribute only when it changes. */
export function setData(node: HTMLElement, key: string, value: string): void {
  if (node.dataset[key] !== value) node.dataset[key] = value;
}
