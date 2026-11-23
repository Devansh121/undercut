import { expect, it } from 'vitest';
import { compoundMark, formatFuel, formatTyreTemp, tyreBand } from '../src/ui/hud/tyres';

const K = 273.15;

it('bands a tread temperature against its compound window', () => {
  const low = K + 85;
  const high = K + 115;
  expect(tyreBand(K + 70, low, high)).toBe('cold');
  expect(tyreBand(K + 85, low, high)).toBe('ok');
  expect(tyreBand(K + 84.6, low, high)).toBe('ok');
  expect(tyreBand(K + 115.4, low, high)).toBe('ok');
  expect(tyreBand(K + 115, low, high)).toBe('ok');
  expect(tyreBand(K + 120, low, high)).toBe('warm');
  expect(tyreBand(K + 126, low, high)).toBe('hot');
});

it('formats temperature in °C and fuel in kg at the UI edge', () => {
  expect(formatTyreTemp(K + 94.6)).toBe('95°');
  expect(formatFuel(11.94)).toBe('11.9 kg');
  expect(formatFuel(0)).toBe('0.0 kg');
});

it('reads each compound mark from the design file', () => {
  expect(compoundMark('soft')).toMatchObject({ code: 'S', slots: [-1, 0, 1] });
  expect(compoundMark('hard')).toMatchObject({ code: 'H', slots: [0] });
  expect(compoundMark('nope').code).toBe('M');
});
