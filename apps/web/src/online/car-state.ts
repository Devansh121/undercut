/**
 * The local car as a network snapshot, and a remote car's interpolated view back as a pose the
 * renderer draws. Pure.
 */
import { CAR_FLAG, type CarSnapshot, type RemoteCarView } from '@undercut/protocol';
import type { CarPose } from '@undercut/sim';

/**
 * Road-wheel angle that maps to full lock in the snapshot's steer field, rad. Only the look of a
 * remote car's front wheels depends on it; both ends use this constant.
 */
export const STEER_LOCK = 0.5;
/** Faster than this between two sim steps is a placement, not driving, m/s. */
const PLACEMENT_SPEED = 150;

export interface LocalCar {
  seat: number;
  /** Sim tick of `pose`. */
  tick: number;
  /** Estimated server time of `pose`, ms. */
  t: number;
  pose: CarPose;
  /** Pose one sim step earlier: velocities come from the difference. */
  prevPose: CarPose;
  /** Sim step, s. */
  step: number;
  speed: number;
  rpm: number;
  gear: number;
  throttle: number;
  brake: number;
  /** Wheel spin rates, rad/s, FL, FR, RL, RR. */
  wheelSpin: ArrayLike<number>;
  drs: boolean;
  /** Race laps completed and distance from the timing line, m. */
  lap: number;
  s: number;
  /** Placements so far (wraps modulo 4 on the wire). */
  resets: number;
}

function wrapAngle(a: number): number {
  const twoPi = 2 * Math.PI;
  return a - twoPi * Math.round(a / twoPi);
}

export function toSnapshot(c: LocalCar): CarSnapshot {
  const p = c.pose;
  const q = c.prevPose;
  let vx = (p.x - q.x) / c.step;
  let vy = (p.y - q.y) / c.step;
  let vz = (p.z - q.z) / c.step;
  let yawRate = wrapAngle(p.yaw - q.yaw) / c.step;
  if (Math.hypot(vx, vy, vz) > PLACEMENT_SPEED) {
    vx = 0;
    vy = 0;
    vz = 0;
    yawRate = 0;
  }
  const spin = c.wheelSpin;
  return {
    ...(p.breakableHits ? { breakableHits: Array.from(p.breakableHits) } : {}),
    seat: c.seat,
    flags: c.drs ? CAR_FLAG.drs : 0,
    resets: ((c.resets % 4) + 4) % 4,
    tick: c.tick,
    t: c.t,
    x: p.x,
    y: p.y,
    z: p.z,
    yaw: p.yaw,
    pitch: p.pitch,
    roll: p.roll,
    vx,
    vy,
    vz,
    yawRate,
    steer: Math.max(-1, Math.min(1, p.steerAngle / STEER_LOCK)),
    throttle: c.throttle,
    brake: c.brake,
    gear: c.gear,
    rpm: c.rpm,
    wheelSpin: [spin[0] ?? 0, spin[1] ?? 0, spin[2] ?? 0, spin[3] ?? 0],
    lap: c.lap,
    s: c.s,
  };
}

/**
 * Write a remote car's view into `out`. Wheel heights sit `wheelDrop` above the body reference
 * (taken from the local car at rest); the wheels spin on from their last angle by `dt` seconds of
 * the snapshot's spin rates.
 */
export function poseFromView(
  view: RemoteCarView,
  wheelDrop: readonly number[],
  dt: number,
  out: CarPose,
): CarPose {
  const hits = (out.breakableHits ??= new Float64Array(16));
  if (view.breakableHits) hits.set(view.breakableHits);
  else {
    hits.fill(0);
    for (let i = 0; i < 4; i++) hits[i * 4] = -1;
  }
  out.x = view.x;
  out.y = view.y;
  out.z = view.z;
  out.yaw = view.yaw;
  out.pitch = view.pitch;
  out.roll = view.roll;
  out.steerAngle = view.steer * STEER_LOCK;
  const twoPi = 2 * Math.PI;
  for (let k = 0; k < 4; k++) {
    out.wheelY[k] = view.y + (wheelDrop[k] ?? 0);
    const a = ((out.wheelAngle[k] ?? 0) + (view.wheelSpin[k] ?? 0) * dt) % twoPi;
    out.wheelAngle[k] = a < 0 ? a + twoPi : a;
  }
  return out;
}
