import { describe, expect, it } from 'vitest';
import {
  REFERENCE_CAR,
  createTyreCurve,
  createTyreForce,
  lateralMu,
  longitudinalMu,
  tyreForce,
} from '../src/index';

const curve = createTyreCurve(REFERENCE_CAR.tyre);
const out = createTyreForce();
const FZ = 3000;

function peakOver(samples: number, fn: (x: number) => number, max: number): [number, number] {
  let best = -Infinity;
  let at = 0;
  for (let i = 1; i <= samples; i++) {
    const x = (max * i) / samples;
    const v = fn(x);
    if (v > best) {
      best = v;
      at = x;
    }
  }
  return [best, at];
}

describe('tyre model', () => {
  it('gives zero force at zero slip and is odd in each slip', () => {
    tyreForce(curve, FZ, 0, 0, 1, out);
    expect(out.fx).toBe(0);
    expect(out.fy).toBe(0);
    const a = tyreForce(curve, FZ, 0.05, -0.03, 1, createTyreForce());
    const b = tyreForce(curve, FZ, -0.05, 0.03, 1, createTyreForce());
    expect(b.fx).toBeCloseTo(-a.fx, 9);
    expect(b.fy).toBeCloseTo(-a.fy, 9);
  });

  it('peaks at the configured slips with the configured friction', () => {
    const [fyPeak, alphaAt] = peakOver(2000, (t) => tyreForce(curve, FZ, 0, t, 1, out).fy, 0.5);
    expect(alphaAt).toBeCloseTo(REFERENCE_CAR.tyre.peakSlipTan, 3);
    expect(fyPeak / FZ).toBeCloseTo(REFERENCE_CAR.tyre.muY, 6);
    const [fxPeak, kappaAt] = peakOver(2000, (k) => tyreForce(curve, FZ, k, 0, 1, out).fx, 0.6);
    expect(kappaAt).toBeCloseTo(REFERENCE_CAR.tyre.peakSlipRatio, 3);
    expect(fxPeak / FZ).toBeCloseTo(REFERENCE_CAR.tyre.muX, 6);
  });

  it('keeps sliding friction below the peak: about 0.76 locked, 0.85 sideways', () => {
    const locked = tyreForce(curve, FZ, -1, 0, 1, out).fx / out.dx;
    expect(locked).toBeLessThan(-0.7);
    expect(locked).toBeGreaterThan(-0.85);
    const sideways = tyreForce(curve, FZ, 0, 5, 1, out).fy / out.dy;
    expect(sideways).toBeGreaterThan(0.8);
    expect(sideways).toBeLessThan(0.9);
  });

  it('loses friction coefficient with load, each direction at its own rate', () => {
    const t = REFERENCE_CAR.tyre;
    expect(lateralMu(curve, 3000)).toBeCloseTo(t.muY, 9);
    expect(lateralMu(curve, 8000)).toBeCloseTo(t.muY + 5000 * t.loadSensitivityY, 9);
    expect(longitudinalMu(curve, 3000)).toBeCloseTo(t.muX, 9);
    expect(longitudinalMu(curve, 8000)).toBeCloseTo(t.muX + 5000 * t.loadSensitivityX, 9);
    expect(lateralMu(curve, 1e6)).toBe(t.muMin);
    expect(longitudinalMu(curve, 1e6)).toBe(t.muMin);
  });

  it('sets longitudinal and lateral peak friction independently', () => {
    const other = createTyreCurve({ ...REFERENCE_CAR.tyre, muX: 1.2, loadSensitivityX: -2e-4 });
    for (const fz of [1000, 3000, 6000, 9000]) {
      expect(lateralMu(other, fz)).toBe(lateralMu(curve, fz));
      const pure = tyreForce(other, fz, 0, 0.3, 1, createTyreForce());
      const ref = tyreForce(curve, fz, 0, 0.3, 1, createTyreForce());
      expect(pure.fy).toBe(ref.fy);
      expect(pure.dx).toBeCloseTo(longitudinalMu(other, fz) * fz, 9);
    }
  });

  it('stays inside the friction ellipse under combined slip', () => {
    for (let k = -1; k <= 1; k += 0.05) {
      for (let t = -1; t <= 1; t += 0.05) {
        tyreForce(curve, FZ, k, t, 1, out);
        const e = (out.fx / out.dx) ** 2 + (out.fy / out.dy) ** 2;
        expect(e).toBeLessThanOrEqual(1 + 1e-9);
      }
    }
  });

  it('trades lateral force for longitudinal under combined slip', () => {
    const pure = tyreForce(curve, FZ, 0, 0.09, 1, createTyreForce()).fy;
    const combined = tyreForce(curve, FZ, 0.1, 0.09, 1, createTyreForce()).fy;
    expect(combined).toBeLessThan(pure * 0.8);
  });

  it('scales with the surface grip multiplier and returns nothing off the ground', () => {
    const full = tyreForce(curve, FZ, 0, 0.09, 1, createTyreForce()).fy;
    const grass = tyreForce(curve, FZ, 0, 0.09, 0.4, createTyreForce()).fy;
    expect(grass / full).toBeCloseTo(0.4, 9);
    tyreForce(curve, 0, 0.1, 0.1, 1, out);
    expect([out.fx, out.fy]).toEqual([0, 0]);
  });
});
