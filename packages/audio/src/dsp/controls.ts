import {
  CAR_STATE_FIELDS,
  CAR_STATE_LENGTH,
  CAR_STATE_RANGE,
  F,
  packCarState,
  type AudioCarState,
} from './state';

/** Frames per control chunk. The core renders in chunks of at most this many frames. */
export const CHUNK = 32;

/** Fields that switch at once instead of ramping (flags and the gear number). */
const STEPPED = new Set<number>([
  F.engineOn,
  F.gear,
  F.shifting,
  F.shiftDirection,
  F.revLimiter,
  F.pitLimiter,
  F.impactSpeed,
  F.impactSerial,
]);

/** Fields that hold a whole number or a flag: rounded after clamping. */
const DISCRETE = new Set<number>([
  F.engineOn,
  F.gear,
  F.shifting,
  F.shiftDirection,
  F.revLimiter,
  F.pitLimiter,
  F.impactSerial,
]);
/** Fields given as a magnitude whose sign does not matter: slips. */
const MAGNITUDE = new Set<number>([F.slipFront, F.slipRear]);

/**
 * Turns state updates arriving at 60–240 Hz into per-sample control signals. Each continuous
 * field ramps linearly from where it is to the new value over one estimated update interval,
 * so the signals are continuous whatever the update rate. Flags step at the update.
 * Interpolating costs one update interval of latency (about 4–17 ms).
 *
 * This is the boundary every input crosses, packed or not: each field is clamped to
 * CAR_STATE_RANGE, and a non-finite value keeps the last valid one, so no update can push
 * the DSP outside what it was designed for.
 */
export class CarControls {
  /** Per-field control signal for the current chunk: `buffers[field][frame]`. */
  readonly buffers: Float64Array[];
  private readonly value = new Float64Array(CAR_STATE_LENGTH);
  private readonly target = new Float64Array(CAR_STATE_LENGTH);
  private readonly step = new Float64Array(CAR_STATE_LENGTH);
  private readonly packed = new Float64Array(CAR_STATE_LENGTH);
  private readonly stepped: Uint8Array;
  private readonly min = new Float64Array(CAR_STATE_LENGTH);
  private readonly max = new Float64Array(CAR_STATE_LENGTH);
  private readonly discrete = new Uint8Array(CAR_STATE_LENGTH);
  private readonly magnitude = new Uint8Array(CAR_STATE_LENGTH);
  private remaining = 0;
  private interval = 0;
  private sinceUpdate = 0;
  private hasState = false;
  private readonly minRamp: number;
  private readonly maxRamp: number;

  constructor(sampleRate: number) {
    this.buffers = Array.from({ length: CAR_STATE_LENGTH }, () => new Float64Array(CHUNK));
    this.stepped = new Uint8Array(CAR_STATE_LENGTH);
    for (const i of STEPPED) this.stepped[i] = 1;
    for (const i of DISCRETE) this.discrete[i] = 1;
    for (const i of MAGNITUDE) this.magnitude[i] = 1;
    CAR_STATE_FIELDS.forEach((name, i) => {
      this.min[i] = CAR_STATE_RANGE[name][0];
      this.max[i] = CAR_STATE_RANGE[name][1];
    });
    this.minRamp = Math.round(sampleRate * 0.0005);
    this.maxRamp = Math.round(sampleRate * 0.05);
    this.interval = Math.round(sampleRate / 120);
  }

  /** Latest state. Takes a struct or its packed form. Does not keep a reference. */
  set(state: AudioCarState | ArrayLike<number>): void {
    const src = 'engineSpeed' in state ? packCarState(state, this.packed) : state;
    if (this.hasState) {
      const measured = this.sinceUpdate;
      if (measured >= this.minRamp && measured <= this.maxRamp) {
        this.interval += (measured - this.interval) * 0.25;
      }
    }
    const ramp = this.hasState
      ? Math.max(this.minRamp, Math.min(this.maxRamp, Math.round(this.interval)))
      : 0;
    for (let i = 0; i < CAR_STATE_LENGTH; i++) {
      let t = src[i] as number;
      if (t - t !== 0) {
        // NaN or ±Infinity (x - x is NaN for both): keep the last valid value.
        t = this.target[i] as number;
      } else {
        if (this.magnitude[i] === 1 && t < 0) t = -t;
        const lo = this.min[i] as number;
        const hi = this.max[i] as number;
        t = t < lo ? lo : t > hi ? hi : t;
        if (this.discrete[i] === 1) t = Math.round(t);
      }
      this.target[i] = t;
      if (ramp === 0 || this.stepped[i] === 1) {
        this.value[i] = t;
        this.step[i] = 0;
      } else {
        this.step[i] = (t - (this.value[i] ?? 0)) / ramp;
      }
    }
    this.remaining = ramp;
    this.sinceUpdate = 0;
    this.hasState = true;
  }

  /** Where a field is heading: the value of the latest update. */
  targetOf(field: number): number {
    return this.target[field] as number;
  }

  /** Fill `buffers` for the next `frames` (<= CHUNK) samples. */
  advance(frames: number): void {
    const remaining = this.remaining;
    for (let i = 0; i < CAR_STATE_LENGTH; i++) {
      const buf = this.buffers[i] as Float64Array;
      let v = this.value[i] as number;
      if (remaining === 0) {
        buf.fill(v, 0, frames);
        continue;
      }
      const step = this.step[i] as number;
      const target = this.target[i] as number;
      let left = remaining;
      for (let f = 0; f < frames; f++) {
        if (left > 0) {
          left--;
          v = left === 0 ? target : v + step;
        }
        buf[f] = v;
      }
      this.value[i] = v;
    }
    this.remaining = Math.max(0, remaining - frames);
    this.sinceUpdate += frames;
  }
}
