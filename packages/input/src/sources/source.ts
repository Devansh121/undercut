import type { DeviceKind } from '../actions';
import type { ControlId } from '../controls';

/**
 * Hands out increasing stamps so sources can say which of them was used most recently.
 * Evented sources stamp as events arrive; polled sources stamp when polled, which happens at
 * the start of a sample, after every event queued before it.
 */
export class ActivityClock {
  private last = 0;
  next(): number {
    this.last += 1;
    return this.last;
  }
}

/** Hot-plug notice from a source. */
export interface DeviceChange {
  type: 'connected' | 'disconnected';
  device: DeviceKind;
  id: string;
}

/**
 * One input device, behind the same face for keyboard, gamepad and touch (strategy per device).
 * A source reports raw control levels and presses; the input system maps them to actions.
 */
export interface DeviceSource {
  readonly kind: DeviceKind;
  /** Whether the device can be used now (keyboard: always; gamepad: one connected). */
  readonly connected: boolean;
  /** Stamp from the shared ActivityClock of the last press; 0 if never used. */
  readonly lastActivity: number;
  /** Read polled hardware. Called once at the start of every sample. */
  poll(): void;
  /** Level of a control in [0, 1], after the device's own conditioning (curves, dead zones). */
  level(control: ControlId): number;
  /**
   * Controls pressed since the last call, in order. A press and release that both happen
   * between two samples still appear once.
   */
  drainPresses(): readonly ControlId[];
  /** Hot-plug notices since the last call. */
  drainChanges(): readonly DeviceChange[];
  /** Let go of everything (focus lost, device removed). */
  releaseAll(): void;
}

/** Upper bound on presses kept between two samples; older ones are dropped first. */
export const MAX_PENDING_PRESSES = 32;

export function pushPress(list: ControlId[], control: ControlId): void {
  if (list.length >= MAX_PENDING_PRESSES) list.shift();
  list.push(control);
}
