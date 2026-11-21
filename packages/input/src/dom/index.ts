/** DOM adapters for the input layer: thin wiring from browser events to the pure model. */
export { attachFocusGuard } from './focus';
export { attachKeyboard } from './keyboard';
export { navigatorGamepads, navigatorRumble } from './gamepad';
export { WebStorageAdapter } from './storage';
export { mountTouchOverlay, type TouchOverlay } from './touch-overlay';
export { ICONS, icon, type IconName } from './icons';
