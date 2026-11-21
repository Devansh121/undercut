import { keyControl, type ControlId } from '../controls';
import { pushPress, type ActivityClock, type DeviceChange, type DeviceSource } from './source';

const NO_CHANGES: readonly DeviceChange[] = [];

/** Keyboard state from key events, by `KeyboardEvent.code`. Fed by the DOM adapter or a test. */
export class KeyboardSource implements DeviceSource {
  readonly kind = 'keyboard' as const;
  readonly connected = true;
  lastActivity = 0;
  private readonly held = new Set<ControlId>();
  private presses: ControlId[] = [];
  private drained: ControlId[] = [];

  constructor(private readonly clock: ActivityClock) {}

  /** A key went down. Auto-repeat keeps the key held but is not a new press. */
  keyDown(code: string, repeat = false): void {
    const control = keyControl(code);
    if (repeat && this.held.has(control)) return;
    this.held.add(control);
    pushPress(this.presses, control);
    this.lastActivity = this.clock.next();
  }

  keyUp(code: string): void {
    this.held.delete(keyControl(code));
  }

  isHeld(code: string): boolean {
    return this.held.has(keyControl(code));
  }

  /** Codes currently held, for diagnostics. */
  heldCodes(): string[] {
    return [...this.held].map((c) => c.slice(4));
  }

  poll(): void {}

  level(control: ControlId): number {
    return this.held.has(control) ? 1 : 0;
  }

  drainPresses(): readonly ControlId[] {
    const out = this.presses;
    this.presses = this.drained;
    this.presses.length = 0;
    this.drained = out;
    return out;
  }

  drainChanges(): readonly DeviceChange[] {
    return NO_CHANGES;
  }

  releaseAll(): void {
    this.held.clear();
  }
}
