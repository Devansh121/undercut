/**
 * Server clock estimate from ping/pong round trips (the NTP idea): for a ping sent at
 * local time t0, answered with server time S and received at t1, the offset is
 * S - (t0 + t1) / 2 with an error of at most (t1 - t0) / 2. The estimate is the median
 * offset of the fastest third of recent samples, whose error bound is smallest.
 */

export interface ClockSample {
  offset: number;
  rtt: number;
}

export class ClockSync {
  private samples: ClockSample[] = [];

  constructor(private readonly keep = 16) {}

  /** Add one round trip: local send time, server time in the reply, local receive time. */
  add(sentLocal: number, serverTime: number, receivedLocal: number): void {
    const rtt = receivedLocal - sentLocal;
    if (!(rtt >= 0) || !Number.isFinite(serverTime)) return;
    this.samples.push({ offset: serverTime - (sentLocal + receivedLocal) / 2, rtt });
    if (this.samples.length > this.keep) this.samples.shift();
  }

  get sampleCount(): number {
    return this.samples.length;
  }

  private best(): ClockSample[] {
    const byRtt = [...this.samples].sort((a, b) => a.rtt - b.rtt);
    return byRtt.slice(0, Math.max(1, Math.ceil(byRtt.length / 3)));
  }

  /** Server time minus local time, ms; null before the first sample. */
  get offset(): number | null {
    if (this.samples.length === 0) return null;
    const offsets = this.best()
      .map((s) => s.offset)
      .sort((a, b) => a - b);
    const mid = offsets.length >> 1;
    return offsets.length % 2 === 1
      ? (offsets[mid] as number)
      : ((offsets[mid - 1] as number) + (offsets[mid] as number)) / 2;
  }

  /** Bound on the offset error: half the fastest round trip used, ms. */
  get error(): number | null {
    if (this.samples.length === 0) return null;
    return Math.max(...this.best().map((s) => s.rtt)) / 2;
  }

  /** Median round-trip time of recent samples, ms. */
  get rtt(): number | null {
    if (this.samples.length === 0) return null;
    const r = this.samples.map((s) => s.rtt).sort((a, b) => a - b);
    return r[r.length >> 1] as number;
  }

  serverTime(localNow: number): number | null {
    const o = this.offset;
    return o === null ? null : localNow + o;
  }

  localTime(serverTime: number): number | null {
    const o = this.offset;
    return o === null ? null : serverTime - o;
  }

  reset(): void {
    this.samples = [];
  }
}
