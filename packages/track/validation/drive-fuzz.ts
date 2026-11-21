import { createRng } from '@undercut/core';
import {
  addCar,
  bodyCorners,
  checkCarInvariants,
  createCarParams,
  createWallSample,
  createWorld,
  invariantLimits,
  stepWorld,
  type AeroTrim,
} from '@undercut/sim';
import { createVec3 } from '../src/path';
import { TrackSurface } from '../src/surface';
import type { Track } from '../src/track';

export const STEP = 1 / 240;

export interface FuzzResult {
  seed: number;
  /** First invariant broken, with the sim time, or null. */
  failure: string | null;
  /** Deepest any body corner ended a step behind a barrier, m. */
  deepest: number;
  /** Barrier contacts (steps with a corner touching) and the hardest impact, m/s. */
  wallSteps: number;
  maxImpact: number;
  /** The contact's last line of defence: must stay zero on a continuous track. */
  groundSteps: number;
  contactLifts: number;
  /** Highest floor above the ground, m, and the sim time driven. */
  maxRide: number;
  seconds: number;
}

/**
 * Random driving on a real circuit: a random start point round the lap (anywhere across the
 * track, heading roughly along it, at a random speed), then random steer, throttle and brake,
 * each held for a random time, with random gear requests. Every step the car's pose is checked
 * against the invariants and its body corners against the barriers.
 */
export function driveFuzz(track: Track, seed: number, seconds: number): FuzzResult {
  const rng = createRng(seed);
  const surface = new TrackSurface(track);
  const trims: readonly AeroTrim[] = ['low', 'medium', 'high'];
  const params = createCarParams(trims[seed % 3]!);
  const world = createWorld({ step: STEP, seed, surface });
  const s0 = rng.range(0, track.length);
  const i0 = track.lap.sampleIndex(s0);
  const d0 = rng.range(-track.halfWidth[1][i0]! + 1, track.halfWidth[0][i0]! - 1);
  const p = createVec3();
  const t = createVec3();
  track.lap.pointAt(s0, d0, p);
  track.lap.tangent(s0, t);
  const car = addCar(world, params, {
    x: p.x,
    z: p.z,
    yaw: Math.atan2(-t.z, t.x) + rng.range(-0.3, 0.3),
    speed: rng.range(5, 80),
    fuel: rng.range(5, 100),
  });
  const limits = invariantLimits(car.state.model);
  const corners = new Float64Array(8);
  const wall = createWallSample();
  const hints = [{ index: -1 }, { index: -1 }, { index: -1 }, { index: -1 }];
  const inp = car.input;
  let hold = 0;
  const r: FuzzResult = {
    seed,
    failure: null,
    deepest: -Infinity,
    wallSteps: 0,
    maxImpact: 0,
    groundSteps: 0,
    contactLifts: 0,
    maxRide: 0,
    seconds,
  };
  const n = Math.round(seconds / STEP);
  for (let k = 0; k < n && r.failure === null; k++) {
    if (--hold <= 0) {
      hold = Math.round(rng.range(0.1, 3) / STEP);
      const mode = rng.next();
      // A third of the time flat out with a small correction, otherwise anything goes.
      inp.steer = mode < 0.33 ? rng.range(-0.1, 0.1) : rng.range(-1, 1);
      inp.throttle = mode < 0.33 ? 1 : rng.next() < 0.6 ? rng.next() : 0;
      inp.brake = mode >= 0.33 && rng.next() < 0.3 ? rng.next() : 0;
      inp.drs = rng.next() < 0.3;
    }
    const st = car.state;
    const rpm = (st.engineSpeed * 60) / (2 * Math.PI);
    inp.gearShift = rpm > 11500 && st.gear < 8 ? 1 : rpm < 7000 && st.gear > 1 ? -1 : 0;
    stepWorld(world);
    const why = checkCarInvariants(st, limits);
    if (why !== null) r.failure = `t=${(k * STEP).toFixed(3)} s: ${why}`;
    bodyCorners(st, corners);
    for (let c = 0; c < 4; c++) {
      surface.wall(corners[2 * c]!, corners[2 * c + 1]!, hints[c]!, wall);
      if (wall.depth > r.deepest) r.deepest = wall.depth;
    }
    if (st.wallContact) r.wallSteps++;
    r.maxImpact = Math.max(r.maxImpact, st.wallImpactSpeed);
    r.maxRide = Math.max(r.maxRide, st.rideHeightFront, st.rideHeightRear);
  }
  r.groundSteps = car.state.groundSteps;
  r.contactLifts = car.state.contactLifts;
  return r;
}
