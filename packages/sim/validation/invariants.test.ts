import { createRng } from '@undercut/core';
import { describe, expect, it } from 'vitest';
import {
  ErsMode,
  FLAT_SURFACE,
  NEUTRAL_INPUT,
  REFERENCE_CAR,
  SurfaceKind,
  beginErsLap,
  createCarParams,
  createCarState,
  createEnvironment,
  gearRatio,
  restoreCar,
  rpmToRad,
  snapshotCar,
  stepCar,
  type CarState,
  type ControlInput,
  type SurfaceSampler,
} from '../src/index';
import { STEP } from './lib/index';

const env = createEnvironment();

function input(over: Partial<ControlInput> = {}): ControlInput {
  return { ...NEUTRAL_INPUT, ...over };
}

/** Random extreme driving: pedals, full-lock flicks, gear and DRS requests, from a seed. */
function fuzzInput(rng: ReturnType<typeof createRng>, inp: ControlInput, tick: number): void {
  if (tick % 12 === 0) {
    inp.steer = rng.next() < 0.3 ? (rng.next() < 0.5 ? -1 : 1) : rng.range(-1, 1);
    inp.throttle = rng.next() < 0.5 ? 1 : rng.next();
    inp.brake = rng.next() < 0.25 ? rng.next() : 0;
    inp.drs = rng.next() < 0.5;
    inp.overtake = rng.next() < 0.3;
    inp.pitLimiter = rng.next() < 0.05;
  }
  inp.gearShift = rng.next() < 0.02 ? (rng.next() < 0.6 ? 1 : -1) : 0;
}

function drive(car: CarState, seed: number, seconds: number, check?: (c: CarState) => void): void {
  const rng = createRng(seed);
  const inp = input();
  const n = Math.round(seconds / STEP);
  for (let i = 0; i < n; i++) {
    fuzzInput(rng, inp, i);
    stepCar(car, inp, FLAT_SURFACE, STEP, env);
    check?.(car);
  }
}

/** A tilted plane: rises `grade` per metre along +X and `bank` per metre along +Z. */
function plane(grade: number, bank: number): SurfaceSampler {
  const len = Math.sqrt(grade * grade + bank * bank + 1);
  return {
    sample(x, z, _hint, out) {
      out.height = grade * x + bank * z;
      out.normalX = -grade / len;
      out.normalY = 1 / len;
      out.normalZ = -bank / len;
      out.grip = 1;
      out.drag = 1;
      out.roughness = 0;
      out.kind = SurfaceKind.Asphalt;
      out.s = Number.NaN;
      out.d = Number.NaN;
    },
  };
}

describe('invariant: determinism', () => {
  it('gives bit-identical state for the same inputs', () => {
    const run = () => {
      const car = createCarState(REFERENCE_CAR, { speed: 10, gear: 2 });
      drive(car, 1234, 20);
      return Array.from(snapshotCar(car));
    };
    expect(run()).toEqual(run());
  });

  it('round-trips through a snapshot mid-run and continues bit for bit', () => {
    const a = createCarState(createCarParams('high'), { speed: 50, gear: 6 });
    drive(a, 7, 5);
    const snap = snapshotCar(a);
    const b = createCarState(createCarParams('high'));
    restoreCar(b, snap);
    drive(a, 8, 5);
    drive(b, 8, 5);
    expect(Array.from(snapshotCar(b))).toEqual(Array.from(snapshotCar(a)));
  });
});

describe('invariant: no NaN or runaway under extreme random input', () => {
  for (const trim of ['low', 'medium', 'high'] as const) {
    for (const seed of [1, 2, 3]) {
      it(`${trim} trim, seed ${seed}, 40 s`, () => {
        const params = createCarParams(trim);
        const car = createCarState(params, { speed: 40 + seed * 10 });
        const limit = rpmToRad(params.engine.revLimit + 300);
        drive(car, seed * 101 + trim.length, 40, (c) => {
          if (!(Math.abs(c.vx) < 110 && Math.abs(c.vy) < 60 && Math.abs(c.yawRate) < 15)) {
            throw new Error(`runaway: vx ${c.vx} vy ${c.vy} r ${c.yawRate}`);
          }
          if (!(Math.abs(c.pitch) < 0.2 && Math.abs(c.roll) < 0.2)) {
            throw new Error(`body angle: pitch ${c.pitch} roll ${c.roll}`);
          }
          if (!(c.engineSpeed <= limit && c.rideHeightFront > -0.05 && c.rideHeightRear > -0.05)) {
            throw new Error(`rpm ${c.engineSpeed} ride ${c.rideHeightFront} ${c.rideHeightRear}`);
          }
          if (!(c.ersStore >= -1e-6 && c.ersStore <= 4e6 + 1e-6)) throw new Error('ERS window');
        });
        for (const v of snapshotCar(car)) expect(Number.isFinite(v)).toBe(true);
      });
    }
  }
});

