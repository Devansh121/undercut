import { describe, expect, it } from 'vitest';
import {
  NEUTRAL_INPUT,
  NO_ASSISTS,
  REFERENCE_CAR,
  applyAssists,
  createAssistState,
  createCarState,
  speedSensitiveSteer,
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

  it('speed-sensitive steering keeps full lock when slow and shrinks it with speed', () => {
    expect(speedSensitiveSteer(1, 5)).toBe(1);
    const scales = [20, 40, 60, 80, 100].map((v) => speedSensitiveSteer(1, v));
    for (let i = 1; i < scales.length; i++) expect(scales[i]!).toBeLessThan(scales[i - 1]!);
    expect(scales[4]!).toBeGreaterThan(0.12);
    expect(speedSensitiveSteer(-0.5, 60)).toBe(-speedSensitiveSteer(0.5, 60));
  });
});
