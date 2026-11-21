import { describe, expect, it } from 'vitest';
import { tally } from './lib/compare';

/**
 * The clumsy player on a gamepad (analogue stick and triggers, lighter help) and on a phone,
 * five seeds of two laps on each preset. Measured at the time of writing (default / stability
 * off): gamepad 0.30 / 3.1 spins per lap, touch 0.0 / 0.8.
 */
describe('drivability: gamepad and touch', () => {
  for (const device of ['gamepad', 'touch'] as const) {
    const preset = tally(device, {}, 5, 2);
    const noStability = tally(device, { stability: 0 }, 5, 2);

    it(`${device}: fewer spins, less time off and quicker laps than with stability off`, () => {
      expect(preset.laps).toBe(10);
      expect(preset.spinsPerLap).toBeLessThanOrEqual(0.6);
      expect(preset.spinsPerLap).toBeLessThan(noStability.spinsPerLap);
      expect(preset.offPerLap).toBeLessThan(noStability.offPerLap);
      expect(preset.meanLap).toBeLessThan(noStability.meanLap);
    });
  }
});
