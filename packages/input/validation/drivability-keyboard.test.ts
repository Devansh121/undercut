import { describe, expect, it } from 'vitest';
import { expectLap, lapTargetName } from '../../ai/validation/expect-lap';
import { MONZA, referenceLap } from '../../ai/validation/lib/index';
import { LAP_GAPS } from '../../ai/validation/lib/targets';
import { ASSISTS_OFF, DRIVABILITY_GAPS, tally } from './lib/compare';
import { DISCIPLINED } from './lib/human';

/**
 * A clumsy keyboard player (`lib/human.ts`: reaction 0.15–0.25 s, key taps, late and early
 * braking, early throttle, mid-corner lifts, kerb strikes) round Monza through the game's own
 * input chain, five seeds of two laps. Spins (and resets after sitting stopped) cost `SPIN_COST`
 * seconds and count as time off. Measured at the time of writing (default / stability off / all
 * off): 1 / 100 / 134 incidents in ten laps, 43 / 70 / 83 s off or spun per lap.
 */
describe('drivability: keyboard', () => {
  // The unassisted car: the reference driver's lap against the value the physics suite records
  // (master's, not a copy), as `reference-lap.test.ts` checks it.
  it(lapTargetName('monza-lap-m1'), () => {
    const { result } = referenceLap(MONZA);
    expect(result.spun).toBe(false);
    expectLap('monza-lap-m1', result.laps[0]!.time);
  });

  const preset = tally('keyboard', {}, 5, 2);
  const noStability = tally('keyboard', { stability: 0 }, 5, 2);

  it('meets the target: at most 1 spin in 10 laps for a clumsy driver on the default assists', () => {
    expect(preset.laps).toBe(10);
    expect(Math.round(preset.spinsPerLap * preset.laps)).toBeLessThanOrEqual(1);
    expect(preset.spinsPerLap).toBeLessThan(0.25 * noStability.spinsPerLap);
  });

  it('never steers for the driver, and costs neither time off the track nor lap time', () => {
    expect(preset.overridePerLap).toBe(0);
    expect(preset.offPerLap).toBeLessThan(noStability.offPerLap);
    expect(preset.meanLap).toBeLessThan(noStability.meanLap);
  });

  it('known gap: the disciplined driver still strikes barriers and laps 35 % slow', () => {
    // Target: no spin and 6–12 % slower than the reference lap. Recorded, not met.
    const gap = DRIVABILITY_GAPS.disciplinedKeyboard;
    const disciplined = tally('keyboard', {}, 5, 2, DISCIPLINED);
    expect(disciplined.laps).toBe(10);
    const incidents = Math.round(disciplined.spinsPerLap * disciplined.laps);
    expect(incidents, gap.reason).toBeGreaterThan(0);
    expect(Math.abs(incidents - gap.incidents), gap.reason).toBeLessThanOrEqual(1);
    expect(Math.abs(disciplined.meanLap - gap.meanLap) / gap.meanLap).toBeLessThan(0.015);
    expect(disciplined.meanLap).toBeGreaterThan(1.12 * LAP_GAPS['monza-lap-m1']!.measured);
  });

  it('still spins the same driver often with every assist off: the car is not made easy', () => {
    const off = tally('keyboard', ASSISTS_OFF, 2, 1);
    expect(off.spinsPerLap).toBeGreaterThan(8);
  });
});
