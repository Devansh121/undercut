import { describe, expect, it } from 'vitest';
import {
  CAR_SNAPSHOT_LENGTH,
  ErsMode,
  FLAT_SURFACE,
  NEUTRAL_INPUT,
  REFERENCE_CAR,
  STANDARD_GRAVITY,
  aeroCoefficients,
  applyAssists,
  beginErsLap,
  computeMass,
  createCarModel,
  createCarParams,
  createAssistState,
  createCarState,
  createEnvironment,
  engineFullLoadTorque,
  fuelFlow,
  lateralMu,
  longitudinalMu,
  radToRpm,
  restoreCar,
  rpmToRad,
  setErsMode,
  snapshotCar,
  stepCar,
  type CarState,
  type ControlInput,
  type MassState,
} from '../src/index';

const DT = 1 / 240;
const env = createEnvironment();
const g = STANDARD_GRAVITY;

function run(car: CarState, input: ControlInput, seconds: number): void {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) stepCar(car, input, FLAT_SURFACE, DT, env);
}

const autoGears = { tractionControl: 0, abs: 0, autoGears: true };

/** Drive with the automatic-gearbox assist so the car can use its whole speed range. */
function drive(car: CarState, driver: ControlInput, seconds: number, until = () => false): void {
  const memory = createAssistState();
  const out = input();
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n && !until(); i++) {
    applyAssists(autoGears, memory, car, driver, DT, out);
    stepCar(car, out, FLAT_SURFACE, DT, env);
  }
}

function input(over: Partial<ControlInput> = {}): ControlInput {
  return { ...NEUTRAL_INPUT, ...over };
}

const sum = (a: ArrayLike<number>): number => Array.from(a).reduce((x, y) => x + y, 0);

describe('car parameters', () => {
  it('carry the regulated and documented numbers', () => {
    const p = REFERENCE_CAR;
    expect(p.mass.dryMass).toBe(800);
    expect(p.geometry.wheelbase).toBe(3.6);
    expect(p.gearbox.ratios).toEqual([16.5, 12.4, 10.1, 8.5, 7.3, 6.3, 5.4, 4.6]);
    expect(p.ers.mgukPower).toBe(120e3);
    expect(p.ers.deployPerLap).toBe(4e6);
    expect(p.ers.harvestPerLap).toBe(2e6);
    expect(Object.isFrozen(p.tyre)).toBe(true);
  });

  it('builds each trim from the doc 1.4 table', () => {
    expect(createCarParams('low').aero.clA).toBe(3.6);
    expect(createCarParams('low').aero.cdA).toBe(1.16); // inside 1.05–1.25, fitted to the trap
    expect(createCarParams('medium').aero.clA).toBe(4.6);
    expect(createCarParams('high').aero.balance).toBe(0.45);
    expect(createCarParams('high', { tyre: { muY: 1.9 } }).tyre.muY).toBe(1.9);
  });

  it('moves the weight distribution about one point rearward with 105 kg of fuel (doc 1.1)', () => {
    const model = createCarModel(REFERENCE_CAR);
    const m: MassState = computeMass(model, 0, {} as MassState);
    expect(m.b / REFERENCE_CAR.geometry.wheelbase).toBeCloseTo(0.455, 6);
    computeMass(model, 105, m);
    expect(m.total).toBe(905);
    expect(m.b / REFERENCE_CAR.geometry.wheelbase).toBeCloseTo(0.445, 3);
  });
});

