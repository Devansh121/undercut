import { expect, it } from 'vitest';
import { expectCleanRace } from './lib/expect-race';
import { aiSession, defaultPitLap, runSession } from './lib/runner';

// Spa with scheduled stops (one each around half distance), twenty cars, five laps. Seed 17
// jammed the pit lane when the pit-lane follower's wheelspin guard kept a high throttle floor
// at speed: 25 watchdog findings, 7 cars stuck, a car facing the wrong way in the lane (review
// of #77). The corrected exit paths can mask that jam, so classification alone is not a
// throttle regression: also observe the actual lane commands during sustained wheelspin.
it('spa seed 17: clean scheduled stops and throttle cut during sustained lane wheelspin', () => {
  const session = aiSession({ kind: 'race', laps: 5 }, { circuit: 'spa', cars: 20, seed: 17 });
  const spinningFor = new Float64Array(20);
  let spinSamples = 0;
  let maxSpinThrottle = 0;
  for (const car of session.cars) {
    const driver = car.controller;
    car.controller = {
      kind: driver.kind,
      get autoLimiter() {
        return driver.autoLimiter;
      },
      set autoLimiter(value) {
        driver.autoLimiter = value;
      },
      reset: () => driver.reset(),
      snapshot: () => driver.snapshot(),
      restore: (state) => driver.restore(state),
      control(ctx, out) {
        driver.control(ctx, out);
        const phase = ctx.control.pitPhase(ctx.car);
        const slip = Math.max(ctx.telemetry.slipRatio[2]!, ctx.telemetry.slipRatio[3]!);
        const laneSpin =
          ctx.facts.inPitLane && (phase === 'lane' || phase === 'released') && slip > 0.12;
        spinningFor[ctx.car] = laneSpin ? spinningFor[ctx.car]! + ctx.dt : 0;
        // Longer than the 0.95 / 6 s needed to reduce full throttle to the safe floor.
        if (spinningFor[ctx.car]! >= 0.25) {
          spinSamples++;
          maxSpinThrottle = Math.max(maxSpinThrottle, out.throttle);
        }
      },
    };
  }
  const run = runSession(session, { pitLap: defaultPitLap(5) });
  console.warn('Spa lane wheelspin', {
    spinSamples,
    maxSpinThrottle,
    classified: run.result.entries.filter((e) => e.status === 'finished').length,
    findings: run.result.anomalies.length,
    stuck: run.result.entries.filter((e) => e.reason === 'stuck').length,
  });
  expect(run.result.entries).toHaveLength(20);
  expect(run.result.entries.filter((e) => e.status === 'finished')).toHaveLength(20);
  expect(run.result.entries.filter((e) => e.reason === 'stuck')).toHaveLength(0);
  expect(run.result.anomalies).toHaveLength(0);
  expect(spinSamples).toBeGreaterThan(0);
  expect(maxSpinThrottle).toBeLessThanOrEqual(0.05);
  expectCleanRace(run, 5);
  expect(run.result.anomalies).toEqual([]);
  expect(run.result.entries.every((e) => e.status === 'finished' && e.laps === 5)).toBe(true);
  expect(run.result.entries.every((e) => e.pitStops === 1)).toBe(true);
}, 300_000);
