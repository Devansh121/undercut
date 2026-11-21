/**
 * Per-device shaping: the curves and ramps that turn raw device values into driver demand.
 * Plain functions over numbers so the numbers can be tested exactly.
 */
import { clamp } from '@undercut/core';

/**
 * Response curve for one analog control, input and output in [0, 1].
 * Below `deadZone` the output is 0. Between `deadZone` and `saturation` the input is rescaled to
 * [0, 1], raised to `gamma` (linearity: 1 is linear, above 1 is finer near centre), then mapped
 * to [antiDeadZone, 1]. At or above `saturation` the output is 1.
 */
export interface AxisCurve {
  deadZone: number;
  /** Output just past the dead zone; cancels a game-side dead zone. 0 for none. */
  antiDeadZone: number;
  gamma: number;
  saturation: number;
}

export function applyAxisCurve(x: number, curve: AxisCurve): number {
  if (!(x > curve.deadZone)) return 0;
  if (x >= curve.saturation) return 1;
  const span = curve.saturation - curve.deadZone;
  const t = span > 0 ? clamp((x - curve.deadZone) / span, 0, 1) : 1;
  const shaped = curve.gamma === 1 ? t : t ** curve.gamma;
  return curve.antiDeadZone + (1 - curve.antiDeadZone) * shaped;
}

/**
 * Keyboard shaping. A key is all or nothing, so steering ramps toward a target at a limited rate,
 * the target narrowing with speed, and comes back to centre faster than it goes out. Pedals ramp
 * too, so a tap is a short squeeze rather than a step. Rates are per second; speeds in m/s.
 */
export interface KeyboardShaping {
  /** Steering rate away from centre at standstill (full lock in 1 / rate seconds). */
  steerRate: number;
  /** Steering rate away from centre at and above `highSpeed`. */
  steerRateAtHighSpeed: number;
  /** Steering rate toward centre. */
  returnRate: number;
  /** Speed at which the high-speed rate and lock apply. */
  highSpeed: number;
  /** Largest steering demand a held key asks for at and above `highSpeed`. */
  lockAtHighSpeed: number;
  throttleRise: number;
  throttleFall: number;
  brakeRise: number;
  brakeFall: number;
}

export interface GamepadShaping {
  stick: AxisCurve;
  trigger: AxisCurve;
}

/** Touch shaping. Lengths in CSS pixels. */
export interface TouchShaping {
  stick: AxisCurve;
  /** Finger travel from the stick origin to full lock. */
  stickRadius: number;
  /** Pedal value as soon as a finger lands on it, at the pedal's bottom edge. */
  pedalFloor: number;
  /** Fraction of the pedal height, from the bottom, at which the pedal reads full. */
  pedalFullAt: number;
}

export interface InputShaping {
  keyboard: KeyboardShaping;
  gamepad: GamepadShaping;
  touch: TouchShaping;
  /** DRS button behaviour: `toggle` (press to request, press again or brake to cancel) or `hold`. */
  drsMode: 'toggle' | 'hold';
}

export const DEFAULT_KEYBOARD_SHAPING: Readonly<KeyboardShaping> = Object.freeze({
  steerRate: 4.5,
  steerRateAtHighSpeed: 2,
  returnRate: 8,
  highSpeed: 70,
  lockAtHighSpeed: 0.3,
  throttleRise: 5,
  throttleFall: 10,
  brakeRise: 8,
  brakeFall: 10,
});

export const DEFAULT_GAMEPAD_SHAPING: Readonly<GamepadShaping> = Object.freeze({
  stick: Object.freeze({ deadZone: 0.06, antiDeadZone: 0, gamma: 1.5, saturation: 0.97 }),
  trigger: Object.freeze({ deadZone: 0.03, antiDeadZone: 0, gamma: 1, saturation: 0.98 }),
});

export const DEFAULT_TOUCH_SHAPING: Readonly<TouchShaping> = Object.freeze({
  stick: Object.freeze({ deadZone: 0.04, antiDeadZone: 0, gamma: 1.3, saturation: 1 }),
  stickRadius: 56,
  pedalFloor: 0.15,
  pedalFullAt: 0.8,
});

export function defaultShaping(): InputShaping {
  return {
    keyboard: { ...DEFAULT_KEYBOARD_SHAPING },
    gamepad: {
      stick: { ...DEFAULT_GAMEPAD_SHAPING.stick },
      trigger: { ...DEFAULT_GAMEPAD_SHAPING.trigger },
    },
    touch: { ...DEFAULT_TOUCH_SHAPING, stick: { ...DEFAULT_TOUCH_SHAPING.stick } },
    drsMode: 'toggle',
  };
}

/** 0 at standstill, 1 at and above the keyboard's high speed. */
function speedFactor(speed: number, s: KeyboardShaping): number {
  return s.highSpeed > 0 ? clamp(Math.abs(speed) / s.highSpeed, 0, 1) : 1;
}

/** Steering target for a keyboard direction in [-1, 1] at `speed` m/s. */
export function keyboardSteerTarget(direction: number, speed: number, s: KeyboardShaping): number {
  if (direction === 0) return 0;
  const f = speedFactor(speed, s);
  const lock = 1 - f + f * s.lockAtHighSpeed;
  return direction * lock;
}

/** Outward steering rate at `speed` m/s. */
export function keyboardSteerRate(speed: number, s: KeyboardShaping): number {
  const f = speedFactor(speed, s);
  return (1 - f) * s.steerRate + f * s.steerRateAtHighSpeed;
}

/**
 * Move `current` toward `target` over `dt` seconds: at `returnRate` while heading toward centre
 * (including the part of a move that crosses it), at `outRate` while heading away from it.
 */
export function rampSteer(
  current: number,
  target: number,
  dt: number,
  outRate: number,
  returnRate: number,
): number {
  if (current === target || dt <= 0) return current;
  let time = dt;
  let value = current;
  const towardCentre = (value > 0 && target < value) || (value < 0 && target > value);
  if (towardCentre) {
    // Stop at the target if it is on the same side, else at centre.
    const stop = Math.sign(target) === Math.sign(value) ? target : 0;
    const distance = Math.abs(value - stop);
    const reach = returnRate * time;
    if (reach < distance) return value + Math.sign(stop - value) * reach;
    time -= returnRate > 0 ? distance / returnRate : time;
    value = stop;
    if (value === target) return value;
  }
  const distance = Math.abs(target - value);
  const reach = outRate * time;
  return reach >= distance ? target : value + Math.sign(target - value) * reach;
}

/** Move a pedal toward `target` at `rise` per second going up and `fall` going down. */
export function rampPedal(
  current: number,
  target: number,
  dt: number,
  rise: number,
  fall: number,
): number {
  if (target > current) return Math.min(target, current + rise * dt);
  if (target < current) return Math.max(target, current - fall * dt);
  return current;
}