describe('power unit', () => {
  const eng = REFERENCE_CAR.engine;
  const eff = createCarModel(REFERENCE_CAR).iceEfficiency;

  it('follows the regulated fuel-flow law (doc 1.1)', () => {
    expect(fuelFlow(eng, 8000) * 3600).toBeCloseTo(0.009 * 8000 + 5.5, 9);
    expect(fuelFlow(eng, 10500) * 3600).toBeCloseTo(100, 9);
    expect(fuelFlow(eng, 12000) * 3600).toBeCloseTo(100, 9);
  });

  it('makes 560 kW from 10 500 to 11 500 rpm and less above (doc 1.3)', () => {
    const power = (rpm: number) => engineFullLoadTorque(eng, eff, rpm) * rpmToRad(rpm);
    expect(power(10500)).toBeCloseTo(560e3, -2);
    expect(power(11500)).toBeCloseTo(560e3, -2);
    expect(power(12200)).toBeLessThan(540e3);
    expect(power(8000)).toBeLessThan(450e3);
  });

  it('burns 100 kg/h at full throttle above 10 500 rpm', () => {
    const car = createCarState(REFERENCE_CAR, { speed: 66, gear: 6, fuel: 50 });
    run(car, input({ throttle: 1 }), 1);
    expect(radToRpm(car.engineSpeed)).toBeLessThan(12400);
    expect(radToRpm(car.engineSpeed)).toBeGreaterThan(10500);
    // Never above the regulated 100 kg/h, and within 0.1 % of it at full load.
    const burnt = 50 - car.fuelMass;
    expect(burnt).toBeLessThanOrEqual(100 / 3600 + 1e-12);
    expect(burnt).toBeGreaterThan((100 / 3600) * 0.999);
  });

  it('never burns more than the regulated flow at any engine speed', () => {
    for (const [speed, gear] of [
      [30, 3],
      [45, 4],
      [55, 5],
    ] as const) {
      const car = createCarState(REFERENCE_CAR, { speed, gear, fuel: 50 });
      let previous = car.fuelMass;
      for (let i = 0; i < 240; i++) {
        stepCar(car, input({ throttle: 1 }), FLAT_SURFACE, DT, env);
        const limit = fuelFlow(REFERENCE_CAR.engine, radToRpm(car.engineSpeed) + 200);
        expect((previous - car.fuelMass) / DT).toBeLessThanOrEqual(limit + 1e-12);
        previous = car.fuelMass;
      }
    }
  });

  it('burns only idle fuel at rest with the throttle closed', () => {
    const car = createCarState(REFERENCE_CAR, { fuel: 50 });
    run(car, input(), 10);
    expect(50 - car.fuelMass).toBeCloseTo(REFERENCE_CAR.engine.idleFlow * 10, 9);
  });

  it('shifts up in the doc shift time and refuses an over-revving downshift', () => {
    const car = createCarState(REFERENCE_CAR, { speed: 40, gear: 3 });
    stepCar(car, input({ gearShift: 1, throttle: 1 }), FLAT_SURFACE, DT, env);
    expect(car.shiftTimer).toBeGreaterThan(0);
    run(car, input({ throttle: 1 }), 0.03);
    expect(car.gear).toBe(4);
    const fast = createCarState(REFERENCE_CAR, { speed: 80, gear: 8 });
    stepCar(fast, input({ gearShift: -1 }), FLAT_SURFACE, DT, env);
    run(fast, input(), 0.1);
    expect(fast.gear).toBe(7);
    const tooFast = createCarState(REFERENCE_CAR, { speed: 80, gear: 6 });
    stepCar(tooFast, input({ gearShift: -1 }), FLAT_SURFACE, DT, env);
    expect(tooFast.shiftTimer).toBe(0);
    expect(tooFast.gear).toBe(6);
  });

  it('selects reverse only near standstill, through neutral', () => {
    const car = createCarState(REFERENCE_CAR, { gear: 0 });
    stepCar(car, input({ gearShift: -1 }), FLAT_SURFACE, DT, env);
    run(car, input(), 0.1);
    expect(car.gear).toBe(-1);
    run(car, input({ throttle: 0.3 }), 2);
    expect(car.vx).toBeLessThan(-1);
  });
});

describe('brakes', () => {
  it('take their capacity from the hydraulics and discs, not from an operating point', () => {
    const b = REFERENCE_CAR.brakes;
    // Pedal force through the pedal ratio onto the master cylinders; the front share of that
    // pressure on the front pistons, two pad faces at the effective radius, two front wheels,
    // expressed as a total over the bias split.
    const pressurePerBias = (b.pedalForce * b.pedalRatio) / b.masterCylinderArea;
    const front = 2 * 2 * b.padFriction * pressurePerBias * b.frontPistonArea * b.frontRadius;
    const capacity = createCarModel(REFERENCE_CAR).brakeCapacity;
    expect(capacity).toBeCloseTo(front, 6);
    expect(capacity).toBeGreaterThan(17e3);
    expect(capacity).toBeLessThan(19e3);
  });

  it('can lock the tyres at full pedal from 330 km/h in high-downforce trim', () => {
    const car = createCarState(createCarParams('high'), {
      speed: 330 / 3.6,
      fuel: 50,
      ersStore: 4e6,
    });
    let lowest = 0;
    for (let i = 0; i < 0.4 / DT; i++) {
      stepCar(car, input({ brake: 1 }), FLAT_SURFACE, DT, env);
      for (let w = 0; w < 4; w++) lowest = Math.min(lowest, car.slipRatio[w]!);
    }
    // Past the peak at 10 % slip: the tyres, not the brakes, limit the stop.
    expect(lowest).toBeLessThan(-0.3);
  });
});

