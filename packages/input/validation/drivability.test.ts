import { describe, expect, it } from 'vitest';
import { DrivingLine } from '@undercut/ai';
import { MONZA, referenceLap } from '../../ai/validation/lib/index';
import type { DeviceKind } from '../src/actions';
import { assistsFor } from '../src/driver-aids';
import { CLUMSY, DISCIPLINED } from './lib/human';
import { newcomerPlan, runPlayer } from './lib/player-lap';

const REF_TIME = 84.9691326147698;
const plan = newcomerPlan(MONZA);
const cues = new DrivingLine(plan);

function clumsyOverTenLaps(device: DeviceKind): { laps: number; spins: number } {
  let laps = 0;
  let spins = 0;
  for (let seed = 1; seed <= 5; seed++) {
    const result = runPlayer({
      setup: MONZA,
      device,
      traits: CLUMSY,
      assists: assistsFor(device, {}),
      seed,
      laps: 2,
      plan,
      cues,
    });
    laps += result.laps;
    spins += result.spins.length;
  }
  return { laps, spins };
}

describe('player drivability', () => {
  it('keeps the validated unassisted reference lap identical', () => {
    const { result } = referenceLap(MONZA);
    const lap = result.laps[0]!;
    expect(lap.time).toBe(REF_TIME);
    expect(lap.trap).toBe(347.3873987429674);
    expect(lap.sectors).toEqual([27.877479110448448, 28.66689891479436, 28.424754589526998]);
    expect(result.ticks).toBe(40822);
  });

  it('keeps a clumsy keyboard driver to at most 1 spin in 10 laps on default assists', () => {
    const { laps, spins } = clumsyOverTenLaps('keyboard');
    expect(laps).toBe(10);
    expect(spins).toBeLessThanOrEqual(1);
  });

  it('lets a keyboard player following the pedal cues lap without spinning', () => {
    const result = runPlayer({
      setup: MONZA,
      device: 'keyboard',
      traits: DISCIPLINED,
      assists: assistsFor('keyboard', {}),
      seed: 1,
      laps: 2,
      plan,
      cues,
    });
    expect(result.laps).toBe(2);
    expect(result.spins).toEqual([]);
    for (const time of result.lapTimes) {
      expect(time).toBeGreaterThan(REF_TIME * 1.06);
      expect(time).toBeLessThan(REF_TIME * 1.12);
    }
  });

  it('keeps clumsy gamepad and touch drivers to at most 1 spin in 10 laps, and 0 on cues', () => {
    for (const device of ['gamepad', 'touch'] as const) {
      const clumsy = clumsyOverTenLaps(device);
      expect(clumsy.laps).toBe(10);
      expect(clumsy.spins).toBeLessThanOrEqual(1);

      const disc = runPlayer({
        setup: MONZA,
        device,
        traits: DISCIPLINED,
        assists: assistsFor(device, {}),
        seed: 1,
        laps: 2,
        plan,
        cues,
      });
      expect(disc.laps).toBe(2);
      expect(disc.spins).toEqual([]);
      for (const time of disc.lapTimes) {
        expect(time).toBeGreaterThan(REF_TIME * 1.03);
        expect(time).toBeLessThan(REF_TIME * 1.12);
      }
    }
  });

  it('still spins the same clumsy keyboard driver often with assists off', () => {
    const result = runPlayer({
      setup: MONZA,
      device: 'keyboard',
      traits: CLUMSY,
      assists: { tractionControl: 0, stability: 0, abs: 0, autoGears: true, steering: 0 },
      seed: 1,
      laps: 1,
      plan,
      cues,
    });
    expect(result.laps).toBe(1);
    expect(result.spins.length).toBeGreaterThanOrEqual(15);
  });
});
