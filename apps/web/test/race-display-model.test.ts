import { describe, expect, it } from 'vitest';
import { RailRace } from '../../../packages/race/test/rails';
import type { RaceEvent, StandingRow } from '@undercut/race';
import {
  BLACK_WHITE_BANNER_S,
  JUMP_START_HOLD_S,
  LIGHTS_OUT_HOLD_S,
  RaceDisplayModel,
  RaceMessageQueue,
  formatYellowSectors,
  lightsBitmask,
  marshalToTimingSector,
  type RaceEntrantDisplay,
} from '../src/ui/hud/race-display-model';

const entrants = (n = 20): RaceEntrantDisplay[] =>
  Array.from({ length: n }, (_, i) => ({
    id: i === 0 ? 'player' : `driver${i}`,
    name: i === 0 ? 'Player Driver' : `Driver ${i}`,
    code: i === 0 ? 'PLY' : `D${String(i).padStart(2, '0')}`,
    teamColour: `#${String(100 + i * 20).slice(0, 3)}`,
    teamName: `Team ${Math.floor(i / 2) + 1}`,
    initialCompound: 'medium',
  }));

const standing = (car: number, position: number, o: Partial<StandingRow> = {}): StandingRow => ({
  car,
  position,
  status: 'running',
  lap: 1,
  lapsCompleted: 0,
  gap: position === 1 ? 0 : (position - 1) * 1.25,
  interval: position === 1 ? 0 : 1.25,
  lapsDown: 0,
  bestLap: null,
  lastLap: null,
  inPit: false,
  pitStops: 0,
  penaltySeconds: 0,
  ...o,
});

function createModel(
  o: { sessionKind?: 'race' | 'qualifying' | 'practice' } = {},
): RaceDisplayModel {
  return new RaceDisplayModel({
    entrants: entrants(20),
    playerCar: 0,
    sessionKind: o.sessionKind ?? 'race',
    totalLaps: o.sessionKind && o.sessionKind !== 'race' ? null : 5,
    marshalSectorCount: 9,
    timingSectorBoundaries: [2000, 4000],
    trackLength: 6000,
  });
}

describe('race display model: start lights & jump start', () => {
  it('tracks the five lights in sync with events, lights out hold, and 3D gantry mask', () => {
    const m = createModel();
    expect(m.snapshot().startLights).toMatchObject({
      visible: true,
      phase: 'grid',
      lit: 0,
      lightsOut: false,
      gantryMask: 0,
    });

    for (let count = 1; count <= 5; count++) {
      m.ingest([{ type: 'lights', t: count, count }]);
      const sl = m.snapshot().startLights;
      expect(sl.visible).toBe(true);
      expect(sl.lit).toBe(count);
      expect(sl.lightsOut).toBe(false);
      expect(sl.gantryMask).toBe(lightsBitmask(count));
    }
    expect(lightsBitmask(5)).toBe(0b11111);

    // Lights out -> holds briefly then hides.
    m.ingest([
      { type: 'lights', t: 7, count: 0 },
      { type: 'phase', t: 7, phase: 'green' },
    ]);
    expect(m.snapshot().startLights).toMatchObject({
      visible: true,
      lit: 0,
      lightsOut: true,
      gantryMask: 0,
      caption: 'Lights out',
    });

    m.tick(LIGHTS_OUT_HOLD_S + 0.1);
    expect(m.snapshot().startLights.visible).toBe(false);
    expect(m.snapshot().startLights.lightsOut).toBe(false);
  });

  it('shows a jump-start indication for AI and gives precedence to a player jump start', () => {
    const m = createModel();
    m.ingest([
      { type: 'lights', t: 2, count: 2 },
      { type: 'penalty', t: 2.3, car: 4, reason: 'jumpStart', seconds: 5 },
    ]);
    expect(m.snapshot().startLights.jumpStart).toEqual({
      car: 4,
      code: 'D04',
      player: false,
      seconds: 5,
    });

    // Player jump start overrides AI notice.
    m.ingest([{ type: 'penalty', t: 2.6, car: 0, reason: 'jumpStart', seconds: 5 }]);
    expect(m.snapshot().startLights.jumpStart).toEqual({
      car: 0,
      code: 'PLY',
      player: true,
      seconds: 5,
    });

    // Stays visible past lights out until jump-start hold expires.
    m.ingest([
      { type: 'lights', t: 6, count: 0 },
      { type: 'phase', t: 6, phase: 'green' },
    ]);
    m.tick(LIGHTS_OUT_HOLD_S + 0.2);
    expect(m.snapshot().startLights.visible).toBe(true);
    expect(m.snapshot().startLights.jumpStart?.player).toBe(true);

    m.tick(JUMP_START_HOLD_S);
    expect(m.snapshot().startLights.visible).toBe(false);
    expect(m.snapshot().startLights.jumpStart).toBeNull();
  });
});

