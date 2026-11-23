import type { CompoundId } from '@undercut/sim';

/** Estimates: medium loses 0.08 s per equivalent 100 s lap per lap of age. */
function degradation(laps: number, lapTime: number): number {
  return (0.08 * (lapTime / 100) * laps * laps) / 2;
}
export function plannedStops(laps: number, lapTime: number, pitLoss: number): 1 | 2 {
  return laps >= 12 &&
    degradation(laps / 2, lapTime) * 2 - degradation(laps / 3, lapTime) * 3 > pitLoss
    ? 2
    : 1;
}
export interface StrategyReading {
  laps: number;
  lap: number;
  car: number;
  stops: number;
  compound: string;
  wear: number;
  lapTime: number;
  pitLoss: number;
  gapAhead: number | null;
  aheadPitting: boolean;
  rejoinGap: number;
}
export function choosePitStop(
  r: StrategyReading,
): { compound: CompoundId; reason: 'planned' | 'undercut' } | null {
  const stops = plannedStops(r.laps, r.lapTime, r.pitLoss);
  if (r.stops >= stops || r.lap < 2 || r.lap >= r.laps) return null;
  const target = Math.min(
    r.laps - 1,
    Math.max(2, Math.ceil((r.laps * (r.stops + 1)) / (stops + 1)) + (r.car % 3) - 1),
  );
  const deadline = r.lap >= r.laps - 1;
  const compound = r.compound === 'hard' ? 'medium' : 'hard';
  // A lap on fresh tyres must repay the gap ahead, without immediately joining a queue.
  const gain = r.wear * 6;
  if (!deadline && r.lap < target && r.gapAhead !== null && gain > r.gapAhead && r.rejoinGap > 2)
    return { compound, reason: 'undercut' };
  // Stay out one more lap in clean air on a healthy set while the rival services theirs.
  if (!deadline && r.aheadPitting && r.wear < 0.3 && r.lap <= target) return null;
  return r.lap >= target || deadline ? { compound, reason: 'planned' } : null;
}
