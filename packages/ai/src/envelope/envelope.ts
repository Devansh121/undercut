/**
 * The car's performance envelope, measured from the vehicle model itself (`measure.ts`): what
 * the car can do in each direction as a function of speed and of the normal load factor (how
 * hard the ground pushes back, in g: above 1 in a compression or on banking, below 1 over a
 * crest). Plain data so it serialises to a small committed artefact; `EnvelopeModel` gives
 * O(1) interpolated lookups for the speed-profile passes.
 *
 * Every table is on the same uniform speed grid. Accelerations are in m/s².
 */
export interface Envelope {
  readonly format: 'undercut-envelope';
  readonly version: 1;
  /** What was measured: trim name, air density (kg/m³), fuel (kg), total mass (kg), bias. */
  readonly conditions: {
    readonly trim: string;
    readonly airDensity: number;
    readonly fuel: number;
    readonly mass: number;
    readonly brakeBias: number;
  };
  /** Uniform speed grid, m/s. */
  readonly speeds: readonly number[];
  /** Normal load factors the load-dependent tables were measured at, ascending. */
  readonly loads: readonly number[];
  /** Sustained lateral acceleration at the limit, [load][speed]. */
  readonly lateral: readonly (readonly number[])[];
  /** Tyre braking deceleration at the threshold, drag excluded, [load][speed]. */
  readonly brake: readonly (readonly number[])[];
  /** Tyre drive acceleration at the traction limit, drag excluded, [load][speed]. */
  readonly traction: readonly (readonly number[])[];
  /**
   * Net full-throttle acceleration on the flat (power and traction limits, drag included) at
   * load 1, through the gears with the measured shift points: DRS closed or open, with the
   * MGU-K deploying or not.
   */
  readonly drive: {
    readonly closedErs: readonly number[];
    readonly closedNoErs: readonly number[];
    readonly openErs: readonly number[];
    readonly openNoErs: readonly number[];
  };
  /** Aerodynamic drag deceleration, DRS closed and open. */
  readonly drag: { readonly closed: readonly number[]; readonly open: readonly number[] };
  /**
   * Shape of the combined limit: (|ax|/ax_max)^p + (|ay|/ay_max)^p ≤ 1, fitted to braking-in-a-
   * turn measurements.
   */
  readonly combinedExponent: number;
  /** MGU-H power at full throttle (feeds the MGU-K before the store), W, per speed. */
  readonly mguh: readonly number[];
  /** MGU-K harvest while threshold braking, W, per speed (before the per-lap cap). */
  readonly harvest: readonly number[];
  /** The car's ERS limits (sim parameters): MGU-K power, per-lap deploy and harvest, window. */
  readonly ers: {
    readonly mgukPower: number;
    readonly deployPerLap: number;
    readonly harvestPerLap: number;
    readonly storeWindow: number;
  };
  /** Upshift points per gear, rpm (from the engine's full-load curve). */
  readonly shiftRpm: readonly number[];
  /** Highest speed reached on the flat at full throttle with the MGU-K, m/s. */
  readonly topSpeed: { readonly closed: number; readonly open: number };
}

/** Fractions of the measured envelope a driver plans with (1 = all of it). */
export interface EnvelopeScale {
  lateral: number;
  brake: number;
  traction: number;
}

export const FULL_ENVELOPE: Readonly<EnvelopeScale> = Object.freeze({
  lateral: 1,
  brake: 1,
  traction: 1,
});

/** Fast interpolated lookups into an `Envelope`. */
export class EnvelopeModel {
  readonly envelope: Envelope;
  private readonly v0: number;
  private readonly dv: number;
  private readonly nv: number;
  private readonly lateralT: Float64Array[];
  private readonly brakeT: Float64Array[];
  private readonly tractionT: Float64Array[];
  private readonly loads: Float64Array;
  private readonly driveT: Float64Array[];
  private readonly dragT: Float64Array[];
  private readonly mguhT: Float64Array;
  private readonly harvestT: Float64Array;
  readonly exponent: number;

  constructor(envelope: Envelope) {
    this.envelope = envelope;
    const v = envelope.speeds;
    this.nv = v.length;
    this.v0 = v[0]!;
    this.dv = (v[v.length - 1]! - v[0]!) / (v.length - 1);
    for (let i = 1; i < v.length; i++) {
      if (Math.abs(v[i]! - v[0]! - i * this.dv) > 1e-3 * this.dv)
        throw new Error('speed grid not uniform');
    }
    const f = (a: readonly number[]): Float64Array => Float64Array.from(a);
    this.loads = Float64Array.from(envelope.loads);
    this.lateralT = envelope.lateral.map(f);
    this.brakeT = envelope.brake.map(f);
    this.tractionT = envelope.traction.map(f);
    this.driveT = [
      f(envelope.drive.closedNoErs),
      f(envelope.drive.closedErs),
      f(envelope.drive.openNoErs),
      f(envelope.drive.openErs),
    ];
    this.dragT = [f(envelope.drag.closed), f(envelope.drag.open)];
    this.mguhT = f(envelope.mguh);
    this.harvestT = f(envelope.harvest);
    this.exponent = envelope.combinedExponent;
  }

