import { describe, expect, it } from 'vitest';
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
  it('keeps the validated unassisted reference lap identical', () => {
    const { result } = referenceLap(MONZA);
    const lap = result.laps[0]!;
    expect(lap.time).toBe(84.9691326147698);
    expect(lap.trap).toBe(347.3873987429674);
    expect(lap.sectors).toEqual([27.877479110448448, 28.66689891479436, 28.424754589526998]);
    expect(result.ticks).toBe(40822);
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
