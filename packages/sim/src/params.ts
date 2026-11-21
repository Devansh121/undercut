/**
 * Car parameters: the reference car of the 2022–2025 ground-effect era and its three aero trims.
 *
 * Every number traces to `docs/physics-validation.md` section 1 ("doc 1.x"), with its source
 * number there, or is marked "estimate" with the reasoning. Values tuned inside a documented
 * range are listed in that document's Results section. SI units throughout.
 */

export interface MassParams {
  /** Car plus driver, no fuel, kg. Doc 1.1 [1] Art. 4.1. */
  dryMass: number;
  /** Static front share of the dry mass. Doc 1.1: 45.5 % (middle of the regulated window). */
  frontShareDry: number;
  /**
   * Front share of the fuel mass alone, which places the fuel cell between the axles. Doc 1.1:
   * "the distribution moves only about 1 point rearward with a full tank" (105 kg): solving
   * (800 × 0.455 + 105 s) / 905 = 0.445 gives s = 0.369.
   */
  fuelFrontShare: number;
  /** Fuel capacity used to clamp the fuel state, kg. Doc 1.1: 110 kg reported cap (estimate). */
  fuelCapacity: number;
  /** Unsprung mass per corner, kg. Doc 1.1 (estimate): 25 front, 30 rear. */
  unsprungFront: number;
  unsprungRear: number;
  /** CoG height above the ground at static ride height, m. Doc 1.1: 0.30 (0.27–0.33). */
  cgHeight: number;
  /** Yaw inertia of the dry car, kg·m². Doc 1.1: 1200 (1000–1400). Fuel adds its own term. */
  yawInertia: number;
  /** Pitch and roll inertia of the sprung mass, kg·m². Doc 1.1: 1100 and 180. */
  pitchInertia: number;
  rollInertia: number;
}

export interface GeometryParams {
  /** m. Doc 1.1: 3.6 ([1] Art. 3.4.2 limit; estimate that cars run at it). */
  wheelbase: number;
  /** Wheel-centre track, m. Doc 1.1 (estimate): 1.62 front, 1.56 rear. */
  trackFront: number;
  trackRear: number;
  /** Largest road-wheel steer angle, rad. Estimate: a 10 m hairpin needs about L/R = 0.36 rad. */
  maxSteerAngle: number;
}

export interface TyreParams {
  /** Loaded rolling radius, m. Doc 1.2: 0.355 (estimate). */
  rollingRadius: number;
  /** Free (unloaded) radius, m. Doc 1.2: 0.36; diameter ≤ 0.725 m [1] Art. 10.8.1. */
  freeRadius: number;
  /** Vertical stiffness per tyre, N/m. Doc 1.6: 250–300 kN/m. */
  verticalStiffness: number;
  /**
   * Vertical damping at each tyre, N·s/m. Estimate: with springs five times stiffer than the
   * tyres, corner dampers barely act on the body modes, so the damping that gives doc 1.6's
   * ratios (heave 0.3–0.5, roll 0.6–0.8) is lumped here: tyre carcass plus the inerter and heave
   * damper of a real car. Measured free decay: heave ζ 0.33, roll ζ 0.60.
   */
  verticalDamping: number;
  /**
   * Peak lateral friction at the reference load. Doc 1.2: about 1.8 at 3 kN, below [44]'s
   * 1.85–2.15. This is the model's one fitted parameter: fitted to the Monza T1 2025 peak
   * deceleration (4.7 g, [21][47]) with the hardware-derived brakes, it comes out at 1.80.
   */
  muY: number;
  /** Peak longitudinal friction at the reference load. Doc 1.2: 0.9 × μy ([44] 0.89–0.91). */
  muX: number;
  /** d(mu)/d(Fz) of each, 1/N. Doc 1.2: −5e-5 ([44]) for μy, the same share for μx. */
  loadSensitivityY: number;
  loadSensitivityX: number;
  /** Reference load for `muY` and `muX`, N. Doc 1.2: 3 kN. */
  referenceLoad: number;
  /** Floor on the load-sensitive friction so very high loads stay physical. Estimate. */
  muMin: number;
  /**
   * Slip ratio and tan(slip angle) at the force peak. Estimate: racing slicks peak near 8–12 %
   * slip ratio and 4–6° slip angle; the 18-inch tyre has a stiffer sidewall, so the low ends.
   */
  peakSlipRatio: number;
  peakSlipTan: number;
  /**
   * Magic-formula shape factor C. With E = 0 the force falls after the peak to sin(C·π/2) of it
   * when fully sliding: 0.76 longitudinal (locked wheel) and 0.85 lateral. Estimate.
   */
  shapeX: number;
  shapeY: number;
  /** Relaxation lengths, m. Estimate: short longitudinally, about 0.7 tyre widths laterally. */
  relaxationX: number;
  relaxationY: number;
  /**
   * Carcass damping on the contact-patch deflection, N·s/m. Only acts below `lowSpeed`, where the
   * relaxation term no longer damps the patch (the low-speed damping of transient tyre models).
   */
  carcassDampingX: number;
  carcassDampingY: number;
  lowSpeed: number;
  /** Rolling-resistance coefficient on the tyre load. Estimate for racing slicks. */
  rollingResistance: number;
  /** Spin inertia of wheel, tyre, disc and hub, kg·m². Estimate for the 18-inch assembly. */
  wheelInertiaFront: number;
  wheelInertiaRear: number;
}

