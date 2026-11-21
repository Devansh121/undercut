/**
 * Keyboard, gamepad and touch input. Pure TypeScript: the DOM adapters live in
 * `@undercut/input/dom`, so everything here runs in Node with fake event sources.
 */
export * from './actions';
export * from './controls';
export * from './shaping';
export * from './bindings';
export * from './storage';
export * from './assists';
export { DeviceArbiter } from './arbiter';
export { KeyboardAxisShaper, PASS_THROUGH, type AxisShaper, type Axes } from './axis-shaper';
export { ActivityClock, type DeviceChange, type DeviceSource } from './sources/source';
export { KeyboardSource } from './sources/keyboard';
export {
  GamepadSource,
  type GamepadReader,
  type GamepadSnapshot,
  type RumblePort,
} from './sources/gamepad';
export {
  TOUCH_BUTTONS,
  TouchSource,
  type PedalState,
  type Rect,
  type StickState,
  type TouchButton,
  type TouchLayout,
} from './sources/touch';
export { InputSystem, type InputEvent, type InputFrame, type InputSystemOptions } from './system';
export { NEUTRAL_INPUT, type ControlInput } from '@undercut/sim';
