/**
 * The game's icon set, drawn for it on a 24 px grid: 1.75 px strokes, square caps, mitred
 * joins, no fills except state marks (docs/visual-direction.md, "Icons"). Paths only, so the set
 * costs a few kilobytes and every icon takes `currentColor`.
 */
export const ICON_PATHS = {
  // Modes and navigation
  stopwatch:
    'M12 21a7.5 7.5 0 1 0 0-15a7.5 7.5 0 1 0 0 15z M12 13.5V10 M9.5 2.5h5 M12 2.5V6 M18.5 6.5L20 5',
  flag: 'M5 21V4 M5 4h13l-3 4.5 3 4.5H5',
  weekend: 'M3.5 5.5h17v15h-17z M3.5 10h17 M8 3v5 M16 3v5 M7 14h2 M11 14h2 M15 14h2 M7 17h2',
  trophy:
    'M7 4h10v5a5 5 0 0 1-10 0z M7 6H4v2a3 3 0 0 0 3 3 M17 6h3v2a3 3 0 0 1-3 3 M12 14v4 M8 20.5h8',
  rooms: 'M10 14l4-4 M8.5 11.5L6 14a3 3 0 0 0 4 4l2.5-2.5 M15.5 12.5L18 10a3 3 0 0 0-4-4l-2.5 2.5',
  chevron: 'M9 5l7 7-7 7',
  chevronLeft: 'M15 5l-7 7 7 7',
  chevronUp: 'M5 15l7-7 7 7',
  chevronDown: 'M5 9l7 7 7-7',
  back: 'M10 6l-6 6 6 6 M4 12h16',
  close: 'M6 6l12 12 M18 6L6 18',
  check: 'M4.5 12.5l5 5 10-11',
  plus: 'M12 5v14 M5 12h14',
  minus: 'M5 12h14',
  // Settings
  settings:
    'M10.3 3h3.4l.5 2.4 1.6.7 2-1.4 2.4 2.4-1.4 2 .7 1.6 2.4.5v3.4l-2.4.5-.7 1.6 1.4 2-2.4 2.4-2-1.4-1.6.7-.5 2.4h-3.4l-.5-2.4-1.6-.7-2 1.4-2.4-2.4 1.4-2-.7-1.6L3 13.7v-3.4l2.4-.5.7-1.6-1.4-2 2.4-2.4 2 1.4 1.6-.7z M15 12a3 3 0 1 1-6 0a3 3 0 1 1 6 0z',
  display: 'M3 5h18v12H3z M8 21h8 M12 17v4',
  volume: 'M4 9h4l5-4v14l-5-4H4z M16.5 9a4 4 0 0 1 0 6 M19 6.5a7.5 7.5 0 0 1 0 11',
  controls:
    'M7 8h10a4 4 0 0 1 4 4v1a4 4 0 0 1-7 2.6h-4A4 4 0 0 1 3 13v-1a4 4 0 0 1 4-4z M7 10.5v3 M5.5 12h3 M16 11h.01 M18 13h.01',
  keyboard: 'M2.5 6h19v12h-19z M6 9.5h.01 M9.5 9.5h.01 M13 9.5h.01 M16.5 9.5h.01 M7 14.5h10',
  touch: 'M6 2.5h12v19H6z M10.5 18.5h3',
  assists: 'M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6z M8.5 12l2.5 2.5 4.5-5',
  eye: 'M2.5 12C5 7.5 8.3 5.5 12 5.5s7 2 9.5 6.5c-2.5 4.5-5.8 6.5-9.5 6.5S5 16.5 2.5 12z M15 12a3 3 0 1 1-6 0a3 3 0 1 1 6 0z',
  credits: 'M5 3.5h11l3 3v14H5z M8.5 9h7 M8.5 12.5h7 M8.5 16h4',
  info: 'M12 21a9 9 0 1 0 0-18a9 9 0 1 0 0 18z M12 11v6 M12 7.5v.01',
  warning: 'M12 3.5l9.5 16.5h-19z M12 10v4.5 M12 17.5v.01',
  lock: 'M5.5 11h13v9.5h-13z M8.5 11V8a3.5 3.5 0 0 1 7 0v3',
  // Conditions
  sun: 'M16 12a4 4 0 1 1-8 0a4 4 0 1 1 8 0z M12 2v2.5 M12 19.5V22 M2 12h2.5 M19.5 12H22 M4.9 4.9l1.8 1.8 M17.3 17.3l1.8 1.8 M4.9 19.1l1.8-1.8 M17.3 6.7l1.8-1.8',
  cloud: 'M7 18.5h10.5a4 4 0 0 0 .5-8 6 6 0 0 0-11.5 1.5A3.3 3.3 0 0 0 7 18.5z',
  moon: 'M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10z',
  temp: 'M10 4a2 2 0 0 1 4 0v9.5a4 4 0 1 1-4 0z M12 10v7',
  drop: 'M12 3s6 7 6 11a6 6 0 0 1-12 0c0-4 6-11 6-11z',
  edit: 'M4 20h4L19 9l-4-4L4 16z M13 7l4 4',
  // Session and car
  camera: 'M3 8h4l2-3h6l2 3h4v11H3z M15.5 13a3.5 3.5 0 1 1-7 0a3.5 3.5 0 1 1 7 0z',
  pause: 'M8 5v14 M16 5v14',
  play: 'M7 5l12 7-12 7z',
  restart: 'M5 12a7 7 0 1 0 2.05-4.95 M5 4v4h4',
  reset: 'M12 3v6 M8 7l4 4 4-4 M4 15h16 M6 19h12',
  exit: 'M14 4h6v16h-6 M10 8l-4 4 4 4 M6 12h10',
  car: 'M9.5 3h5v3l2 1v4l1 1v6l-1.5 3h-7L7 18v-6l1-1V7l1.5-1z M4.5 6h3v3h-3z M16.5 6h3v3h-3z M4.5 15h3v4h-3z M16.5 15h3v4h-3z',
  tyre: 'M12 21a9 9 0 1 0 0-18a9 9 0 1 0 0 18z M12 16a4 4 0 1 0 0-8a4 4 0 1 0 0 8z M12 3v5 M12 16v5 M3 12h5 M16 12h5',
  fuel: 'M5 20.5V4.5h9v16 M3.5 20.5h12 M7.5 8h4 M14 9h2.5l2 2v7a1.5 1.5 0 0 0 3 0V9l-3-3',
  battery: 'M4 7h14v10H4z M18 10h2.5v4H18 M10 9l-2 3.5h4L10 16',
  pit: 'M4 20V6l8-3 8 3v14 M9 20v-6h6v6 M4 10h16',
  grid: 'M4 4h6v5H4z M14 7h6v5h-6z M4 13h6v5H4z M14 16h6v5h-6z',
  standings: 'M4 20V11h5v9 M9 20V5h6v15 M15 20v-7h5v7',
  up: 'M12 19V6 M6 11l6-6 6 6',
  down: 'M12 5v13 M6 13l6 6 6-6',
  person: 'M15.5 7.5a3.5 3.5 0 1 1-7 0a3.5 3.5 0 1 1 7 0z M4.5 20.5a7.5 7.5 0 0 1 15 0',
  route:
    'M6 18.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z M18 10.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z M6 13.5V9a3 3 0 0 1 3-3h6.5 M18 10.5V15a3 3 0 0 1-3 3H8.5',
} as const;

