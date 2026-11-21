import { DurableObject } from 'cloudflare:workers';
import { slide } from './window';

const STAMPS_KEY = 'stamps';

/**
 * Counts room creations in a sliding window: one instance per client address, plus one
 * shared instance for the optional global limit. The attempt times are stored, so the
 * window survives the object being evicted between attempts (on Cloudflare an idle
 * object is evicted within minutes, which would otherwise reset the count). An alarm at
 * the end of the window deletes the stored times, so an address that stops creating
 * rooms leaves nothing behind.
 */
export class CreateLimiter extends DurableObject {
  /** Record one attempt; true if it is within `limit` per `windowMs`. */
  async allow(limit: number, windowMs: number): Promise<boolean> {
    const now = Date.now();
    const stored = (await this.ctx.storage.get<number[]>(STAMPS_KEY)) ?? [];
    const result = slide(Array.isArray(stored) ? stored : [], now, limit, windowMs);
    if (result.changed) {
      await this.ctx.storage.put(STAMPS_KEY, result.stamps);
      if (result.allowed) await this.ctx.storage.setAlarm(now + windowMs);
    }
    return result.allowed;
  }

  override async alarm(): Promise<void> {
    await this.ctx.storage.deleteAll();
  }
}
