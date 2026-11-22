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

export function saveQuality(q: QualityName | 'auto'): void {
  try {
    window.localStorage.setItem(KEY, q);
  } catch {
    // Blocked storage: the choice lasts for this page only.
  }
}

/** The preset the Auto benchmark settled on, so later sessions start there without measuring. */
const AUTO_KEY = 'settings.quality.auto';

export function loadAutoPick(): QualityName | null {
  try {
    const v = window.localStorage.getItem(AUTO_KEY);
    return isQuality(v) && v !== 'lite' ? v : null;
  } catch {
    return null;
  }
}

export function saveAutoPick(q: QualityName | null): void {
  try {
    if (q) window.localStorage.setItem(AUTO_KEY, q);
    else window.localStorage.removeItem(AUTO_KEY);
  } catch {
    // Blocked storage: Auto measures again next session.
  }
}

/** The preset the offline cache (tools/serve/pwa.mjs) holds. */
export const OFFLINE_PRESET: QualityName = 'mobile';

/**
 * Whether Auto may rebuild the view at its pick. Offline it may only move to the cached preset:
 * any other one would fetch textures that are not there.
 */
export function autoSwitchAllowed(
  pick: QualityName,
  current: QualityName,
  online: boolean,
): boolean {
  return pick !== current && (online || pick === OFFLINE_PRESET);
}
