import type { CarTelemetry, ControlInput, ErsMode } from '@undercut/sim';
import type { EnvelopeScale } from '../envelope/envelope';

/**
 * An AI driver: reads what a driver can read (the car's telemetry and where it is on the
 * track) and produces the same `ControlInput` a human's devices produce. It never touches the
 * car's state; the sim treats its input exactly like the player's.
 *
 * Drivers are strategies: the reference driver is one; later ones vary skill and behaviour
 * (racecraft, mistakes) behind the same interface.
 */
export interface Driver {
  readonly name: string;
  /**
   * MGU-K mode the driver selects on the steering wheel before the run. Deployment within
   * the lap is then driven through `ControlInput.overtake`.
   */
  readonly ersMode: ErsMode;
  /** Forget everything carried between ticks (after a teleport or restart). */
  reset(): void;
  /** One sim tick of length `dt`: read `telemetry`, write the demand into `out`. */
  drive(telemetry: CarTelemetry, dt: number, out: ControlInput): ControlInput;
  /**
   * Everything the driver carries between ticks, as plain JSON (saves, host migration): a
   * driver restored from it drives the next ticks exactly as the original would.
   */
  snapshot(): DriverMemory;
  /** Overwrite the carried state from `snapshot` of a driver built the same way. */
  restore(memory: DriverMemory): void;
}

/** A driver's carried state: plain JSON numbers, booleans and number lists. */
export type DriverMemory = { readonly [key: string]: number | boolean | readonly number[] };

/**
 * How well a driver drives. The reference driver is "as fast as it can drive cleanly": the
 * envelope fractions are the most it can use without leaving the track or spinning, with no
 * lag or noise. Slower drivers plan with less of the envelope, react later and make errors.
 */
export interface DriverSkill {
  /** Fractions of the measured envelope the driver plans its speeds with. */
  envelope: EnvelopeScale;
  /** First-order lag of hands and feet, s (0 = none). */
  reaction: number;
  /** Error injection: steering noise (standard deviation, steer units) and pedal noise. */
  steerNoise: number;
  pedalNoise: number;
  /** Slow wander off the line, m (amplitude of a random walk held inside it). */
  lineWander: number;
  /** Seed for the error injection. */
  seed: number;
}
