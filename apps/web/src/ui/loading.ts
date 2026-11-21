import { el, icon } from './dom';

export interface LoadingScreen {
  root: HTMLElement;
  /** Bytes received and expected so far. */
  progress(loaded: number, total: number): void;
  /** Show a failure with Try again and Back; resolves with the player's choice. */
  fail(message: string): Promise<'retry' | 'back'>;
  /** Back to the progress state (after Try again). */
  reset(): void;
  remove(): void;
}

const MB = 1024 * 1024;

/**
 * The loading screen between Start and the first frame: the circuit, a progress bar by bytes, and
 * on failure a plain message with Try again (fetches only what is missing) and Back.
 */
export function mountLoadingScreen(
  host: HTMLElement,
  circuit: string,
  detail: string,
): LoadingScreen {
  const root = el('section', 'loading');
  root.dataset.testid = 'loading';
  root.setAttribute('role', 'status');
  root.setAttribute('aria-live', 'polite');
  const head = el('div', 'loading__head');
  head.append(el('span', 'label', detail), el('h2', 'loading__title', circuit));
  const bar = el('div', 'loading__bar');
  const fill = el('div', 'loading__fill');
  bar.append(fill);
  bar.setAttribute('role', 'progressbar');
  bar.setAttribute('aria-valuemin', '0');
  bar.setAttribute('aria-valuemax', '100');
  const meta = el('div', 'loading__meta');
  const what = el('span', 'label', 'Loading track and car');
  const bytes = el('span', 'loading__bytes num', '');
  meta.append(what, bytes);
  const error = el('div', 'loading__error');
  error.hidden = true;
  const message = el('p', 'loading__message');
  const actions = el('div', 'loading__actions');
  const retry = el('button', 'button button--primary');
  retry.type = 'button';
  retry.append(el('span', 'button__label', 'Try again'), icon('chevron'));
  const back = el('button', 'button');
  back.type = 'button';
  back.append(el('span', 'button__label', 'Back'));
  actions.append(retry, back);
  error.append(message, actions);
  root.append(head, bar, meta, error);
  host.append(root);

  let shown = 0;
  return {
    root,
    progress(loaded, total) {
      const pct = total > 0 ? Math.min(100, (loaded / total) * 100) : 0;
      // Never run backwards when a new file adds to the total.
      shown = Math.max(shown, pct);
      fill.style.transform = `scaleX(${shown / 100})`;
      bar.setAttribute('aria-valuenow', String(Math.round(shown)));
      bytes.textContent =
        total > 0 ? `${(loaded / MB).toFixed(1)} / ${(total / MB).toFixed(1)} MB` : '';
    },
    fail(text) {
      message.textContent = text;
      error.hidden = false;
      what.textContent = 'Stopped';
      root.dataset.state = 'error';
      retry.focus({ preventScroll: true });
      return new Promise((resolve) => {
        retry.onclick = () => resolve('retry');
        back.onclick = () => resolve('back');
      });
    },
    reset() {
      error.hidden = true;
      what.textContent = 'Loading track and car';
      delete root.dataset.state;
    },
    remove() {
      root.remove();
    },
  };
}