export interface SuspensionParams {
  /**
   * Wheel-centre spring rates, N/m. Doc 1.6 sets heave frequencies of 5–7 Hz front and 4.5–6 Hz
   * rear for the sprung mass on springs and tyres in series; these rates give 6.1 and 5.0 Hz.
   */
  springFront: number;
  springRear: number;
  /** Anti-roll bar rate per metre of left–right travel difference, N/m: 56 % front roll stiffness. */
  antiRollFront: number;
  antiRollRear: number;
  /** Per-corner dampers, N·s/m. Estimate; they mainly damp wheel hop (see `verticalDamping`). */
  damperFront: number;
  damperRear: number;
  /** Extra roll damping per axle on the left–right travel-rate difference, N·s/m. Estimate. */
  rollDamperFront: number;
  rollDamperRear: number;
  /**
   * Plank and floor-edge contact when the floor reaches the ground, per axle. Estimate. The
   * skid points sit at the floor edges, `floorHalfWidth` either side of the centreline.
   */
  plankStiffness: number;
  plankDamping: number;
  plankFriction: number;
  floorHalfWidth: number;
}

export interface AeroParams {
  /** Trim name for telemetry and reports. */
  name: string;
  /** Drag area with DRS closed at the reference ride height, m². Doc 1.4 table. */
  cdA: number;
  /** Downforce area at the reference ride height, m². Doc 1.4 table. */
  clA: number;
  /** Front share of downforce at the reference rake. Doc 1.4 table. */
  balance: number;
  /** Fractional drag change with DRS open. Doc 1.4 table (negative). */
  drsDrag: number;
  /** Fractional total downforce change with DRS open, all taken from the rear. Estimate. */
  drsDownforce: number;
  /**
   * Static floor ride heights at the axles, dry car, m. Doc 1.6: 20–30 mm front, 60–80 rear.
   * Part of the trim because teams raise the car with the downforce level.
   */
  rideHeightFront: number;
  rideHeightRear: number;
  /** Flap travel time, s. Estimate: a short hydraulic transient. */
  drsOpenTime: number;
  drsCloseTime: number;
  /**
   * Ride-height map (doc 1.4, shape estimate). ClA·(1 + k·(h0 − h)) with h a front-weighted
   * mean of the floor heights at the axles, a smooth stall of `stallLoss` over `stallWidth` once the floor's
   * leading edge drops below `stallHeight`, and drag sensitivity one third of the downforce
   * sensitivity. `referenceHeight` (h0) is the mean floor height at which the table ClA and
   * CdA hold: the doc fitted them to speed-trap and braking data, so h0 is the height the car
   * runs at 300 km/h on a flat straight in that trim (measured, see the Results section).
   */
  heightSensitivity: number;
  /** Weight of the front ride height in h; the floor's ground effect is led by its front. */
  frontHeightWeight: number;
  referenceHeight: number;
  /** Floor leading edge position as a fraction of the wheelbase behind the front axle. */
  leadingEdge: number;
  stallHeight: number;
  stallWidth: number;
  stallLoss: number;
  /** Balance change per metre of rake increase (front minus rear height falling). */
  rakeBalance: number;
  referenceRake: number;
}

