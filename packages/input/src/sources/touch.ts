import { clamp } from '@undercut/core';
import { touchControl, type ControlId, type TouchControl } from '../controls';
import { applyAxisCurve, type TouchShaping } from '../shaping';
import { pushPress, type ActivityClock, type DeviceChange, type DeviceSource } from './source';

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export type TouchButton = 'gearUp' | 'gearDown' | 'drs' | 'overtake' | 'camera' | 'pause';
export const TOUCH_BUTTONS: readonly TouchButton[] = [
  'gearUp',
  'gearDown',
  'drs',
  'overtake',
  'camera',
  'pause',
];

/** Where the overlay's controls are, in the same coordinates as the pointer events. */
export interface TouchLayout {
  /** Zone in which a finger plants the floating steering stick. */
  steer: Rect;
  throttle: Rect;
  brake: Rect;
  buttons: Partial<Record<TouchButton, Rect>>;
}

/** Live state of the steering stick, for drawing it. */
export interface StickState {
  pointer: number | null;
  originX: number;
  originY: number;
  x: number;
  y: number;
  /** Raw deflection in [-1, 1], finger right positive (screen direction, before shaping). */
  deflection: number;
}

export interface PedalState {
  pointer: number | null;
  value: number;
}

function inside(r: Rect | undefined, x: number, y: number): boolean {
  return !!r && x >= r.left && x <= r.left + r.width && y >= r.top && y <= r.top + r.height;
}

const NO_CHANGES: readonly DeviceChange[] = [];

/**
 * Touch controls as a pure model of pointers over a layout: a floating steering stick in the
 * left zone, two analog pedals and a set of buttons. Each control owns at most one pointer id
 * from its first contact until that pointer lifts, so fingers never disturb each other.
 */
export class TouchSource implements DeviceSource {
  readonly kind = 'touch' as const;
  lastActivity = 0;
  layout: TouchLayout | null = null;
  readonly stick: StickState = { pointer: null, originX: 0, originY: 0, x: 0, y: 0, deflection: 0 };
  readonly throttle: PedalState = { pointer: null, value: 0 };
  readonly brake: PedalState = { pointer: null, value: 0 };
  readonly buttons: Record<TouchButton, number | null> = {
    gearUp: null,
    gearDown: null,
    drs: null,
    overtake: null,
    camera: null,
    pause: null,
  };
  private presses: ControlId[] = [];
  private drained: ControlId[] = [];

  constructor(
    private readonly clock: ActivityClock,
    private readonly shaping: () => TouchShaping,
  ) {}

  /** Touch counts as present once the overlay has given it a layout. */
  get connected(): boolean {
    return this.layout !== null;
  }

  setLayout(layout: TouchLayout | null): void {
    this.layout = layout;
    if (!layout) this.releaseAll();
  }

  /** A pointer went down. Returns true when a control took it. */
  pointerDown(id: number, x: number, y: number): boolean {
    const layout = this.layout;
    if (!layout || this.owns(id)) return false;
    for (const name of TOUCH_BUTTONS) {
      if (inside(layout.buttons[name], x, y)) {
        if (this.buttons[name] !== null) return false;
        this.buttons[name] = id;
        this.pressed(touchControl(name));
        return true;
      }
    }
    for (const [pedal, rect, name] of [
      [this.throttle, layout.throttle, 'throttle'],
      [this.brake, layout.brake, 'brake'],
    ] as const) {
      if (inside(rect, x, y)) {
        if (pedal.pointer !== null) return false;
        pedal.pointer = id;
        pedal.value = this.pedalValue(rect, y);
        this.pressed(touchControl(name));
        return true;
      }
    }
    if (inside(layout.steer, x, y)) {
      if (this.stick.pointer !== null) return false;
      Object.assign(this.stick, { pointer: id, originX: x, originY: y, x, y, deflection: 0 });
      this.lastActivity = this.clock.next();
      return true;
    }
    return false;
  }

  pointerMove(id: number, x: number, y: number): void {
    const layout = this.layout;
    if (!layout) return;
    if (this.stick.pointer === id) {
      const radius = Math.max(1, this.shaping().stickRadius);
      this.stick.x = x;
      this.stick.y = y;
      this.stick.deflection = clamp((x - this.stick.originX) / radius, -1, 1);
    } else if (this.throttle.pointer === id) {
      this.throttle.value = this.pedalValue(layout.throttle, y);
    } else if (this.brake.pointer === id) {
      this.brake.value = this.pedalValue(layout.brake, y);
    }
  }

  /** A pointer lifted or was cancelled: release only the control it owned. */
  pointerUp(id: number): void {
    if (this.stick.pointer === id) {
      this.stick.pointer = null;
      this.stick.deflection = 0;
    }
    for (const pedal of [this.throttle, this.brake]) {
      if (pedal.pointer === id) {
        pedal.pointer = null;
        pedal.value = 0;
      }
    }
    for (const name of TOUCH_BUTTONS) if (this.buttons[name] === id) this.buttons[name] = null;
  }

  /** Number of pointers held by controls. */
  activePointers(): number {
    let n = 0;
    if (this.stick.pointer !== null) n++;
    if (this.throttle.pointer !== null) n++;
    if (this.brake.pointer !== null) n++;
    for (const name of TOUCH_BUTTONS) if (this.buttons[name] !== null) n++;
    return n;
  }

  private owns(id: number): boolean {
    return (
      this.stick.pointer === id ||
      this.throttle.pointer === id ||
      this.brake.pointer === id ||
      TOUCH_BUTTONS.some((name) => this.buttons[name] === id)
    );
  }

  private pressed(control: ControlId): void {
    pushPress(this.presses, control);
    this.lastActivity = this.clock.next();
  }

  private pedalValue(rect: Rect, y: number): number {
    const s = this.shaping();
    const travel = rect.height * s.pedalFullAt;
    const t = travel > 0 ? clamp((rect.top + rect.height - y) / travel, 0, 1) : 1;
    return s.pedalFloor + (1 - s.pedalFloor) * t;
  }

  poll(): void {}

  level(control: ControlId): number {
    if (!control.startsWith('touch:')) return 0;
    const name = control.slice(6) as TouchControl;
    switch (name) {
      case 'steerLeft':
        return applyAxisCurve(-this.stick.deflection, this.shaping().stick);
      case 'steerRight':
        return applyAxisCurve(this.stick.deflection, this.shaping().stick);
      case 'throttle':
        return this.throttle.value;
      case 'brake':
        return this.brake.value;
      default:
        return this.buttons[name] !== null ? 1 : 0;
    }
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
    this.stick.pointer = null;
    this.stick.deflection = 0;
    for (const pedal of [this.throttle, this.brake]) {
      pedal.pointer = null;
      pedal.value = 0;
    }
    for (const name of TOUCH_BUTTONS) this.buttons[name] = null;
  }
}
