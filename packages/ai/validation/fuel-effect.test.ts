import { it } from 'vitest';
import { measureEnvelope } from '../src/index';
import { planFromRacingLine } from '../src/reference-setup';
import { expectLap, lapTargetName } from './expect-lap';
import { MONZA, carFor, loadLine } from './lib/index';

// Doc 4.3: the model, not a rule, must make a heavier car slower: 0.25–0.40 s for 10 kg at
// Monza. Measured quasi-steady, as a driver who uses what the car has would: the envelope
// re-measured at each fuel load and the racing line's speed profile re-planned on it (the
// reference driver follows one fixed plan, so its own laps barely show the mass).
it(lapTargetName('monza-fuel-10kg'), () => {
  const track = MONZA.track();
  const line = loadLine(MONZA);
  const lap = (fuel: number): number => {
    const envelope = measureEnvelope({
      params: carFor(MONZA),
      airDensity: MONZA.airDensity,
      fuel,
    }).envelope;
    return planFromRacingLine(track, line, envelope).profile.lapTime;
  };
  expectLap('monza-fuel-10kg', lap(MONZA.fuel + 10) - lap(MONZA.fuel));
});
