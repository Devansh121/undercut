import { describe, expect, it } from 'vitest';
import { MONZA, referenceLap } from '../lib/index';

/**
 * Nightly soak (`npm run test:soak`): ten consecutive flying laps by the reference driver at
 * Monza. Qualifying fuel cannot cover ten laps, so the car starts with enough for the run-up
 * and ten laps (about 2.2 kg a lap, measured) and gets lighter as it goes; the energy store is
 * whatever the previous lap left. The laps must all be clean and close together.
 */
const LAPS = 10;
const FUEL = MONZA.fuel + 2.2 * (LAPS + 1);
/** Largest spread of the ten lap times accepted, s. Measured when written: 0.244 s. */
const MAX_SPREAD = 0.5;

describe('soak: ten consecutive reference laps, Monza', () => {
  const { result } = referenceLap(MONZA, { laps: LAPS, fuel: FUEL });

  it('completes every lap without a spin', () => {
    expect(result.spun).toBe(false);
    expect(result.laps).toHaveLength(LAPS);
  });

  it('stays within track limits on every lap', () => {
    for (const lap of result.laps) expect(lap.allOffTicks).toBe(0);
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
