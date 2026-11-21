import type { DeviceKind } from './actions';
import type { DeviceSource } from './sources/source';

/**
 * Picks the device whose prompts the HUD shows and whose axes drive the car.
 *
 * Rule: the last device used wins. "Used" means a press: a key going down, a gamepad button
 * or trigger past half travel, a stick past half deflection, or a finger landing on a touch
 * control. Connecting a pad is not using it. If the active device disconnects, the most
 * recently used remaining device takes over, else the starting device.
 */
export class DeviceArbiter {
  private current: DeviceKind;

  constructor(private readonly initial: DeviceKind) {
    this.current = initial;
  }

  get active(): DeviceKind {
    return this.current;
  }

  /** Re-evaluate after the sources have been polled. Returns true when the device changed. */
  update(sources: readonly DeviceSource[]): boolean {
    let best: DeviceSource | null = null;
    for (const source of sources) {
      if (!source.connected || source.lastActivity === 0) continue;
      if (!best || source.lastActivity > best.lastActivity) best = source;
    }
    const currentSource = sources.find((s) => s.kind === this.current);
    let next = this.current;
    if (best && (!currentSource?.connected || best.lastActivity > currentSource.lastActivity)) {
      next = best.kind;
    } else if (!currentSource?.connected) {
      next = best?.kind ?? this.initial;
    }
    const changed = next !== this.current;
    this.current = next;
    return changed;
  }
}
