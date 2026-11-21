import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GAMEPAD_SHAPING,
  DEFAULT_KEYBOARD_SHAPING,
  applyAxisCurve,
  keyboardSteerTarget,
  rampPedal,
  rampSteer,
  type AxisCurve,
} from '../src/shaping';

const linear: AxisCurve = { deadZone: 0, antiDeadZone: 0, gamma: 1, saturation: 1 };

describe('applyAxisCurve', () => {
  it('is the identity with a neutral curve', () => {
    for (const x of [0, 0.1, 0.5, 0.9, 1]) expect(applyAxisCurve(x, linear)).toBe(x);
  });

  it('returns zero inside the dead zone and rescales the rest to [0, 1]', () => {
    const curve: AxisCurve = { deadZone: 0.2, antiDeadZone: 0, gamma: 1, saturation: 1 };
    expect(applyAxisCurve(0.2, curve)).toBe(0);
    expect(applyAxisCurve(0.1, curve)).toBe(0);
    expect(applyAxisCurve(0.6, curve)).toBeCloseTo(0.5, 12);
    expect(applyAxisCurve(1, curve)).toBe(1);
  });

  it('reaches full output at the saturation point', () => {
    const curve: AxisCurve = { deadZone: 0, antiDeadZone: 0, gamma: 1, saturation: 0.8 };
    expect(applyAxisCurve(0.4, curve)).toBeCloseTo(0.5, 12);
    expect(applyAxisCurve(0.8, curve)).toBe(1);
    expect(applyAxisCurve(0.95, curve)).toBe(1);
  });

  it('applies the linearity exponent after the dead zone', () => {
    const curve: AxisCurve = { deadZone: 0.1, antiDeadZone: 0, gamma: 2, saturation: 0.9 };
    // t = (0.5 - 0.1) / (0.9 - 0.1) = 0.5, out = 0.5^2
    expect(applyAxisCurve(0.5, curve)).toBeCloseTo(0.25, 12);
  });

  it('jumps to the anti-dead-zone just past the dead zone', () => {
    const curve: AxisCurve = { deadZone: 0.1, antiDeadZone: 0.2, gamma: 1, saturation: 1 };
    expect(applyAxisCurve(0.1, curve)).toBe(0);
    expect(applyAxisCurve(0.1 + 1e-9, curve)).toBeCloseTo(0.2, 6);
    // t = 0.5, out = 0.2 + 0.8 * 0.5
    expect(applyAxisCurve(0.55, curve)).toBeCloseTo(0.6, 12);
    expect(applyAxisCurve(1, curve)).toBe(1);
  });

  it('clamps out-of-range input', () => {
    expect(applyAxisCurve(-0.3, linear)).toBe(0);
    expect(applyAxisCurve(1.4, linear)).toBe(1);
    expect(applyAxisCurve(Number.NaN, linear)).toBe(0);
  });

  it('ships stick and trigger defaults with their own dead zones', () => {
    const { stick, trigger } = DEFAULT_GAMEPAD_SHAPING;
    expect(stick.deadZone).toBe(0.06);
    expect(trigger.deadZone).toBe(0.03);
    // Default stick: t = (0.53 - 0.06) / (0.97 - 0.06), out = t^1.5
    expect(applyAxisCurve(0.53, stick)).toBeCloseTo(((0.53 - 0.06) / 0.91) ** 1.5, 12);
  });
});

describe('rampSteer', () => {
  const out = 4; // per second, away from centre
  const back = 8; // per second, toward centre

  it('moves toward the target at the outward rate', () => {
    expect(rampSteer(0, 1, 0.1, out, back)).toBeCloseTo(0.4, 12);
    expect(rampSteer(0, -1, 0.1, out, back)).toBeCloseTo(-0.4, 12);
  });

  it('stops exactly at the target', () => {
    expect(rampSteer(0.9, 1, 0.1, out, back)).toBe(1);
    expect(rampSteer(0.5, 0.5, 0.1, out, back)).toBe(0.5);
  });

  it('returns to centre at the faster return rate', () => {
    expect(rampSteer(1, 0, 0.05, out, back)).toBeCloseTo(0.6, 12);
    expect(rampSteer(-1, 0, 0.05, out, back)).toBeCloseTo(-0.6, 12);
    expect(rampSteer(0.3, 0, 0.05, out, back)).toBe(0);
  });

  it('uses the return rate when easing off toward a smaller target on the same side', () => {
    expect(rampSteer(1, 0.5, 0.025, out, back)).toBeCloseTo(0.8, 12);
  });

  it('crosses centre at the return rate, then continues out at the outward rate', () => {
    // 0.2 to centre takes 0.025 s at 8/s; the remaining 0.075 s moves 0.3 outward at 4/s.
    expect(rampSteer(0.2, -1, 0.1, out, back)).toBeCloseTo(-0.3, 12);
  });
});

describe('keyboardSteerTarget', () => {
  const s = DEFAULT_KEYBOARD_SHAPING;

  it('allows full lock when stationary and narrows with speed', () => {
    expect(keyboardSteerTarget(1, 0, s)).toBe(1);
    expect(keyboardSteerTarget(-1, 0, s)).toBe(-1);
    expect(keyboardSteerTarget(1, s.highSpeed, s)).toBe(s.lockAtHighSpeed);
    expect(keyboardSteerTarget(1, s.highSpeed * 2, s)).toBe(s.lockAtHighSpeed);
    expect(keyboardSteerTarget(1, s.highSpeed / 2, s)).toBeCloseTo((1 + s.lockAtHighSpeed) / 2, 12);
    expect(keyboardSteerTarget(0, 30, s)).toBe(0);
  });
});

describe('rampPedal', () => {
  it('rises and falls at separate rates and clamps at the target', () => {
    expect(rampPedal(0, 1, 0.1, 5, 10)).toBeCloseTo(0.5, 12);
    expect(rampPedal(0.5, 1, 0.2, 5, 10)).toBe(1);
    expect(rampPedal(1, 0, 0.05, 5, 10)).toBeCloseTo(0.5, 12);
    expect(rampPedal(0.5, 0, 0.1, 5, 10)).toBe(0);
  });
});
