import { NEUTRAL_INPUT, REFERENCE_CAR, createAssistState, createCarState } from '@undercut/sim';
import { describe, expect, it } from 'vitest';
import { applyDriverAids, assistsFor, brakeHelp, type SpeedGuide } from '../src/driver-aids';

const DT = 1 / 240;

/** A guide that wants `slow` m/s from s = 100 m on, and 90 m/s before it. */
function corner(slow: number): SpeedGuide {
  return { speedAt: (s: number) => (s >= 100 ? slow : 90) };
}

describe('braking help', () => {
  it('is off at level 0 and without a guide', () => {
    expect(brakeHelp(0, corner(20), 90, 80)).toBe(0);
    const car = createCarState(REFERENCE_CAR, { speed: 80, gear: 7 });
    const config = { ...assistsFor('keyboard', {}), braking: 2 };
    const out = applyDriverAids(
      'keyboard',
      config,
      createAssistState(),
      car,
      { ...NEUTRAL_INPUT, throttle: 1 },
      DT,
      { ...NEUTRAL_INPUT },
    );
    expect(out.brake).toBe(0);
    expect(out.throttle).toBeGreaterThan(0);
  });

  it('brakes for a corner the car is too fast for, more the higher the level', () => {
    const low = brakeHelp(1, corner(65), 90, 70);
    const high = brakeHelp(3, corner(65), 90, 70);
    expect(low).toBeGreaterThan(0);
    expect(high).toBeGreaterThan(low);
    expect(high).toBeLessThanOrEqual(1);
  });

  it('does nothing at or a little under the guide speed', () => {
    expect(brakeHelp(3, corner(40), 120, 40)).toBe(0);
    expect(brakeHelp(1, corner(40), 120, 42)).toBe(0);
  });

  it('looks ahead by the speed: a faster car is braked from further back', () => {
    // 30 m before the slow zone: at 70 m/s the look-ahead reaches it, at 30 m/s it does not.
    expect(brakeHelp(2, corner(25), 70, 70)).toBeGreaterThan(0);
    expect(brakeHelp(2, corner(25), 70, 30)).toBe(0);
  });

  it('adds to the driver’s brake, lifts the throttle, and goes through ABS', () => {
    const car = createCarState(REFERENCE_CAR, { speed: 70, gear: 7 });
    const config = { ...assistsFor('keyboard', {}), braking: 3 };
    const at = { guide: corner(30), s: 90 };
    const out = applyDriverAids(
      'keyboard',
      config,
      createAssistState(),
      car,
      { ...NEUTRAL_INPUT, throttle: 1 },
      DT,
      { ...NEUTRAL_INPUT },
      at,
    );
    expect(out.brake).toBeGreaterThan(0.5);
    expect(out.throttle).toBe(0);
    // The driver braking harder than the help keeps their own pedal.
    const hard = applyDriverAids(
      'keyboard',
      config,
      createAssistState(),
      car,
      { ...NEUTRAL_INPUT, brake: 1 },
      DT,
      { ...NEUTRAL_INPUT },
      at,
    );
    expect(hard.brake).toBe(1);
    // A locking wheel: ABS still limits the helped pedal.
    car.slipRatio.set([-0.4, -0.4, -0.4, -0.4]);
    const locked = applyDriverAids(
      'keyboard',
      config,
      createAssistState(),
      car,
      { ...NEUTRAL_INPUT },
      DT,
      { ...NEUTRAL_INPUT },
      at,
    );
    expect(locked.brake).toBeLessThan(0.5);
  });

  it('is part of the keyboard and touch presets, not the gamepad one', () => {
    expect(assistsFor('keyboard', {}).braking).toBeGreaterThan(0);
    expect(assistsFor('touch', {}).braking).toBeGreaterThan(assistsFor('keyboard', {}).braking);
    expect(assistsFor('gamepad', {}).braking).toBe(0);
  });
});