describe('race display model: 20-car timing tower', () => {
  it('builds 20 rows with gap/interval toggle, compound + tyre age, pit stops, and pit/retired states', () => {
    const m = createModel();
    m.ingest([{ type: 'phase', t: 7, phase: 'green' }]);
    const grid = Array.from({ length: 20 }, (_, i) =>
      standing(i, i + 1, {
        lap: 4,
        lapsCompleted: 3,
        gap: i === 0 ? 0 : i * 1.4,
        interval: i === 0 ? 0 : 0.75,
        pitStops: i === 2 ? 1 : 0,
        inPit: i === 5,
        status: i === 18 ? 'dnf' : i === 19 ? 'dsq' : 'running',
        lapsDown: i === 16 ? 1 : 0,
      }),
    );

    const gapRows = m.buildTowerRows(grid, { fastestCar: 1 });
    expect(gapRows).toHaveLength(20);
    expect(gapRows[0]).toMatchObject({
      position: 1,
      code: 'PLY',
      player: true,
      value: 'LEADER',
      tyreAge: 3,
      pitStops: 0,
    });
    expect(gapRows[1]).toMatchObject({
      position: 2,
      code: 'D01',
      value: '+1.400',
      fastest: true,
    });
    expect(gapRows[2]?.pitStops).toBe(1);
    expect(gapRows[5]).toMatchObject({ value: 'PIT', tone: 'pit', inPit: true });
    expect(gapRows[16]?.value).toBe('+1L');
    expect(gapRows[18]).toMatchObject({ value: 'OUT', tone: 'out', retired: true });
    expect(gapRows[19]).toMatchObject({ value: 'DSQ', tone: 'out', retired: true });

    // Toggle to interval mode.
    expect(m.toggleGapMode()).toBe('interval');
    const intRows = m.buildTowerRows(grid);
    expect(intRows[0]?.value).toBe('LEADER');
    expect(intRows[1]?.value).toBe('+0.750');
    expect(intRows[2]?.value).toBe('+0.750');
    expect(intRows[16]?.value).toBe('+1L');
    expect(intRows[17]?.value).toBe('+0.750');

    // Tyre age resets when a car fits new tyres in the pit box.
    m.ingest([
      {
        type: 'lap',
        t: 100,
        car: 0,
        at: 100,
        result: {
          lap: 1,
          time: 80,
          sectors: [],
          sectorClasses: [],
          valid: true,
          class: 'personal',
          deltaToBest: null,
          personalBest: true,
          record: false,
          sectorRecords: [],
        },
      },
      {
        type: 'lap',
        t: 180,
        car: 0,
        at: 180,
        result: {
          lap: 2,
          time: 80,
          sectors: [],
          sectorClasses: [],
          valid: true,
          class: 'personal',
          deltaToBest: null,
          personalBest: false,
          record: false,
          sectorRecords: [],
        },
      },
      {
        type: 'pit',
        t: 190,
        car: 0,
        stage: 'serviceEnd',
        actions: [{ kind: 'tyres', compound: 'hard' }],
      },
    ]);
    const afterPit = m.buildTowerRows([standing(0, 1, { lap: 3, lapsCompleted: 2, pitStops: 1 })]);
    expect(afterPit[0]?.compound?.code).toBe('H');
    expect(afterPit[0]?.tyreAge).toBe(0);
    expect(afterPit[0]?.pitStops).toBe(1);

    const nextLap = m.buildTowerRows([standing(0, 1, { lap: 4, lapsCompleted: 3, pitStops: 1 })]);
    expect(nextLap[0]?.tyreAge).toBe(1);
  });

  it('formats qualifying and practice rows by best lap and gap to P1', () => {
    const m = createModel({ sessionKind: 'qualifying' });
    const rows = m.buildTowerRows([
      standing(1, 1, { bestLap: 80.5 }),
      standing(0, 2, { bestLap: 80.925 }),
      standing(2, 3, { bestLap: null }),
    ]);
    expect(rows[0]).toMatchObject({ value: '1:20.500', tone: 'overall' });
    expect(rows[1]).toMatchObject({ value: '+0.425', tone: '' });
    expect(rows[2]).toMatchObject({ value: 'NO TIME', tone: 'empty' });
  });
});

