import type { ResultEntry, SessionKind, SessionResult } from '@undercut/race';
import { formatLapTime, formatRaceStatus } from '../game/format';
import { el } from './dom';

/** A session's name as the menus and the HUD print it. */
export function sessionName(kind: SessionKind): string {
  switch (kind) {
    case 'timeTrial':
      return 'Time trial';
    case 'practice':
      return 'Practice';
    case 'qualifying':
      return 'Qualifying';
    case 'race':
      return 'Race';
  }
}

/** "1 stop", "2 stops". */
export function stopsText(n: number): string {
  return `${n} ${n === 1 ? 'stop' : 'stops'}`;
}

/** Compound ids as their initials in order of use: "M / H". */
export function compoundsText(compounds: readonly string[]): string {
  return compounds.map((c) => c.charAt(0).toUpperCase()).join(' / ');
}

/** Race: the winner's time, then the gap or the reason a car has none. */
function raceTime(e: ResultEntry): string {
  if (e.status !== 'finished') return formatRaceStatus(e.status);
  if (e.gap === null) return formatLapTime(e.totalTime);
  if ('laps' in e.gap) return `+${e.gap.laps} ${e.gap.laps === 1 ? 'lap' : 'laps'}`;
  return `+${e.gap.time.toFixed(3)} s`;
}

/** Timed sessions: the best lap, and the gap to the fastest. */
function timedGap(e: ResultEntry): string {
  if (e.bestLap === null || e.gap === null || !('time' in e.gap)) return '';
  return `+${e.gap.time.toFixed(3)} s`;
}

export interface ClassificationColumn {
  head: string;
  /** Numbers align right in tabular figures. */
  num?: boolean;
  cell(e: ResultEntry): string;
}

/** The columns a session's classification shows. */
export function classificationColumns(
  kind: SessionKind,
  o: { points?: boolean } = {},
): ClassificationColumn[] {
  const pos: ClassificationColumn = { head: 'Pos', num: true, cell: (e) => String(e.position) };
  const driver: ClassificationColumn = { head: 'Driver', cell: (e) => e.name };
  if (kind !== 'race')
    return [
      pos,
      driver,
      { head: 'Best lap', num: true, cell: (e) => formatLapTime(e.bestLap) },
      { head: 'Gap', num: true, cell: timedGap },
      { head: 'Laps', num: true, cell: (e) => String(e.laps) },
    ];
  return [
    pos,
    driver,
    { head: 'Time', num: true, cell: raceTime },
    { head: 'Pits', num: true, cell: (e) => String(e.pitStops) },
    { head: 'Tyres', cell: (e) => compoundsText(e.compounds) },
    {
      head: 'Pen',
      num: true,
      cell: (e) => (e.penaltyTime ? `+${e.penaltyTime.toFixed(0)} s` : ''),
    },
    ...(o.points
      ? [{ head: 'Pts', num: true, cell: (e: ResultEntry) => (e.points ? String(e.points) : '') }]
      : []),
  ];
}

/**
 * A session's classification as a table: a header row, one row per entrant, the player's own
 * row marked (`is-player`, car 0).
 */
export function classificationTable(
  result: SessionResult,
  o: { points?: boolean; rowClass?: string } = {},
): HTMLTableElement {
  const cols = classificationColumns(result.kind, o);
  const table = el('table', 'classification');
  const head = el('tr');
  for (const c of cols) head.append(el('th', c.num ? 'num' : '', c.head));
  const thead = el('thead');
  thead.append(head);
  table.append(thead);
  const body = el('tbody');
  for (const e of result.entries) {
    const row = el('tr', `${o.rowClass ?? ''}${e.car === 0 ? ' is-player' : ''}`.trim());
    for (const c of cols) row.append(el('td', c.num ? 'num' : '', c.cell(e)));
    body.append(row);
  }
  table.append(body);
  return table;
}
