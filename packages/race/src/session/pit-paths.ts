import type { FollowPoint } from '@undercut/ai';
import { createVec3, type Track } from '@undercut/track';
import type { CircuitInfo } from '../circuit';

/** Speed the pit-lane paths aim for under the limit, below the limit, m/s. */
export const PIT_MARGIN = 0.3;
const STEP = 2;
/** Speed allowed in the pit lane before the first limit line's braking, m/s. */
export const LANE_ENTRY_SPEED = 25;
/** The steepest lane heading the approach and exit blends match, lateral m per m (about 17°). */
const MAX_JOIN_SLOPE = 0.3;

function smooth(t: number): number {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
}

/**
 * Cubic Hermite from `d0` (slope 0, along the lap) to `d1` with slope `m1` (lateral metres per
 * metre of lap), over `t` in 0..1 of a run of `run` metres.
 */
function hermite(t: number, run: number, d0: number, d1: number, m1: number): number {
  const x = Math.max(0, Math.min(1, t));
  const x2 = x * x;
  const x3 = x2 * x;
  return d0 * (2 * x3 - 3 * x2 + 1) + d1 * (-2 * x3 + 3 * x2) + run * m1 * (x3 - x2);
}

/**
 * The pit lane's heading where it meets the lap, as a lateral slope in the lap frame: how far
 * across the lap it moves per metre along it, measured over `span` metres of the pit lane from
 * `pitS` (positive span: into the lane; negative: back from its exit).
 */
function laneSlope(track: Track, pitS: number, span: number): number {
  const v = createVec3();
  const hint = { index: -1 };
  track.pit.path.pointAt(pitS, 0, v);
  const a = track.project(v.x, v.z, hint, { s: 0, d: 0, index: -1 });
  track.pit.path.pointAt(pitS + span, 0, v);
  const b = track.project(v.x, v.z, hint, { s: 0, d: 0, index: -1 });
  let ds = b.s - a.s;
  if (ds > track.length / 2) ds -= track.length;
  if (ds < -track.length / 2) ds += track.length;
  const slope = Math.abs(ds) < 1e-6 ? 0 : (b.d - a.d) / ds;
  // A lane that leaves at a steep angle (Spa's, inside the chicane) keeps the plain blend:
  // matching its slope, even in part, bent the approach out the other way and folded the path,
  // and cars stopped in the lane where it crossed itself.
  return Math.abs(slope) > MAX_JOIN_SLOPE ? 0 : slope;
}

function forward(length: number, from: number, to: number): number {
  const d = (to - from) % length;
  return d < 0 ? d + length : d;
}

/**
 * The way into the pit box from the car's position on the lap (`fromS`, `fromD`): along the lap
 * blending from the car's offset onto the pit lane's start, down the pit lane at the limit from
 * the first limit line, and across into the box. The follower stops at its end.
 */
export function pitInPath(
  track: Track,
  circuit: CircuitInfo,
  fromS: number,
  fromD: number,
  box: { s: number; d: number },
  fromPitS?: number,
): FollowPoint[] {
  const L = track.length;
  const pit = track.pit;
  const limit = circuit.pit.speedLimit - PIT_MARGIN;
  const v = createVec3();
  const out: FollowPoint[] = [];
  // Where the pit path starts, in the lap frame.
  const start = track.project(
    pit.entryPose.x,
    pit.entryPose.z,
    { index: -1 },
    { s: 0, d: 0, index: -1 },
  );
  const run = forward(L, fromS, start.s);
  if (fromPitS === undefined && run < L / 2) {
    // Into the lane along its own heading: a blend that arrived along the lap met the lane at an
    // angle (a 5 to 15 m radius kink at the join, taken at about 19 m/s).
    const slope = laneSlope(track, 0, 10);
    for (let x = 0; x < run; x += STEP) {
      const d = hermite(x / run, run, fromD, start.d, slope);
      track.lap.pointAt(fromS + x, d, v);
      out.push({ x: v.x, z: v.z, v: Infinity });
    }
  }
  const turnIn = Math.max(circuit.pit.limitStart + 5, box.s - 25);
  for (let sp = fromPitS ?? 0; sp <= box.s; sp += STEP) {
    const d = sp < turnIn ? 0 : box.d * smooth((sp - turnIn) / (box.s - turnIn));
    pit.path.pointAt(sp, d, v);
    // On the entry road, before braking for the first line: no faster than `LANE_ENTRY_SPEED`
    // (the lane is 5 to 7 m wide there; a car carried in at 55 m/s met the wall).
    out.push({
      x: v.x,
      z: v.z,
      v: sp >= circuit.pit.limitStart - 15 ? limit : LANE_ENTRY_SPEED,
    });
  }
  pit.path.pointAt(box.s, box.d, v);
  out.push({ x: v.x, z: v.z, v: limit });
  return out;
}

/**
 * The way out from the pit lane at `fromPitS`, `fromPitD` (a box, or anywhere in the lane):
 * across to the lane's centre, at the limit to the second limit line, then free to the exit and
 * a little way onto the lap.
 */
export function pitOutPath(
  track: Track,
  circuit: CircuitInfo,
  fromPitS: number,
  fromPitD: number,
): FollowPoint[] {
  const pit = track.pit;
  const limit = circuit.pit.speedLimit - PIT_MARGIN;
  const v = createVec3();
  const out: FollowPoint[] = [];
  const merge = 20;
  for (let sp = fromPitS; sp <= pit.length; sp += STEP) {
    const d = fromPitD * (1 - smooth((sp - fromPitS) / merge));
    pit.path.pointAt(sp, d, v);
    out.push({ x: v.x, z: v.z, v: sp <= circuit.pit.limitEnd ? limit : Infinity });
  }
  const exit = track.project(
    pit.exitPose.x,
    pit.exitPose.z,
    { index: -1 },
    { s: 0, d: 0, index: -1 },
  );
  // Onto the lap from the exit's offset with no sideways start: matching the lane's heading here
  // sent cars across the track at once, into the path of cars on the straight (Monza seed 211,
  // 20 m/s). The kink this leaves at the join is taken at the exit's speed anyway.
  for (let x = STEP; x <= 60; x += STEP) {
    track.lap.pointAt(exit.s + x, exit.d * (1 - smooth(x / 60)), v);
    out.push({ x: v.x, z: v.z, v: Infinity });
  }
  return out;
}
