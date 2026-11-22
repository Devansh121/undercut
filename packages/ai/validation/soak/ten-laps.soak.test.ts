import { describe, expect, it } from 'vitest';
import { MONZA, SINGAPORE, SPA, referenceLap, type CircuitSetup } from '../lib/index';

/**
 * Nightly soak (`npm run test:soak`): ten consecutive flying laps by the reference driver at
 * each circuit. Qualifying fuel cannot cover ten laps, so the car starts with enough for the
 * run-up and ten laps and gets lighter as it goes; the energy store is whatever the previous
 * lap left. The laps must all be clean and close together.
 *
 * Fuel a lap, measured on the reference lap: Monza 1.71 kg, Spa 2.07 kg, Singapore 1.56 kg;
 * the loads below carry about 30 % more.
 */
const LAPS = 10;
const FUEL_PER_LAP: Readonly<Record<string, number>> = { monza: 2.2, spa: 2.7, singapore: 2.0 };
/** Largest spread of the ten lap times accepted, s. Measured when written: 0.244 s at Monza. */
const MAX_SPREAD = 0.5;

describe.each([
  ['Monza', MONZA],
  ['Spa', SPA],
  ['Singapore', SINGAPORE],
] as const)('soak: ten consecutive reference laps, %s', (_name, setup: CircuitSetup) => {
  const fuel = setup.fuel + FUEL_PER_LAP[setup.id]! * (LAPS + 1);
  const { result } = referenceLap(setup, { laps: LAPS, fuel });

  it('completes every lap without a spin', () => {
    expect(result.spun).toBe(false);
    expect(result.laps).toHaveLength(LAPS);
  });

  it('stays within track limits on every lap', () => {
    for (const lap of result.laps) expect(lap.allOffTicks).toBe(0);
  });

  it('keeps every tyre off grass and gravel on every lap', () => {
    for (const lap of result.laps) expect(lap.grassSamples).toBe(0);
  });

  it(`repeats its lap time within ${MAX_SPREAD} s`, () => {
    const times = result.laps.map((l) => l.time);
    expect(Math.max(...times) - Math.min(...times)).toBeLessThanOrEqual(MAX_SPREAD);
  });

  it('keeps the MGU-K within its per-lap limits on every lap', () => {
    for (const lap of result.laps) {
      expect(lap.deployMJ).toBeLessThanOrEqual(4 + 1e-6);
      expect(lap.harvestMJ).toBeLessThanOrEqual(2 + 1e-6);
    }
  });
});
