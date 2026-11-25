import { describe, expect, it } from 'vitest';
import type { ResultEntry } from '@undercut/race';
import {
  classificationColumns,
  compoundsText,
  sessionName,
  stopsText,
} from '../src/ui/classification';

const entry = (o: Partial<ResultEntry>): ResultEntry => ({
  position: 1,
  car: 0,
  id: 'player',
  name: 'Player',
  code: 'PLY',
  team: 0,
  status: 'finished',
  reason: null,
  laps: 5,
  totalTime: 412.345,
  gap: null,
  bestLap: 81.234,
  bestLapNumber: 3,
  pitStops: 1,
  penalties: [],
  penaltyTime: 0,
  warnings: 0,
  compounds: ['medium', 'hard'],
  points: 25,
  topSpeed: null,
  ...o,
});

const cells = (kind: 'race' | 'qualifying', e: ResultEntry, points = false) =>
  Object.fromEntries(classificationColumns(kind, { points }).map((c) => [c.head, c.cell(e)]));

describe('session classification', () => {
  it('names sessions with a capital, as headings do', () => {
    expect(sessionName('practice')).toBe('Practice');
    expect(sessionName('qualifying')).toBe('Qualifying');
    expect(sessionName('race')).toBe('Race');
  });

  it('counts stops in the singular for one', () => {
    expect(stopsText(0)).toBe('0 stops');
    expect(stopsText(1)).toBe('1 stop');
    expect(stopsText(2)).toBe('2 stops');
  });

  it('shows a race as time, gaps, best lap, pit stops, compounds, penalties and points', () => {
    expect(cells('race', entry({}), true)).toEqual({
      Pos: '1',
      Driver: 'Player',
      Team: 'Aldermoor Racing',
      Time: '6:52.345',
      'Best lap': '1:21.234',
      Pits: '1',
      Tyres: 'M / H',
      Pen: '',
      Pts: '25',
    });
    expect(cells('race', entry({ position: 2, gap: { time: 1.5 } })).Time).toBe('+1.500 s');
    expect(cells('race', entry({ gap: { laps: 1 } })).Time).toBe('+1 lap');
    expect(cells('race', entry({ status: 'dnf' })).Time).toBe('Retired');
    expect(cells('race', entry({ bestLap: null }))['Best lap']).toBe('—');
    expect(cells('race', entry({ penaltyTime: 5 })).Pen).toBe('+5 s');
    expect(
      cells('race', entry({ penalties: [{ reason: 'jumpStart', seconds: 5, served: true }] })).Pen,
    ).toBe('5 s served');
    expect(compoundsText(['medium', 'hard', 'soft'])).toBe('M / H / S');
  });

  it('shows a timed session as best lap and gap to the fastest', () => {
    expect(cells('qualifying', entry({}))).toEqual({
      Pos: '1',
      Driver: 'Player',
      'Best lap': '1:21.234',
      Gap: '',
      Laps: '5',
    });
    expect(cells('qualifying', entry({ gap: { time: 0.25 } })).Gap).toBe('+0.250 s');
    expect(cells('qualifying', entry({ bestLap: null, gap: null }))['Best lap']).toBe('—:——.———');
  });
});
