import { describe, expect, it } from 'vitest';
import {
  classify,
  judgeLap,
  type CarRecord,
  type CircuitInfo,
  type LapEvidence,
  type LapMessage,
} from '../src/index';
import { car as snapshot } from './harness';

const CIRCUIT: CircuitInfo = {
  id: 'test',
  lengthM: 600,
  minLapMs: 5000,
  minSectorMs: [1500, 1500, 1500],
  maxLapMs: 30_000,
};
const OUT = 1_000_000; // lights out, server time

function record(over: Partial<CarRecord> = {}): CarRecord {
  return {
    seat: 0,
    kind: 'human',
    member: 'm1',
    aiIndex: null,
    name: 'Ana',
    gridPosition: 1,
    state: 'racing',
    lap: 1,
    raceMs: 8000,
    lastCrossAt: OUT + 8000,
    bestLapMs: 8000,
    penaltyMs: 0,
    warnings: 0,
    jumpStart: false,
    invalidLaps: [],
    flags: [],
    ...over,
  };
}

/** Lap 2 completed at race time 15 s (a 7 s lap), received at that moment. */
const NOW = OUT + 15_000;
function claim(over: Partial<LapMessage> = {}): LapMessage {
  return {
    type: 'lap',
    seat: 0,
    lap: 2,
    lapMs: 7000,
    raceMs: 15_000,
    sectorsMs: [2000, 2500, 2500],
    tick: 1800,
    s: 1,
    speed: 80,
    at: NOW,
    ...over,
  };
}
function evidence(over: Partial<LapEvidence> = {}): LapEvidence {
  return {
    snapshot: snapshot(0, { lap: 1, s: 590 }),
    snapshotAt: NOW - 30,
    outages: [],
    lightsOutAt: OUT,
    ...over,
  };
}

describe('judgeLap', () => {
  it('accepts a plausible crossing', () => {
    expect(judgeLap(record(), claim(), CIRCUIT, evidence(), NOW)).toEqual({
      status: 'accepted',
      reason: null,
    });
  });

  it('accepts when the last snapshot is just past the line', () => {
    const ev = evidence({ snapshot: snapshot(0, { lap: 2, s: 3 }) });
    expect(judgeLap(record(), claim(), CIRCUIT, ev, NOW).status).toBe('accepted');
  });

  it.each<[string, Partial<CarRecord>, Partial<LapMessage>, Partial<LapEvidence>, string, string]>([
    ['the same lap again', {}, { lap: 1, raceMs: 8000 }, {}, 'rejected', 'duplicate'],
    [
      'a finished car repeating its last lap',
      { state: 'finished' },
      { lap: 1, raceMs: 8000 },
      {},
      'rejected',
      'duplicate',
    ],
    ['a retired car', { state: 'dnf' }, {}, {}, 'rejected', 'not_racing'],
    ['a lap going backwards', { lap: 3, raceMs: 22_000 }, {}, {}, 'rejected', 'lap_not_monotonic'],
    [
      'a crossing time far from now',
      {},
      { at: NOW + 60_000 },
      {},
      'rejected',
      'timestamp_implausible',
    ],
    [
      'a crossing before lights out',
      {},
      { at: OUT - 20_000 },
      {},
      'rejected',
      'timestamp_implausible',
    ],
    [
      'a crossing while disconnected',
      {},
      {},
      { outages: [[NOW - 100, null]] },
      'rejected',
      'crossed_while_disconnected',
    ],
    [
      'a crossing in a past outage',
      {},
      {},
      { outages: [[NOW - 500, NOW + 10]] },
      'rejected',
      'crossed_while_disconnected',
    ],
    [
      'a lap under the floor',
      {},
      { lapMs: 4999, raceMs: 12_999, sectorsMs: [1666, 1666, 1667] },
      {},
      'rejected',
      'lap_too_fast',
    ],
    [
      'a sector under its floor',
      {},
      { sectorsMs: [1400, 2800, 2800] },
      {},
      'rejected',
      'sector_too_fast',
    ],
    [
      'sectors that do not add up',
      {},
      { sectorsMs: [2000, 2000, 2000] },
      {},
      'rejected',
      'bad_sectors',
    ],
    ['the wrong number of sectors', {}, { sectorsMs: [3500, 3500] }, {}, 'rejected', 'bad_sectors'],
    [
      'a lap time that disagrees with race time',
      {},
      { raceMs: 16_000 },
      {},
      'rejected',
      'race_time_mismatch',
    ],
    [
      'two laps in too little time',
      {},
      { lap: 3, lapMs: 5000, raceMs: 17_000, sectorsMs: [1600, 1700, 1700] },
      {},
      'rejected',
      'gap_too_fast',
    ],
    [
      'a snapshot two laps behind',
      {},
      {},
      { snapshot: snapshot(0, { lap: 0, s: 590 }) },
      'rejected',
      's_inconsistent',
    ],
    [
      'a snapshot half a lap from the line',
      {},
      {},
      { snapshot: snapshot(0, { lap: 1, s: 300 }) },
      'rejected',
      's_inconsistent',
    ],
    ['no recent snapshot', {}, {}, { snapshotAt: NOW - 10_000 }, 'flagged', 'no_snapshot_evidence'],
    [
      'no snapshot at all',
      {},
      {},
      { snapshot: null, snapshotAt: null },
      'flagged',
      'no_snapshot_evidence',
    ],
    [
      'a lap the server saw take much longer',
      { lastCrossAt: OUT + 3000 },
      {},
      {},
      'flagged',
      'time_mismatch',
    ],
  ])('%s', (_label, rec, cl, ev, status, reason) => {
    expect(judgeLap(record(rec), claim(cl), CIRCUIT, evidence(ev), NOW)).toEqual({
      status,
      reason,
    });
  });

  it('accepts a skipped lap when the race time covers it (a crossing lost while away)', () => {
    const verdict = judgeLap(
      record(),
      claim({ lap: 3, lapMs: 7000, raceMs: 22_000 }),
      CIRCUIT,
      evidence({ snapshot: snapshot(0, { lap: 2, s: 595 }) }),
      OUT + 22_000,
    );
    expect(verdict.status).not.toBe('rejected');
  });

  it('accepts a claim without sectors', () => {
    const { sectorsMs: _s, ...noSectors } = claim();
    expect(judgeLap(record(), noSectors, CIRCUIT, evidence(), NOW).status).toBe('accepted');
  });
});

