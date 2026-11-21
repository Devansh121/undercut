import { describe, expect, it } from 'vitest';
import { formatDelta, formatGear, formatLapTime, formatSpeedKmh } from '../src/game/format';

describe('format', () => {
  it('formats lap times to the millisecond, rounding down', () => {
    expect(formatLapTime(81.448)).toBe('1:21.448');
    expect(formatLapTime(81.4489)).toBe('1:21.448');
    expect(formatLapTime(9.5)).toBe('0:09.500');
    expect(formatLapTime(27.898, true)).toBe('27.898');
    expect(formatLapTime(65.001, true)).toBe('1:05.001');
    expect(formatLapTime(null, true)).toBe('—');
  });

  it('formats deltas with a sign and a real minus', () => {
    expect(formatDelta(-0.3184)).toBe('−0.318');
    expect(formatDelta(0.2141)).toBe('+0.214');
    expect(formatDelta(1.5)).toBe('+1.500');
    expect(formatDelta(0.0001)).toBe('0.000');
    expect(formatDelta(null)).toBe('—');
  });

  it('formats speed and gear', () => {
    expect(formatSpeedKmh(83.3333)).toBe('300');
    expect(formatSpeedKmh(-2)).toBe('7');
    expect(formatGear(-1)).toBe('R');
    expect(formatGear(0)).toBe('N');
    expect(formatGear(7)).toBe('7');
  });
});