describe('race display model: flags & safety indicators', () => {
  it('maps marshalling sectors to timing sectors and honours flag priority', () => {
    expect(marshalToTimingSector(0, 9, [2000, 4000], 6000)).toBe(1);
    expect(marshalToTimingSector(4, 9, [2000, 4000], 6000)).toBe(2);
    expect(marshalToTimingSector(8, 9, [2000, 4000], 6000)).toBe(3);
    expect(formatYellowSectors([2])).toBe('Sector 2');
    expect(formatYellowSectors([1, 3])).toBe('Sectors 1, 3');
    expect(formatYellowSectors([1, 3], true)).toBe('S1 S3');

    const m = createModel();
    m.ingest([{ type: 'phase', t: 5, phase: 'green' }]);
    expect(m.snapshot().flags.banner).toBeNull();
    expect(m.snapshot().flags.towerStatus).toEqual({ flag: 'green', text: 'Green flag' });

    // Blue flag for player.
    m.ingest([{ type: 'flag', t: 10, flag: 'blue', on: true, car: 0, by: 3 }]);
    expect(m.snapshot().flags.banner).toEqual({
      flag: 'blue',
      title: 'Blue flag',
      detail: 'Let D03 through',
    });

    // Yellow sector overrides blue in banner, and records exact marshalling sector.
    m.ingest([{ type: 'flag', t: 12, flag: 'yellow', on: true, sector: 4 }]);
    expect(m.snapshot().flags.yellowSectors[4]).toBe(true);
    expect(m.snapshot().flags.yellowTimingSectors).toEqual([2]);
    expect(m.snapshot().flags.banner).toEqual({
      flag: 'yellow',
      title: 'Yellow flag',
      detail: 'Sector 2 · No overtaking',
    });
    expect(m.snapshot().flags.towerStatus).toEqual({ flag: 'yellow', text: 'Yellow · S2' });

    // Chequered overrides yellow.
    m.ingest([{ type: 'flag', t: 50, flag: 'chequered', on: true }]);
    expect(m.snapshot().flags.banner?.flag).toBe('chequered');
    expect(m.snapshot().flags.towerStatus).toEqual({ flag: 'chequered', text: 'Chequered flag' });
  });

  it('tracks black-and-white flag expiry and blocking-ghost safety indicator', () => {
    const m = createModel();
    m.ingest([
      { type: 'phase', t: 5, phase: 'green' },
      { type: 'flag', t: 20, flag: 'blackWhite', on: true, car: 0 },
    ]);
    expect(m.snapshot().flags.banner?.flag).toBe('blackWhite');
    m.tick(BLACK_WHITE_BANNER_S + 0.1);
    expect(m.snapshot().flags.banner).toBeNull();

    m.setBlockingGhost(true);
    expect(m.snapshot().safety).toEqual({
      kind: 'ghost',
      title: 'Safety ghost',
      detail: 'Traffic passing through your car',
    });
    m.setBlockingGhost(false);
    expect(m.snapshot().safety).toBeNull();
  });
});

