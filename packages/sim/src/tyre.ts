import type { TyreParams } from './params';

/**
 * Steady-state tyre force: a Pacejka-style magic formula with load-sensitive friction, set
 * separately for the longitudinal and lateral directions (peak and load slope each, as the
 * magic formula's pDx1/pDx2 and pDy1/pDy2 are), and a
 * combined-slip method based on normalised slip (the "similarity" approach).
 *
 * Each slip is divided by the slip at which its pure-slip force peaks, giving sx and sy. The
 * combined normalised slip s = |(sx, sy)| feeds one magic-formula curve per direction that
 * peaks at s = 1, and the force points along (sx, sy):
 *
 *     Fx = Dx · sin(Cx · atan(Bx · s)) · sx / s,   Fy = Dy · sin(Cy · atan(By · s)) · sy / s
 *
 * so pure slip reproduces the pure-slip curves, the combined force never leaves the friction
 * ellipse (Dx, Dy), and the result is smooth through zero slip and at any slip, standstill
 * included. Slip inputs come from the transient contact-patch deflection (see `step.ts`), so
 * nothing here divides by the wheel speed.
 */
export interface TyreCurve {
  readonly peakSlipRatio: number;
  readonly peakSlipTan: number;
  readonly shapeX: number;
  readonly shapeY: number;
  /** B of the normalised curve: tan(π / 2C) puts the peak at s = 1 when E = 0. */
  readonly stiffX: number;
  readonly stiffY: number;
  readonly muX: number;
  readonly muY: number;
  readonly loadSensitivityX: number;
  readonly loadSensitivityY: number;
  readonly referenceLoad: number;
  readonly muMin: number;
}

export function createTyreCurve(p: TyreParams): TyreCurve {
  return {
    peakSlipRatio: p.peakSlipRatio,
    peakSlipTan: p.peakSlipTan,
    shapeX: p.shapeX,
    shapeY: p.shapeY,
    stiffX: Math.tan(Math.PI / (2 * p.shapeX)),
    stiffY: Math.tan(Math.PI / (2 * p.shapeY)),
    muX: p.muX,
    muY: p.muY,
    loadSensitivityX: p.loadSensitivityX,
    loadSensitivityY: p.loadSensitivityY,
    referenceLoad: p.referenceLoad,
    muMin: p.muMin,
  };
}

/** Peak lateral friction coefficient at load `fz` (linear load sensitivity, floored). */
export function lateralMu(curve: TyreCurve, fz: number): number {
  const mu = curve.muY + curve.loadSensitivityY * (fz - curve.referenceLoad);
  return mu > curve.muMin ? mu : curve.muMin;
}

/** Peak longitudinal friction coefficient at load `fz` (linear load sensitivity, floored). */
export function longitudinalMu(curve: TyreCurve, fz: number): number {
  const mu = curve.muX + curve.loadSensitivityX * (fz - curve.referenceLoad);
  return mu > curve.muMin ? mu : curve.muMin;
}

/** Result holder so the hot loop does not allocate. */
export interface TyreForce {
  fx: number;
  fy: number;
  /** Peak force available in each direction at this load and grip. */
  dx: number;
  dy: number;
}

export function createTyreForce(): TyreForce {
  return { fx: 0, fy: 0, dx: 0, dy: 0 };
}

/**
 * Force for slip ratio `kappa`, lateral slip `tanAlpha` (tan of the slip angle, positive when
 * the force points to +y), load `fz` in N and surface grip multiplier `grip`.
 */
export function tyreForce(
  curve: TyreCurve,
  fz: number,
  kappa: number,
  tanAlpha: number,
  grip: number,
  out: TyreForce,
): TyreForce {
  if (!(fz > 0)) {
    out.fx = 0;
    out.fy = 0;
    out.dx = 0;
    out.dy = 0;
    return out;
  }
  const dy = lateralMu(curve, fz) * grip * fz;
  const dx = longitudinalMu(curve, fz) * grip * fz;
  const sx = kappa / curve.peakSlipRatio;
  const sy = tanAlpha / curve.peakSlipTan;
  const s = Math.sqrt(sx * sx + sy * sy);
  out.dx = dx;
  out.dy = dy;
  if (s < 1e-9) {
    // Limit of sin(C·atan(B·s)) / s as s → 0 is C·B.
    out.fx = dx * curve.shapeX * curve.stiffX * sx;
    out.fy = dy * curve.shapeY * curve.stiffY * sy;
    return out;
  }
  const inv = 1 / s;
  out.fx = dx * Math.sin(curve.shapeX * Math.atan(curve.stiffX * s)) * sx * inv;
  out.fy = dy * Math.sin(curve.shapeY * Math.atan(curve.stiffY * s)) * sy * inv;
  return out;
}
