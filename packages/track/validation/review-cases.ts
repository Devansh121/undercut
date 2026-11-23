import { createRng } from '@undercut/core';
import {
  addCar,
  bodyCorners,
  checkCarInvariants,
  createCarParams,
  createSurfaceSample,
  createWallSample,
  createWorld,
  invariantLimits,
  snapshotCar,
  stepWorld,
} from '@undercut/sim';
import { createVec3 } from '../src/path';
import { TrackSurface } from '../src/surface';
import type { Track } from '../src/track';

/**
 * The flat-out runs from the review of PR 19 that broke the pose limits on master at 22dd96e,
 * reproduced exactly: low trim, 20 kg of fuel, 300 km/h, full throttle, upshift at 1200 rad/s.
 *
 * - `flat`: along the lap at (s, 0), wheel straight.
 * - `scrapeL` / `scrapeR`: 2 m inside the left or right barrier, 0.06 rad toward it, straight.
 * - `right`: 0.85 rad to the right of the lap, steer redrawn in ±0.5 every second.
 */
export type ReviewMode = 'flat' | 'scrapeL' | 'scrapeR' | 'right';

export interface ReviewRun {
  /** First failure as `tick: reason`, or null. */
  failure: string | null;
  maxPitch: number;
  maxRoll: number;
  /** Highest the body's floor reference got above the ground under the car's centre, m. */
  maxBodyAboveGround: number;
  snapshot: number[];
  /** Lightweight objects the car broke. */
  panelsBroken: number;
}

/**
 * The review's own probes on top of the invariant checker: |pitch| and |roll| over 0.3 rad, the
 * body more than 0.6 m above the ground under its centre, a body corner more than 0.1 m behind a
 * barrier, or the centre more than 1 m behind one.
 */
export const PROBE_PITCH = 0.3;
export const PROBE_ROLL = 0.3;
export const PROBE_BODY = 0.6;

export function reviewRun(
  track: Track,
  seed: number,
  s: number,
  mode: ReviewMode,
  seconds = 18,
  breakables = false,
): ReviewRun {
  const rng = createRng(seed);
  // The review's cases measure the ground and the barriers: without the lightweight objects
  // unless asked, as when they were recorded.
  const surface = new TrackSurface(track, { breakables });
  const world = createWorld({ step: 1 / 240, seed, surface });
  let d = 0;
  let angle = 0;
  if (mode === 'right') angle = -0.85;
  if (mode === 'scrapeL' || mode === 'scrapeR') {
    const side = mode === 'scrapeL' ? 0 : 1;
    d = (side === 0 ? 1 : -1) * (track.barrierAt(s, side) - 2);
    angle = side === 0 ? 0.06 : -0.06;
  }
  const p = createVec3();
  const t = createVec3();
  track.lap.pointAt(s, d, p);
  track.lap.tangent(s, t);
  const car = addCar(world, createCarParams('low'), {
    x: p.x,
    z: p.z,
    yaw: Math.atan2(-t.z, t.x) + angle,
    speed: 83.333,
    fuel: 20,
  });
  const st = car.state;
  const limits = invariantLimits(st.model);
  const corners = new Float64Array(8);
  const wall = createWallSample();
  const sample = createSurfaceSample();
  const r: ReviewRun = {
    failure: null,
    maxPitch: 0,
    maxRoll: 0,
    maxBodyAboveGround: 0,
    snapshot: [],
    panelsBroken: 0,
  };
  const fail = (k: number, why: string): void => {
    r.failure ??= `tick ${k + 1}: ${why}`;
  };
  let steer = 0;
  for (let k = 0; k < 240 * seconds; k++) {
    if (k % 240 === 0) steer = mode === 'right' ? rng.range(-0.5, 0.5) : 0;
    car.input.throttle = 1;
    car.input.steer = steer;
    car.input.brake = 0;
    car.input.gearShift = st.engineSpeed > 1200 && st.gear < 8 ? 1 : 0;
    stepWorld(world);
    const why = checkCarInvariants(st, limits);
    if (why) fail(k, why);
    if (Math.abs(st.pitch) > PROBE_PITCH) fail(k, `pitch ${st.pitch.toFixed(3)}`);
    if (Math.abs(st.roll) > PROBE_ROLL) fail(k, `roll ${st.roll.toFixed(3)}`);
    surface.sample(st.x, st.z, { index: -1 }, sample);
    const above = st.y - sample.height;
    if (above > PROBE_BODY) fail(k, `body ${above.toFixed(3)} m above the ground`);
    bodyCorners(st, corners);
    for (let c = 0; c < 4; c++) {
      surface.wall(corners[2 * c]!, corners[2 * c + 1]!, { index: -1 }, wall);
      if (wall.depth > 0.1) fail(k, `corner ${wall.depth.toFixed(3)} m behind a barrier`);
    }
    r.maxPitch = Math.max(r.maxPitch, Math.abs(st.pitch));
    r.maxRoll = Math.max(r.maxRoll, Math.abs(st.roll));
    r.maxBodyAboveGround = Math.max(r.maxBodyAboveGround, above);
  }
  r.snapshot = Array.from(snapshotCar(st));
  r.panelsBroken = st.breakableHitCount;
  return r;
}

/** The 18 failing direct-sim cases from the review: seed, start s, mode. */
export const REVIEW_SIM_CASES: readonly (readonly [number, number, ReviewMode])[] = [
  [91149, 0, 'scrapeL'],
  [91186, 0, 'scrapeR'],
  [91445, 62, 'scrapeL'],
  [91593, 66, 'flat'],
  [91741, 66, 'scrapeL'],
  [91778, 66, 'scrapeR'],
  [92037, 300, 'scrapeL'],
  [92333, 540, 'scrapeL'],
  [92592, 610, 'right'],
  [92629, 610, 'scrapeL'],
  [92666, 610, 'scrapeR'],
  [92925, 650, 'scrapeL'],
  [93961, 1700, 'flat'],
  [94146, 1700, 'scrapeR'],
  [97106, 5338, 'scrapeR'],
  [97402, 5343, 'scrapeR'],
  [97513, 5600, 'flat'],
  [97698, 5600, 'scrapeR'],
];
