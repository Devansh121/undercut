import { createSurfaceHint, type SurfaceHint, type SurfaceSampler } from './contracts';
import { PATCH_HINTS, createPatchSample, samplePatch } from './contact';
import { STANDARD_GRAVITY } from './environment';
import { createCarModel, type CarModel } from './model';
import type { CarParams } from './params';

/** MGU-K deployment modes. Numeric so they live in snapshots. */
export const ErsMode = {
  /** No deployment; harvesting continues. */
  None: 0,
  /** Full power at full throttle, stopping near the end of long straights to save energy. */
  Balanced: 1,
  /** Full power whenever the throttle is mostly open, while the limits allow. */
  Overtake: 2,
} as const;
export type ErsMode = (typeof ErsMode)[keyof typeof ErsMode];

/**
 * The complete mutable state of one car. Every field that changes during a step is a number or
 * a number array, so the state copies into a flat `Float64Array` (see `snapshotCar`).
 *
 * Frames: world is three.js (+Y up, +X east, +Z south). Velocities `vx`, `vy` are in the car's
 * horizontal frame with +x forward and +y to the LEFT (the body frame's −Z), so a positive yaw
 * rate and a positive `vy` both mean "to the left". Pitch is positive nose up, roll positive
 * with the right side down (rotation about the body +X axis).
 */
export class CarState {
  readonly model: CarModel;
  /** Surface search hints, one per wheel. Caches only; never part of a snapshot. */
  readonly hints: readonly SurfaceHint[] = [
    createSurfaceHint(),
    createSurfaceHint(),
    createSurfaceHint(),
    createSurfaceHint(),
  ];
  /** Barrier search hints, one per body corner (front left, front right, rear left, rear right). */
  readonly wallHints: readonly SurfaceHint[] = [
    createSurfaceHint(),
    createSurfaceHint(),
    createSurfaceHint(),
    createSurfaceHint(),
  ];
  /** Hints for the contact-patch sample points, `PATCH_HINTS` per wheel. Caches only. */
  readonly patchHints: readonly SurfaceHint[] = Array.from(
    { length: 4 * PATCH_HINTS },
    createSurfaceHint,
  );

  // Planar motion.
  x = 0;
  z = 0;
  yaw = 0;
  vx = 0;
  vy = 0;
  yawRate = 0;
  // Sprung body: world height of the floor reference below the sprung CoG, pitch and roll.
  y = 0;
  heaveRate = 0;
  pitch = 0;
  pitchRate = 0;
  roll = 0;
  rollRate = 0;
  // Power unit.
  engineSpeed = 0;
  gear = 1;
  shiftTarget = 1;
  shiftTimer = 0;
  driveTorque = 0;
  fuelMass = 0;
  ersStore = 0;
  ersDeployLap = 0;
  ersHarvestLap = 0;
  ersMode: number = ErsMode.Balanced;
  mgukLocked = 1;
  mgukPower = 0;
  mguhPower = 0;
  brakeBias = 0.57;
  // Aero.
  drsPosition = 0;
  drsLatched = 0;
  downforceFront = 0;
  downforceRear = 0;
  dragForce = 0;
  rideHeightFront = 0;
  rideHeightRear = 0;
  // What actually reached the car on the last step.
  steerAngle = 0;
  throttleApplied = 0;
  brakeApplied = 0;
  // Specific force on the body (accelerometer reading without gravity), m/s².
  accelX = 0;
  accelY = 0;
  accelVertical = 0;
  distance = 0;
  // Seams for later systems: slipstream and damage scale the aero; contacts push the car.
  downforceScale = 1;
  dragScale = 1;
  externalForceX = 0;
  externalForceZ = 0;
  externalTorque = 0;
  /**
   * Contact diagnostics (see `liftOutOfGround` in step.ts). `groundSteps`: substeps that met a
   * step in the ground, the last line of defence, which never acts on a continuous track.
   * `contactLifts`: floor or rim strikes resolved inelastically; zero on the racing line, and off
   * it only on raised kerbs taken hard.
   */
  groundSteps = 0;
  contactLifts = 0;
  /**
   * Barrier contact on the last step: the largest speed into a barrier at a contact, m/s (0 when
   * nothing hit), and 1 while any body corner touches a barrier. For damage and audio later.
   */
  wallImpactSpeed = 0;
  wallContact = 0;

