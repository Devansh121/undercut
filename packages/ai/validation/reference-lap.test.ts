import { describe, expect, it } from 'vitest';
import { lateralLimit, topSpeed } from '../../sim/validation/lib/index';
import { racingLineSpeeds } from '../src/export/racing-line';
import { MONZA, checkArtefacts, loadEnvelope, loadLine, referenceLap } from './lib/index';
import { expectLap, lapTargetName } from './expect-lap';

// Doc 2.1: a flying lap by the reference driver at Monza in low-drag trim, qualifying fuel
// (10 kg), 25 °C at 180 m, DRS in the zones, full ERS. One lap here; ten in the nightly soak.
describe('validation: reference lap, Monza (doc 2.1)', () => {
  const staleness = checkArtefacts(MONZA);

  it('uses racing-line and envelope artefacts made from the current car, track and code', () => {
    const msg = (name: string) =>
      `${name} artefact is stale: the car, the track or the code that made it changed. ` +
      'Run `npm run ai:build` and commit packages/ai/data/.';
    expect(staleness.envelope.stale, msg('envelope')).toBe(false);
    expect(staleness.line.stale, msg('racing-line')).toBe(false);
  });

  const { result, plan } = referenceLap(MONZA);
  const lap = result.laps[0];

  it('completes the lap without a spin', () => {
    expect(result.spun).toBe(false);
    expect(lap).toBeDefined();
    expect(lap!.maxSideslipDeg).toBeLessThan(15);
  });

  it(lapTargetName('monza-lap-m1'), () => expectLap('monza-lap-m1', lap!.time));

  it(lapTargetName('monza-trap'), () => expectLap('monza-trap', lap!.trap));

  it('stays within track limits: never all four wheels beyond the white lines', () => {
    expect(lap!.allOffTicks).toBe(0);
    expect(lap!.maxWheelsOff).toBeLessThan(4);
  });

  it('keeps the MGU-K within its per-lap limits', () => {
    expect(lap!.deployMJ).toBeLessThanOrEqual(4 + 1e-6);
    expect(lap!.harvestMJ).toBeLessThanOrEqual(2 + 1e-6);
  });

  it('drives the profile the shipped racing line describes', () => {
    const shipped = racingLineSpeeds(loadLine(MONZA));
    let worst = 0;
    for (let i = 0; i < shipped.length; i++) {
      worst = Math.max(worst, Math.abs(shipped[i]! - plan.profile.v[i]!));
    }
    // Speeds are stored to the cm/s and rebuilt from offsets stored to 0.1 mm.
    expect(worst).toBeLessThan(0.05);
    expect(Math.abs(lap!.time - plan.profile.lapTime) / plan.profile.lapTime).toBeLessThan(0.03);
  });
});

// The envelope is measured from the sim, not typed in: it agrees with the physics suite's own
// manoeuvres run on the same car in the same air.
describe('validation: the envelope is the car', () => {
  const env = loadEnvelope(MONZA);
  const at = (table: readonly number[], v: number): number => {
    const k = env.speeds.findIndex((s) => Math.abs(s - v) < 1e-6);
    return table[k]!;
  };
  const load1 = env.loads.indexOf(1);

  it('lateral limit at 200 km/h matches the suite’s constant-speed sweep', () => {
    const v = 200 / 3.6;
    const sweep = lateralLimit({ trim: MONZA.trim, speed: v, airDensity: MONZA.airDensity });
    expect(Math.abs(at(env.lateral[load1]!, v) - sweep.maxLatG * 9.80665)).toBeLessThan(
      0.02 * sweep.maxLatG * 9.80665,
    );
  });

  it('top speed with DRS matches the suite’s top-speed run', () => {
    const run = topSpeed({ trim: MONZA.trim, drs: true, airDensity: MONZA.airDensity });
    expect(Math.abs(env.topSpeed.open - run.maxSpeed)).toBeLessThan(1 / 3.6);
  });
});
