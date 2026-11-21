import {
  FLAT_SURFACE,
  NEUTRAL_INPUT,
  airDensity,
  createCarParams,
  createCarState,
  createCarTelemetry,
  createEnvironment,
  readCarTelemetry,
  stepCar,
  type AeroTrim,
  type CarParams,
  type CarState,
  type CarTelemetry,
  type ControlInput,
  type Environment,
  type ErsMode,
  type SurfaceSampler,
} from '../../src/index';

/** The game's sim step: 240 Hz (apps/web). Every manoeuvre runs at it. */
export const STEP = 1 / 240;
export const KMH = 1 / 3.6;
export const G = 9.80665;

/**
 * Event conditions: "ISA-like conditions corrected to the event (25 °C, the circuit's
 * altitude)" (doc 2.1). Altitudes: Monza 180 m (doc 1.4), Spa about 415 m (middle of
 * 364–467 m, track-data.md), Singapore about 15 m.
 */
export const CIRCUITS = {
  monza: { trim: 'low', airDensity: airDensity(180, 25) },
  spa: { trim: 'medium', airDensity: airDensity(415, 25) },
  singapore: { trim: 'high', airDensity: airDensity(15, 25) },
} as const satisfies Record<string, { trim: AeroTrim; airDensity: number }>;
export type Circuit = keyof typeof CIRCUITS;

/** Columns written by the trace recorder, in order. */
export const TRACE_COLUMNS = [
  't',
  'x',
  'z',
  'yaw',
  'speed_kmh',
  'rpm',
  'gear',
  'throttle',
  'brake',
  'steer_deg',
  'long_g',
  'lat_g',
  'vert_g',
  'load_fl',
  'load_fr',
  'load_rl',
  'load_rr',
  'slip_fl',
  'slip_fr',
  'slip_rl',
  'slip_rr',
  'alpha_fl_deg',
  'alpha_fr_deg',
  'alpha_rl_deg',
  'alpha_rr_deg',
  'ride_f_mm',
  'ride_r_mm',
  'pitch_deg',
  'roll_deg',
  'downforce_n',
  'drag_n',
  'drs',
  'ers_mj',
  'deploy_lap_mj',
  'harvest_lap_mj',
  'mguk_kw',
  'fuel_kg',
  'yaw_rate_dps',
  'distance',
] as const;

export interface Trace {
  columns: readonly string[];
  rows: number[][];
}

export interface HarnessOptions {
  trim?: AeroTrim;
  params?: CarParams;
  fuel?: number;
  speed?: number;
  gear?: number;
  ersMode?: ErsMode;
  ersStore?: number;
  brakeBias?: number;
  airDensity?: number;
  surface?: SurfaceSampler;
  /** Record a trace row every `recordEvery` steps (0 = no trace). */
  recordEvery?: number;
}

/** One car on a surface with a clock, a reusable input and an optional trace. */
export class Harness {
  readonly car: CarState;
  readonly env: Environment;
  readonly surface: SurfaceSampler;
  readonly input: ControlInput = { ...NEUTRAL_INPUT };
  readonly tel: CarTelemetry = createCarTelemetry();
  readonly trace: Trace | undefined;
  private readonly recordEvery: number;
  time = 0;
  steps = 0;

  constructor(options: HarnessOptions = {}) {
    const params = options.params ?? createCarParams(options.trim ?? 'medium');
    this.env = createEnvironment({ airDensity: options.airDensity ?? airDensity(0, 25) });
    this.surface = options.surface ?? FLAT_SURFACE;
    this.car = createCarState(params, {
      fuel: options.fuel ?? 105,
      speed: options.speed ?? 0,
      airDensity: this.env.airDensity,
      surface: this.surface,
      ...(options.gear === undefined ? {} : { gear: options.gear }),
      ...(options.ersMode === undefined ? {} : { ersMode: options.ersMode }),
      ...(options.brakeBias === undefined ? {} : { brakeBias: options.brakeBias }),
      ...(options.ersStore === undefined ? {} : { ersStore: options.ersStore }),
    });
    this.recordEvery = options.recordEvery ?? 0;
    this.trace = this.recordEvery > 0 ? { columns: TRACE_COLUMNS, rows: [] } : undefined;
    if (this.trace) this.record();
  }

  /** One sim step with the current `input`; the gear request is consumed. */
  step(): void {
    stepCar(this.car, this.input, this.surface, STEP, this.env);
    this.input.gearShift = 0;
    this.time = ++this.steps * STEP;
    readCarTelemetry(this.car, this.tel, this.env.gravity);
    if (this.trace && this.steps % this.recordEvery === 0) this.record();
  }

  private record(): void {
    const t = readCarTelemetry(this.car, this.tel, this.env.gravity);
    const c = this.car;
    const deg = 180 / Math.PI;
    this.trace!.rows.push([
      this.time,
      t.x,
      t.z,
      t.yaw,
      t.speed * 3.6,
      t.engineRpm,
      t.gear,
      t.throttle,
      t.brake,
      t.steerAngle * deg,
      t.longG,
      t.latG,
      t.vertG,
      t.wheelLoad[0]!,
      t.wheelLoad[1]!,
      t.wheelLoad[2]!,
      t.wheelLoad[3]!,
      t.slipRatio[0]!,
      t.slipRatio[1]!,
      t.slipRatio[2]!,
      t.slipRatio[3]!,
      t.slipAngle[0]! * deg,
      t.slipAngle[1]! * deg,
      t.slipAngle[2]! * deg,
      t.slipAngle[3]! * deg,
      t.rideHeightFront * 1000,
      t.rideHeightRear * 1000,
      t.pitch * deg,
      t.roll * deg,
      t.downforce,
      t.drag,
      t.drs,
      t.ersStore / 1e6,
      t.ersDeployLap / 1e6,
      t.ersHarvestLap / 1e6,
      t.mgukPower / 1e3,
      t.fuelMass,
      c.yawRate * deg,
      t.distance,
    ]);
  }
}

/** Mean of `values` over a trailing window of `n` entries, kept in a ring. */
export class MovingAverage {
  private readonly buf: Float64Array;
  private i = 0;
  private count = 0;
  private sum = 0;
  constructor(n: number) {
    this.buf = new Float64Array(Math.max(1, Math.round(n)));
  }
  push(v: number): number {
    if (this.count === this.buf.length) this.sum -= this.buf[this.i]!;
    else this.count++;
    this.buf[this.i] = v;
    this.sum += v;
    this.i = (this.i + 1) % this.buf.length;
    return this.sum / this.count;
  }
  get full(): boolean {
    return this.count === this.buf.length;
  }
}
