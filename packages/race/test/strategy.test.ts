import { expect, it } from 'vitest';
import { choosePitStop, plannedStops, type StrategyReading } from '../src/strategy';

const reading: StrategyReading = {
  laps: 5,
  lap: 2,
  car: 1,
  stops: 0,
  compound: 'medium',
  wear: 0.15,
  lapTime: 100,
  pitLoss: 30,
  gapAhead: null,
  aheadPitting: false,
  rejoinGap: 10,
};
it('plans one stop at short distance and two only when degradation repays the extra pit loss', () => {
  expect(plannedStops(5, 100, 30)).toBe(1);
  expect(plannedStops(60, 100, 20)).toBe(2);
  expect(plannedStops(60, 100, 5000)).toBe(1);
});
it('changes compound and makes the mandatory stop before the final lap', () => {
  expect(choosePitStop({ ...reading, lap: 1 })).toBeNull();
  expect(choosePitStop({ ...reading, lap: 4 })).toEqual({ compound: 'hard', reason: 'planned' });
  expect(choosePitStop({ ...reading, lap: 4, stops: 1, compound: 'hard' })).toBeNull();
});
it('undercuts a close car on worn tyres only when there is room to rejoin', () => {
  expect(choosePitStop({ ...reading, wear: 0.5, gapAhead: 1 })).toEqual({
    compound: 'hard',
    reason: 'undercut',
  });
  expect(choosePitStop({ ...reading, wear: 0.5, gapAhead: 1, rejoinGap: 0.4 })).toBeNull();
});
it('extends a good set while a rival pits, without missing the compound change', () => {
  expect(choosePitStop({ ...reading, lap: 3, aheadPitting: true })).toBeNull();
  expect(choosePitStop({ ...reading, lap: 4, aheadPitting: true })).not.toBeNull();
});
it('is a pure decision from saved race state', () => {
  expect(choosePitStop(JSON.parse(JSON.stringify(reading)) as StrategyReading)).toEqual(
    choosePitStop(reading),
  );
});
