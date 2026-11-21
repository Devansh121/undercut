/** Map fixed simulation ticks to the server-clock interval being caught up this frame. */
export class StartGate {
  private origin = 0;
  beginFrame(serverNow: number, elapsed: number, remainder: number, simTime: number): void {
    this.origin = serverNow - (elapsed + remainder + simTime) * 1000;
  }
  /** Timestamp of the start of this actual simulation tick, never the nominal lights-out. */
  tickAt(simTime: number): number {
    return this.origin + simTime * 1000;
  }
}
