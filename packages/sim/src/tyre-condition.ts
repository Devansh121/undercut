import type { CarState } from './state';

/**
 * Tyre condition: the compound fitted, each tyre's tread temperature and wear, and the grip
 * they leave (`CarState.gripScale`, which multiplies the surface's grip at each wheel).
 *
 * Opt-in per car: a car with no compound fitted (`tyreCompound` −1, the default) keeps
 * `gripScale` at whatever it holds and steps exactly as before; the physics validation and the
 * reference laps run that way. The reference compound is the soft, new and inside its working
 * range: that is the tyre the model's friction was fitted to (docs/physics-validation.md 1.2
 * and 2.1, "new softest compound"), so it gives a grip factor of exactly 1.
 *
 * Kept out of `CarParams` on purpose: the AI's committed envelopes and lines fingerprint the
 * car's parameters, and the condition model does not change what they measure (new reference
 * tyres).
 *
 * Plain numbers, no allocation per step; the state lives in the car's snapshot.
 */

export type CompoundId = 'soft' | 'medium' | 'hard';

export interface CompoundParams {
  readonly id: CompoundId;
  /** Peak friction against the reference (soft, new, in its window). */
  readonly grip: number;
  /** Working range of the tread, K: grip is full inside it. */
  readonly windowLow: number;
  readonly windowHigh: number;
  /** Wear per joule of sliding energy into the tread, 1/J (wear 1 = the tread gone). */
  readonly wearRate: number;
}

const C = 273.15;

/**
 * The three dry compounds. Working ranges: Pirelli's last published windows (13-inch era,
 * 2019) shifted 5 °C lower for the 70 °C blanket limit, docs/physics-validation.md 4.2 [38]
 * [17], taking soft, medium and hard as C5, C4 and C3 (Monza's and Singapore's 2025
 * nomination; Spa's hard was C1, see 4.2 and 1.2). Grip steps between compounds and wear
 * rates are **estimates** (section 4.2: no published per-compound figures); `wearRate` is
 * calibrated so the lap-time loss to wear lands in section 4.2's bands at Monza
 * (packages/ai/validation/tyres.test.ts): soft 0.10, medium 0.065, hard 0.04 s a lap, with a
 * lap there costing 0.31 s per 1 % of grip (quasi-steady: the racing line re-planned on a
 * scaled envelope). The grip steps cost 0.28 s (medium) and 0.55 s (hard) a lap there.
 */
export const COMPOUNDS: readonly CompoundParams[] = Object.freeze([
  Object.freeze({
    id: 'soft',
    grip: 1,
    windowLow: C + 80,
    windowHigh: C + 110,
    wearRate: 1.0e-7,
  } as const),
  Object.freeze({
    id: 'medium',
    grip: 0.991,
    windowLow: C + 85,
    windowHigh: C + 115,
    wearRate: 7.6e-8,
  } as const),
  Object.freeze({
    id: 'hard',
    grip: 0.982,
    windowLow: C + 100,
    windowHigh: C + 130,
    wearRate: 5.4e-8,
  } as const),
]);

/** Thermal and grip shape shared by the compounds. All **estimates** unless cited. */
export interface TyreThermalParams {
  /** Heat capacity of the tread layer that sets its working temperature, J/K. */
  readonly heatCapacity: number;
  /** Share of a tyre's sliding power that heats its tread (the rest goes into the track). */
  readonly slideHeatShare: number;
  /** Carcass flex heating: this share of the rolling-resistance power (Crr·Fz·v), into the tread. */
  readonly rollHeatShare: number;
  /** Rolling-resistance coefficient used for the flex heating (the model's own, params tyre). */
  readonly rollingResistance: number;
  /** Cooling to the air: h0 + h1·v, W/K, v in m/s. */
  readonly coolStill: number;
  readonly coolPerSpeed: number;
  /**
   * Grip lost per kelvin below the window and above it: 4.2 gives −1 % per 5 °C above; the
   * same below is an estimate (a steeper cold slope spun cars on Monza's cool front right).
   */
  readonly coldSlope: number;
  readonly hotSlope: number;
  /** Least grip the temperature can leave. */
  readonly tempGripFloor: number;
  /** Grip lost at full wear (wear 1). */
  readonly wearGripLoss: number;
  /** Wear rate multiplier per 10 K above the window (4.2: × 1.5). */
  readonly hotWearPer10K: number;
  /** Tread temperature of a new set off the blankets, K (70 °C limit, [17]). */
  readonly blanketTemperature: number;
  /** Air temperature the tyres cool towards when none is given, K (25 °C, doc 2.1). */
  readonly ambient: number;
}

