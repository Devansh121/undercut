import { computeMass, type CarState, type MassState } from '@undercut/sim';
import { LEFT, RIGHT, createPathPoint, type Track } from '@undercut/track';

/**
 * Half the tread width the track-limit check uses, m: between the front (0.305 m) and rear
 * (0.405 m) tyres. A wheel counts as off only when its whole tread is past the line.
 */
export const TYRE_HALF_TREAD = 0.18;

/**
 * Track limits: the white line's outer edge is the limit. A wheel is off when its tread is
 * entirely beyond it; the lap is invalid when all four are off at once (penalties are M3).
 */
export class TrackLimits {
  private readonly track: Track;
  private readonly halfTread: number;
  private readonly hints = [{ index: -1 }, { index: -1 }, { index: -1 }, { index: -1 }];
  private readonly q = createPathPoint();
  private readonly mass: MassState = {
    total: 0,
    sprung: 0,
    a: 0,
    b: 0,
    sprungA: 0,
    sprungB: 0,
    yawInertia: 0,
  };

  constructor(track: Track, halfTread = TYRE_HALF_TREAD) {
    this.track = track;
    this.halfTread = halfTread;
  }

  /** Forget cached search positions (after a teleport). */
  reset(): void {
    for (const h of this.hints) h.index = -1;
  }

  /** How many wheels are wholly beyond the track-limit lines. Allocation-free. */
  wheelsOff(car: CarState): number {
    const m = computeMass(car.model, car.fuelMass, this.mass);
    const c = Math.cos(car.yaw);
    const sn = Math.sin(car.yaw);
    let off = 0;
    for (let i = 0; i < 4; i++) {
      const bx = i < 2 ? m.a : -m.b;
      const by = car.model.wheelLeft[i] as number;
      // Body frame: +x forward, +y left; world: yaw about +Y, 0 facing +X.
      const x = car.x + bx * c - by * sn;
      const z = car.z - bx * sn - by * c;
      const q = this.track.project(x, z, this.hints[i] as { index: number }, this.q);
      const side = q.d >= 0 ? LEFT : RIGHT;
      if (Math.abs(q.d) - this.halfTread > this.track.halfWidthAt(q.s, side)) off++;
    }
    return off;
  }
}
