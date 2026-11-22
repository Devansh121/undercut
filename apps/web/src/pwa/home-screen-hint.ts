import { el } from '../ui/dom';
import { iconButton } from '../ui/kit/components';
import { S } from '../ui/strings';

const KEY = 'hint.homeScreen.v1';
/** On screen this long counts as seen, ms (a player who taps Start at once sees it again). */
const SEEN_MS = 4000;

function remember(): void {
  try {
    localStorage.setItem(KEY, 'seen');
  } catch {
    // Blocked storage: it shows again next visit.
  }
}

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

/**
 * Until seen once per browser (closed, or 4 s on the launch screen), on the launch screen only
 * (styles.css), dismissible.
 */
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
    onClick: () => {
      remember();
      stop();
      bar.remove();
    },
  });
  bar.append(el('span', 'home-hint__text', S.homeScreen.hint), close);
  document.body.append(bar);
  // Count time only while it is actually on screen (the launch screen shows it).
  let seen = 0;
  const timer = window.setInterval(() => {
    if (document.documentElement.dataset.screen !== 'launch' || document.hidden) return;
    seen += 500;
    if (seen >= SEEN_MS) {
      remember();
      stop();
    }
  }, 500);
  function stop(): void {
    window.clearInterval(timer);
  }
}