export interface EngineParams {
  /** Fuel lower heating value, J/kg. Doc 1.4: about 43 MJ/kg. */
  fuelEnergy: number;
  /** Regulated fuel flow: 100 kg/h above 10 500 rpm, else 0.009·N + 5.5 kg/h. Doc 1.1 [1]. */
  flowMax: number;
  flowSlope: number;
  flowOffset: number;
  flowCornerRpm: number;
  /** Crank power at full fuel flow, W. Doc 1.3: 560 kW (540–590). Sets the shaft efficiency. */
  peakPower: number;
  /** Power holds to this speed, then friction grows: doc 1.3 "peak 10 500–11 500 rpm". */
  powerFadeRpm: number;
  /** Fractional power loss per (1000 rpm)² above `powerFadeRpm`. Estimate. */
  powerFade: number;
  /** Torque cap at low rpm, N·m. Estimate (the flow law alone diverges as rpm → 0). */
  maxTorque: number;
  /** Rev limiter, rpm, with a soft cut over `limiterWidth`. Doc 1.3: 12 500 rpm. */
  revLimit: number;
  limiterWidth: number;
  idleRpm: number;
  /** Closed-throttle friction and pumping torque: −(a + b·rpm), N·m. Estimate. */
  dragTorqueBase: number;
  dragTorquePerRpm: number;
  /** Crank, flywheel and MGU-K rotor inertia seen at the crank, kg·m². Estimate. */
  inertia: number;
  /** Clutch: slips below `clutchFullRpm` engine speed, no torque below `clutchStartRpm`. */
  clutchStartRpm: number;
  clutchFullRpm: number;
  clutchCapacity: number;
  /** Fuel burnt at idle, kg/s. Estimate. */
  idleFlow: number;
}

export interface ErsParams {
  /** MGU-K power and torque limits, W and N·m. Doc 1.3 [1] Art. 5.3.3. */
  mgukPower: number;
  mgukTorque: number;
  /** ES → MGU-K per lap and MGU-K → ES per lap, J. Doc 1.3 [1] Art. 5.3.2. */
  deployPerLap: number;
  harvestPerLap: number;
  /** State-of-charge window, J. Doc 1.3: max − min ≤ 4 MJ. */
  storeWindow: number;
  /** MGU-H harvest at full ICE load, W. Doc 1.3: 0–60 kW (estimate). */
  mguhPower: number;
  /** MGU-K may deploy only after the car first reaches this speed, m/s. Doc 1.3: 100 km/h. */
  startDeploySpeed: number;
}

export interface GearboxParams {
  /** Overall ratios, engine revs per wheel rev, 1st to 8th. Doc 1.3 (estimate). */
  ratios: readonly number[];
  /** Reverse, negative. Estimate. */
  reverseRatio: number;
  /** Shift times, s. Doc 1.3: 30 ms up, 60 ms down. */
  upshiftTime: number;
  downshiftTime: number;
  /** Doc 1.3: 0.95. */
  efficiency: number;
}

export interface DiffParams {
  /** Locking torque = preload + ramp·|input torque|, N·m. Estimate. */
  preload: number;
  rampDrive: number;
  rampCoast: number;
}

/**
 * Brake hardware. The full-pedal torque follows from it (`brakeCapacity`), not from any
 * operating point: the published peak braking powers (doc 1.5) are event figures, so they are
 * checked against the model's output instead of being used to set a ceiling.
 */
export interface BrakeParams {
  /** Peak pedal force, N. Doc 1.5: 145–162 kg at the hardest stops; 160 kg. */
  pedalForce: number;
  /** Pedal lever ratio. Estimate: about 3:1 on racing pedal boxes. */
  pedalRatio: number;
  /** Master-cylinder bore area, m². Estimate: 17.8 mm (0.7 in) bore. */
  masterCylinderArea: number;
  /** Front caliper piston area on one side of the disc, m². Estimate: three 36 mm pistons. */
  frontPistonArea: number;
  /**
   * Front effective friction radius, m. Doc 1.5: front discs 325–330 mm ([1] Art. 11.3); the
   * pad centre sits about 25 mm inside the 165 mm rim.
   */
  frontRadius: number;
  /** Carbon–carbon pad friction coefficient in its operating window. Estimate. */
  padFriction: number;
  /** Front share of friction torque. Doc 1.5: 57 % default, 52–62 % adjustable. */
  bias: number;
}

