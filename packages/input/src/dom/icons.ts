/**
 * Icons drawn for the game on a 24 px grid: 1.75 px strokes, square caps, mitred joins, no
 * fills. Path data only; `icon()` wraps one in an SVG that takes the current text colour.
 */
export const ICONS = {
  up: 'M6 15l6-6 6 6',
  down: 'M6 9l6 6 6-6',
  camera: 'M3 8h4l2-3h6l2 3h4v11H3z M15.5 13a3.5 3.5 0 1 1-7 0a3.5 3.5 0 1 1 7 0z',
  pause: 'M8 5v14M16 5v14',
  keyboard: 'M2.5 6.5h19v11h-19z M6 10h1M9.5 10h1M13 10h1M16.5 10h1M7.5 14h9',
  gamepad:
    'M8 7.5h8a5 5 0 0 1 5 5v2a2.5 2.5 0 0 1-4.6 1.4L15 14H9l-1.4 1.9A2.5 2.5 0 0 1 3 14.5v-2a5 5 0 0 1 5-5z M7.5 10v3.5M5.75 11.75h3.5 M15.5 10.5h.5M17.5 12.5h.5',
  touch: 'M2.5 7h19v10h-19z M8.5 12a1.5 1.5 0 1 1-3 0a1.5 1.5 0 1 1 3 0z M18.5 9.5v5',
} as const;

export type IconName = keyof typeof ICONS;

const SVG_NS = 'http://www.w3.org/2000/svg';

export function icon(name: IconName, doc: Document = document): SVGSVGElement {
  const svg = doc.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'ut-icon');
  const path = doc.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', ICONS[name]);
  svg.append(path);
  return svg;
}
