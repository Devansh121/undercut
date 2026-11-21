import type { QualityName } from '@undercut/render';

/*
 * Kept free of runtime imports from @undercut/render: the launch screen loads this, and the
 * renderer (with three.js) is fetched only when a session starts.
 */
const KEY = 'settings.quality';
const NAMES: readonly string[] = ['ultra', 'high', 'medium', 'mobile', 'lite'];

export function isQuality(v: unknown): v is QualityName {
  return typeof v === 'string' && NAMES.includes(v);
}

/** Before any benchmark: Mobile on touch-first or small devices, High elsewhere. */
export function firstGuess(touchFirst: boolean, shortEdge: number): QualityName {
  return touchFirst || shortEdge < 600 ? 'mobile' : 'high';
}

/** The player's saved graphics preset, or null (first run: benchmark). Storage may be blocked. */
export function loadQuality(): QualityName | null {
  try {
    const v = window.localStorage.getItem(KEY);
    return isQuality(v) && v !== 'lite' ? v : null;
  } catch {
    return null;
  }
}

export function saveQuality(q: QualityName): void {
  try {
    window.localStorage.setItem(KEY, q);
  } catch {
    // Blocked storage: the choice lasts for this page only.
  }
}
