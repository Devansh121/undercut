/** Unicode minus, so a negative delta is as wide as a positive one in tabular figures. */
const MINUS = '−';

/** Lap or sector time as m:ss.mmm (or s.mmm under a minute when `short`). Rounds down. */
export function formatLapTime(seconds: number | null, short = false): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return short ? '—' : '—:——.———';
  const ms = Math.floor(seconds * 1000 + 1e-6);
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const frac = String(ms % 1000).padStart(3, '0');
  if (short && m === 0) return `${s}.${frac}`;
  return `${m}:${String(s).padStart(2, '0')}.${frac}`;
}

/** Signed delta in seconds with three decimals: "+0.214", "−0.318", "0.000" for null input as em dash. */
export function formatDelta(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return '—';
  const ms = Math.round(Math.abs(seconds) * 1000);
  const sign = ms === 0 ? '' : seconds < 0 ? MINUS : '+';
  return `${sign}${Math.floor(ms / 1000)}.${String(ms % 1000).padStart(3, '0')}`;
}

/** Speed for the HUD: whole km/h from m/s, never negative. */
export function formatSpeedKmh(metresPerSecond: number): string {
  return String(Math.max(0, Math.round(Math.abs(metresPerSecond) * 3.6)));
}

/** Gear for the HUD: R, N or the number. */
export function formatGear(gear: number): string {
  if (gear < 0) return 'R';
  if (gear === 0) return 'N';
  return String(gear);
}
