/**
 * What a driver feels through the seat and the pedal: how far the tyres are past their peak
 * slip. Shared by the reference driver and the envelope rig, so the speeds the plan expects
 * are measured with the same feel the driver drives with.
 */

/**
 * How far the braked wheels are past locking up, as slip ratio beyond what the driver accepts
 * (negative: margin left). The loaded wheel of an axle is held at the tyre's peak slip. A
 * lightly loaded wheel (the inside one when braking into a turn) carries little and may slip
 * further, up to three times the peak as its load falls below the other wheel's, but never to
 * a full lock: a locked front tyre stops steering the car.
 */
export function lockExcess(
  slipRatio: ArrayLike<number>,
  load: ArrayLike<number>,
  peak: number,
): number {
  let excess = -Infinity;
  for (let k = 0; k < 4; k++) {
    const other = load[k ^ 1]!;
    const own = Math.max(load[k]!, 1);
    const allow = peak * Math.min(3, Math.max(1, Math.sqrt(other / own)));
    excess = Math.max(excess, -slipRatio[k]! - allow);
  }
  return excess;
}

/**
 * How far the driven (rear) wheels are past their peak in drive, in normalised slip (1 = the
 * top of the friction curve): slip ratio and slip angle combined, the way the tyre model
 * combines them, so a rear that is already working hard sideways has less to give the throttle.
 * Only wheels slipping in drive count.
 */
export function spinExcess(
  slipRatio: ArrayLike<number>,
  slipAngle: ArrayLike<number>,
  peakRatio: number,
  peakTan: number,
): number {
  let excess = -Infinity;
  for (let i = 2; i < 4; i++) {
    const sx = slipRatio[i]!;
    if (sx <= 0) continue;
    const nx = sx / peakRatio;
    const ny = Math.tan(slipAngle[i]!) / peakTan;
    excess = Math.max(excess, Math.sqrt(nx * nx + ny * ny) - 1);
  }
  return excess;
}
