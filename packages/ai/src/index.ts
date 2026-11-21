/** AI drivers. Placeholder until M3 brings the grid. */

/** What an AI driver hands the sim each step, the same shape a human's input takes. */
export interface DriverCommand {
  /** Steering in [-1, 1], positive to the left. */
  steer: number;
  /** Throttle in [0, 1]. */
  throttle: number;
  /** Brake in [0, 1]. */
  brake: number;
}
