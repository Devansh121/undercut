import { describe, expect, it } from 'vitest';
import { DRIVABILITY_GAPS, tally } from './lib/compare';

/**
 * The clumsy player on a gamepad (analogue stick and triggers, lighter help) and on a phone,
 * five seeds of two laps on each preset. Measured at the time of writing (default / stability
 * off): gamepad 3 / 28 incidents in ten laps, touch 0 / 8.
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

    if (device === 'touch') {
      it('touch: meets the target of at most 1 spin in 10 laps', () => {
        expect(incidents).toBeLessThanOrEqual(1);
      });
    } else {
      it('gamepad: known gap, 3 incidents in 10 laps against a target of 1', () => {
        const gap = DRIVABILITY_GAPS.clumsyGamepad;
        expect(incidents, gap.reason).toBeGreaterThan(1);
        expect(Math.abs(incidents - gap.incidents), gap.reason).toBeLessThanOrEqual(1);
      });
    }
  }
});
