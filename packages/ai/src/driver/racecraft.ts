import { BODY_HALF_WIDTH } from '@undercut/sim';
import type { TrafficView } from './traffic';

/**
 * Clip a proposed road lane to the first closing car's corridor. Check the whole swept
 * path, including a destination beyond that corridor. All positions and speeds are SI.
 * The caller excludes crawling, recovery and stopped-queue manoeuvres.
 */
export function mirrorLane(
  view: TrafficView,
  target: number,
  length: number,
  reaction: number,
): number {
  const current = view.self.d;
  const direction = Math.sign(target - current);
  let lane = target;
  for (let k = 0; k < view.count; k++) {
    const c = view.cars[k]!;
    let ds = (c.s - view.self.s + length) % length;
    if (ds > length / 2) ds -= length;
    const closing = c.speed - view.self.speed;
    if (ds >= -5.6 || ds < -40 || closing <= 0) continue;
    const across = direction * (c.d - current);
    if (across <= 0) continue;
    const clearance = BODY_HALF_WIDTH + c.halfWidth + 0.8;
    if (direction * (target - c.d) < -clearance) continue;
    const time = Math.min(2, Math.max(0, across - clearance) / 1.5) + reaction + 0.6;
    if (-ds - 5.6 > closing * time) continue;
    const edge = c.d - direction * clearance;
    const stop = direction > 0 ? Math.max(current, edge) : Math.min(current, edge);
    lane = direction > 0 ? Math.min(lane, stop) : Math.max(lane, stop);
  }
  return lane;
}

export interface DefenceMemory {
  lane: number;
  used: boolean;
}

/** One early move to cover the inside, held until the corner rather than tracking the attacker. */
export function defensiveLane(
  view: TrafficView,
  memory: DefenceMemory,
  inside: number,
  braking: boolean,
  inCorner: boolean,
  lo: number,
  hi: number,
  length = Infinity,
): number {
  if (inCorner) {
    memory.used = false;
    memory.lane = 0;
    return 0;
  }
  if (!memory.used && !braking && inside !== 0) {
    for (let k = 0; k < view.count; k++) {
      const c = view.cars[k]!;
      let ds = c.s - view.self.s;
      if (ds > length / 2) ds -= length;
      else if (ds < -length / 2) ds += length;
      if (ds < -20 && ds > -40 && c.speed > view.self.speed + 1) {
        memory.used = true;
        memory.lane = inside * Math.min(2, inside > 0 ? hi : -lo);
        break;
      }
    }
  }
  return Math.max(lo, Math.min(hi, memory.lane));
}