export type IconKey = keyof typeof ICON_PATHS;

export const ICON_KEYS = Object.keys(ICON_PATHS) as IconKey[];

const SVG_NS = 'http://www.w3.org/2000/svg';

/** An icon as an inline SVG, sized by the font size (1em) unless the class says otherwise. */
export function icon(name: IconKey, className = 'icon'): SVGSVGElement {
  const s = document.createElementNS(SVG_NS, 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('aria-hidden', 'true');
  s.setAttribute('class', className);
  s.dataset.icon = name;
  const p = document.createElementNS(SVG_NS, 'path');
  p.setAttribute('d', ICON_PATHS[name]);
  s.append(p);
  return s;
}

/**
 * The wordmark's mark: two slanted bars, vermilion and warm white. The one filled icon; it is
 * the brand, not a state.
 */
export function brandMark(className = 'mark'): SVGSVGElement {
  const s = document.createElementNS(SVG_NS, 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('aria-hidden', 'true');
  s.setAttribute('class', className);
  const a = document.createElementNS(SVG_NS, 'path');
  a.setAttribute('d', 'M3 20L11 4h4l-8 16z');
  a.setAttribute('fill', 'var(--c-brand)');
  const b = document.createElementNS(SVG_NS, 'path');
  b.setAttribute('d', 'M11 20l8-16h2l-8 16z');
  b.setAttribute('fill', 'var(--c-text-1)');
  s.append(a, b);
  return s;
}
