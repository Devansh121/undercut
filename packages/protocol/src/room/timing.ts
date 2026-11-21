/**
 * The timing referee: decides whether a line-crossing claim counts. It checks
 * plausibility (monotonic laps, physical lap and sector floors, consistency with the
 * car's own snapshots and with the server's clock), not authenticity: a modified
 * client that reports consistent fake data can still pass. See docs/netcode.md.
 */
import type { TimingReason } from '../errors';
import type { LapMessage } from '../messages';
import type { CircuitInfo } from '../settings';
import type { CarSnapshot } from '../snapshot';
import { LIMITS } from './rules';
import type { CarRecord } from './state';

export interface LapEvidence {
  /** Last snapshot of this car the server relayed, and when it arrived. */
  snapshot: CarSnapshot | null;
  snapshotAt: number | null;
  /** Disconnection windows of the member who owns the car (empty for AI). */
  outages: readonly (readonly [number, number | null])[];
  /** Server time of lights out. */
  lightsOutAt: number;
}

export type LapVerdict =
  | { status: 'accepted'; reason: null }
  | { status: 'flagged'; reason: TimingReason }
  | { status: 'rejected'; reason: TimingReason };

const reject = (reason: TimingReason): LapVerdict => ({ status: 'rejected', reason });

/** Judge one crossing claim for `car` received at server time `now`. Pure. */
export function judgeLap(
  car: CarRecord,
  claim: LapMessage,
  circuit: CircuitInfo,
  evidence: LapEvidence,
  now: number,
): LapVerdict {
  if (car.state !== 'racing') {
    return car.state === 'finished' && claim.lap === car.lap && claim.raceMs === car.raceMs
      ? reject('duplicate')
      : reject('not_racing');
  }
  if (claim.lap <= car.lap) {
    return claim.lap === car.lap && claim.raceMs === car.raceMs
      ? reject('duplicate')
      : reject('lap_not_monotonic');
  }
  if (
    Math.abs(claim.at - now) > LIMITS.timestampToleranceMs ||
    claim.at < evidence.lightsOutAt - LIMITS.timestampToleranceMs
  ) {
    return reject('timestamp_implausible');
  }
  for (const [from, to] of evidence.outages) {
    if (claim.at >= from && claim.at <= (to ?? now)) return reject('crossed_while_disconnected');
  }
  if (claim.lapMs < circuit.minLapMs) return reject('lap_too_fast');
  if (claim.sectorsMs !== undefined) {
    const n = circuit.minSectorMs.length;
    const sum = claim.sectorsMs.reduce((a, b) => a + b, 0);
    if (
      (n > 0 && claim.sectorsMs.length !== n) ||
      Math.abs(sum - claim.lapMs) > LIMITS.sectorSumToleranceMs * claim.sectorsMs.length
    ) {
      return reject('bad_sectors');
    }
    for (let i = 0; i < n; i++) {
      if ((claim.sectorsMs[i] ?? 0) < (circuit.minSectorMs[i] ?? 0))
        return reject('sector_too_fast');
    }
  }
  const gap = claim.lap - car.lap;
  const raceDelta = claim.raceMs - car.raceMs;
  if (gap === 1 && Math.abs(raceDelta - claim.lapMs) > LIMITS.raceTimeToleranceMs) {
    return reject('race_time_mismatch');
  }
  if (raceDelta < gap * circuit.minLapMs) return reject('gap_too_fast');

  // Evidence from the car's own snapshots: it should be near the line.
  const snap = evidence.snapshot;
  if (
    snap === null ||
    evidence.snapshotAt === null ||
    now - evidence.snapshotAt > LIMITS.evidenceWindowMs
  ) {
    return { status: 'flagged', reason: 'no_snapshot_evidence' };
  }
  if (snap.lap !== claim.lap - 1 && snap.lap !== claim.lap) return reject('s_inconsistent');
  const distance = snap.lap === claim.lap - 1 ? circuit.lengthM - snap.s : snap.s;
  const elapsed = Math.abs(now - evidence.snapshotAt) / 1000 + 1;
  if (distance > LIMITS.maxPlausibleSpeed * elapsed + LIMITS.evidenceSlackM) {
    return reject('s_inconsistent');
  }

  // The server's own view of the lap time, from arrival times.
  const observed = now - (car.lastCrossAt ?? evidence.lightsOutAt);
  const tolerance = Math.max(LIMITS.timeMismatchMinMs, LIMITS.timeMismatchFraction * raceDelta);
  if (Math.abs(observed - raceDelta) > tolerance)
    return { status: 'flagged', reason: 'time_mismatch' };
  return { status: 'accepted', reason: null };
}
