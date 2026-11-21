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
}

export interface TrafficView {
  /** This driver's own car. */
  readonly self: TrafficCar;
  /** Other cars on the circuit (not in the pit lane); the first `count` entries are valid. */
  readonly cars: TrafficCar[];
  count: number;
  /** A blue flag is shown to this car: a car a lap up is close behind. */
  blueFlag: boolean;
}

export function createTrafficCar(): TrafficCar {
  return { id: -1, s: 0, d: 0, speed: 0 };
}

export function createTrafficView(capacity: number): TrafficView {
  return {
    self: createTrafficCar(),
    cars: Array.from({ length: capacity }, createTrafficCar),
    count: 0,
    blueFlag: false,
  };
}
