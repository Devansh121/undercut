/**
 * Prompt glyphs: the key or pad button bound to an action, drawn for the device in use. They
 * follow the player's rebinding and switch when the active device changes (a key cap for the
 * keyboard, a face button, bumper or trigger for a pad; nothing on touch, where the controls are
 * on the screen). One registry: `setGlyphContext` re-renders every glyph in the document.
 */
import {
  controlLabel,
  controlsFor,
  defaultBindings,
  parsePadControl,
  type ActionId,
  type BindingMap,
  type ControlId,
  type DeviceKind,
} from '@undercut/input';
import { icon, type IconKey } from './icons';

let device: DeviceKind = 'keyboard';
let bindings: BindingMap = defaultBindings();

/** Pad buttons by standard-mapping index: a short label and the shape it is drawn in. */
const PAD: Record<
  number,
  { label: string; shape: 'face' | 'bumper' | 'trigger' | 'small' | 'dpad' }
> = {
  0: { label: 'A', shape: 'face' },
  1: { label: 'B', shape: 'face' },
  2: { label: 'X', shape: 'face' },
  3: { label: 'Y', shape: 'face' },
  4: { label: 'LB', shape: 'bumper' },
  5: { label: 'RB', shape: 'bumper' },
  6: { label: 'LT', shape: 'trigger' },
  7: { label: 'RT', shape: 'trigger' },
  8: { label: 'View', shape: 'small' },
  9: { label: 'Menu', shape: 'small' },
  10: { label: 'LS', shape: 'face' },
  11: { label: 'RS', shape: 'face' },
  12: { label: '↑', shape: 'dpad' },
  13: { label: '↓', shape: 'dpad' },
  14: { label: '←', shape: 'dpad' },
  15: { label: '→', shape: 'dpad' },
};

const KEY_SHORT: Record<string, string> = {
  'Left arrow': '←',
  'Right arrow': '→',
  'Up arrow': '↑',
  'Down arrow': '↓',
  Backspace: 'Bksp',
};

export interface GlyphFace {
  text: string;
  shape: 'key' | 'face' | 'bumper' | 'trigger' | 'small' | 'dpad' | 'stick' | 'none';
}

/** What to draw for `action` on `dev` with `map`: the first bound control, or nothing. */
export function glyphFace(action: ActionId, dev: DeviceKind, map: BindingMap): GlyphFace {
  if (dev === 'touch') return { text: '', shape: 'none' };
  const control = controlsFor(map, dev, action)[0];
  if (!control) return { text: '', shape: 'none' };
  if (dev === 'keyboard') {
    const label = controlLabel(control);
    return { text: KEY_SHORT[label] ?? label, shape: 'key' };
  }
  return padFace(control);
}

/** What to draw for one pad control: its button shape, or a stick for an axis. */
export function padFace(control: ControlId): GlyphFace {
  const pad = parsePadControl(control);
  if (pad?.kind === 'button') {
    const p = PAD[pad.index];
    return p ? { text: p.label, shape: p.shape } : { text: `B${pad.index}`, shape: 'face' };
  }
  if (pad?.kind === 'axis') return { text: pad.index < 2 ? 'L' : 'R', shape: 'stick' };
  return { text: '', shape: 'none' };
}

const ARROWS: Record<string, IconKey> = {
  '↑': 'chevronUp',
  '↓': 'chevronDown',
  '←': 'chevronLeft',
  '→': 'chevron',
};

function paint(el: HTMLElement): void {
  const action = el.dataset.glyph as ActionId | undefined;
  if (!action) return;
  draw(el, glyphFace(action, device, bindings));
}

function draw(el: HTMLElement, face: GlyphFace): void {
  const key = `${face.shape}:${face.text}`;
  if (el.dataset.face === key) return;
  el.dataset.face = key;
  el.dataset.shape = face.shape;
  const arrow = ARROWS[face.text];
  // Arrows are drawn with the icon set, not a font's arrow characters.
  if (arrow) el.replaceChildren(icon(arrow, 'glyph__icon'));
  else el.textContent = face.text;
  el.setAttribute('aria-label', face.text);
  el.hidden = face.shape === 'none';
}

/** A glyph for `action` that keeps itself current. */
export function glyph(action: ActionId, className = ''): HTMLElement {
  const el = document.createElement('kbd');
  el.className = className ? `glyph ${className}` : 'glyph';
  el.dataset.glyph = action;
  el.setAttribute('aria-hidden', 'true');
  paint(el);
  return el;
}

/** A glyph that always shows `face`, whatever the device in use (the controls list). */
export function faceGlyph(face: GlyphFace, className = ''): HTMLElement {
  const el = document.createElement('kbd');
  el.className = className ? `glyph ${className}` : 'glyph';
  el.setAttribute('aria-hidden', 'true');
  draw(el, face);
  return el;
}

/** Repaint every glyph inside `scope` for the current device and bindings. */
export function refreshGlyphs(scope: ParentNode = document): void {
  for (const el of scope.querySelectorAll<HTMLElement>('[data-glyph]')) paint(el);
}

/** The device whose glyphs show, and its bindings; repaints every glyph on the page. */
export function setGlyphContext(dev: DeviceKind, map: BindingMap): void {
  device = dev;
  bindings = map;
  document.documentElement.dataset.device = dev;
  refreshGlyphs(document);
}

export function glyphDevice(): DeviceKind {
  return device;
}
