/** What the first-lap coach reads from the session each frame. */
export interface CoachFrame {
  /** Real seconds since the last frame. */
  dt: number;
  /** The session is running (not paused, not loading). */
  running: boolean;
  /** The player is using the controls (throttle, brake or steering). */
  driving: boolean;
  /** The driving line shows a braking zone here. */
  cue: boolean;
  braking: boolean;
  invalid: boolean;
  paused: boolean;
  /** Laps completed this session. */
  laps: number;
}

export const COACH_STEPS = 4;
/** Shortest time a tip stays up before driving can move it on, s. */
const READ = 3;
/** The track-limits tip, s, and how long it stays after the lap goes invalid, s. */
const LIMITS_READ = 10;
const INVALID_READ = 4;

/**
 * The coach's steps, free of the DOM: controls, braking, track limits, pause. Each moves on by
 * what the player does with whatever device they use, so no tip needs a click.
 */
export class CoachSteps {
  step = 0;
  private shown = 0;
  private drove = false;
  private cueSeen = false;
  private invalidAt: number | null = null;
  /** Laps completed when this run began, read on the first frame after (re)start. */
  private lapsAtStart: number | null = null;

  constructor(public done: boolean) {}

  restart(): void {
    this.done = false;
    this.step = 0;
    this.lapsAtStart = null;
    this.reset();
  }

  finish(): void {
    this.done = true;
  }

  /** Move to the next tip; past the last one the coach is done. */
  advance(): void {
    this.step++;
    this.reset();
    if (this.step >= COACH_STEPS) this.done = true;
  }

  /** Returns true when the step changed or the coach finished. */
  update(f: CoachFrame): boolean {
    if (this.done) return false;
    this.lapsAtStart ??= f.laps;
    if (f.laps > this.lapsAtStart) {
      this.done = true;
      return true;
    }
    if (f.running) this.shown += f.dt;
    const before = this.step;
    switch (this.step) {
      case 0:
        if (f.driving) this.drove = true;
        if (this.drove && this.shown >= READ) this.advance();
        break;
      case 1:
        if (f.cue) this.cueSeen = true;
        if ((f.braking && (f.cue || this.shown >= READ)) || (this.cueSeen && !f.cue))
          this.advance();
        break;
      case 2:
        if (f.invalid && this.invalidAt === null) this.invalidAt = this.shown;
        if (
          this.shown >= LIMITS_READ &&
          (this.invalidAt === null || this.shown - this.invalidAt >= INVALID_READ)
        )
          this.advance();
        break;
      default:
        if (f.paused) this.done = true;
    }
    return this.done || this.step !== before;
  }

  private reset(): void {
    this.shown = 0;
    this.drove = false;
    this.cueSeen = false;
    this.invalidAt = null;
  }
}