describe('race display model: message queue', () => {
  it('maps pit, track limits, speeding, penalty, penalty served, and warning events into the queue', () => {
    const m = createModel();
    const events: RaceEvent[] = [
      { type: 'trackLimits', t: 10, car: 0, strike: 1, outcome: 'warning' },
      { type: 'trackLimits', t: 15, car: 0, strike: 3, outcome: 'blackWhite' },
      { type: 'penalty', t: 20, car: 0, reason: 'trackLimits', seconds: 5 },
      { type: 'pit', t: 30, car: 0, stage: 'speeding' },
      { type: 'penalty', t: 30, car: 0, reason: 'pitSpeeding', seconds: 5 },
      { type: 'pit', t: 35, car: 0, stage: 'penaltyStart', duration: 5 },
      { type: 'penaltyServed', t: 40, car: 0, seconds: 5 },
      {
        type: 'pit',
        t: 42,
        car: 0,
        stage: 'serviceEnd',
        actions: [{ kind: 'tyres', compound: 'soft' }],
      },
    ];
    m.ingest(events);

    const visible = m.snapshot(6).messages;
    expect(visible.map((x) => [x.tag, x.text])).toEqual([
      ['Pit stop', 'Soft tyres fitted'],
      ['Penalty served', '5 s served in pit box'],
      ['Pit penalty', 'Serving 5 s penalty'],
      ['+5 s penalty', 'Pit lane speeding'],
      ['Pit speeding', 'Over pit lane limit'],
      ['+5 s penalty', 'Track limits'],
    ]);

    // Expiring messages clear out cleanly.
    m.tick(10);
    expect(m.snapshot().messages).toHaveLength(0);
  });

  it('deduplicates repeated active messages and caps visible output', () => {
    const q = new RaceMessageQueue(5);
    q.push('Pit lane', 'Entered pit lane', 'info', 2);
    q.push('Pit lane', 'Entered pit lane', 'info', 4);
    expect(q.visible(5)).toHaveLength(1);
    expect(q.visible(5)[0]?.remaining).toBe(4);
    q.push('A', '1', 'info', 4);
    q.push('B', '2', 'warning', 4);
    q.push('C', '3', 'invalid', 4);
    expect(q.visible(3)).toHaveLength(3);
  });
});

it('keeps the tower on the fitted compound after medium → hard → medium with two serviced stops', () => {
  const race = new RailRace({ kind: 'race', laps: 10 }, [{ speed: 50 }]);
  const model = createModel();
  const c = race.control;
  for (const compound of ['hard', 'medium'] as const) {
    race.request(0, [{ kind: 'tyres', compound }]);
    const events = race.run(100, (events) =>
      events.some((e) => e.type === 'pit' && e.stage === 'serviceEnd'),
    );
    expect(events.some((e) => e.type === 'pit' && e.stage === 'serviceEnd')).toBe(true);
    model.ingest(events);
    const rows = model.buildTowerRows(c.standings(), { cars: c.cars, phase: c.phase });
    expect(rows[0]?.compound?.code).toBe(compound === 'hard' ? 'H' : 'M');
    expect(rows[0]?.tyreAge).toBe(0);
    race.run(20, () => c.pitPhase(0) === 'none');
  }
  expect(c.cars[0]?.pitStops).toBe(2);
  expect(c.cars[0]?.compounds).toEqual(['medium', 'hard']);
});