describe('ERS', () => {
  it('keeps the MGU-K off at a standing start until 100 km/h', () => {
    const car = createCarState(REFERENCE_CAR, { ersMode: ErsMode.Overtake, gear: 2 });
    let deployedBelow = 0;
    for (let i = 0; i < 240 * 4 && car.vx < 100 / 3.6; i++) {
      stepCar(car, input({ throttle: 0.6 }), FLAT_SURFACE, DT, env);
      if (car.vx < 100 / 3.6) deployedBelow = Math.max(deployedBelow, car.mgukPower);
    }
    expect(deployedBelow).toBe(0);
  });

  it('deploys at most 120 kW and stops drawing on the store at 4 MJ per lap', () => {
    const car = createCarState(REFERENCE_CAR, { speed: 60, gear: 6, ersMode: ErsMode.Overtake });
    let peak = 0;
    for (let i = 0; i < 240 * 90; i++) {
      stepCar(car, input({ throttle: 1 }), FLAT_SURFACE, DT, env);
      peak = Math.max(peak, car.mgukPower);
    }
    expect(peak).toBeLessThanOrEqual(120e3 + 1e-6);
    expect(car.ersDeployLap).toBeLessThanOrEqual(4e6 + 1e-6);
    expect(car.ersDeployLap).toBeGreaterThan(3.99e6);
    // The MGU-H keeps feeding the MGU-K directly once the per-lap allowance is used.
    expect(car.mgukPower).toBeGreaterThan(0);
    beginErsLap(car);
    expect(car.ersDeployLap).toBe(0);
  });

  it('deploys on the overtake button where the mode alone would not, within the limits', () => {
    const start = () =>
      createCarState(createCarParams('low'), {
        speed: 310 / 3.6,
        fuel: 10,
        ersMode: ErsMode.Balanced,
        ersStore: 3e6,
      });
    const released = start();
    run(released, input({ throttle: 1 }), 0.1);
    expect(released.mgukPower).toBe(0); // Balanced stops deploying above 300 km/h
    const pressed = start();
    run(pressed, input({ throttle: 1, overtake: true }), 0.1);
    expect(pressed.mgukPower).toBeCloseTo(120e3, 6);
    // With the lap's store allowance used, only the MGU-H's direct feed remains.
    const spent = start();
    spent.ersDeployLap = 4e6;
    run(spent, input({ throttle: 1, overtake: true }), 0.1);
    expect(spent.mgukPower).toBeGreaterThan(0);
    expect(spent.mgukPower).toBeLessThanOrEqual(spent.mguhPower + 1e-6);
    expect(spent.ersDeployLap).toBe(4e6);
  });

  it('sets the deployment mode through the public API', () => {
    const car = createCarState(createCarParams('low'), {
      speed: 310 / 3.6,
      fuel: 10,
      ersStore: 3e6,
    });
    setErsMode(car, ErsMode.Overtake);
    run(car, input({ throttle: 1 }), 0.1);
    expect(car.mgukPower).toBeCloseTo(120e3, 6);
    setErsMode(car, ErsMode.None);
    run(car, input({ throttle: 1, overtake: false }), 0.1);
    expect(car.mgukPower).toBe(0);
    expect(() => setErsMode(car, 7 as ErsMode)).toThrow(RangeError);
  });

  it('brakes the same whether or not the MGU-K can harvest (brake-by-wire)', () => {
    const stop = (store: number) => {
      const car = createCarState(REFERENCE_CAR, { speed: 200 / 3.6, fuel: 50, ersStore: store });
      const decel: number[] = [];
      const regen: number[] = [];
      for (let i = 0; i < 0.6 / DT; i++) {
        stepCar(car, input({ brake: 0.3 }), FLAT_SURFACE, DT, env);
        decel.push(car.accelX);
        regen.push(car.mgukPower);
      }
      return { decel, regen, car };
    };
    const free = stop(2e6); // room to harvest the whole stop
    const full = stop(4e6); // store full: no harvest at all
    const filling = stop(4e6 - 30e3); // the store fills a quarter of a second in
    expect(Math.min(...free.regen)).toBeLessThan(-100e3);
    expect(Math.max(...full.regen.map(Math.abs))).toBe(0);
    expect(filling.regen[10]!).toBeLessThan(-100e3);
    expect(filling.regen[filling.regen.length - 1]!).toBe(0);
    for (let i = 0; i < free.decel.length; i++) {
      expect(Math.abs(full.decel[i]! - free.decel[i]!)).toBeLessThan(0.02 * g);
      expect(Math.abs(filling.decel[i]! - free.decel[i]!)).toBeLessThan(0.02 * g);
    }
  });

  it('harvests under braking up to 2 MJ per lap and never past the store window', () => {
    const car = createCarState(REFERENCE_CAR, { speed: 80, gear: 8, ersStore: 0 });
    for (let lap = 0; lap < 12; lap++) {
      drive(car, input({ throttle: 1 }), 6);
      drive(car, input({ brake: 0.3 }), 6, () => car.vx < 30);
      expect(car.ersHarvestLap).toBeLessThanOrEqual(2e6 + 1e-6);
      expect(car.ersStore).toBeLessThanOrEqual(4e6 + 1e-6);
      expect(car.ersStore).toBeGreaterThanOrEqual(-1e-6);
    }
    expect(car.ersHarvestLap).toBeGreaterThan(1.99e6);
  });
});

