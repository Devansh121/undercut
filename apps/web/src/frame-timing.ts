/** Longest physics step one animation frame may take after a stall, s. */
export const PHYSICS_DT_CAP = 0.25;

/**
 * The physics step for a frame `elapsedMs` after the last one, capped so a stall (a tab switch,
 * a slow device) never jumps the car. Render timing (frame pacing, dynamic resolution) takes the
 * real elapsed time instead: capped at 250 ms, a 1 s frame would count as a quarter second and
 * the pacer's 10 s and 60 s fallbacks would take 40 s and 240 s.
 */
export function physicsDt(elapsedMs: number): number {
  return Math.min(PHYSICS_DT_CAP, Math.max(0, elapsedMs) / 1000);
}
