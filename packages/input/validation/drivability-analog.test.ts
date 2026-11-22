import { describe, expect, it } from 'vitest';
import { tally } from './lib/compare';

/**
 * The clumsy player on a gamepad (analogue stick and triggers, lighter help) and on a phone,
 * five seeds of two laps on each preset. Measured at the time of writing (default / stability
 * off): gamepad 0 incidents in ten laps (3 before docs/physics-validation.md section 7.9), touch 0 / 8.
 */
describe('drivability: gamepad and touch', () => {
  for (const device of ['gamepad', 'touch'] as const) {
    const preset = tally(device, {}, 5, 2);
    const noStability = tally(device, { stability: 0 }, 5, 2);
    const incidents = Math.round(preset.spinsPerLap * preset.laps);

    it(`${device}: fewer spins, less time off and quicker laps than with stability off`, () => {
      expect(preset.laps).toBe(10);
      expect(preset.spinsPerLap).toBeLessThan(noStability.spinsPerLap);
      expect(preset.offPerLap).toBeLessThan(noStability.offPerLap);
      expect(preset.meanLap).toBeLessThan(noStability.meanLap);
    });

    it(`${device}: meets the target of at most 1 spin in 10 laps`, () => {
      expect(incidents).toBeLessThanOrEqual(1);
    });
  }
});