  // Per wheel, in FL, FR, RL, RR order.
  readonly wheelSpeed = new Float64Array(4);
  readonly wheelAngle = new Float64Array(4);
  readonly wheelY = new Float64Array(4);
  readonly wheelVy = new Float64Array(4);
  readonly deflectX = new Float64Array(4);
  readonly deflectY = new Float64Array(4);
  readonly groundY = new Float64Array(4);
  readonly load = new Float64Array(4);
  readonly slipRatio = new Float64Array(4);
  readonly slipTan = new Float64Array(4);
  readonly forceX = new Float64Array(4);
  readonly forceY = new Float64Array(4);
  readonly travel = new Float64Array(4);
  /** Per-wheel grip multiplier for later tyre temperature, wear and damage. */
  readonly gripScale = new Float64Array([1, 1, 1, 1]);
  /**
   * Diagnostics from the last substep, never part of a snapshot (they are outputs, recomputed
   * every substep): the carcass damping share of each tyre's vertical load, N, and the total
   * vertical force of the floor's skid points on the ground, N.
   */
  readonly tyreDamping = new Float64Array(4);
  plankForce = 0;

  constructor(model: CarModel) {
    this.model = model;
  }

  get params(): CarParams {
    return this.model.params;
  }
}

/** Select the MGU-K deployment mode (driver setting, HUD or AI). Throws on an unknown mode. */
export function setErsMode(state: CarState, mode: ErsMode): void {
  if (mode !== ErsMode.None && mode !== ErsMode.Balanced && mode !== ErsMode.Overtake) {
    throw new RangeError(`unknown ERS mode ${String(mode)}`);
  }
  state.ersMode = mode;
}

const SCALAR_KEYS = [
  'x',
  'z',
  'yaw',
  'vx',
  'vy',
  'yawRate',
  'y',
  'heaveRate',
  'pitch',
  'pitchRate',
  'roll',
  'rollRate',
  'engineSpeed',
  'gear',
  'shiftTarget',
  'shiftTimer',
  'driveTorque',
  'fuelMass',
  'ersStore',
  'ersDeployLap',
  'ersHarvestLap',
  'ersMode',
  'mgukLocked',
  'mgukPower',
  'mguhPower',
  'brakeBias',
  'drsPosition',
  'drsLatched',
  'downforceFront',
  'downforceRear',
  'dragForce',
  'rideHeightFront',
  'rideHeightRear',
  'steerAngle',
  'throttleApplied',
  'brakeApplied',
  'accelX',
  'accelY',
  'accelVertical',
  'distance',
  'downforceScale',
  'dragScale',
  'externalForceX',
  'externalForceZ',
  'externalTorque',
  'groundSteps',
  'contactLifts',
  'wallImpactSpeed',
  'wallContact',
] as const satisfies readonly (keyof CarState)[];

const WHEEL_KEYS = [
  'wheelSpeed',
  'wheelAngle',
  'wheelY',
  'wheelVy',
  'deflectX',
  'deflectY',
  'groundY',
  'load',
  'slipRatio',
  'slipTan',
  'forceX',
  'forceY',
  'travel',
  'gripScale',
] as const satisfies readonly (keyof CarState)[];

/** Length of a car snapshot in numbers. */
export const CAR_SNAPSHOT_LENGTH = SCALAR_KEYS.length + WHEEL_KEYS.length * 4;

/** Copy every number of the state into `out` (allocated if absent). Plain numbers only. */
export function snapshotCar(state: CarState, out?: Float64Array): Float64Array {
  const buf = out ?? new Float64Array(CAR_SNAPSHOT_LENGTH);
  if (buf.length < CAR_SNAPSHOT_LENGTH) throw new RangeError('snapshot buffer too short');
  let k = 0;
  for (const key of SCALAR_KEYS) buf[k++] = state[key];
  for (const key of WHEEL_KEYS) {
    const arr = state[key];
    for (let i = 0; i < 4; i++) buf[k++] = arr[i] as number;
  }
  return buf;
}

