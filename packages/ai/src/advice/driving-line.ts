import type { EnvelopeScale } from '../envelope/envelope';
import type { DrivingPlan } from '../profile/plan';
import { Phase } from '../profile/speed-profile';

const BRAKE_PHASE: number = Phase.Brake;

/**
 * The driving line a player can switch on: the racing line with a cue at every point, telling
 * the driver what to do with the pedals given how fast the car is going now.
 *
 * The speeds come from a plan on the shipped racing line built with less of the envelope than
 * the reference driver uses (`DRIVING_LINE_SCALE`): a line a newcomer can drive. The braking
 * curves in that plan are the car's own braking capability at each speed (the measured envelope,
 * with downforce), so the brake point for a car arriving faster than the plan comes earlier by
 * exactly the distance the car needs.
 *
 * A point `s` ahead is
 * - brake: the car, still at its present speed when it gets there, would be above the plan's
 *   speed a moment later (`lead`) inside one of the plan's braking zones, or above it anywhere
 *   by more than a lift sheds;
 * - lift: above it by less than that outside a braking zone (in a corner or a kink: coasting
 *   sheds it within `liftTime`, drag plus `coastDecel` for engine braking and rolling
 *   resistance);
 * - throttle: at or under the plan.
 *
 * Pure, allocation-free per query.
 */
export const LineCue = {
  Throttle: 0,
  Lift: 1,
  Brake: 2,
} as const;
export type LineCue = (typeof LineCue)[keyof typeof LineCue];

/** Envelope fractions the driving line's speeds are planned with. */
export const DRIVING_LINE_SCALE: Readonly<EnvelopeScale> = Object.freeze({
  lateral: 0.9,
  brake: 0.8,
  traction: 0.9,
});

export interface DrivingLineOptions {
  /** Time a driver needs to get on the pedal, s: the cue at a point is for the plan this far on. */
  lead: number;
  /** Speed excess a lift handles: what coasting sheds in this many seconds, s. */
  liftTime: number;
  /** Deceleration off both pedals besides drag (engine braking, rolling resistance), m/s². */
  coastDecel: number;
}

export const DRIVING_LINE_OPTIONS: Readonly<DrivingLineOptions> = Object.freeze({
  lead: 0.3,
  liftTime: 0.5,
  coastDecel: 3,
});

export class DrivingLine {
  readonly plan: DrivingPlan;
  readonly options: DrivingLineOptions;

  constructor(plan: DrivingPlan, options: Partial<DrivingLineOptions> = {}) {
    this.plan = plan;
    this.options = { ...DRIVING_LINE_OPTIONS, ...options };
  }

  /** The plan's speed at centreline `s`, m/s (linear interpolation, wraps). */
  speedAt(s: number): number {
    const track = this.plan.track;
    const v = this.plan.profile.v;
    const n = v.length;
    const u = track.wrap(s) / track.lap.step;
    const i = Math.floor(u) % n;
    const j = (i + 1) % n;
    const f = u - Math.floor(u);
    return v[i]! + (v[j]! - v[i]!) * f;
  }

  /** The cue at centreline `s` for a car doing `speed` m/s there. */
  cueAt(s: number, speed: number): LineCue {
    const o = this.options;
    const at = s + speed * o.lead;
    const over = speed - this.speedAt(at);
    if (over <= 0) return LineCue.Throttle;
    const track = this.plan.track;
    const phase = this.plan.profile.phase[track.lap.sampleIndex(track.wrap(at))];
    if (phase === BRAKE_PHASE) return LineCue.Brake;
    const shed = (this.plan.model.drag(speed, false) + o.coastDecel) * o.liftTime;
    return over <= shed ? LineCue.Lift : LineCue.Brake;
  }

  /**
   * Cues along the line for a car at `s` doing `speed`: `out[k]` is the cue at
   * `s + from + k · spacing`, as if the car were still at `speed` when it got there.
   */
  fill(s: number, speed: number, from: number, spacing: number, out: Uint8Array): Uint8Array {
    for (let k = 0; k < out.length; k++) out[k] = this.cueAt(s + from + k * spacing, speed);
    return out;
  }
}
