/**
 * Back-pressure for the 3D view: at most `maxInFlight` frames queued on the GPU. WebGL calls
 * return before the GPU runs them, and the browser does not always hold animation frames back
 * while the GPU is behind: with software rendering (SwiftShader, Chrome's fallback when the GPU is
 * blocked) on a busy CPU, each frame costs more GPU time than the interval it was drawn in, so the
 * queue grows without limit. Measured on a loaded two-core machine, a fence took 14 s to signal at
 * the start of a session and 40 s after a few seconds of pause; what is on screen lags input by as
 * much, and releasing the context (leaving the page, closing the tab) first runs the whole queue.
 *
 * Before drawing, the view asks `ready()`: false while the oldest of `maxInFlight` frames is still
 * on the GPU, and the frame skips its draw (everything on the CPU side still runs, and the canvas
 * keeps the last frame). A fence after each draw marks its end. Fences complete in submission
 * order, so only the oldest needs checking. A GPU that keeps up never sees a skip: with two in
 * flight, the frame before last has finished by the time the next one starts.
 *
 * A fence that never signals (a driver bug) must not freeze the view for the session. After 10 s
 * with no fence completing, one frame draws anyway (the queue may then hold one more); after 60 s,
 * fences are taken not to work here: pacing stops for the session, its fences are released, and
 * `disabled` says so (renderStats). The times are long on purpose: on a CPU-starved machine with
 * software WebGL a working fence was measured taking more than 5 s to complete, and stopping
 * pacing there brings back the unbounded queue this class exists to prevent (an online race on
 * one core: the host page stopped pacing and never showed the start lights). A slow GPU whose
 * fences do complete resets both clocks with every completion.
 */
export interface Fences<F> {
  /** A fence after the commands issued so far, or null when the context cannot make one. */
  insert(): F | null;
  signaled(fence: F): boolean;
  release(fence: F): void;
}

/** Skipping this long with no fence completing draws one frame anyway, ms. */
const FORCE_MS = 10_000;
/** This long with no fence completing turns pacing off for the session, ms. */
const GIVE_UP_MS = 60_000;

export class FramePacer<F> {
  /** Draws skipped because the GPU was behind. */
  skipped = 0;
  /** Frames drawn anyway after 10 s of waiting on the GPU. */
  forcedDraws = 0;
  /** Pacing switched off for the session: fences stopped completing. */
  disabled = false;
  private readonly queue: F[] = [];
  /** Time skipping since a fence last completed (or since the last forced draw), ms. */
  private waiting = 0;
  /** Time since a fence last completed while the queue was full, ms. */
  private stalled = 0;

  constructor(
    private readonly fences: Fences<F>,
    readonly maxInFlight = 2,
  ) {}

  /** Frames on the GPU that have not finished. */
  get inFlight(): number {
    return this.queue.length;
  }

  /**
   * May this frame draw? Counts a skip when it may not. `elapsedMs`: real time since the last
   * call, for the stuck-fence fallbacks above.
   */
  ready(elapsedMs = 0): boolean {
    if (this.disabled) return true;
    let completed = false;
    while (this.queue.length > 0 && this.fences.signaled(this.queue[0] as F)) {
      this.fences.release(this.queue.shift() as F);
      completed = true;
    }
    if (completed) {
      this.waiting = 0;
      this.stalled = 0;
    }
    if (this.queue.length < this.maxInFlight) return true;
    this.waiting += elapsedMs;
    this.stalled += elapsedMs;
    if (this.stalled >= GIVE_UP_MS) {
      this.disabled = true;
      this.dispose();
      return true;
    }
    if (this.waiting >= FORCE_MS && this.queue.length <= this.maxInFlight) {
      this.waiting = 0;
      this.forcedDraws++;
      return true;
    }
    this.skipped++;
    return false;
  }

  /** Call after a frame's draw calls. */
  submitted(): void {
    if (this.disabled) return;
    const fence = this.fences.insert();
    if (fence !== null) this.queue.push(fence);
  }

  /** The context was lost: its fences are gone; forget them without touching GL. */
  abandon(): void {
    this.queue.length = 0;
  }

  dispose(): void {
    for (const fence of this.queue) this.fences.release(fence);
    this.queue.length = 0;
  }
}

/** WebGL2 sync objects as fences. A status only changes between tasks, as the spec requires. */
export function webglFences(gl: WebGL2RenderingContext): Fences<WebGLSync> {
  return {
    insert: () => {
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      // Make sure the fence reaches the GPU now rather than with the next frame's commands.
      if (sync) gl.flush();
      return sync;
    },
    signaled: (sync) => gl.getSyncParameter(sync, gl.SYNC_STATUS) === gl.SIGNALED,
    release: (sync) => gl.deleteSync(sync),
  };
}
