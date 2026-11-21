import type { RaceControl } from './control';
import type { CarStatus } from './core';
import type { PenaltyReason } from './events';
import type { SessionKind } from './kinds';
import { POINTS_TABLE } from './rules';
import type { Anomaly } from './systems/watchdog';

export interface EntrantInfo {
  id: string;
  name: string;
  /** Three-letter code for timing screens. */
  code: string;
  team: number;
  teamName?: string;
}

export type ResultStatus = Exclude<CarStatus, 'running'> | 'notClassified';

export interface ResultEntry {
  position: number;
  car: number;
  id: string;
  name: string;
  code: string;
  team: number;
  status: ResultStatus;
  /** Why the car did not finish, was not classified or was disqualified. */
  reason: string | null;
  laps: number;
  /** Race: from lights out to the finish line, with unserved penalties added, s. */
  totalTime: number | null;
  /** Race: behind the winner, in time (same laps) or in laps. Timed sessions: best lap behind. */
  gap: { time: number } | { laps: number } | null;
  bestLap: number | null;
  bestLapNumber: number | null;
  pitStops: number;
  penalties: { reason: PenaltyReason; seconds: number; served: boolean }[];
  /** Penalty time added at the finish (not served in the pits), s. */
  penaltyTime: number;
  warnings: number;
  compounds: string[];
  points: number;
  /** Best speed-trap speed, m/s. */
  topSpeed: number | null;
}

export interface SessionResult {
  kind: SessionKind;
  circuit: string;
  seed: number;
  laps: number | null;
  entries: ResultEntry[];
  fastestLap: { car: number; lap: number; time: number } | null;
  anomalies: Anomaly[];
}

/**
 * The classification of a session (final once it has ended):
 *
 * - Race: finishers, ordered by laps and then total time (from lights out to the flag plus
 *   unserved time penalties). A car is classified as a finisher only if it completed
 *   `classifiedShare` of the winner's laps, whether or not it took the flag; else it is not
 *   classified. Then retirements by
 *   distance, then disqualifications. Exact ties go to the order the cars took the flag, then
 *   to the live classification. A finisher that broke the two-compound rule (when it
 *   applies) is disqualified. Points by `POINTS_TABLE` for classified finishers.
 * - Timed sessions: by best valid lap, then laps.
 */
export function buildResult(
  control: RaceControl,
  entrants: readonly EntrantInfo[],
  seed: number,
): SessionResult {
  const s = control.strategy;
  const L = control.circuit.length;
  const start = control.lightsOutAt ?? control.greenTime ?? 0;
  const rows = control.cars.map((c, i) => {
    const timer = control.timers[i]!;
    const unserved =
      c.finishTime !== null || c.status === 'running' ? control.unservedPenalty(i) : 0;
    return {
      car: i,
      c,
      laps: c.finishLaps ?? timer.lapsCompleted,
      unserved,
      best: timer.bestLap,
      total: c.finishTime !== null && s.kind === 'race' ? c.finishTime - start + unserved : null,
      dist: c.finishDist ?? c.dist,
      status: 'finished' as ResultStatus,
      reason: c.reason,
    };
  });
  if (s.classifyBy === 'distance') {
    const winnerLaps = Math.max(
      0,
      ...rows.filter((r) => r.c.finishTime !== null).map((r) => r.laps),
    );
    const need = Math.ceil(control.rules.classifiedShare * winnerLaps);
    for (const r of rows) {
      // Taking the flag is not enough: a car needs `classifiedShare` of the winner's laps.
      if (r.c.status === 'dnf' || r.c.status === 'dsq') r.status = r.c.status;
      else if (winnerLaps > 0 && r.laps >= need) {
        r.status = 'finished';
        if (r.c.finishTime === null) r.total = null;
      } else {
        r.status = 'notClassified';
        r.reason = 'not classified';
      }
      if (s.twoCompoundRule && r.status === 'finished' && r.c.compounds.length < 2) {
        r.status = 'dsq';
        r.reason = 'two-compound rule';
      }
    }
    const rank: Record<ResultStatus, number> = { finished: 0, notClassified: 1, dnf: 2, dsq: 3 };
    rows.sort((a, b) => {
      const g = rank[a.status] - rank[b.status];
      if (g !== 0) return g;
      if (a.laps !== b.laps) return b.laps - a.laps;
      if (a.total !== null && b.total !== null && a.total !== b.total) return a.total - b.total;
      if (a.total !== null && b.total === null) return -1;
      if (b.total !== null && a.total === null) return 1;
      // Exact ties: the order they took the flag (itself by time, then by position before
      // the tick), then distance, then the live classification. Never the car number.
      const fa = a.c.finishOrder;
      const fb = b.c.finishOrder;
      if (fa !== null && fb !== null && fa !== fb) return fa - fb;
      if (a.dist !== b.dist) return b.dist - a.dist;
      return control.order.indexOf(a.car) - control.order.indexOf(b.car);
    });
  } else {
    const order = control.order;
    rows.sort((a, b) => order.indexOf(a.car) - order.indexOf(b.car));
    for (const r of rows) if (r.c.status === 'dnf' || r.c.status === 'dsq') r.status = r.c.status;
  }
  const winner = rows[0];
  return {
    kind: s.kind,
    circuit: control.circuit.id,
    seed,
    laps: s.laps,
    fastestLap: control.fastestLap,
    anomalies: control.anomalies().map((a) => ({ ...a })),
    entries: rows.map((r, k) => {
      const e = entrants[r.car]!;
      let gap: ResultEntry['gap'] = null;
      if (k > 0 && winner) {
        if (s.classifyBy === 'distance') {
          if (r.laps < winner.laps) gap = { laps: winner.laps - r.laps };
          else if (r.total !== null && winner.total !== null)
            gap = { time: r.total - winner.total };
          else gap = { laps: Math.max(0, Math.floor((winner.dist - r.dist) / L)) };
        } else if (r.best !== null && winner.best !== null) {
          gap = { time: r.best - winner.best };
        }
      }
      const position = k + 1;
      const scores = s.kind === 'race' && r.status === 'finished';
      return {
        position,
        car: r.car,
        id: e.id,
        name: e.name,
        code: e.code,
        team: e.team,
        status: r.status,
        reason: r.status === 'finished' ? null : r.reason,
        laps: r.laps,
        totalTime: r.total,
        gap,
        bestLap: r.best,
        bestLapNumber: r.c.bestLapNumber,
        pitStops: r.c.pitStops,
        penalties: r.c.penalties.map((p) => ({
          reason: p.reason,
          seconds: p.seconds,
          served: p.served,
        })),
        penaltyTime: r.unserved,
        warnings: r.c.warnings,
        compounds: r.c.compounds.slice(),
        points: scores ? (POINTS_TABLE[position - 1] ?? 0) : 0,
        topSpeed: r.c.speedTrapBest,
      };
    }),
  };
}
