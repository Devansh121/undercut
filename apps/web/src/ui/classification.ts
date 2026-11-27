import type { ResultEntry, SessionKind, SessionResult } from '@undercut/race';
import { formatLapTime, formatRaceStatus } from '../game/format';
import { TEAMS, type Team } from './data/teams';
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

/** Order `TEAMS` with the player's chosen team at index 0, matching entrant `team` indices. */
export function orderedTeams(playerTeamId?: string): readonly Team[] {
  if (!playerTeamId) return TEAMS;
  return [...TEAMS].sort((a, b) => (a.id === playerTeamId ? -1 : b.id === playerTeamId ? 1 : 0));
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

/** Penalties column: unserved time added to finish, or served penalty total if any. */
function penaltyText(e: ResultEntry): string {
  if (e.penaltyTime > 0) return `+${e.penaltyTime.toFixed(0)} s`;
  const served = e.penalties.reduce((sum, p) => sum + (p.served ? p.seconds : 0), 0);
  if (served > 0) return `${served.toFixed(0)} s served`;
  return '';
}

export interface ClassificationColumn<R = ResultEntry> {
  head: string;
  /** Numbers align right in tabular figures. */
  num?: boolean;
  /** Optional responsive column class (e.g. `col-team`, `col-tyres`, `col-best`). */
  colClass?: string;
  cell(e: R): string;
}

export interface ClassificationOptions {
  points?: boolean;
  rowClass?: string;
  /** Team order (index 0 = player's team) used for team names and colour bars. */
  teams?: readonly Team[];
}

/** The columns a session's classification shows. */
export function classificationColumns(
  kind: SessionKind,
  o: { points?: boolean; teams?: readonly Team[] } = {},
): ClassificationColumn[] {
  const teams = o.teams ?? TEAMS;
  const pos: ClassificationColumn = { head: 'Pos', num: true, cell: (e) => String(e.position) };
  const driver: ClassificationColumn = { head: 'Driver', cell: (e) => e.name };
  if (kind !== 'race')
    return [
      pos,
      driver,
      { head: 'Best lap', num: true, colClass: 'col-best', cell: (e) => formatLapTime(e.bestLap) },
      { head: 'Gap', num: true, cell: timedGap },
      { head: 'Laps', num: true, cell: (e) => String(e.laps) },
    ];
  return [
    pos,
    driver,
    {
      head: 'Team',
      colClass: 'col-team',
      cell: (e) => teams[e.team]?.name ?? '',
    },
    { head: 'Time', num: true, cell: raceTime },
    {
      head: 'Best lap',
      num: true,
      colClass: 'col-best',
      cell: (e) => (e.bestLap !== null ? formatLapTime(e.bestLap) : '—'),
    },
    { head: 'Pits', num: true, cell: (e) => String(e.pitStops) },
    { head: 'Tyres', colClass: 'col-tyres', cell: (e) => compoundsText(e.compounds) },
    {
      head: 'Pen',
      num: true,
      colClass: 'col-pen',
      cell: penaltyText,
    },
    ...(o.points
      ? [{ head: 'Pts', num: true, cell: (e: ResultEntry) => (e.points ? String(e.points) : '') }]
      : []),
  ];
}

/** A team colour bar + name cell shared by classification and championship standings. */
export function teamBar(colour: string): HTMLElement {
  const bar = el('i', 'classification__bar');
  bar.style.setProperty('--row-team', colour);
  bar.setAttribute('aria-hidden', 'true');
  return bar;
}

/**
 * A session's classification as a table: a header row, one row per entrant, team colour bar,
 * fastest-lap highlight, and the player's own row marked (`is-player`, car 0).
 */
export function classificationTable(
  result: SessionResult,
  o: ClassificationOptions = {},
): HTMLTableElement {
  const teams = o.teams ?? TEAMS;
  const cols = classificationColumns(result.kind, { ...o, teams });
  const fastestCar = result.fastestLap?.car ?? null;
  return classificationGrid({
    kind: result.kind,
    columns: cols,
    rows: result.entries,
    rowClass: (e) => `${o.rowClass ?? ''}${e.car === 0 ? ' is-player' : ''}`.trim(),
    colour: (e) => teams[e.team]?.colours.tower ?? '#626c74',
    cellClass: (e, c) =>
      c.head === 'Best lap' && fastestCar === e.car && e.bestLap !== null
        ? 'is-fastest'
        : c.head === 'Pen' && e.penaltyTime > 0
          ? 'is-penalty'
          : '',
  });
}

/** Shared classification rendering for local sessions and the room's official results. */
export function classificationGrid<R>(o: {
  kind: SessionKind;
  columns: readonly ClassificationColumn<R>[];
  rows: readonly R[];
  rowClass: (row: R) => string;
  colour: (row: R) => string;
  cellClass?: (row: R, column: ClassificationColumn<R>) => string;
}): HTMLTableElement {
  const table = el('table', 'classification');
  table.dataset.kind = o.kind;
  const head = el('tr');
  for (const c of o.columns) {
    const th = el('th', `${c.num ? 'num ' : ''}${c.colClass ?? ''}`.trim(), c.head);
    th.scope = 'col';
    head.append(th);
  }
  const thead = el('thead');
  thead.append(head);
  const body = el('tbody');
  for (const e of o.rows) {
    const row = el('tr', o.rowClass(e));
    for (const c of o.columns) {
      const cls = [c.num ? 'num' : '', c.colClass ?? '', o.cellClass?.(e, c) ?? '']
        .filter(Boolean)
        .join(' ');
      const td = el('td', cls);
      if (c.head === 'Driver') {
        const wrap = el('span', 'classification__driver');
        wrap.append(teamBar(o.colour(e)), el('span', '', c.cell(e)));
        td.append(wrap);
      } else td.textContent = c.cell(e);
      row.append(td);
    }
    body.append(row);
  }
  table.append(thead, body);
  return table;
}