  /** Linear interpolation on the speed grid, linear extrapolation past either end. */
  private atSpeed(t: Float64Array, v: number): number {
    let u = (v - this.v0) / this.dv;
    let i = Math.floor(u);
    if (i < 0) i = 0;
    else if (i > this.nv - 2) i = this.nv - 2;
    u -= i;
    return t[i]! + (t[i + 1]! - t[i]!) * u;
  }

  private atSpeedLoad(t: Float64Array[], v: number, load: number): number {
    const L = this.loads;
    const m = L.length;
    if (m === 1) return this.atSpeed(t[0]!, v);
    let j = 0;
    while (j < m - 2 && load > L[j + 1]!) j++;
    const w = (load - L[j]!) / (L[j + 1]! - L[j]!);
    const a = this.atSpeed(t[j]!, v);
    const b = this.atSpeed(t[j + 1]!, v);
    return a + (b - a) * w;
  }

  lateral(v: number, load: number): number {
    return Math.max(0, this.atSpeedLoad(this.lateralT, v, load));
  }

  brake(v: number, load: number): number {
    return Math.max(0, this.atSpeedLoad(this.brakeT, v, load));
  }

  traction(v: number, load: number): number {
    return Math.max(0, this.atSpeedLoad(this.tractionT, v, load));
  }

  /** Net full-throttle acceleration on the flat at load 1, drag included. */
  drive(v: number, drsOpen: boolean, ers: boolean): number {
    return this.atSpeed(this.driveT[(drsOpen ? 2 : 0) + (ers ? 1 : 0)]!, v);
  }

  drag(v: number, drsOpen: boolean): number {
    return Math.max(0, this.atSpeed(this.dragT[drsOpen ? 1 : 0]!, v));
  }

  mguh(v: number): number {
    return Math.max(0, this.atSpeed(this.mguhT, v));
  }

  harvest(v: number): number {
    return Math.max(0, this.atSpeed(this.harvestT, v));
  }

  /**
   * Fraction of a pure limit left when `used` of the other direction's limit is taken:
   * (1 − used^p)^(1/p), for `used` in [0, 1].
   */
  remaining(used: number): number {
    if (used >= 1) return 0;
    if (used <= 0) return 1;
    const p = this.exponent;
    return Math.pow(1 - Math.pow(used, p), 1 / p);
  }
}

/** The committed envelope file: the envelope plus the hash of what produced it. */
export type EnvelopeArtefact = Envelope & { readonly inputsHash: string };

/** Validate a parsed envelope file. Throws with the first problem found. */
export function decodeEnvelope(raw: unknown): EnvelopeArtefact {
  const fail = (msg: string): never => {
    throw new Error(`envelope: ${msg}`);
  };
  if (!raw || typeof raw !== 'object') return fail('not an object');
  const e = raw as Record<string, unknown>;
  if (e.format !== 'undercut-envelope') fail(`format is ${String(e.format)}`);
  if (e.version !== 1) fail(`unsupported version ${String(e.version)}`);
  if (typeof e.inputsHash !== 'string') fail('inputsHash missing');
  const speeds = e.speeds;
  if (!Array.isArray(speeds) || speeds.length < 2) fail('speed grid missing');
  const nv = (speeds as unknown[]).length;
  const loads = e.loads;
  if (!Array.isArray(loads) || loads.length < 1) fail('loads missing');
  for (const k of ['lateral', 'brake', 'traction'] as const) {
    const t = e[k];
    if (!Array.isArray(t) || t.length !== (loads as unknown[]).length)
      fail(`${k} needs a row per load`);
    for (const row of t as unknown[]) {
      if (!Array.isArray(row) || row.length !== nv) fail(`${k} rows need ${nv} entries`);
    }
  }
  const drive = e.drive as Record<string, unknown> | undefined;
  for (const k of ['closedErs', 'closedNoErs', 'openErs', 'openNoErs']) {
    if (!drive || !Array.isArray(drive[k]) || (drive[k] as unknown[]).length !== nv)
      fail(`drive.${k} needs ${nv} entries`);
  }
  if (typeof e.combinedExponent !== 'number' || !(e.combinedExponent >= 1))
    fail('combined exponent must be at least 1');
  return raw as EnvelopeArtefact;
}
