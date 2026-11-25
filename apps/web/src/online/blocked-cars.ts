/** Stopped-car recovery for the host field, matching the offline race's six-second grace. */
import type { RemoteContactBody } from '@undercut/sim';

interface Recovery {
  x: number;
  z: number;
  still: number;
  ghost: boolean;
}

export class BlockedCars {
  private readonly recovery = new Map<number, Recovery>();

  update(
    cars: readonly RemoteContactBody[],
    dt: number,
    traffic: readonly RemoteContactBody[] = cars,
  ): ReadonlySet<number> {
    const ghosts = new Set<number>();
    for (const car of cars) {
      let state = this.recovery.get(car.seat);
      if (!state) {
        state = { x: car.x, z: car.z, still: 0, ghost: false };
        this.recovery.set(car.seat, state);
      }
      if (Math.hypot(car.x - state.x, car.z - state.z) >= 6) {
        state.x = car.x;
        state.z = car.z;
        state.still = 0;
      } else state.still += dt;
      if (!state.ghost && state.still >= 6) state.ghost = true;
      if (state.ghost && Math.hypot(car.vx, car.vz) > 5 && this.clear(car, traffic)) {
        state.ghost = false;
        state.still = 0;
        state.x = car.x;
        state.z = car.z;
      }
      if (state.ghost) ghosts.add(car.seat);
    }
    return ghosts;
  }

  restore(car: RemoteContactBody): void {
    this.recovery.set(car.seat, { x: car.x, z: car.z, still: 0, ghost: true });
  }

  private clear(car: RemoteContactBody, cars: readonly RemoteContactBody[]): boolean {
    const cos = Math.cos(car.yaw),
      sin = Math.sin(car.yaw);
    const speed = Math.hypot(car.vx, car.vz);
    for (const other of cars) {
      if (other.seat === car.seat || other.ghost) continue;
      const dx = other.x - car.x,
        dz = other.z - car.z;
      const forward = dx * cos - dz * sin;
      const across = Math.abs(-dx * sin - dz * cos);
      if (Math.abs(forward) < 6.5 && across < 2.6) return false;
      const closing = Math.hypot(other.vx, other.vz) - speed;
      if (forward < 0 && across < 3.6 && closing > 0 && -forward - 6.5 < closing * 2) return false;
    }
    return true;
  }
}
