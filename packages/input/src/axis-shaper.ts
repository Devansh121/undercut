import {
  keyboardSteerRate,
  keyboardSteerTarget,
  rampPedal,
  rampSteer,
  type KeyboardShaping,
} from './shaping';

/** Driver demand on the three analog axes: steer in [-1, 1] (left positive), pedals in [0, 1]. */
export interface Axes {
  steer: number;
  throttle: number;
  brake: number;
}

/**
 * Turns mapped demand into the axes the car sees, per device (strategy). Analog devices pass
 * demand straight through (their curves act on each control); the keyboard ramps.
 */
export interface AxisShaper {
  shape(demand: Readonly<Axes>, dt: number, speed: number, out: Axes): void;
  /** Start from these values, so taking over from another device does not jump. */
  seed(from: Readonly<Axes>): void;
}

export const PASS_THROUGH: AxisShaper = Object.freeze({
  shape(demand: Readonly<Axes>, _dt: number, _speed: number, out: Axes): void {
    out.steer = demand.steer;
    out.throttle = demand.throttle;
    out.brake = demand.brake;
  },
  seed(): void {},
});

export class KeyboardAxisShaper implements AxisShaper {
  private readonly state: Axes = { steer: 0, throttle: 0, brake: 0 };

  constructor(private readonly settings: () => KeyboardShaping) {}

  shape(demand: Readonly<Axes>, dt: number, speed: number, out: Axes): void {
    const s = this.settings();
    const st = this.state;
    st.steer = rampSteer(
      st.steer,
      keyboardSteerTarget(demand.steer, speed, s),
      dt,
      keyboardSteerRate(speed, s),
      s.returnRate,
    );
    st.throttle = rampPedal(st.throttle, demand.throttle, dt, s.throttleRise, s.throttleFall);
    st.brake = rampPedal(st.brake, demand.brake, dt, s.brakeRise, s.brakeFall);
    out.steer = st.steer;
    out.throttle = st.throttle;
    out.brake = st.brake;
  }

  seed(from: Readonly<Axes>): void {
    this.state.steer = from.steer;
    this.state.throttle = from.throttle;
    this.state.brake = from.brake;
  }
}
