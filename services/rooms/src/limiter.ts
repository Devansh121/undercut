import { DurableObject } from 'cloudflare:workers';

/**
 * Counts room creations per client address in a sliding window. One instance per
 * address; memory only (a restart forgets, which errs on the side of allowing).
 */
export class CreateLimiter extends DurableObject {
  private stamps: number[] = [];

  /** Record one attempt; true if it is within `limit` per `windowMs`. */
  async allow(limit: number, windowMs: number): Promise<boolean> {
    const now = Date.now();
    this.stamps = this.stamps.filter((t) => now - t < windowMs);
    if (this.stamps.length >= limit) return false;
    this.stamps.push(now);
    return true;
  }
}
