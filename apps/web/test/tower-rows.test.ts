import { describe, expect, it } from 'vitest';
import { towerWindow, type TowerRow } from '../src/ui/hud/tower-rows';

const field = (n: number, player: number | null): TowerRow[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `c${i + 1}`,
    position: i + 1,
    code: `D${i + 1}`,
    teamColour: '#fff',
    value: i === 0 ? 'LEADER' : `+${i}.000`,
    player: i + 1 === player,
  }));
const ids = (rows: TowerRow[]): (number | null)[] => rows.map((r) => r.position);

describe('compact timing tower window', () => {
  it('shows the leader and the cars around the player', () => {
    expect(ids(towerWindow(field(20, 6), 4))).toEqual([1, 5, 6, 7]);
    expect(ids(towerWindow(field(20, 6), 5))).toEqual([1, 5, 6, 7, 8]);
  });

  it('keeps the window inside the field at the back', () => {
    expect(ids(towerWindow(field(20, 20), 4))).toEqual([1, 18, 19, 20]);
  });

  it('shows the top rows when the player is near the front or absent', () => {
    expect(ids(towerWindow(field(20, 2), 4))).toEqual([1, 2, 3, 4]);
    expect(ids(towerWindow(field(20, 4), 4))).toEqual([1, 2, 3, 4]);
    expect(ids(towerWindow(field(20, 5), 4))).toEqual([1, 4, 5, 6]);
    expect(ids(towerWindow(field(20, null), 4))).toEqual([1, 2, 3, 4]);
    expect(ids(towerWindow(field(3, 3), 4))).toEqual([1, 2, 3]);
  });
});
