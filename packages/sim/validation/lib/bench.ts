import { REFERENCE_CAR, addCar, createWorld, stepWorld } from '../../src/index';
import { STEP } from './harness';

/**
 * Benchmark workload: `cars` cars in one world at the game's 240 Hz step, driven with varying
 * throttle, brake and steering so every code path runs (launch, shifts, ERS, cornering,
 * braking). Returns the simulated seconds and a checksum so the work cannot be optimised away.
 * The caller times it; the sim itself never reads a clock.
 */
export function benchWorkload(
  cars: number,
  seconds: number,
): { simSeconds: number; checksum: number } {
  const world = createWorld({ step: STEP, seed: 42 });
  for (let i = 0; i < cars; i++) addCar(world, REFERENCE_CAR, { z: i * 8, speed: 20, gear: 2 });
  const steps = Math.round(seconds / STEP);
  for (let k = 0; k < steps; k++) {
    const t = k * STEP;
    const phase = t % 12;
    for (const car of world.cars) {
      const inp = car.input;
      inp.steer = 0.15 * Math.sin(t * 0.7 + car.id);
      inp.throttle = phase < 8 ? 1 : 0;
      inp.brake = phase >= 8 && phase < 10 ? 0.7 : 0;
      const rpm = (car.state.engineSpeed * 60) / (2 * Math.PI);
      inp.gearShift =
        phase < 8 && rpm > 11800 && car.state.gear < 8
          ? 1
          : phase >= 8 && rpm < 9000 && car.state.gear > 1
            ? -1
            : 0;
    }
    stepWorld(world);
  }
  let checksum = 0;
  for (const car of world.cars) checksum += car.state.x + car.state.vx;
  return { simSeconds: steps * STEP, checksum };
}
