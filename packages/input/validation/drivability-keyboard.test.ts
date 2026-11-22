import { describe, expect, it } from 'vitest';
import { expectLap, lapTargetName } from '../../ai/validation/expect-lap';
import { MONZA, referenceLap } from '../../ai/validation/lib/index';
import { REFERENCE_LAP_EXACT } from '../../ai/validation/lib/targets';
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
  // The unassisted car: the reference driver's lap against the physics suite's record, both
  // the target check (`expectLap`, as `reference-lap.test.ts` runs it) and to the last bit.
  it(lapTargetName('monza-lap-m1'), () => {
    const { result } = referenceLap(MONZA);
    const lap = result.laps[0]!;
    expect(result.spun).toBe(false);
    expectLap('monza-lap-m1', lap.time);
    const exact = REFERENCE_LAP_EXACT['monza-lap-m1']!;
    expect(lap.time).toBe(exact.time);
    expect(lap.trap).toBe(exact.trap);
    expect(result.ticks).toBe(exact.ticks);
  });

  const preset = tally('keyboard', {}, 5, 2);
  const noStability = tally('keyboard', { stability: 0 }, 5, 2);

  it('known gap: a clumsy driver on the default assists, 2 incidents in 10 laps against 1', () => {
    const gap = DRIVABILITY_GAPS.clumsyKeyboard;
    expect(preset.laps).toBe(10);
    const incidents = Math.round(preset.spinsPerLap * preset.laps);
    expect(incidents, gap.reason).toBeGreaterThan(1);
    expect(Math.abs(incidents - gap.incidents), gap.reason).toBeLessThanOrEqual(1);
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
    expect(disciplined.meanLap).toBeGreaterThan(1.12 * REFERENCE_LAP_EXACT['monza-lap-m1']!.time);
  });

  it('still spins the same driver often with every assist off: the car is not made easy', () => {
    const off = tally('keyboard', ASSISTS_OFF, 2, 1);
    expect(off.spinsPerLap).toBeGreaterThan(8);
  });
});
