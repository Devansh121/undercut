import { SurfaceKind } from '@undercut/sim';

/** Below this speed either way, m/s, a car off the road counts as stopped. */
const STOPPED_SPEED = 1.5;

/**
 * Whether the HUD offers the reset ("Car stopped, Backspace to reset"): a car in play, more than
 * 2 s into the session, standing off the road. A car reversing out is moving, not stopped.
 */
export function carStopped(c: {
  playing: boolean;
  /** Session time, s. */
  time: number;
  /** Forward speed, m/s: negative in reverse. */
  speed: number;
  surface: SurfaceKind;
}): boolean {
  return (
    c.playing &&
    c.time > 2 &&
    Math.abs(c.speed) < STOPPED_SPEED &&
    c.surface !== SurfaceKind.Asphalt
  );
}