export const TYRE_THERMAL: TyreThermalParams = Object.freeze({
  heatCapacity: 3600,
  slideHeatShare: 0.2,
  rollHeatShare: 1,
  rollingResistance: 0.015,
  coolStill: 15,
  coolPerSpeed: 0.955,
  coldSlope: 0.002,
  hotSlope: 0.002,
  tempGripFloor: 0.75,
  wearGripLoss: 0.2,
  hotWearPer10K: 1.5,
  blanketTemperature: C + 70,
  ambient: C + 25,
});

/** Index of a compound in `COMPOUNDS`, or −1. */
export function compoundIndex(id: string): number {
  for (let k = 0; k < COMPOUNDS.length; k++) if (COMPOUNDS[k]!.id === id) return k;
  return -1;
}

/** Grip factor of tread temperature `t` (K) on `c`: 1 inside the window, falling either side. */
export function temperatureGrip(c: CompoundParams, t: number, p = TYRE_THERMAL): number {
  let f = 1;
  if (t < c.windowLow) f = 1 - p.coldSlope * (c.windowLow - t);
  else if (t > c.windowHigh) f = 1 - p.hotSlope * (t - c.windowHigh);
  return f > p.tempGripFloor ? f : p.tempGripFloor;
}

/** Grip factor of wear `w` (0 new, 1 the tread gone). */
export function wearGrip(w: number, p = TYRE_THERMAL): number {
  return 1 - p.wearGripLoss * (w < 0 ? 0 : w > 1 ? 1 : w);
}

/** The whole grip factor of one tyre: compound × temperature × wear. */
export function tyreGrip(c: CompoundParams, t: number, w: number, p = TYRE_THERMAL): number {
  return c.grip * temperatureGrip(c, t, p) * wearGrip(w, p);
}

export interface FitOptions {
  /** Tread temperature of the new set, K. Default the blanket temperature. */
  temperature?: number;
  /** Wear of the set, 0 to 1. Default 0 (new). */
  wear?: number;
  /** Air temperature the tyres cool towards, K. Default `TYRE_THERMAL.ambient`. */
  ambient?: number;
}

/**
 * Fit a set of `compound` to `state` and turn the condition model on for it (a pit stop, the
 * start). Sets temperature, wear and the grip they give.
 */
export function fitTyres(state: CarState, compound: CompoundId, o: FitOptions = {}): void {
  const k = compoundIndex(compound);
  if (k < 0) throw new RangeError(`unknown compound ${compound}`);
  const c = COMPOUNDS[k]!;
  const t = o.temperature ?? TYRE_THERMAL.blanketTemperature;
  const w = o.wear ?? 0;
  state.tyreCompound = k;
  state.tyreAmbient = o.ambient ?? TYRE_THERMAL.ambient;
  for (let i = 0; i < 4; i++) {
    state.tyreTemp[i] = t;
    state.tyreWear[i] = w;
    state.gripScale[i] = tyreGrip(c, t, w);
  }
}

/**
 * Advance each tyre's temperature and wear by `dt` from what the last step left in the state
 * (load, slips, forces, speed), and set `gripScale` for the next step. Heat in: the tread's
 * share of the sliding power |Fx·κ·v| + |Fy·tanα·v| and the carcass flex share of the
 * rolling-resistance power; heat out: convection to the air, faster with speed. Wear grows
 * with the sliding energy into the tread, faster above the window. A car with no compound
 * fitted is left alone.
 */
export function updateTyres(state: CarState, dt: number, p = TYRE_THERMAL): void {
  const k = state.tyreCompound;
  if (k < 0) return;
  const c = COMPOUNDS[k]!;
  const v = Math.abs(state.vx);
  const cool = p.coolStill + p.coolPerSpeed * v;
  const ambient = state.tyreAmbient;
  for (let i = 0; i < 4; i++) {
    const fz = state.load[i]!;
    const slide =
      Math.abs(state.forceX[i]! * state.slipRatio[i]! * v) +
      Math.abs(state.forceY[i]! * state.slipTan[i]! * v);
    const slideIn = p.slideHeatShare * slide;
    const roll = fz > 0 ? p.rollHeatShare * p.rollingResistance * fz * v : 0;
    const t = state.tyreTemp[i]!;
    const tNext = t + ((slideIn + roll - cool * (t - ambient)) * dt) / p.heatCapacity;
    state.tyreTemp[i] = tNext;
    const over = t - c.windowHigh;
    const hot = over > 0 ? Math.pow(p.hotWearPer10K, over / 10) : 1;
    const w = state.tyreWear[i]! + c.wearRate * slideIn * hot * dt;
    state.tyreWear[i] = w < 1 ? w : 1;
    state.gripScale[i] = tyreGrip(c, tNext, state.tyreWear[i]!, p);
  }
}
