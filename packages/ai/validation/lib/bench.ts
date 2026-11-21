import {
  addCar,
  createCarTelemetry,
  createWorld,
  readCarTelemetry,
  setErsMode,
  stepWorld,
} from '@undercut/sim';
import { TrackSurface } from '@undercut/track';
import { REFERENCE_SKILL, ReferenceDriver } from '../../src/driver/reference';
import { loadEnvelope, loadLine } from './artefacts';
import { MONZA, carFor } from './circuits';
import { planFromRacingLine } from '../../src/reference-setup';

/**
 * A representative track workload for the cost of the vehicle model on a real surface: `cars`
 * cars on the Monza surface, spread evenly round the lap on the committed racing line, each
 * driven by the reference driver (so they stay on the track, over its kerbs and zones, as a
 * field does). Returns the wall time of the world steps alone (the drivers' ticks are timed
 * separately and left out), measured with the caller's clock, and a checksum.
 */
export interface TrackBenchResult {
  cars: number;
  ticks: number;
  /** Wall time of `stepWorld` over all ticks, ms. */
  stepMs: number;
  /** Per 240 Hz world tick, all cars, ms. */
  msPerTick: number;
  checksum: number;
}

export function trackBenchWorkload(
  cars: number,
  seconds: number,
  clock: () => number,
): TrackBenchResult {
  const setup = MONZA;
  const track = setup.track();
  const envelope = loadEnvelope(setup);
  const line = loadLine(setup);
  const plan = planFromRacingLine(track, line, envelope, REFERENCE_SKILL);
  const params = carFor(setup);
  const world = createWorld({
    step: 1 / 240,
    seed: 1,
    surface: new TrackSurface(track),
    environment: { airDensity: setup.airDensity },
  });
  const n = plan.line.count;
  const drivers: ReferenceDriver[] = [];
  for (let k = 0; k < cars; k++) {
    const i = Math.floor((k * n) / cars);
    const car = addCar(world, params, {
      x: plan.line.x[i]!,
      z: plan.line.z[i]!,
      yaw: plan.line.heading[i]!,
      speed: plan.profile.v[i]!,
      fuel: 30,
      airDensity: setup.airDensity,
    });
    const d = new ReferenceDriver({ plan, params, skill: REFERENCE_SKILL, deployBeforeLine: true });
    setErsMode(car.state, d.ersMode);
    drivers.push(d);
  }
  const tel = createCarTelemetry();
  const ticks = Math.round(seconds * 240);
  let stepMs = 0;
  for (let t = 0; t < ticks; t++) {
    for (let k = 0; k < cars; k++) {
      const car = world.cars[k]!;
      readCarTelemetry(car.state, tel);
      drivers[k]!.drive(tel, world.step, car.input);
    }
    const t0 = clock();
    stepWorld(world);
    stepMs += clock() - t0;
  }
  let checksum = 0;
  for (const car of world.cars) checksum += car.state.x + car.state.z;
  return { cars, ticks, stepMs, msPerTick: stepMs / ticks, checksum };
}
