/** Map fixed simulation ticks to the server-clock interval being caught up this frame. */
export class StartGate {
  private origin = 0;
  beginFrame(
    serverNow: number,
    elapsed: number,
    remainder: number,
    simTime: number,
    pendingStart: number | null = null,
  ): void {
    let firstTick = serverNow - (elapsed + remainder) * 1000;
    // When a clamped stall straddles lights-out, discard stationary pre-start
    // time first. Preserve the release boundary in the surviving fixed ticks;
    // otherwise the clamp discards the start event itself. The sim still runs
    // at most the accepted 250 ms, losing excess race time as on any stall.
    if (pendingStart !== null && serverNow >= pendingStart)
      firstTick = Math.min(firstTick, pendingStart);
    this.origin = firstTick - simTime * 1000;
  }
  /** Timestamp of the start of this actual simulation tick, never the nominal lights-out. */
  tickAt(simTime: number): number {
    return this.origin + simTime * 1000;
  }
}
