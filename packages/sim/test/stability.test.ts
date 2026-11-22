import { describe, expect, it } from 'vitest';
import {
  FLAT_SURFACE,
  NEUTRAL_INPUT,
  NO_ASSISTS,
  REFERENCE_CAR,
  applyAssists,
  createAssistState,
  createCarState,
  createEnvironment,
  engineFullLoadTorque,
  neutralThrottle,
  snapshotCar,
  stepCar,
  type AssistSettings,
  type CarState,
  type ControlInput,
} from '../src/index';

const DT = 1 / 240;
const DEG = Math.PI / 180;

function driver(over: Partial<ControlInput>): ControlInput {
  return { ...NEUTRAL_INPUT, ...over };
}

const STABILITY: AssistSettings = { tractionControl: 0, abs: 0, autoGears: false, stability: 1 };

function apply(settings: AssistSettings, car: CarState, d: ControlInput): ControlInput {
  return applyAssists(settings, createAssistState(), car, d, DT, driver({}));
}

/** Net crank torque the engine makes at this throttle and the car's engine speed, N·m. */
function crankTorque(car: CarState, throttle: number): number {
  const eng = car.model.params.engine;
  const rpm = (car.engineSpeed * 60) / (2 * Math.PI);
  const wot = engineFullLoadTorque(eng, car.model.iceEfficiency, rpm);
  const drag = eng.dragTorqueBase + eng.dragTorquePerRpm * rpm;
  return throttle * wot - (1 - throttle) * drag;
}

describe('neutral throttle', () => {
  it('is the throttle at which the engine neither drives nor brakes', () => {
    for (const [speed, gear] of [
      [20, 2],
      [50, 5],
      [80, 8],
    ] as const) {
      const car = createCarState(REFERENCE_CAR, { speed, gear });
      const t = neutralThrottle(car);
      expect(t).toBeGreaterThan(0);
      expect(t).toBeLessThan(0.3);
      expect(Math.abs(crankTorque(car, t))).toBeLessThan(1e-6);
    }
  });
});

describe('traction control', () => {
  it('cuts drive, never adds engine braking on the driven wheels', () => {
    const car = createCarState(REFERENCE_CAR, { speed: 25, gear: 2 });
    car.slipRatio.set([0, 0, 0.5, 0.5]);
    const memory = createAssistState();
    const out = driver({});
    const settings = { tractionControl: 3, abs: 0, autoGears: false };
    for (let i = 0; i < 240; i++)
      applyAssists(settings, memory, car, driver({ throttle: 1 }), DT, out);
    expect(out.throttle).toBeLessThan(0.3);
    expect(crankTorque(car, out.throttle)).toBeGreaterThanOrEqual(-1e-6);
  });

  it('leaves a lifted throttle alone (the driver may engine-brake)', () => {
    const car = createCarState(REFERENCE_CAR, { speed: 25, gear: 2 });
    car.slipRatio.set([0, 0, 0.5, 0.5]);
    const out = apply(
      { tractionControl: 3, abs: 0, autoGears: false },
      car,
      driver({ throttle: 0.02 }),
    );
    expect(out.throttle).toBe(0.02);
  });
});

