/**
 * The timing tower's data: one row per car, already ordered and formatted by the caller (the
 * race session turns its engine events into these). Pure: no DOM, so the window logic is
 * unit-tested in Node.
 */

/** What a row's value column means for its colour: a timing colour, or a state. */
export type TowerTone = '' | 'overall' | 'personal' | 'empty' | 'pit' | 'out' | 'finished';

export interface TowerRow {
  /** Stable key for the car across updates (an entrant id); rows are matched by it. */
  id: string;
  /** 1-based; null for a reference row without a place (a record, a ghost). */
  position: number | null;
  /** Three-letter driver code. */
  code: string;
  /** Team colour for the bar (design/teams.json `tower`). */
  teamColour: string;
  /** Right-hand column, formatted: gap or interval ("+1.204", "LEADER", "+1 LAP"), a lap time, "PIT". */
  value: string;
  tone?: TowerTone;
  /** The player's row: drawn inverted. */
  player?: boolean;
  /** A reference row (record, ghost): dashed bar, muted code. */
  reference?: boolean;
  /** Tyre compound mark, when known. */
  compound?: { code: string; colour: string } | null;
  /** Holds the session's fastest lap. */
  fastest?: boolean;
}

/**
 * The rows a compact tower shows (a phone): the leader, then a run of `size - 1` rows centred
 * on the player where they fit, in order. With no player, or a short field, the top rows.
 */
export function towerWindow(rows: readonly TowerRow[], size: number): TowerRow[] {
  if (rows.length <= size) return rows.slice();
  const at = rows.findIndex((r) => r.player);
  if (at < 0 || at < size) return rows.slice(0, size);
  const run = size - 1;
  let start = at - Math.floor((run - 1) / 2);
  start = Math.max(1, Math.min(start, rows.length - run));
  return [rows[0] as TowerRow, ...rows.slice(start, start + run)];
}
