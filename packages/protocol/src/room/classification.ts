import type { ResultRow, Results } from '../messages';
import type { CarRecord } from './state';

/**
 * Final order: running and finished cars by laps (more first), then race time with
 * penalties (less first), then grid position; retired cars after them, ordered the
 * same way. Pure, so every client gets the identical list.
 */
export function classify(
  cars: readonly CarRecord[],
  laps: number,
  reason: Results['reason'],
): Results {
  const key = (c: CarRecord) => ({
    dnf: c.state === 'dnf' ? 1 : 0,
    laps: c.lap,
    time: c.lap > 0 ? c.raceMs + c.penaltyMs : Number.POSITIVE_INFINITY,
  });
  const sorted = [...cars].sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    const byTime = ka.time === kb.time ? 0 : ka.time < kb.time ? -1 : 1;
    return ka.dnf - kb.dnf || kb.laps - ka.laps || byTime || a.gridPosition - b.gridPosition;
  });
  const rows: ResultRow[] = sorted.map((c, i) => ({
    position: i + 1,
    seat: c.seat,
    kind: c.kind,
    member: c.member,
    name: c.name,
    aiIndex: c.aiIndex,
    gridPosition: c.gridPosition,
    laps: c.lap,
    timeMs: c.lap > 0 ? c.raceMs + c.penaltyMs : null,
    penaltyMs: c.penaltyMs,
    bestLapMs: c.bestLapMs,
    status: c.state === 'finished' ? 'finished' : c.state === 'dnf' ? 'dnf' : 'running',
    flags: [...c.flags],
  }));
  return { reason, laps, rows };
}
