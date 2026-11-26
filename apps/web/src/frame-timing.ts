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

/**
 * An online session keeps stepping when animation frames come late. The browser can hold
 * `requestAnimationFrame` back while the compositor is slow to present (software compositing of
 * a large window) even with the main thread idle; the simulation, car contact and the snapshots
 * other players see run in that frame, so without this a slow screen starves the room.
 */
/** Between timer steps while frames are late, ms: the 30 Hz snapshot cadence. */
export const BACKUP_STEP_MS = 1000 / 30;
/** A frame is late once a snapshot interval has passed without one (60 Hz frames never are). */
export const LATE_FRAME_MS = BACKUP_STEP_MS;

/**
 * True when the timer should run a frame's simulation and network work without drawing: the
 * page is visible and the last animation frame (`lastFrameMs`, null before the first) is at
 * least `LATE_FRAME_MS` old.
 */
export function stepWithoutFrame(
  nowMs: number,
  lastFrameMs: number | null,
  visible: boolean,
): boolean {
  return visible && lastFrameMs !== null && nowMs - lastFrameMs >= LATE_FRAME_MS;
}