describe('aero', () => {
  const out = { front: 0, rear: 0, drag: 0 };
  it('gives the table values at the reference ride height and rake', () => {
    for (const trim of ['low', 'medium', 'high'] as const) {
      const a = createCarParams(trim).aero;
      // Front-weighted height h0 with rear − front = reference rake.
      const front = a.referenceHeight - (1 - a.frontHeightWeight) * a.referenceRake;
      aeroCoefficients(a, front, front + a.referenceRake, 0, out);
      expect(out.front + out.rear).toBeCloseTo(a.clA, 9);
      expect(out.drag).toBeCloseTo(a.cdA, 9);
      expect(out.front / (out.front + out.rear)).toBeCloseTo(a.balance, 9);
    }
  });

  it('opens DRS: less drag, less rear downforce, front unchanged', () => {
    const a = createCarParams('low').aero;
    const closed = { ...aeroCoefficients(a, 0.012, 0.042, 0, out) };
    const open = aeroCoefficients(a, 0.012, 0.042, 1, { front: 0, rear: 0, drag: 0 });
    expect(open.drag / closed.drag).toBeCloseTo(1 + a.drsDrag, 9);
    expect(open.front).toBe(closed.front);
    expect(open.rear).toBeLessThan(closed.rear);
  });

  it('gains downforce as the floor drops, then stalls smoothly below the critical height', () => {
    const a = createCarParams('medium').aero;
    const total = (front: number) => {
      aeroCoefficients(a, front, front + 0.03, 0, out);
      return out.front + out.rear;
    };
    expect(total(0.015)).toBeGreaterThan(total(0.025));
    const edge = (front: number) => front + a.leadingEdge * 0.03;
    let previous = total(0.03);
    let biggestStep = 0;
    for (let h = 0.03; h > -0.005; h -= 0.0001) {
      const v = total(h);
      biggestStep = Math.max(biggestStep, Math.abs(v - previous));
      previous = v;
    }
    // Continuous: no step anywhere near the size of the stall loss itself.
    expect(biggestStep).toBeLessThan(0.05 * a.stallLoss * a.clA);
    // Below the stall the floor loses `stallLoss` of what the height trend would give.
    const deep = a.stallHeight - a.leadingEdge * 0.03 - a.stallWidth - 0.001;
    const noStall = { ...a, stallLoss: 0 };
    aeroCoefficients(noStall, deep, deep + 0.03, 0, out);
    const trend = out.front + out.rear;
    expect(total(deep) / trend).toBeCloseTo(1 - a.stallLoss, 9);
    expect(edge(a.stallHeight - a.leadingEdge * 0.03)).toBeCloseTo(a.stallHeight, 9);
  });

  it('moves only the floor share of the downforce and its drag with the floor height', () => {
    const a = createCarParams('low').aero;
    expect(a.floorShare).toBeGreaterThan(0);
    expect(a.floorShare).toBeLessThan(1);
    const allFloor = { ...a, floorShare: 1 };
    const rake = a.referenceRake;
    for (const front of [0.022, 0.026, 0.03, 0.036]) {
      const f = { ...aeroCoefficients(a, front, front + rake, 0, out) };
      const w = aeroCoefficients(allFloor, front, front + rake, 0, { front: 0, rear: 0, drag: 0 });
      expect(f.front + f.rear - a.clA).toBeCloseTo(a.floorShare * (w.front + w.rear - a.clA), 9);
      expect(f.drag - a.cdA).toBeCloseTo(a.floorShare * (w.drag - a.cdA), 9);
    }
  });

  it('opens the DRS flap over its transient and closes it on the brake until released', () => {
    const car = createCarState(createCarParams('low'), { speed: 80, gear: 8 });
    run(car, input({ throttle: 1, drs: true }), 0.1);
    expect(car.drsPosition).toBeGreaterThan(0.4);
    expect(car.drsPosition).toBeLessThan(0.6);
    run(car, input({ throttle: 1, drs: true }), 0.2);
    expect(car.drsPosition).toBe(1);
    run(car, input({ brake: 0.5, drs: true }), 0.2);
    expect(car.drsPosition).toBe(0);
    run(car, input({ throttle: 1, drs: true }), 0.3);
    expect(car.drsPosition).toBe(0);
    run(car, input({ throttle: 1 }), DT);
    run(car, input({ throttle: 1, drs: true }), 0.3);
    expect(car.drsPosition).toBe(1);
  });
});