describe('classify', () => {
  const cars = [
    record({
      seat: 0,
      gridPosition: 1,
      state: 'finished',
      lap: 3,
      raceMs: 30_000,
      penaltyMs: 2000,
    }),
    record({ seat: 1, gridPosition: 2, state: 'finished', lap: 3, raceMs: 33_000 }),
    record({ seat: 2, gridPosition: 3, state: 'finished', lap: 2, raceMs: 25_000 }),
    record({ seat: 3, gridPosition: 4, state: 'dnf', lap: 2, raceMs: 20_000 }),
    record({
      seat: 4,
      gridPosition: 5,
      state: 'racing',
      lap: 0,
      raceMs: 0,
      kind: 'ai',
      member: null,
      aiIndex: 0,
      name: null,
    }),
    record({ seat: 5, gridPosition: 6, state: 'dnf', lap: 0, raceMs: 0 }),
    record({ seat: 6, gridPosition: 7, state: 'racing', lap: 0, raceMs: 0 }),
  ];

  it('orders by laps, then time with penalties, then grid; retirements last', () => {
    const results = classify(cars, 3, 'complete');
    expect(results.rows.map((r) => r.seat)).toEqual([0, 1, 2, 4, 6, 3, 5]);
    expect(results.rows.map((r) => r.position)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(results.rows[0]).toMatchObject({ timeMs: 32_000, penaltyMs: 2000, status: 'finished' });
    expect(results.rows[3]).toMatchObject({ seat: 4, kind: 'ai', timeMs: null, status: 'running' });
    expect(results.rows[5]).toMatchObject({ status: 'dnf' });
  });

  it('lets a penalty change the order', () => {
    const results = classify(
      [...cars.slice(0, 1).map((c) => ({ ...c, penaltyMs: 3001 })), cars[1] as CarRecord],
      3,
      'complete',
    );
    expect(results.rows.map((r) => r.seat)).toEqual([1, 0]);
  });

  it('is independent of input order', () => {
    const a = classify(cars, 3, 'complete');
    const b = classify([...cars].reverse(), 3, 'complete');
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });
});