/** Overwrite `state` from a snapshot taken by `snapshotCar` on a car with the same params. */
export function restoreCar(state: CarState, snapshot: ArrayLike<number>): void {
  if (snapshot.length < CAR_SNAPSHOT_LENGTH) throw new RangeError('snapshot too short');
  let k = 0;
  const target = state as unknown as Record<string, number>;
  for (const key of SCALAR_KEYS) target[key] = snapshot[k++] as number;
  for (const key of WHEEL_KEYS) {
    const arr = state[key];
    for (let i = 0; i < 4; i++) arr[i] = snapshot[k++] as number;
  }
  for (const hint of state.hints) hint.index = -1;
  for (const hint of state.wallHints) hint.index = -1;
  for (const hint of state.patchHints) hint.index = -1;
}

export interface CarStartOptions {
  x?: number;
  z?: number;
  /** Heading, rad. Zero faces +X (east); positive turns left. */
  yaw?: number;
  /** Initial forward speed, m/s. */
  speed?: number;
  /** Fuel load, kg. Default 105 kg (doc 1.1 race start). */
  fuel?: number;
  /** Gear, −1 reverse, 0 neutral, 1–8. Default 1 at rest, otherwise the gear nearest 10 500 rpm. */
  gear?: number;
  /** Energy store, J. Default full window. */
  ersStore?: number;
  ersMode?: ErsMode;
  /** Brake bias, front share. Default from params. */
  brakeBias?: number;
  /** Surface the car starts on (for wheel and body heights). Default flat at y = 0. */
  surface?: SurfaceSampler;
  /** Air density for the aero load in the initial settle, kg/m³. */
  airDensity?: number;
}

/**
 * A car at rest (or rolling at `speed`) in static equilibrium on the surface under it.
 * The suspension starts at the deflections that carry the static weight plus the aero load at
 * the start speed, so a rolling start does not drop onto its springs.
 */
export function createCarState(params: CarParams, options: CarStartOptions = {}): CarState {
  const model = createCarModel(params);
  const s = new CarState(model);
  const speed = options.speed ?? 0;
  s.x = options.x ?? 0;
  s.z = options.z ?? 0;
  s.yaw = options.yaw ?? 0;
  s.vx = speed;
  s.fuelMass = Math.min(Math.max(options.fuel ?? 105, 0), params.mass.fuelCapacity);
  s.ersStore = options.ersStore ?? params.ers.storeWindow;
  s.ersMode = options.ersMode ?? ErsMode.Balanced;
  s.brakeBias = options.brakeBias ?? params.brakes.bias;
  s.mgukLocked = speed >= params.ers.startDeploySpeed ? 0 : 1;

  const R = params.tyre.rollingRadius;
  for (let i = 0; i < 4; i++) s.wheelSpeed[i] = speed / R;
  const gear = options.gear ?? (speed > 1 ? gearForSpeed(params, speed) : 1);
  s.gear = gear;
  s.shiftTarget = gear;
  const ratio = gearRatio(params, gear);
  const idle = (params.engine.idleRpm * 2 * Math.PI) / 60;
  s.engineSpeed = Math.max(idle, Math.abs(ratio) * (speed / R));

  settleSuspension(s, options.surface, options.airDensity ?? 1.184);
  return s;
}

/** Overall ratio for a gear index (0 for neutral). */
export function gearRatio(params: CarParams, gear: number): number {
  if (gear > 0) return params.gearbox.ratios[gear - 1] ?? 0;
  if (gear < 0) return params.gearbox.reverseRatio;
  return 0;
}

function gearForSpeed(params: CarParams, speed: number): number {
  const target = (10500 * 2 * Math.PI) / 60;
  const wheel = speed / params.tyre.rollingRadius;
  const ratios = params.gearbox.ratios;
  for (let g = 1; g <= ratios.length; g++) {
    if ((ratios[g - 1] as number) * wheel <= target) return g;
  }
  return ratios.length;
}

/** Mass properties for the current fuel load. Shared by the step and the initial settle. */
export interface MassState {
  total: number;
  sprung: number;
  /** Total CoG behind the front axle (a) and ahead of the rear axle (b). */
  a: number;
  b: number;
  /** Sprung CoG behind the front axle and ahead of the rear axle. */
  sprungA: number;
  sprungB: number;
  yawInertia: number;
}