describe('invariant: energy', () => {
  it('a car at rest stays at rest: no motion, no free ERS energy', () => {
    const car = createCarState(REFERENCE_CAR, { fuel: 50, ersStore: 1e6 });
    const before = snapshotCar(car).slice();
    for (let i = 0; i < 60 / STEP; i++) stepCar(car, NEUTRAL_INPUT, FLAT_SURFACE, STEP, env);
    expect(car.x).toBe(before[0]);
    expect(car.z).toBe(before[1]);
    expect(Math.abs(car.vx)).toBeLessThan(1e-9);
    expect(Math.max(...Array.from(car.wheelSpeed).map(Math.abs))).toBeLessThan(1e-9);
    expect(car.ersStore).toBe(1e6);
    expect(car.distance).toBeLessThan(1e-6);
  });

  it('coasting in neutral only ever loses kinetic energy', () => {
    const car = createCarState(REFERENCE_CAR, { speed: 80, gear: 0, fuel: 50 });
    const I = REFERENCE_CAR.tyre;
    const energy = () => {
      const m = 800 + car.fuelMass;
      let e = 0.5 * m * (car.vx * car.vx + car.vy * car.vy);
      for (let i = 0; i < 4; i++) {
        const j = i < 2 ? I.wheelInertiaFront : I.wheelInertiaRear;
        e += 0.5 * j * car.wheelSpeed[i]! ** 2;
      }
      return e;
    };
    let last = energy();
    for (let k = 0; k < 120; k++) {
      for (let i = 0; i < 60; i++) stepCar(car, NEUTRAL_INPUT, FLAT_SURFACE, STEP, env);
      const e = energy();
      expect(e).toBeLessThan(last);
      last = e;
    }
  });

  it('never exceeds the ERS per-lap limits or the store window over hard laps', () => {
    const car = createCarState(REFERENCE_CAR, { speed: 30, gear: 3, ersMode: ErsMode.Overtake });
    const ers = REFERENCE_CAR.ers;
    const R = REFERENCE_CAR.tyre.rollingRadius;
    const inp = input();
    let maxDeploy = 0;
    let maxHarvest = 0;
    for (let lap = 0; lap < 8; lap++) {
      beginErsLap(car);
      for (let straight = 0; straight < 9; straight++) {
        for (let i = 0; i < 6 / STEP; i++) {
          inp.throttle = 1;
          inp.brake = 0;
          inp.gearShift = car.engineSpeed > rpmToRad(11800) && car.gear < 8 ? 1 : 0;
          stepCar(car, inp, FLAT_SURFACE, STEP, env);
          maxDeploy = Math.max(maxDeploy, car.ersDeployLap);
        }
        for (let i = 0; i < 4 / STEP && car.vx > 25; i++) {
          inp.throttle = 0;
          inp.brake = 0.6;
          const lower = (car.vx / R) * (gearRatio(REFERENCE_CAR, car.gear - 1) || Infinity);
          inp.gearShift = car.gear > 1 && lower < rpmToRad(11000) ? -1 : 0;
          stepCar(car, inp, FLAT_SURFACE, STEP, env);
          maxHarvest = Math.max(maxHarvest, car.ersHarvestLap);
          expect(car.ersStore).toBeLessThanOrEqual(ers.storeWindow + 1e-6);
          expect(car.ersStore).toBeGreaterThanOrEqual(-1e-6);
        }
      }
    }
    expect(maxDeploy).toBeLessThanOrEqual(ers.deployPerLap + 1e-6);
    expect(maxHarvest).toBeLessThanOrEqual(ers.harvestPerLap + 1e-6);
    // The laps were hard enough to use most of both allowances (the MGU-H feeds part of
    // the deployment directly, which does not count against the store limit).
    expect(maxDeploy).toBeGreaterThan(ers.deployPerLap * 0.5);
    expect(maxHarvest).toBeGreaterThan(ers.harvestPerLap * 0.5);
  });
});

describe('invariant: standstill and creep on a sloped, banked surface', () => {
  // 10 % grade and 8 % cross-slope, the steep end of what the circuits have.
  const surface = plane(0.1, 0.08);

  for (const yaw of [0, Math.PI, Math.PI / 2]) {
    it(`holds still on the brake, heading ${((yaw * 180) / Math.PI).toFixed(0)}°`, () => {
      const car = createCarState(REFERENCE_CAR, { yaw, surface });
      const x0 = car.x;
      const z0 = car.z;
      const hold = input({ brake: 0.6 });
      let maxSpeed = 0;
      for (let i = 0; i < 20 / STEP; i++) {
        stepCar(car, hold, surface, STEP, env);
        if (i > 1 / STEP) maxSpeed = Math.max(maxSpeed, Math.hypot(car.vx, car.vy));
      }
      expect(Math.hypot(car.x - x0, car.z - z0)).toBeLessThan(0.01);
      expect(maxSpeed).toBeLessThan(1e-3);
    });
  }

  it('rolls smoothly downhill when the brake is released, without stick-slip', () => {
    const car = createCarState(REFERENCE_CAR, { yaw: 0, surface: plane(0.1, 0) });
    const flat = plane(0.1, 0);
    for (let i = 0; i < 1 / STEP; i++) stepCar(car, input({ brake: 0.6 }), flat, STEP, env);
    let previous = car.vx;
    let reversals = 0;
    for (let i = 0; i < 3 / STEP; i++) {
      stepCar(car, input(), flat, STEP, env);
      if (car.vx > previous + 1e-9) reversals++;
      previous = car.vx;
    }
    // Facing uphill, it rolls backwards: speed falls steadily (more negative), about g·sin.
    expect(car.vx).toBeLessThan(-1.5);
    expect(reversals).toBeLessThan(3);
  });

  it('creeps forward on a little throttle, speed rising steadily from rest', () => {
    const car = createCarState(REFERENCE_CAR, { fuel: 50 });
    let previous = 0;
    let drops = 0;
    for (let i = 0; i < 3 / STEP; i++) {
      stepCar(car, input({ throttle: 0.15 }), FLAT_SURFACE, STEP, env);
      if (car.vx < previous - 1e-6) drops++;
      previous = car.vx;
    }
    expect(car.vx).toBeGreaterThan(0.5);
    expect(car.vx).toBeLessThan(15);
    expect(drops).toBe(0);
  });
});
