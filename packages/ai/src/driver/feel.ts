/**
 * What a driver feels through the seat and the pedal: how far the tyres are past their peak
 * slip. Shared by the reference driver and the envelope rig, so the speeds the plan expects
 * are measured with the same feel the driver drives with.
 */

/**
 * How far the braked wheels are past locking up, as slip ratio beyond what the driver accepts
 * (negative: margin left). The loaded wheel of an axle is held at the tyre's peak slip. A
 * lightly loaded front wheel (the inside one when braking into a turn) carries little and may
 * slip further, up to three times the peak as its load falls below the other wheel's, but never
 * to a full lock: a locked front tyre stops steering the car. A rear wheel gets no such
 * allowance: one that locks while light (over a kerb on the way in) is still locked when its
 * load comes back, and a sliding rear takes the car round. With slip angles given, the threshold
 * follows each tyre's combined slip: it shrinks to the friction ellipse's longitudinal room, and
 * the light inside front's extra allowance fades out as it starts to turn. A front wheel lifted
 * off the ground (under a tenth of the other front's load, an estimate) is not felt at all: it
 * carries neither braking nor cornering force, and a driver does not come off the pedal for it.
 */
/** A front wheel below this share of the other front's load is lifted (estimate). */
const LIFTED = 0.1;

export function lockExcess(
  slipRatio: ArrayLike<number>,
  load: ArrayLike<number>,
  peak: number,
  slipTan?: ArrayLike<number>,
  peakTan = 1,
): number {
  let excess = -Infinity;
  for (let k = 0; k < 4; k++) {
    const other = load[k ^ 1]!;
    const own = Math.max(load[k]!, 1);
    if (k < 2 && own < LIFTED * other) continue;
    // Sideways slip as a share of the peak: a tyre already turning has less left to brake with
    // (the friction ellipse), and a light inside front that is turning gets no extra allowance.
    const sy = slipTan ? Math.min(1, Math.abs(slipTan[k]!) / peakTan) : 0;
    const turning = Math.max(0, 1 - sy / 0.5);
    const light = k < 2 ? Math.min(3, Math.max(1, Math.sqrt(other / own))) : 1;
    const allow = peak * (1 + (light - 1) * turning) * Math.sqrt(Math.max(0.1, 1 - sy * sy));
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
