/**
 * What a racing driver knows about the cars around it: their track positions and speeds as the
 * race sees them (the same facts the timing uses), refreshed every tick by whoever runs the
 * race. The driver decides what of it it can perceive (range, mirrors).
 */
export interface TrafficCar {
  /** Car number in the race (stable identity across ticks). */
  id: number;
  /** Lap position: centreline s and lateral d (positive left), m. */
  s: number;
  d: number;
  /** Forward speed, m/s. */
  speed: number;
  /**
   * Half the width the car takes across the track, m: half a car's width when it points along
   * the lap, up to half its length when it is across it (spun, turning round).
   */
  halfWidth: number;
  /** Slowing for a requested stop, still on the racing surface. */
  pitApproach?: boolean;
}

export interface TrafficView {
  /** This driver's own car. */
  readonly self: TrafficCar;
  /** Other cars on the circuit (not in the pit lane); the first `count` entries are valid. */
  readonly cars: TrafficCar[];
  count: number;
  /** A blue flag is shown to this car: a car a lap up is close behind. */
  blueFlag: boolean;
  /** The car the blue flag is for (the one lapping this car), or -1. */
  blueBy: number;
  /**
   * The racing driver has the car: racing, past its start reaction, not held, not in the pit
   * lane's hands. Only then can it be stuck.
   */
  active: boolean;
  /** Launching from the grid (the controller holds the throttle under the driven wheels' grip). */
  launching: boolean;
}

export function createTrafficCar(): TrafficCar {
  return { id: -1, s: 0, d: 0, speed: 0, halfWidth: 1 };
}

export function createTrafficView(capacity: number): TrafficView {
  return {
    self: createTrafficCar(),
    cars: Array.from({ length: capacity }, createTrafficCar),
    count: 0,
    blueFlag: false,
    blueBy: -1,
    active: false,
    launching: false,
  };
}

/** Include the road the follower will reach where the slowing entrant is now. */
export function pitCarInPath(
  followerD: number,
  entrantD: number,
  pathD: number,
  followerHalfWidth: number,
  entrantHalfWidth: number,
): boolean {
  return (
    Math.min(Math.abs(entrantD - followerD), Math.abs(entrantD - pathD)) <
    followerHalfWidth + entrantHalfWidth + 0.5
  );
}