export function computeMass(model: CarModel, fuel: number, out: MassState): MassState {
  const { mass, geometry } = model.params;
  const L = geometry.wheelbase;
  const total = mass.dryMass + fuel;
  const a = (mass.dryMass * model.cgDry + fuel * model.cgFuel) / total;
  const unsprung = 2 * (mass.unsprungFront + mass.unsprungRear);
  const sprung = total - unsprung;
  const sprungA = (total * a - 2 * mass.unsprungRear * L) / sprung;
  const dd = model.cgDry - a;
  const df = model.cgFuel - a;
  out.total = total;
  out.sprung = sprung;
  out.a = a;
  out.b = L - a;
  out.sprungA = sprungA;
  out.sprungB = L - sprungA;
  out.yawInertia = mass.yawInertia + mass.dryMass * dd * dd + fuel * df * df;
  return out;
}

const settleMass: MassState = {
  total: 0,
  sprung: 0,
  a: 0,
  b: 0,
  sprungA: 0,
  sprungB: 0,
  yawInertia: 0,
};

function settleSuspension(s: CarState, surface: SurfaceSampler | undefined, rho: number): void {
  const model = s.model;
  const p = model.params;
  const g = STANDARD_GRAVITY;
  const m = computeMass(model, s.fuelMass, settleMass);
  const L = p.geometry.wheelbase;
  const patch = createPatchSample();
  const c = Math.cos(s.yaw);
  const sn = Math.sin(s.yaw);
  for (let i = 0; i < 4; i++) {
    const bx = i < 2 ? m.a : -m.b;
    const by = model.wheelLeft[i] as number;
    const px = s.x + bx * c - by * sn;
    const pz = s.z - bx * sn - by * c;
    const width = i < 2 ? p.tyre.patchWidthFront : p.tyre.patchWidthRear;
    if (surface) {
      samplePatch(
        surface,
        px,
        pz,
        c,
        -sn,
        width,
        p.tyre.patchLength,
        s.patchHints,
        i * PATCH_HINTS,
        patch,
      );
    }
    s.groundY[i] = surface ? patch.height : 0;
  }
  // Aero load at the start speed with the reference coefficients (refined by the step itself).
  const q = 0.5 * rho * s.vx * s.vx;
  const aeroFront = q * p.aero.clA * p.aero.balance;
  const aeroRear = q * p.aero.clA * (1 - p.aero.balance);
  const frontAxle = m.total * g * (m.b / L) + aeroFront;
  const rearAxle = m.total * g * (m.a / L) + aeroRear;
  const yc = [0, 0, 0, 0];
  for (let i = 0; i < 4; i++) {
    const front = i < 2;
    const corner = (front ? frontAxle : rearAxle) / 2;
    const unsprung = (front ? p.mass.unsprungFront : p.mass.unsprungRear) * g;
    const k = front ? p.suspension.springFront : p.suspension.springRear;
    const wheelY = (s.groundY[i] as number) + p.tyre.freeRadius - corner / p.tyre.verticalStiffness;
    s.wheelY[i] = wheelY;
    s.wheelVy[i] = 0;
    s.load[i] = corner;
    const compression = (corner - unsprung) / k;
    s.travel[i] = compression - (model.staticCompression[i] as number);
    yc[i] = wheelY + (model.springFree[i] as number) - compression;
  }
  const front = ((yc[0] as number) + (yc[1] as number)) / 2;
  const rear = ((yc[2] as number) + (yc[3] as number)) / 2;
  s.pitch = (front - rear) / L;
  s.y = front - m.sprungA * s.pitch;
  const rollF = ((yc[0] as number) - (yc[1] as number)) / p.geometry.trackFront;
  const rollR = ((yc[2] as number) - (yc[3] as number)) / p.geometry.trackRear;
  s.roll = (rollF + rollR) / 2;
  s.rideHeightFront = front - ((s.groundY[0] as number) + (s.groundY[1] as number)) / 2;
  s.rideHeightRear = rear - ((s.groundY[2] as number) + (s.groundY[3] as number)) / 2;
}
