import type { FollowPoint } from '@undercut/ai';
import { createVec3, type Track } from '@undercut/track';
import type { CircuitInfo } from '../circuit';

/** Speed the pit-lane paths aim for under the limit, below the limit, m/s. */
export const PIT_MARGIN = 0.8;
const STEP = 2;

function smooth(t: number): number {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
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
  if (run < L / 2) {
    for (let x = 0; x < run; x += STEP) {
      const d = fromD + (start.d - fromD) * smooth(x / run);
      track.lap.pointAt(fromS + x, d, v);
      out.push({ x: v.x, z: v.z, v: Infinity });
    }
  }
  const turnIn = Math.max(circuit.pit.limitStart + 5, box.s - 25);
  for (let sp = 0; sp <= box.s; sp += STEP) {
    const d = sp < turnIn ? 0 : box.d * smooth((sp - turnIn) / (box.s - turnIn));
    pit.path.pointAt(sp, d, v);
    out.push({ x: v.x, z: v.z, v: sp >= circuit.pit.limitStart - 15 ? limit : Infinity });
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
  for (let x = STEP; x <= 60; x += STEP) {
    track.lap.pointAt(exit.s + x, exit.d * (1 - smooth(x / 60)), v);
    out.push({ x: v.x, z: v.z, v: Infinity });
  }
  return out;
}
