import { describe, expect, it } from 'vitest';
import {
  ASSIST_SNAPSHOT_LENGTH,
  FLAT_SURFACE,
  NEUTRAL_INPUT,
  NO_ASSISTS,
  REFERENCE_CAR,
  applyAssists,
  createAssistState,
  createCarState,
  createEnvironment,
  restoreAssists,
  restoreCar,
  snapshotAssists,
  snapshotCar,
  speedSensitiveSteer,
  stepCar,
  type ControlInput,
} from '../src/index';

const DT = 1 / 240;

function driver(over: Partial<ControlInput>): ControlInput {
  return { ...NEUTRAL_INPUT, ...over };
}

describe('assists', () => {
  it('pass the driver through untouched when off', () => {
    const car = createCarState(REFERENCE_CAR, { speed: 30, gear: 3 });
    car.slipRatio.set([-0.5, -0.5, 0.6, 0.6]);
    const d = driver({ steer: 0.3, throttle: 0.7, brake: 0.2, gearShift: 1, drs: true });
    const out = applyAssists(NO_ASSISTS, createAssistState(), car, d, DT, driver({}));
    expect(out).toEqual(d);
  });

  it('traction control cuts throttle when the driven wheels spin, then gives it back', () => {
    const car = createCarState(REFERENCE_CAR, { speed: 20, gear: 2 });
    const memory = createAssistState();
    const settings = { tractionControl: 2, abs: 0, autoGears: false };
    const out = driver({});
    car.slipRatio.set([0, 0, 0.3, 0.3]);
    for (let i = 0; i < 5; i++)
      applyAssists(settings, memory, car, driver({ throttle: 1 }), DT, out);
    expect(out.throttle).toBeLessThan(0.3);
    car.slipRatio.set([0, 0, 0.05, 0.05]);
    for (let i = 0; i < 240; i++)
      applyAssists(settings, memory, car, driver({ throttle: 1 }), DT, out);
    expect(out.throttle).toBe(1);
  });

  it('higher traction-control levels intervene at less slip', () => {
    const car = createCarState(REFERENCE_CAR, { speed: 20, gear: 2 });
    car.slipRatio.set([0, 0, 0.12, 0.12]);
    const cut = (level: number) => {
      const out = driver({});
      const memory = createAssistState();
      const settings = { tractionControl: level, abs: 0, autoGears: false };
      applyAssists(settings, memory, car, driver({ throttle: 1 }), DT, out);
      return out.throttle;
    };
    expect(cut(1)).toBe(1);
    expect(cut(3)).toBeLessThan(1);
  });

  it('ABS releases the brake when a wheel locks, and protects the rear first', () => {
    const car = createCarState(REFERENCE_CAR, { speed: 60, gear: 7 });
    const settings = { tractionControl: 0, abs: 2, autoGears: false };
    const apply = (slips: number[]) => {
      car.slipRatio.set(slips);
      const out = driver({});
      applyAssists(settings, createAssistState(), car, driver({ brake: 1 }), DT, out);
      return out.brake;
    };
    expect(apply([-0.05, -0.05, -0.05, -0.05])).toBe(1);
    expect(apply([-0.4, -0.05, -0.05, -0.05])).toBeLessThan(0.5);
    // 0.1 slip: inside the front limit, past the rear one.
    expect(apply([-0.1, -0.1, 0, 0])).toBe(1);
    expect(apply([0, 0, -0.1, -0.1])).toBeLessThan(1);
  });

  it('automatic gears shift up at 11 800 rpm and down when braking', () => {
    const settings = { tractionControl: 0, abs: 0, autoGears: true };
    const fast = createCarState(REFERENCE_CAR, { speed: 41, gear: 2 });
    const out = driver({});
    applyAssists(settings, createAssistState(), fast, driver({ throttle: 1 }), DT, out);
    expect(out.gearShift).toBe(1);
    const slow = createCarState(REFERENCE_CAR, { speed: 20, gear: 6 });
    applyAssists(settings, createAssistState(), slow, driver({ brake: 1 }), DT, out);
    expect(out.gearShift).toBe(-1);
  });

  it('automatic gears let a stopped driver select reverse and come back to first', () => {
    const settings = { tractionControl: 0, abs: 0, autoGears: true };
    const memory = createAssistState();
    const car = createCarState(REFERENCE_CAR, { gear: 1 });
    const out = driver({});
    const press = (shift: -1 | 1): void => {
      applyAssists(settings, memory, car, driver({ gearShift: shift }), DT, out);
      car.gear += out.gearShift;
      for (let i = 0; i < 5; i++) applyAssists(settings, memory, car, driver({}), DT, out);
    };
    // Q twice: first to neutral, then to reverse.
    press(-1);
    expect(car.gear).toBe(0);
    press(-1);
    expect(car.gear).toBe(-1);
    // E twice: back through neutral to first, where automatic shifting takes over again.
    press(1);
    press(1);
    expect(car.gear).toBe(1);
    // Rolling, a downshift request in first is still ignored: no reverse at speed.
    const rolling = createCarState(REFERENCE_CAR, { speed: 8, gear: 1 });
    applyAssists(settings, createAssistState(), rolling, driver({ gearShift: -1 }), DT, out);
    expect(out.gearShift).toBe(0);
  });

  it('speed-sensitive steering keeps full lock when slow and shrinks it with speed', () => {
    expect(speedSensitiveSteer(1, 5)).toBe(1);
    const scales = [20, 40, 60, 80, 100].map((v) => speedSensitiveSteer(1, v));
    for (let i = 1; i < scales.length; i++) expect(scales[i]!).toBeLessThan(scales[i - 1]!);
    expect(scales[4]!).toBeGreaterThan(0.12);
    expect(speedSensitiveSteer(-0.5, 60)).toBe(-speedSensitiveSteer(0.5, 60));
  });

  it('snapshot with the car and continue a traction-controlled launch bit for bit', () => {
    const env = createEnvironment();
    const settings = { tractionControl: 2, abs: 0, autoGears: true };
    const floor = driver({ throttle: 1 });
    const car = createCarState(REFERENCE_CAR, { fuel: 105 });
    const memory = createAssistState();
    const out = driver({});
    const tick = (c: typeof car, m: typeof memory) => {
      applyAssists(settings, m, c, floor, DT, out);
      stepCar(c, out, FLAT_SURFACE, DT, env);
      return out.throttle;
    };
    for (let i = 0; i < 60; i++) tick(car, memory);
    expect(memory.tcScale).toBeLessThan(1); // TC is intervening at the snapshot
    const carSnap = snapshotCar(car);
    const assistSnap = snapshotAssists(memory);
    expect(assistSnap.length).toBe(ASSIST_SNAPSHOT_LENGTH);
    const original = Array.from({ length: 120 }, () => tick(car, memory));

    const restoredCar = createCarState(REFERENCE_CAR);
    const restoredMemory = createAssistState();
    restoreCar(restoredCar, carSnap);
    restoreAssists(restoredMemory, assistSnap);
    const resumed = Array.from({ length: 120 }, () => tick(restoredCar, restoredMemory));
    expect(resumed).toEqual(original);
    expect(Array.from(snapshotCar(restoredCar))).toEqual(Array.from(snapshotCar(car)));

    // Without the assist memory the same driver input gives a different throttle.
    const fresh = createCarState(REFERENCE_CAR);
    restoreCar(fresh, carSnap);
    expect(tick(fresh, createAssistState())).not.toBe(original[0]);
  });
});