/**
 * Total brake torque at full pedal, N·m, as the sum over both axles. The balance bar sends the
 * bias share of the pedal force to the front master cylinder, so the front axle gets
 * bias · F·ratio / A_mc of line pressure on its pistons, two pad faces at the effective radius,
 * on two wheels; dividing by the bias gives the total the rear (brake-by-wire) matches to.
 */
export function brakeCapacity(b: BrakeParams): number {
  const pressurePerBias = (b.pedalForce * b.pedalRatio) / b.masterCylinderArea;
  return 2 * 2 * b.padFriction * pressurePerBias * b.frontPistonArea * b.frontRadius;
}

export interface CarParams {
  mass: MassParams;
  geometry: GeometryParams;
  tyre: TyreParams;
  suspension: SuspensionParams;
  aero: AeroParams;
  engine: EngineParams;
  ers: ErsParams;
  gearbox: GearboxParams;
  diff: DiffParams;
  brakes: BrakeParams;
}

export const AERO_LOW_DRAG: Readonly<AeroParams> = Object.freeze({
  name: 'low',
  cdA: 1.15, // doc 1.4: 1.15 (1.05–1.25), Monza
  clA: 3.6, // doc 1.4: 3.6 (3.0–4.2)
  balance: 0.44,
  drsDrag: -0.12,
  drsDownforce: -0.08, // estimate: a small rear wing has less to lose
  rideHeightFront: 0.025,
  rideHeightRear: 0.065,
  drsOpenTime: 0.2,
  drsCloseTime: 0.15,
  heightSensitivity: 20, // doc 1.4: k_h ≈ 0.02 per mm
  frontHeightWeight: 0.7, // estimate: "downforce rises as the floor's front ride height falls"
  referenceHeight: 0.0214, // measured at 300 km/h, 50 kg fuel (Results section)
  leadingEdge: 0.3, // estimate: the floor starts about 1.1 m behind the front axle
  stallHeight: 0.02, // doc 1.4: 15–20 mm; top of the range (see stallLoss)
  stallWidth: 0.004,
  // Doc 1.4: 10–25 %; top of the range. The published peak decelerations barely change with
  // the downforce level (4.7 g Monza, 4.9 g Singapore), so the floor must give up downforce
  // when the nose dives under braking, as a ground-effect floor does below its critical height.
  stallLoss: 0.25,
  rakeBalance: 0.6, // estimate: +0.6 points of front share per 10 mm more rake
  referenceRake: 0.0304, // measured at 300 km/h
});

export const AERO_MEDIUM: Readonly<AeroParams> = Object.freeze({
  ...AERO_LOW_DRAG,
  name: 'medium',
  cdA: 1.3, // doc 1.4: 1.30 (1.15–1.45), Spa
  clA: 4.6, // doc 1.4: 4.6 (4.0–5.2)
  balance: 0.44,
  drsDrag: -0.15,
  drsDownforce: -0.1,
  rideHeightFront: 0.027,
  rideHeightRear: 0.072,
  referenceHeight: 0.0207,
  referenceRake: 0.033,
});

export const AERO_HIGH_DOWNFORCE: Readonly<AeroParams> = Object.freeze({
  ...AERO_LOW_DRAG,
  name: 'high',
  cdA: 1.6, // doc 1.4: 1.60 (1.45–1.75), Singapore
  clA: 5.8, // doc 1.4: 5.8 (5.0–6.5)
  balance: 0.45,
  drsDrag: -0.18,
  drsDownforce: -0.12,
  rideHeightFront: 0.03,
  rideHeightRear: 0.08,
  referenceHeight: 0.0201,
  referenceRake: 0.0362,
});

export type AeroTrim = 'low' | 'medium' | 'high';

export const AERO_TRIMS: Readonly<Record<AeroTrim, Readonly<AeroParams>>> = Object.freeze({
  low: AERO_LOW_DRAG,
  medium: AERO_MEDIUM,
  high: AERO_HIGH_DOWNFORCE,
});

const RPM_TO_RAD = (2 * Math.PI) / 60;

