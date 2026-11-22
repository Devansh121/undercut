import { CIRCUITS, KMH } from './harness';
import {
  bestBraking,
  bestStandingStart,
  lateralLimit,
  peakDeceleration,
  topSpeed,
  type BrakingResult,
  type LateralResult,
  type StandingStartResult,
  type TopSpeedResult,
} from './manoeuvres';
import { BRAKING_CURVE_SPEEDS, type BrakingEvent, type LateralCase } from './targets';

/**
 * The measurement behind each validation target, run exactly as the doc's test describes.
 * Returns the values keyed by target id, plus the raw results for reports.
 */

export function measureAcceleration(): {
  values: Record<string, number>;
  run: StandingStartResult;
} {
  const run = bestStandingStart({ trim: 'medium' });
  return {
    run,
    values: { 'accel-0-100': run.t100, 'accel-0-200': run.t200, 'accel-0-300': run.t300 },
  };
}

export function measureTopSpeed(): { values: Record<string, number>; run: TopSpeedResult } {
  const run = topSpeed({ trim: 'low', drs: true, airDensity: CIRCUITS.monza.airDensity });
  return { run, values: { 'top-speed-low-drs': run.maxSpeed * 3.6 } };
}

export function measureBrakingEvent(e: BrakingEvent): {
  values: Record<string, number>;
  run: BrakingResult;
} {
  const run = bestBraking({ circuit: e.circuit, v1: e.v1 * KMH, v2: e.v2 * KMH });
  return {
    run,
    values: {
      [`${e.id}-distance`]: run.distance,
      [`${e.id}-time`]: run.time,
      [`${e.id}-peak`]: run.peakG,
      ...(e.power === undefined ? {} : { [`${e.id}-power`]: run.peakBrakePower / 1e3 }),
    },
  };
}

/** Peak deceleration from each curve speed in Monza trim, g. */
export function measureBrakingCurve(): { speeds: readonly number[]; peaks: number[] } {
  return {
    speeds: BRAKING_CURVE_SPEEDS,
    peaks: BRAKING_CURVE_SPEEDS.map((v) => peakDeceleration(v * KMH, 'monza')),
  };
}

export function measureLateral(c: LateralCase): { value: number; run: LateralResult } {
  const run = lateralLimit({
    trim: c.trim,
    speed: c.speedKmh * KMH,
    airDensity: CIRCUITS[c.circuit].airDensity,
  });
  return { value: run.maxLatG, run };
}
