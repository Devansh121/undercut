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

// The icon set lives in kit/icons.ts; re-exported here for the screens that already use it.
export { ICON_PATHS, icon, type IconKey } from './kit/icons';

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
