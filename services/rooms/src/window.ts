/** A creation limit: at most `limit` attempts per `windowMs`. */
export interface CreateLimit {
  limit: number;
  windowMs: number;
}

const DEFAULT_LIMIT: CreateLimit = { limit: 30, windowMs: 600_000 };

/**
 * Parse "count/windowMs". Anything else gives `fallback`: 30 rooms per 10 minutes for the
 * per-address limit, or null (no limit) for the optional global one.
 */
export function parseCreateLimit(raw: string | undefined): CreateLimit;
export function parseCreateLimit(raw: string | undefined, fallback: null): CreateLimit | null;
export function parseCreateLimit(
  raw: string | undefined,
  fallback: CreateLimit | null = DEFAULT_LIMIT,
): CreateLimit | null {
  const m = /^(\d{1,6})\/(\d{1,9})$/.exec(raw ?? '');
  if (!m) return fallback;
  const limit = Number(m[1]);
  const windowMs = Number(m[2]);
  if (windowMs <= 0) return fallback;
  return { limit, windowMs };
}

/**
 * One attempt against a sliding window of earlier attempt times. Returns whether it is
 * allowed, the stamps to keep (expired ones dropped, the new one added when allowed) and
 * whether they differ from what was passed in, so a refused attempt need not be written.
 */
export function slide(
  stamps: readonly number[],
  now: number,
  limit: number,
  windowMs: number,
): { allowed: boolean; stamps: number[]; changed: boolean } {
  const kept = stamps.filter((t) => typeof t === 'number' && now - t < windowMs);
  if (kept.length >= limit)
    return { allowed: false, stamps: kept, changed: kept.length !== stamps.length };
  kept.push(now);
  return { allowed: true, stamps: kept, changed: true };
}
