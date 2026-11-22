import { el } from '../ui/dom';
import { iconButton } from '../ui/kit/components';
import { S } from '../ui/strings';

const KEY = 'hint.homeScreen.v1';

interface Env {
  userAgent: string;
  platform: string;
  maxTouchPoints: number;
  /** iOS Safari's own flag: true when opened from the Home Screen. */
  standalone?: boolean | undefined;
  displayMode(mode: string): boolean;
}

/**
 * An iPhone or iPad browser outside a home-screen launch. iOS has no Fullscreen API for pages,
 * so the bars only go away when the game is opened from the Home Screen.
 */
export function needsHomeScreen(env: Env): boolean {
  const ios =
    /iPhone|iPad|iPod/.test(env.userAgent) ||
    (env.platform === 'MacIntel' && env.maxTouchPoints > 1);
  const installed =
    env.standalone === true || env.displayMode('standalone') || env.displayMode('fullscreen');
  return ios && !installed;
}

/** Once per browser, on the launch screen only (styles.css), dismissible. */
export function showHomeScreenHint(): void {
  const env: Env = {
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    maxTouchPoints: navigator.maxTouchPoints,
    standalone: (navigator as { standalone?: boolean }).standalone,
    displayMode: (mode) => window.matchMedia?.(`(display-mode: ${mode})`).matches ?? false,
  };
  if (!needsHomeScreen(env)) return;
  try {
    if (localStorage.getItem(KEY)) return;
    localStorage.setItem(KEY, 'shown');
  } catch {
    // Blocked storage would show it on every visit: leave it out.
    return;
  }
  const bar = el('aside', 'home-hint');
  bar.dataset.testid = 'home-screen-hint';
  bar.setAttribute('role', 'note');
  const close = iconButton({
    icon: 'close',
    label: S.homeScreen.close,
    action: 'home-hint-close',
    onClick: () => bar.remove(),
  });
  bar.append(el('span', 'home-hint__text', S.homeScreen.hint), close);
  document.body.append(bar);
}
