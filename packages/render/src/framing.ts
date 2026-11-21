/** Time constant for the chase cameras' image shift easing back down, s. */
export const LIFT_EASE_DOWN = 0.25;

/**
 * Next upward image shift for the chase cameras (CSS px). The shift needed this frame is
 * `target`; the result is never below it, so the car never dips behind the driver cluster even
 * for one frame or at a low frame rate. When less is needed it eases down over about
 * `LIFT_EASE_DOWN` seconds instead of jumping. `dt` 0 (paused) holds the current shift.
 */
export function nextLift(current: number, target: number, dt: number): number {
  const eased = dt > 0 ? target + (current - target) * Math.exp(-dt / LIFT_EASE_DOWN) : current;
  return Math.max(target, eased);
}
