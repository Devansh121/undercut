import { createRng, type Rng } from '@undercut/core';
import { createCarContacts, resolveCarContacts, type CarContacts } from './car-contact';
import { FLAT_SURFACE, NEUTRAL_INPUT, type ControlInput, type SurfaceSampler } from './contracts';
import { createEnvironment, type Environment } from './environment';
import type { CarParams } from './params';
import { createCarState, type CarStartOptions, type CarState } from './state';
import { stepCar } from './step';
import { createCarPose, readCarPose, type CarPose } from './telemetry';

export interface WorldOptions {
  /** Fixed simulation step in seconds. */
  step: number;
  /** Seed for every random draw the sim makes. */
  seed: number;
  /** Ground the cars drive on. Default: infinite flat asphalt. */
  surface?: SurfaceSampler;
  environment?: Partial<Environment>;
  /** Cars collide with each other (`car-contact.ts`). Default true; false: ghosts. */
  carContact?: boolean;
}

/** One car in the world: its state, the input it receives next step, and its last pose. */
export interface WorldCar {
  readonly id: number;
  readonly state: CarState;
  /** Set by the input layer or an AI driver before each `stepWorld`. */
  readonly input: ControlInput;
  /** Pose before the latest step, for render interpolation with the current pose. */
  readonly previousPose: CarPose;
  readonly pose: CarPose;
  /**
   * A ghost touches no other car (a retired car left where it stopped, which the race rules
   * park out of the race). Set by the session before each `stepWorld`; default false.
   */
  ghost: boolean;
}

/** The simulation state: clock, RNG, surface and every car. */
export interface World {
  readonly step: number;
  /** Number of steps taken since the world was created. */
  tick: number;
  /** Sim time in seconds, always `tick * step` so it never drifts. */
  time: number;
  readonly rng: Rng;
  surface: SurfaceSampler;
  readonly environment: Environment;
  readonly cars: WorldCar[];
  /** Car-to-car contact on or off, and its broad-phase cache and scratch. */
  carContact: boolean;
  readonly contacts: CarContacts;
}

export function createWorld({ step, seed, surface, environment, carContact }: WorldOptions): World {
  if (!(step > 0)) throw new RangeError('step must be > 0');
  return {
    step,
    tick: 0,
    time: 0,
    rng: createRng(seed),
    surface: surface ?? FLAT_SURFACE,
    environment: createEnvironment(environment),
    cars: [],
    carContact: carContact ?? true,
    contacts: createCarContacts(),
  };
}

/** Put a car into the world. Its input starts neutral. */
export function addCar(world: World, params: CarParams, start: CarStartOptions = {}): WorldCar {
  const state = createCarState(params, {
    surface: world.surface,
    airDensity: world.environment.airDensity,
    ...start,
  });
  const pose = readCarPose(state, createCarPose());
  const car: WorldCar = {
    id: world.cars.length,
    state,
    input: { ...NEUTRAL_INPUT },
    previousPose: readCarPose(state, createCarPose()),
    pose,
    ghost: false,
  };
  world.cars.push(car);
  return car;
}

/**
 * Advance the world by exactly one fixed step: every car, in id order, then the contacts
 * between cars (the order of the pairs depends only on the state, so a restored world goes on
 * bit for bit).
 */
export function stepWorld(world: World): void {
  const cars = world.cars;
  for (let i = 0; i < cars.length; i++) {
    const car = cars[i] as WorldCar;
    readCarPose(car.state, car.previousPose);
    stepCar(car.state, car.input, world.surface, world.step, world.environment);
  }
  if (world.carContact) resolveCarContacts(cars, world.contacts);
  for (let i = 0; i < cars.length; i++) {
    const car = cars[i] as WorldCar;
    readCarPose(car.state, car.pose);
  }
  world.tick += 1;
  world.time = world.tick * world.step;
}
