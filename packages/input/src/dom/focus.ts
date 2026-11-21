import type { InputSystem } from '../system';

/**
 * Tell the input system when the page loses or regains focus or visibility. While the window
 * is blurred or the page hidden, every device is released and gamepads are not read; when it
 * comes back, a gamepad control still held must be let go before it counts again. Returns a
 * function that detaches the listeners.
 */
export function attachFocusGuard(system: InputSystem, win: Window = window): () => void {
  const doc = win.document;
  let blurred = false;
  let hidden = doc.visibilityState === 'hidden';
  const update = (): void => system.setFocused(!blurred && !hidden);
  const onBlur = (): void => {
    blurred = true;
    update();
  };
  const onFocus = (): void => {
    blurred = false;
    update();
  };
  const onVisibility = (): void => {
    hidden = doc.visibilityState === 'hidden';
    update();
  };
  const onPageHide = (): void => {
    hidden = true;
    update();
  };
  const onPageShow = (): void => {
    hidden = doc.visibilityState === 'hidden';
    update();
  };
  win.addEventListener('blur', onBlur);
  win.addEventListener('focus', onFocus);
  win.addEventListener('pagehide', onPageHide);
  win.addEventListener('pageshow', onPageShow);
  doc.addEventListener('visibilitychange', onVisibility);
  update();
  return () => {
    win.removeEventListener('blur', onBlur);
    win.removeEventListener('focus', onFocus);
    win.removeEventListener('pagehide', onPageHide);
    win.removeEventListener('pageshow', onPageShow);
    doc.removeEventListener('visibilitychange', onVisibility);
  };
}
