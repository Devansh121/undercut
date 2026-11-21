import { describe, expect, it } from 'vitest';
import { expectLap, lapTargetName } from '../../ai/validation/expect-lap';
import { MONZA, referenceLap } from '../../ai/validation/lib/index';
import { ASSISTS_OFF, tally } from './lib/compare';

/**
 * A clumsy keyboard player (`lib/human.ts`: reaction 0.15–0.25 s, key taps, late and early
 * braking, early throttle, mid-corner lifts, kerb strikes) round Monza through the game's own
 * input chain, five seeds of two laps. Spins cost `SPIN_COST` seconds and count as time off.
 * Measured at the time of writing (default / stability off / all off): 0.90 / 10.3 / 13.8
 * spins per lap, 41 / 72 / 86 s off or spun per lap.
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

  it('spins a clumsy driver far less on the default assists than with stability off', () => {
    expect(preset.laps).toBe(10);
    expect(preset.spinsPerLap).toBeLessThan(1.5);
    expect(preset.spinsPerLap).toBeLessThan(0.25 * noStability.spinsPerLap);
  });

  it('never steers for the driver, and costs neither time off the track nor lap time', () => {
    expect(preset.overridePerLap).toBe(0);
    expect(preset.offPerLap).toBeLessThan(noStability.offPerLap);
    expect(preset.meanLap).toBeLessThan(noStability.meanLap);
  });

  it('still spins the same driver often with every assist off: the car is not made easy', () => {
    const off = tally('keyboard', ASSISTS_OFF, 2, 1);
    expect(off.spinsPerLap).toBeGreaterThan(8);
  });
});