describe('stability assist', () => {
  /**
   * A car at `speed` m/s turning at `yawRate` rad/s (positive: left), with its rear (`at:
   * 'rear'`) or front tyres at their peak slip angle, or neither.
   */
  function turning(
    speed: number,
    yawRate: number,
    gear = 4,
    at: 'rear' | 'front' | 'none' = 'rear',
  ): CarState {
    const car = createCarState(REFERENCE_CAR, { speed, gear });
    car.yawRate = yawRate;
    const peak = car.model.curve.peakSlipTan * 1.05;
    if (at === 'rear') car.slipTan.set([0, 0, peak, peak]);
    if (at === 'front') car.slipTan.set([peak, peak, 0, 0]);
    return car;
  }
  /** Run the assists `ticks` times on a frozen car and return the last output. */
  function hold(
    settings: AssistSettings,
    car: CarState,
    d: ControlInput,
    ticks = 60,
    ref = car.yawRate,
  ): ControlInput {
    const memory = createAssistState();
    memory.refYaw = ref;
    const out = driver({});
    for (let k = 0; k < ticks; k++) applyAssists(settings, memory, car, d, DT, out);
    return out;
  }

  it('is off unless asked for, and leaves a car turning as asked alone', () => {
    const car = turning(50, 0.8);
    const d = driver({ steer: 0.02, throttle: 1 });
    const off = hold(NO_ASSISTS, car, d);
    expect(off.wheelBrake).toBeUndefined();
    expect(off.throttle).toBe(1);
    // Steer asking for exactly the yaw rate the car has: nothing to correct.
    const p = car.model.params;
    const asked = (0.4 * p.geometry.wheelbase) / (40 * p.geometry.maxSteerAngle);
    const on = hold(STABILITY, turning(40, 0.4), driver({ steer: asked, throttle: 1 }));
    expect(on.wheelBrake).toBeUndefined();
    expect(on.throttle).toBe(1);
  });

  it('never touches the steering and never eases the brake', () => {
    for (const [r, steer, brake] of [
      [1.2, 0, 1],
      [-1.2, 0.2, 0.6],
      [0, 0.3, 0.8],
    ] as const) {
      const out = hold(STABILITY, turning(45, r), driver({ steer, brake }));
      expect(out.steer).toBe(steer);
      expect(out.brake).toBe(brake);
    }
  });

  it('brakes the outer front wheel when the car rotates more than the steering asks', () => {
    const left = hold(STABILITY, turning(50, 0.9), driver({ steer: 0 }));
    expect(left.wheelBrake?.[1]).toBeGreaterThan(0.2);
    expect(left.wheelBrake?.[0]).toBe(0);
    expect(left.wheelBrake?.[2]).toBe(0);
    expect(left.wheelBrake?.[3]).toBe(0);
    const right = hold(STABILITY, turning(50, -0.9), driver({ steer: 0 }));
    expect(right.wheelBrake?.[0]).toBeGreaterThan(0.2);
    expect(right.wheelBrake?.[1]).toBe(0);
  });

  it('brakes the inner rear wheel when the car turns less than the steering asks', () => {
    const left = hold(STABILITY, turning(30, 0.05, 4, 'front'), driver({ steer: 0.3 }), 120);
    expect(left.wheelBrake?.[2]).toBeGreaterThan(0.05);
    expect(left.wheelBrake?.[0]).toBe(0);
    expect(left.wheelBrake?.[1]).toBe(0);
    const right = hold(STABILITY, turning(30, -0.05, 4, 'front'), driver({ steer: -0.3 }), 120);
    expect(right.wheelBrake?.[3]).toBeGreaterThan(0.05);
  });

  it('takes drive away in oversteer, down to neutral and no further', () => {
    const car = turning(40, 1.2, 4);
    const out = hold(STABILITY, car, driver({ throttle: 1 }));
    expect(out.throttle).toBeCloseTo(neutralThrottle(car), 6);
  });

  it('cancels engine braking on the rear in oversteer when the driver lifts', () => {
    const car = turning(40, 1.2, 3);
    const out = hold(STABILITY, car, driver({ throttle: 0 }));
    expect(out.throttle).toBeCloseTo(neutralThrottle(car), 6);
    expect(Math.abs(crankTorque(car, out.throttle))).toBeLessThan(1e-6);
  });

  it('holds the automatic gearbox down-shifts while it corrects oversteer', () => {
    const settings = { ...STABILITY, autoGears: true };
    expect(hold(settings, turning(20, 1.5, 6), driver({ brake: 1 }), 1, 0).gearShift).toBe(0);
    expect(hold(settings, turning(20, 0, 6), driver({ brake: 1 }), 1, 0).gearShift).toBe(-1);
  });

  it('leaves an axle that still has grip alone', () => {
    // Rotating faster than the (released) steering asks, rear tyres well inside their grip:
    // the car is turning, not sliding.
    const out = hold(STABILITY, turning(50, 0.5, 6, 'none'), driver({ throttle: 1 }));
    expect(out.wheelBrake).toBeUndefined();
    expect(out.throttle).toBe(1);
  });

  it('drops its brake on a rear wheel that would lock, keeps it on a locking outer front', () => {
    // Understeer to the left: the inner rear (RL) is the target; locked, it gets nothing.
    const under = turning(30, 0.05, 4, 'front');
    under.slipRatio[2] = -0.5;
    expect(hold(STABILITY, under, driver({ steer: 0.3 }), 120).wheelBrake).toBeUndefined();
    // Oversteer to the left on grass: the outer front (FR) locks at once and keeps braking.
    const over = turning(50, 0.9);
    over.slipRatio[1] = -0.5;
    expect(hold(STABILITY, over, driver({})).wheelBrake?.[1]).toBeGreaterThan(0.2);
  });

  it('a car with no per-wheel brake is bit for bit the car without the field', () => {
    // Absent, undefined and all zeros: the same arithmetic, so the unassisted car is unchanged.
    const run = (extra: Partial<ControlInput>): number[] => {
      const env = createEnvironment();
      const car = createCarState(REFERENCE_CAR, { speed: 60, gear: 7, fuel: 20 });
      for (let k = 0; k < 480; k++) {
        const t = k * DT;
        const d = driver({
          steer: 0.05 * Math.sin(t * 3),
          throttle: t < 1 ? 1 : 0,
          brake: t < 1 ? 0 : 0.8,
          ...extra,
        });
        stepCar(car, d, FLAT_SURFACE, DT, env);
      }
      return Array.from(snapshotCar(car));
    };
    const absent = run({});
    expect(run({ wheelBrake: undefined })).toEqual(absent);
    expect(run({ wheelBrake: new Float64Array(4) })).toEqual(absent);
  });

  it('a braked front wheel turns the car toward its side', () => {
    const env = createEnvironment();
    const car = createCarState(REFERENCE_CAR, { speed: 50, gear: 6, fuel: 20 });
    const wheelBrake = new Float64Array([0, 0.4, 0, 0]);
    const d = driver({ throttle: 0.3, wheelBrake });
    for (let k = 0; k < 120; k++) stepCar(car, d, FLAT_SURFACE, DT, env);
    expect(car.yawRate).toBeLessThan(-0.02);
  });

  it('catches repeated steering reversals at speed that spin the car without it', () => {
    // 198 km/h on a flat pad, then repeated digital steering reversals and a lift.
    const run = (settings: AssistSettings): number => {
      const env = createEnvironment();
      const car = createCarState(REFERENCE_CAR, { speed: 55, gear: 5, fuel: 20 });
      const memory = createAssistState();
      const out = driver({});
      let worst = 0;
      for (let i = 0; i < 240 * 4; i++) {
        const t = i * DT;
        const d = driver({
          steer: t < 1 ? 0.04 : 0.3 * Math.sign(Math.sin(((t - 1) * Math.PI) / 0.3)),
          throttle: t < 1 ? 0.6 : 0,
        });
        applyAssists(settings, memory, car, d, DT, out);
        stepCar(car, out, FLAT_SURFACE, DT, env);
        worst = Math.max(worst, Math.abs(Math.atan2(car.vy, Math.max(Math.abs(car.vx), 1))));
      }
      return worst / DEG;
    };
    const off = run(NO_ASSISTS);
    const on = run(STABILITY);
    expect(off).toBeGreaterThan(30);
    expect(on).toBeLessThan(12);
  });
});