describe('chassis and suspension', () => {
  it('starts in static equilibrium: loads carry the weight, ride heights as set', () => {
    const car = createCarState(REFERENCE_CAR, { fuel: 0 });
    expect(sum(car.load)).toBeCloseTo(800 * g, 6);
    expect(car.rideHeightFront).toBeCloseTo(REFERENCE_CAR.aero.rideHeightFront, 9);
    expect(car.rideHeightRear).toBeCloseTo(REFERENCE_CAR.aero.rideHeightRear, 9);
    run(car, input(), 1);
    expect(sum(car.load)).toBeCloseTo(800 * g, 3);
    expect(car.x).toBe(0);
    expect(car.vx).toBe(0);
  });

  it('transfers load forward under braking and outward in a turn, through the springs', () => {
    const car = createCarState(REFERENCE_CAR, { speed: 50, gear: 6, fuel: 50 });
    run(car, input({ throttle: 0.4 }), 1);
    const frontShare = () => (car.load[0]! + car.load[1]!) / sum(car.load);
    const cruise = frontShare();
    run(car, input({ brake: 0.6 }), 0.5);
    expect(frontShare()).toBeGreaterThan(cruise + 0.08);
    expect(car.pitch).toBeLessThan(0);
    expect(car.travel[0]!).toBeGreaterThan(0);

    const turn = createCarState(REFERENCE_CAR, { speed: 40, gear: 5, fuel: 50 });
    run(turn, input({ throttle: 0.4, steer: 0.1 }), 2);
    expect(turn.yawRate).toBeGreaterThan(0);
    expect(turn.accelY).toBeGreaterThan(1.5 * g);
    // A left turn loads the right-hand wheels and rolls the body right side down.
    expect(turn.load[1]! + turn.load[3]!).toBeGreaterThan(1.5 * (turn.load[0]! + turn.load[2]!));
    expect(turn.roll).toBeGreaterThan(0);
  });

  // Whole-car equilibrium with aero and rolling resistance off: the overturning moment of the
  // ground forces about the CoG height, h·ΣF, must come back as load transfer, all of it.
  const noAero = createCarParams('medium', {
    aero: { clA: 0, cdA: 0 },
    tyre: { rollingResistance: 0 },
  });
  const h = noAero.mass.cgHeight;
  const L = noAero.geometry.wheelbase;

  it('transfers exactly ΣFx·h/L between the axles under braking', () => {
    const rest = createCarState(noAero, { fuel: 50 });
    const staticFront = rest.load[0]! + rest.load[1]!;
    const car = createCarState(noAero, { speed: 40, gear: 5, fuel: 50 });
    run(car, input({ brake: 0.3 }), 0.8);
    const fx = 850 * car.accelX;
    expect(fx).toBeLessThan(-8000);
    const transfer = car.load[0]! + car.load[1]! - staticFront;
    expect(transfer / ((-fx * h) / L)).toBeCloseTo(1, 2);
  });

  it('transfers exactly ΣFy·h across the car in a steady corner', () => {
    const car = createCarState(noAero, { speed: 20, gear: 2, fuel: 50 });
    for (let i = 0; i < 3 / DT; i++) {
      const throttle = Math.min(1, Math.max(0, 0.3 + 0.5 * (20 - car.vx)));
      stepCar(car, input({ steer: 0.3, throttle }), FLAT_SURFACE, DT, env);
    }
    const fy = 850 * car.accelY;
    expect(fy).toBeGreaterThan(8000);
    let moment = 0;
    for (let i = 0; i < 4; i++) moment += car.load[i]! * car.model.wheelLeft[i]!;
    expect(-moment / (fy * h)).toBeCloseTo(1, 2);
  });

  it('compresses onto the springs as downforce builds', () => {
    const car = createCarState(REFERENCE_CAR, { speed: 30, gear: 4, fuel: 50 });
    const slow = car.rideHeightFront;
    drive(car, input({ throttle: 1 }), 8);
    expect(car.vx).toBeGreaterThan(70);
    expect(car.rideHeightFront).toBeLessThan(slow - 0.008);
    expect(car.downforceFront + car.downforceRear).toBeGreaterThan(15e3);
  });
});

