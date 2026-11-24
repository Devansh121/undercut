/**
 * The player's display and accessibility settings, applied to the page as attributes on the
 * root element that the stylesheets read: colour-blind-safe timing and flag colours
 * (`data-cb`), reduced motion (`data-motion`), text size (`data-text`), the mirrored touch
 * layout (`data-touch-layout`) and the HUD scale (`--hud-scale`). Applied at start-up and on
 * every change, so the menus, the HUD and the touch overlay follow without a reload.
 */
import type { PlayerSettings } from './data/prefs';

/** The parts of an element this needs (a real `HTMLElement` satisfies it). */
export interface SettingsTarget {
  dataset: DOMStringMap;
  style: { setProperty(name: string, value: string): void };
}

export function applyPlayerSettings(s: Readonly<PlayerSettings>, root: SettingsTarget): void {
  const set = (key: string, value: string | null): void => {
    if (value === null) delete root.dataset[key];
    else root.dataset[key] = value;
  };
  set('cb', s.colourBlind ? 'on' : null);
  // "system" leaves it to the device's own setting (the stylesheets' media queries).
  set('motion', s.reducedMotion === 'on' ? 'reduce' : null);
  set('text', s.textSize === 'default' ? null : s.textSize);
  set('touchLayout', s.touchLayout === 'mirrored' ? 'mirrored' : null);
  root.style.setProperty('--hud-scale', String(s.hudScale));
}
