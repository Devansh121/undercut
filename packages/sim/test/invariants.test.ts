import { describe, expect, it } from 'vitest';
import {
  FLAT_SURFACE,
  NEUTRAL_INPUT,
  REFERENCE_CAR,
  checkCarInvariants,
  createCarState,
  createEnvironment,
  invariantLimits,
  stepCar,
  type CarState,
} from '../src/index';

const env = createEnvironment();

function settledCar(): CarState {
  const car = createCarState(REFERENCE_CAR, { speed: 20 });
  for (let i = 0; i < 240; i++) stepCar(car, NEUTRAL_INPUT, FLAT_SURFACE, 1 / 240, env);
  return car;
}

describe('pose invariants', () => {
  const limits = invariantLimits(createCarState(REFERENCE_CAR).model);

  it('derives limits from the car: static ride inside, pitch from ride span over wheelbase', () => {
    expect(limits.rideMin).toBeLessThan(0);
    expect(limits.rideMax).toBeGreaterThan(REFERENCE_CAR.aero.rideHeightRear);
    expect(limits.pitch).toBeCloseTo(
      (limits.rideMax - limits.rideMin) / REFERENCE_CAR.geometry.wheelbase,
      12,
    );
    expect(limits.wheelMin).toBeLessThan(REFERENCE_CAR.tyre.freeRadius);
    expect(limits.wheelMax).toBeGreaterThan(REFERENCE_CAR.tyre.freeRadius);
    const stepped = invariantLimits(createCarState(REFERENCE_CAR).model, { surfaceStep: 2 });
    expect(stepped.rideMax - limits.rideMax).toBeCloseTo(2, 12);
    expect(limits.wheelMin - stepped.wheelMin).toBeCloseTo(2, 12);
  });

  it('passes a car driving on flat ground', () => {
    expect(checkCarInvariants(settledCar(), limits)).toBeNull();
  });

  const broken: Record<string, (c: CarState) => void> = {
    'a NaN velocity': (c) => void (c.vx = Number.NaN),
    'an infinite wheel speed': (c) => void (c.wheelSpeed[2] = Infinity),
    'a body flying 5 m up': (c) => {
      c.rideHeightFront += 5;
      c.rideHeightRear += 5;
    },
    'a floor 0.5 m into the ground': (c) => void (c.rideHeightRear = -0.5),
    'pitch of 0.6 rad': (c) => void (c.pitch = 0.6),
    'roll of 1 rad': (c) => void (c.roll = -1),
    'a wheel sunk 0.5 m into the ground': (c) => void (c.wheelY[1] = c.groundY[1]! - 0.15),
    'a wheel stretched 3 m up': (c) => void (c.wheelY[3] = c.groundY[3]! + 3),
  };
  for (const [name, corrupt] of Object.entries(broken)) {
    it(`reports ${name}`, () => {
      const car = settledCar();
      corrupt(car);
      expect(checkCarInvariants(car, limits)).toMatch(/./);
    });
  }

  it('measures pitch and roll against the ground plane, not the horizon', () => {
    // A car parked on a 10 % grade, nose up: most of its pitch is the ground's, not the body's.
    const grade = 0.1;
    const surface = {
      sample(
        x: number,
        _z: number,
        _h: unknown,
        out: Parameters<typeof FLAT_SURFACE.sample>[3],
      ): void {
        FLAT_SURFACE.sample(x, 0, { index: -1 }, out);
        out.height = grade * x;
      },
    };
    const car = createCarState(REFERENCE_CAR, { surface });
    expect(car.pitch).toBeGreaterThan(0.08);
    expect(checkCarInvariants(car, limits)).toBeNull();
  });
});
