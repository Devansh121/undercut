import { el } from '../ui/dom';
import { button } from '../ui/kit/components';
import { S } from '../ui/strings';

/** Check for a new build at most this often while the page stays open (an installed app). */
const RECHECK_MS = 60 * 60 * 1000;

/**
 * A non-blocking "new version" bar. It never reloads on its own: a race in progress keeps
 * running until the player chooses to reload. Hidden while driving (see styles.css).
 */
function updateBar(onReload: () => void): HTMLElement {
  const bar = el('aside', 'update-bar');
  bar.dataset.testid = 'update-ready';
  bar.setAttribute('role', 'status');
  const reload = button({
    label: S.update.reload,
    variant: 'primary',
    action: 'update-reload',
    onClick: onReload,
  });
  bar.append(el('span', 'update-bar__text', S.update.ready), reload);
  return bar;
}

/**
 * Register the offline worker. A new build installs beside the running one and waits; the
 * player accepts the prompt, the new worker takes over (skipWaiting, then clients.claim) and
 * the page reloads. Other open tabs show the same prompt once the new worker controls them.
 */
export function registerOffline(): void {
  const query = new URLSearchParams(location.search);
  if (query.has('debug') && query.get('offline') !== '1') return;
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  const sw = navigator.serviceWorker;
  const hadController = Boolean(sw.controller);
  let accepted = false;
  let bar: HTMLElement | null = null;
  const offer = (onReload: () => void): void => {
    bar?.remove();
    bar = updateBar(onReload);
    document.body.append(bar);
  };
  sw.addEventListener('controllerchange', () => {
    // The first install claiming this page changes nothing it has loaded.
    if (!hadController) return;
    if (accepted) location.reload();
    else offer(() => location.reload());
  });
  window.addEventListener('load', () => {
    sw.register('./sw.js', { updateViaCache: 'none' })
      .then((registration) => {
        const waiting = (): void => {
          const next = registration.waiting;
          if (!next || !sw.controller) return;
          offer(() => {
            accepted = true;
            next.postMessage('skip-waiting');
          });
        };
        waiting();
        registration.addEventListener('updatefound', () => {
          const next = registration.installing;
          next?.addEventListener('statechange', () => {
            if (next.state === 'installed') waiting();
          });
        });
        let checked = Date.now();
        document.addEventListener('visibilitychange', () => {
          if (document.hidden || Date.now() - checked < RECHECK_MS) return;
          checked = Date.now();
          void registration.update().catch(() => {});
        });
      })
      .catch(() => {
        // Insecure Wi-Fi origins and blocked storage still support online play.
      });
  });
}
