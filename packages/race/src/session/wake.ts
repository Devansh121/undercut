/** World pose and forward speed, m, rad and m/s. */
interface WakeCar {
  x: number;
  z: number;
  yaw: number;
  vx: number;
}

/**
 * Estimated wake exposure, 0 to 1. Geometry is in the leader's frame, so a car on another
 * section of a folded circuit cannot tow this one. The wake narrows toward its source and
 * fades over 100 m; below racing speed or across a corner it has no effect.
 */
export function wakeStrength(follower: WakeCar, leader: WakeCar): number {
  if (follower.vx < 30 || leader.vx < 30) return 0;
  if (Math.cos(follower.yaw - leader.yaw) < 0.98) return 0;
  const dx = follower.x - leader.x;
  const dz = follower.z - leader.z;
  const along = -(dx * Math.cos(leader.yaw) - dz * Math.sin(leader.yaw));
  if (along < 6 || along >= 100) return 0;
  const across = Math.abs(dx * Math.sin(leader.yaw) + dz * Math.cos(leader.yaw));
  const width = 1.5 + along * 0.015;
  return Math.max(0, 1 - across / width) * (1 - along / 100);
}
