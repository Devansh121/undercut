import type { InputSystem } from '../system';

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
}

/**
 * Feed keyboard events into the input system. Keys are read by `event.code`, so bindings follow
 * key positions, not the layout's letters. While driving, bound keys do not scroll the page.
 * Every held key is released when the window loses focus or the page is hidden, so nothing
 * stays pressed after alt-tab. Returns a function that detaches the listeners.
 */
export function attachKeyboard(system: InputSystem, win: Window = window): () => void {
  const doc = win.document;
  const onKeyDown = (event: KeyboardEvent): void => {
    if (isEditable(event.target) || event.code === '') return;
    system.keyboard.keyDown(event.code, event.repeat);
    const modified = event.ctrlKey || event.metaKey || event.altKey;
    const capturing = system.capturing === 'keyboard';
    if (
      !modified &&
      (capturing || (system.context === 'driving' && system.isKeyBound(event.code)))
    ) {
      event.preventDefault();
    }
  };
  const onKeyUp = (event: KeyboardEvent): void => {
    if (event.code !== '') system.keyboard.keyUp(event.code);
  };
  const release = (): void => system.releaseAll();
  const onVisibility = (): void => {
    if (doc.visibilityState === 'hidden') release();
  };
  win.addEventListener('keydown', onKeyDown);
  win.addEventListener('keyup', onKeyUp);
  win.addEventListener('blur', release);
  win.addEventListener('pagehide', release);
  doc.addEventListener('visibilitychange', onVisibility);
  return () => {
    win.removeEventListener('keydown', onKeyDown);
    win.removeEventListener('keyup', onKeyUp);
    win.removeEventListener('blur', release);
    win.removeEventListener('pagehide', release);
    doc.removeEventListener('visibilitychange', onVisibility);
  };
}
