import { describe, expect, it } from 'vitest';
import {
  COMPOUNDS,
  FLAT_SURFACE,
  NEUTRAL_INPUT,
  REFERENCE_CAR,
  TYRE_THERMAL,
  compoundIndex,
  createCarState,
  createEnvironment,
  fitTyres,
  restoreCar,
  snapshotCar,
  stepCar,
  temperatureGrip,
  tyreGrip,
  wearGrip,
  type CarState,
  type ControlInput,
} from '../src/index';

const DT = 1 / 240;
const env = createEnvironment();
const K = 273.15;
const [SOFT, MEDIUM, HARD] = COMPOUNDS as [
  (typeof COMPOUNDS)[number],
  (typeof COMPOUNDS)[number],
  (typeof COMPOUNDS)[number],
];

function run(car: CarState, input: ControlInput, seconds: number): void {
  for (let i = 0, n = Math.round(seconds / DT); i < n; i++) {
    stepCar(car, input, FLAT_SURFACE, DT, env);
  }
}

/** A steady left-hand circle at about 40 m/s, sliding the tyres a little. */
const CIRCLE: ControlInput = { ...NEUTRAL_INPUT, throttle: 0.35, steer: 0.18 };

describe('tyre grip factor', () => {
  it('is exactly 1 for the reference compound, new, inside its window', () => {
    for (const t of [SOFT.windowLow, (SOFT.windowLow + SOFT.windowHigh) / 2, SOFT.windowHigh]) {
      expect(tyreGrip(SOFT, t, 0)).toBe(1);
    }
  });

  it('orders the compounds soft, medium, hard at their best', () => {
    const best = (c: typeof SOFT) => tyreGrip(c, (c.windowLow + c.windowHigh) / 2, 0);
    expect(best(SOFT)).toBeGreaterThan(best(MEDIUM));
    expect(best(MEDIUM)).toBeGreaterThan(best(HARD));
    // Harder compounds work hotter.
    expect(HARD.windowLow).toBeGreaterThan(SOFT.windowLow);
  });

  it('falls either side of the window, continuously, to a floor', () => {
    expect(temperatureGrip(SOFT, SOFT.windowLow - 1e-9)).toBeCloseTo(1, 6);
    expect(temperatureGrip(SOFT, SOFT.windowHigh + 1e-9)).toBeCloseTo(1, 6);
    // Doc 4.2: −1 % per 5 °C above the window.
    expect(temperatureGrip(SOFT, SOFT.windowHigh + 5)).toBeCloseTo(0.99, 9);
    // Cold costs more than hot, per kelvin (estimate).
    expect(temperatureGrip(SOFT, SOFT.windowLow - 5)).toBeLessThan(0.99);
    expect(temperatureGrip(SOFT, K - 50)).toBe(TYRE_THERMAL.tempGripFloor);
  });

  it('falls with wear, clamped to the tread', () => {
    expect(wearGrip(0)).toBe(1);
    expect(wearGrip(0.5)).toBeCloseTo(1 - TYRE_THERMAL.wearGripLoss / 2, 12);
    expect(wearGrip(2)).toBe(wearGrip(1));
    expect(wearGrip(-1)).toBe(1);
  });
});

describe('fitting a set', () => {
  it('turns the model on with the compound, blanket temperature and no wear', () => {
    const car = createCarState(REFERENCE_CAR);
    expect(car.tyreCompound).toBe(-1);
    fitTyres(car, 'medium');
    expect(car.tyreCompound).toBe(compoundIndex('medium'));
    expect(Array.from(car.tyreTemp)).toEqual([0, 1, 2, 3].map(() => K + 70));
    expect(Array.from(car.tyreWear)).toEqual([0, 0, 0, 0]);
    // Off the blankets the medium is below its window: less than its best grip.
    expect(car.gripScale[0]).toBeLessThan(MEDIUM.grip);
    expect(car.gripScale[0]).toBeCloseTo(tyreGrip(MEDIUM, K + 70, 0), 12);
  });

  it('refuses a compound it does not know', () => {
    const car = createCarState(REFERENCE_CAR);
    expect(() => fitTyres(car, 'wet' as 'soft')).toThrow(/unknown compound/);
  });
});

describe('a car with no compound fitted', () => {
  it('keeps its grip and leaves the tyre state alone', () => {
    const car = createCarState(REFERENCE_CAR, { speed: 40 });
    run(car, CIRCLE, 5);
    expect(Array.from(car.gripScale)).toEqual([1, 1, 1, 1]);
    expect(Array.from(car.tyreTemp)).toEqual([0, 0, 0, 0]);
    expect(Array.from(car.tyreWear)).toEqual([0, 0, 0, 0]);
  });
});

describe('temperature and wear on the move', () => {
  it('warms tyres from the air temperature as the car corners, and wears them', () => {
    const car = createCarState(REFERENCE_CAR, { speed: 40 });
    fitTyres(car, 'soft', { temperature: K + 25, ambient: K + 25 });
    run(car, CIRCLE, 20);
    for (let i = 0; i < 4; i++) {
      expect(car.tyreTemp[i]).toBeGreaterThan(K + 25);
      expect(car.tyreWear[i]).toBeGreaterThan(0);
      expect(car.gripScale[i]).toBeCloseTo(tyreGrip(SOFT, car.tyreTemp[i]!, car.tyreWear[i]!), 12);
    }
    // Cornering left loads the right-hand tyres: they run hotter.
    expect(car.tyreTemp[1]).toBeGreaterThan(car.tyreTemp[0]!);
  });

  it('cools towards the air standing still, and never wears there', () => {
    const car = createCarState(REFERENCE_CAR);
    fitTyres(car, 'hard', { temperature: K + 110, ambient: K + 25 });
    run(car, { ...NEUTRAL_INPUT, brake: 1 }, 60);
    for (let i = 0; i < 4; i++) {
      expect(car.tyreTemp[i]).toBeLessThan(K + 110);
      expect(car.tyreTemp[i]).toBeGreaterThan(K + 25);
      expect(car.tyreWear[i]).toBe(0);
    }
  });

  it('is deterministic, and a restored snapshot continues bit-identically', () => {
    const a = createCarState(REFERENCE_CAR, { speed: 40 });
    const b = createCarState(REFERENCE_CAR, { speed: 40 });
    fitTyres(a, 'medium');
    fitTyres(b, 'medium');
    run(a, CIRCLE, 3);
    run(b, CIRCLE, 3);
    const mid = snapshotCar(a);
    expect(Array.from(snapshotCar(b))).toEqual(Array.from(mid));
    run(a, CIRCLE, 3);
    const c = createCarState(REFERENCE_CAR);
    restoreCar(c, mid);
    expect(c.tyreCompound).toBe(compoundIndex('medium'));
    run(c, CIRCLE, 3);
    expect(Array.from(snapshotCar(c))).toEqual(Array.from(snapshotCar(a)));
  });
});