/** The reference car in medium trim. Use `createCarParams` for another trim. */
export const REFERENCE_CAR: Readonly<CarParams> = deepFreeze({
  mass: {
    dryMass: 800,
    frontShareDry: 0.455,
    fuelFrontShare: 0.369,
    fuelCapacity: 110,
    unsprungFront: 25,
    unsprungRear: 30,
    cgHeight: 0.3,
    yawInertia: 1200,
    pitchInertia: 1100,
    rollInertia: 180,
  },
  geometry: {
    wheelbase: 3.6,
    trackFront: 1.62,
    trackRear: 1.56,
    maxSteerAngle: 0.38,
  },
  tyre: {
    rollingRadius: 0.355,
    freeRadius: 0.36,
    verticalStiffness: 300e3,
    verticalDamping: 7000,
    muY: 1.8,
    muX: 1.62,
    loadSensitivityY: -5e-5,
    loadSensitivityX: -4.5e-5,
    referenceLoad: 3000,
    muMin: 0.9,
    peakSlipRatio: 0.1,
    peakSlipTan: 0.09,
    shapeX: 1.45,
    shapeY: 1.35,
    relaxationX: 0.08,
    relaxationY: 0.25,
    carcassDampingX: 5000,
    carcassDampingY: 8000,
    lowSpeed: 5,
    rollingResistance: 0.012,
    wheelInertiaFront: 1.2,
    wheelInertiaRear: 1.4,
  },
  suspension: {
    springFront: 1.5e6,
    springRear: 0.6e6,
    antiRollFront: 0.9e6,
    antiRollRear: 0.25e6,
    damperFront: 5000,
    damperRear: 4800,
    rollDamperFront: 800,
    rollDamperRear: 500,
    plankStiffness: 2e6,
    plankDamping: 2e4,
    plankFriction: 0.3,
    floorHalfWidth: 0.7, // estimate: the floor is about 1.4 m wide inside a 2 m car
  },
  aero: { ...AERO_MEDIUM },
  engine: {
    fuelEnergy: 43e6,
    flowMax: 100 / 3600,
    flowSlope: 0.009 / 3600,
    flowOffset: 5.5 / 3600,
    flowCornerRpm: 10500,
    peakPower: 560e3,
    powerFadeRpm: 11500,
    powerFade: 0.12,
    maxTorque: 560,
    revLimit: 12500,
    limiterWidth: 100,
    idleRpm: 4000,
    dragTorqueBase: 20,
    dragTorquePerRpm: 0.006,
    inertia: 0.02,
    clutchStartRpm: 4500,
    clutchFullRpm: 6500,
    clutchCapacity: 1500,
    idleFlow: 0.5 / 3600,
  },
  ers: {
    mgukPower: 120e3,
    mgukTorque: 200,
    deployPerLap: 4e6,
    harvestPerLap: 2e6,
    storeWindow: 4e6,
    mguhPower: 60e3,
    startDeploySpeed: 100 / 3.6,
  },
  gearbox: {
    ratios: [16.5, 12.4, 10.1, 8.5, 7.3, 6.3, 5.4, 4.6],
    reverseRatio: -18,
    upshiftTime: 0.03,
    downshiftTime: 0.06,
    efficiency: 0.95,
  },
  diff: {
    preload: 100,
    rampDrive: 0.4,
    rampCoast: 0.25,
  },
  brakes: {
    pedalForce: 160 * 9.80665,
    pedalRatio: 3,
    masterCylinderArea: Math.PI * 0.0089 * 0.0089,
    frontPistonArea: 3 * Math.PI * 0.018 * 0.018,
    frontRadius: 0.14,
    padFriction: 0.55,
    bias: 0.57,
  },
});

/** The reference car with another aero trim, and optional overrides per section. */
export function createCarParams(
  trim: AeroTrim = 'medium',
  overrides: { [K in keyof CarParams]?: Partial<CarParams[K]> } = {},
): CarParams {
  const base = REFERENCE_CAR;
  return {
    mass: { ...base.mass, ...overrides.mass },
    geometry: { ...base.geometry, ...overrides.geometry },
    tyre: { ...base.tyre, ...overrides.tyre },
    suspension: { ...base.suspension, ...overrides.suspension },
    aero: { ...AERO_TRIMS[trim], ...overrides.aero },
    engine: { ...base.engine, ...overrides.engine },
    ers: { ...base.ers, ...overrides.ers },
    gearbox: { ...base.gearbox, ...overrides.gearbox },
    diff: { ...base.diff, ...overrides.diff },
    brakes: { ...base.brakes, ...overrides.brakes },
  };
}

export const rpmToRad = (rpm: number): number => rpm * RPM_TO_RAD;
export const radToRpm = (rad: number): number => rad / RPM_TO_RAD;

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const v of Object.values(value)) deepFreeze(v);
    Object.freeze(value);
  }
  return value;
}
