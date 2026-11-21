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

/** A car at `speed` m/s sliding with body sideslip `beta` (positive: travelling left of the nose). */
function sliding(speed: number, beta: number, gear = 4): CarState {
  const car = createCarState(REFERENCE_CAR, { speed, gear });
  car.vx = speed * Math.cos(beta);
  car.vy = speed * Math.sin(beta);
  car.slipTan.set([0, 0, -Math.tan(beta), -Math.tan(beta)]);
  return car;
}

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
  it('is off unless asked for, and does nothing while the car is not sliding', () => {
    const car = sliding(50, 10 * DEG);
    const d = driver({ steer: 0.1, throttle: 1, brake: 0 });
    expect(apply(NO_ASSISTS, car, d)).toEqual(d);
    expect(apply({ ...NO_ASSISTS, stability: 0 }, car, d)).toEqual(d);
    const gripping = sliding(50, 1 * DEG);
    expect(apply(STABILITY, gripping, d)).toEqual(d);
  });

  it('steers toward a slide', () => {
    for (const beta of [6 * DEG, -6 * DEG]) {
      const out = apply(STABILITY, sliding(50, beta), driver({ steer: 0 }));
      expect(Math.sign(out.steer)).toBe(Math.sign(beta));
    }
    // More slide, more help, never past full lock.
    const small = apply(STABILITY, sliding(50, 5 * DEG), driver({})).steer;
    const big = apply(STABILITY, sliding(50, 15 * DEG), driver({})).steer;
    expect(big).toBeGreaterThan(small);
    expect(apply(STABILITY, sliding(50, 60 * DEG), driver({ steer: 1 })).steer).toBe(1);
  });

  it('takes drive away from a sliding rear, down to neutral and no further', () => {
    const car = sliding(40, 12 * DEG, 4);
    const out = apply(STABILITY, car, driver({ throttle: 1 }));
    expect(out.throttle).toBeLessThan(0.5);
    expect(out.throttle).toBeCloseTo(neutralThrottle(car), 6);
  });

  it('cancels engine braking on a sliding rear when the driver lifts', () => {
    const car = sliding(40, 12 * DEG, 3);
    const out = apply(STABILITY, car, driver({ throttle: 0 }));
    expect(out.throttle).toBeCloseTo(neutralThrottle(car), 6);
    expect(Math.abs(crankTorque(car, out.throttle))).toBeLessThan(1e-6);
  });

  it('eases the brake while the car slides', () => {
    const out = apply(STABILITY, sliding(40, 8 * DEG), driver({ brake: 1 }));
    expect(out.brake).toBeLessThan(1);
    expect(out.brake).toBeGreaterThan(0);
    // Off the brake pedal, nothing to ease.
    expect(apply(STABILITY, sliding(40, 8 * DEG), driver({})).brake).toBe(0);
  });

  it('holds the automatic gearbox down-shifts while the car slides', () => {
    const settings = { ...STABILITY, autoGears: true };
    const car = sliding(20, 10 * DEG, 6);
    expect(apply(settings, car, driver({ brake: 1 })).gearShift).toBe(0);
    expect(apply(settings, sliding(20, 0, 6), driver({ brake: 1 })).gearShift).toBe(-1);
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
