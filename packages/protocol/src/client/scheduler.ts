/**
 * When to send our car: at a fixed rate (about 30 Hz), never catching up in a burst
 * after a stall, and skipping a send while the socket's queue is backed up, so a slow
 * link drops stale snapshots instead of queueing them.
 */
export class SnapshotScheduler {
  private nextAt = Number.NEGATIVE_INFINITY;
  readonly intervalMs: number;
  sent = 0;
  skipped = 0;

  constructor(
    rateHz = 30,
    private readonly maxBufferedBytes = 16 * 1024,
  ) {
    this.intervalMs = 1000 / rateHz;
  }

  /** Is a send due at local time `now`? */
  due(now: number): boolean {
    return now >= this.nextAt;
  }

  /** Decide and account for one slot: true means send now. */
  take(now: number, bufferedAmount: number): boolean {
    if (!this.due(now)) return false;
    this.nextAt = Math.max(this.nextAt + this.intervalMs, now + this.intervalMs * 0.5);
    if (bufferedAmount > this.maxBufferedBytes) {
      this.skipped++;
      return false;
    }
    this.sent++;
    return true;
  }

  reset(): void {
    this.nextAt = Number.NEGATIVE_INFINITY;
  }
}
