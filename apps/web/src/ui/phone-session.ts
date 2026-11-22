import { el } from './dom';
import { S } from './strings';

/** Phone browser capabilities are optional and may be denied without ending a session. */
export function phoneSession(pause: () => void): {
  root: HTMLElement;
  active(on: boolean): void;
  destroy(): void;
} {
  const root = el('aside', 'rotate-prompt');
  root.dataset.testid = 'rotate-prompt';
  root.append(el('h2', '', S.intro.rotate), el('p', '', S.intro.rotateHelp));
  let wanted = false;
  let destroyed = false;
  let requesting = false;
  let lock: WakeLockSentinel | null = null;
  const release = (): void => {
    void lock?.release().catch(() => {});
    lock = null;
  };
  const wake = async (): Promise<void> => {
    if (!wanted || destroyed || requesting || lock || document.hidden || !navigator.wakeLock)
      return;
    requesting = true;
    try {
      const next = await navigator.wakeLock.request('screen');
      if (!wanted || destroyed) await next.release();
      else {
        lock = next;
        next.addEventListener('release', () => {
          if (lock === next) lock = null;
        });
      }
    } catch {
      /* Unsupported or denied: driving remains available. */
    } finally {
      requesting = false;
    }
  };
  const resize = (): void => {
    const portrait = innerHeight > innerWidth;
    root.hidden = !portrait;
    document.documentElement.toggleAttribute('data-portrait', portrait);
    if (portrait) pause();
  };
  const visible = (): void => {
    if (document.hidden) release();
    else void wake();
  };
  window.addEventListener('resize', resize);
  document.addEventListener('visibilitychange', visible);
  // Run after the drive screen has finished mounting.
  queueMicrotask(resize);
  return {
    root,
    active(on) {
      wanted = on;
      if (on) void wake();
      else release();
    },
    destroy() {
      destroyed = true;
      wanted = false;
      release();
      root.remove();
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', visible);
      document.documentElement.removeAttribute('data-portrait');
    },
  };
}