describe('tyre force limit at low speed', () => {
  const curve = createCarModel(REFERENCE_CAR).curve;
  const ellipse = (car: CarState, i: number) => {
    const fz = car.load[i]!;
    if (fz <= 0) return 0;
    const dy = lateralMu(curve, fz) * fz * car.gripScale[i]!;
    const dx = longitudinalMu(curve, fz) * fz * car.gripScale[i]!;
    return (car.forceX[i]! / dx) ** 2 + (car.forceY[i]! / dy) ** 2;
  };

  for (const [vx, vy] of [
    [0.5, 0.5],
    [1, -1],
    [0.2, 0.3],
    [0, 0.5],
    [-0.5, 0.4],
    [3, 2],
    [0, 0],
  ] as const) {
    it(`keeps every tyre inside its friction ellipse sliding at (${vx}, ${vy}) m/s`, () => {
      const car = createCarState(REFERENCE_CAR, { fuel: 50 });
      car.vx = vx;
      car.vy = vy;
      car.wheelSpeed.fill(0);
      for (let k = 0; k < 48; k++) {
        stepCar(car, input({ brake: 1 }), FLAT_SURFACE, 1 / 960, env);
        for (let i = 0; i < 4; i++) expect(ellipse(car, i)).toBeLessThanOrEqual(1 + 1e-9);
      }
    });
  }

  // With no grip there is no friction to bound the low-speed carcass damping by: the tyre must
  // pass no tangential force at all, in pure longitudinal, pure lateral and combined slip.
  for (const [what, vx, vy] of [
    ['pure longitudinal', 0.5, 0],
    ['pure lateral', 0, 0.5],
    ['combined', 0.5, 0.4],
  ] as const) {
    it(`passes no tyre force with zero grip, ${what} sliding at (${vx}, ${vy}) m/s`, () => {
      const car = createCarState(REFERENCE_CAR, { fuel: 50 });
      car.gripScale.fill(0);
      car.vx = vx;
      car.vy = vy;
      car.wheelSpeed.fill(0);
      for (let k = 0; k < 8; k++) {
        stepCar(car, input({ brake: 1 }), FLAT_SURFACE, 1 / 960, env);
        for (let i = 0; i < 4; i++) {
          expect(car.load[i]!).toBeGreaterThan(0);
          expect(Math.abs(car.forceX[i]!)).toBe(0);
          expect(Math.abs(car.forceY[i]!)).toBe(0);
        }
      }
      // Only aero drag acts (well under a newton at walking pace).
      expect(car.vx).toBeCloseTo(vx, 4);
      expect(car.vy).toBeCloseTo(vy, 4);
    });
  }
});

describe('snapshots', () => {
  it('round-trips every number, so a restored car continues bit for bit', () => {
    const a = createCarState(REFERENCE_CAR, { speed: 30, gear: 4 });
    const drive = input({ throttle: 0.8, steer: 0.2, drs: true });
    run(a, drive, 1);
    const snap = snapshotCar(a);
    expect(snap.length).toBe(CAR_SNAPSHOT_LENGTH);
    const b = createCarState(REFERENCE_CAR);
    restoreCar(b, snap);
    expect(snapshotCar(b)).toEqual(snap);
    run(a, drive, 2);
    run(b, drive, 2);
    expect(Array.from(snapshotCar(b))).toEqual(Array.from(snapshotCar(a)));
  });
});
