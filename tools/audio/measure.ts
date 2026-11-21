/** Objective measurements of a rendered scenario. */
import {
  dcOffset,
  findPeak,
  integratedLoudness,
  magnitudeSpectrum,
  maxStep,
  rmsDbfs,
  samplePeak,
  toDb,
  truePeak,
} from '@undercut/audio/analysis';
import type { Rendered, TracePoint } from './scenarios';

/** Analysis window for firing-frequency tracking: 4096 samples (85 ms at 48 kHz). */
const TRACK_WINDOW = 4096;
const TRACK_HOP = 2048;
const TRACK_FFT = 32768;
/** A window is used only if the commanded rpm moves less than this fraction across it. */
const TRACK_MAX_RPM_SPREAD = 0.015;

export interface Tracking {
  /** Windows measured (steady rpm, no shift in progress). */
  windows: number;
  /** Absolute error of the measured firing frequency against rpm/20, percent. */
  medianErrorPct: number;
  p95ErrorPct: number;
  maxErrorPct: number;
}

export interface Measurement {
  durationS: number;
  samplePeakDbfs: number;
  truePeakDbtp: number;
  loudnessLufs: number;
  rmsDbfs: number;
  dcOffset: number;
  maxStep: number;
  limiterMinGainDb: number;
  tracking: Tracking;
  layersDbfs: Record<string, number>;
  /** Render speed of the audio core alone, x real time (0 if not timed). */
  realtimeRatio: number;
}

const round = (x: number, digits = 2) => Math.round(x * 10 ** digits) / 10 ** digits;

/** Commanded rpm at a frame: the trace is piecewise constant between updates. */
function traceAt(trace: readonly TracePoint[], frame: number): TracePoint {
  let lo = 0;
  let hi = trace.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((trace[mid] as TracePoint).frame <= frame) lo = mid;
    else hi = mid - 1;
  }
  return trace[lo] as TracePoint;
}

/**
 * Track the firing frequency (rpm/60 × 3 for a four-stroke V6) through the clip: for each
 * steady window, find the strongest spectral peak within ±8 % of rpm/20 and compare.
 * The search band excludes the neighbouring half-order lines (±16.7 %).
 */
export function trackFiringFrequency(r: Rendered): Tracking {
  const errors: number[] = [];
  const mono = new Float32Array(r.left.length);
  for (let i = 0; i < mono.length; i++)
    mono[i] = 0.5 * ((r.left[i] as number) + (r.right[i] as number));
  for (let start = 0; start + TRACK_WINDOW <= mono.length; start += TRACK_HOP) {
    let min = Infinity;
    let max = -Infinity;
    let sum = 0;
    let count = 0;
    let usable = true;
    for (let f = start; f < start + TRACK_WINDOW; f += 64) {
      const p = traceAt(r.trace, f);
      if (p.shifting || !p.engineOn) usable = false;
      min = Math.min(min, p.rpm);
      max = Math.max(max, p.rpm);
      sum += p.rpm;
      count++;
    }
    const mean = sum / count;
    if (!usable || mean < 3000 || (max - min) / mean > TRACK_MAX_RPM_SPREAD) continue;
    const expected = mean / 20;
    const mags = magnitudeSpectrum(mono, start, TRACK_WINDOW, TRACK_FFT);
    const peak = findPeak(mags, r.sampleRate, expected * 0.92, expected * 1.08);
    errors.push((100 * Math.abs(peak.frequency - expected)) / expected);
  }
  errors.sort((a, b) => a - b);
  const pick = (q: number) =>
    errors.length
      ? (errors[Math.min(errors.length - 1, Math.floor(q * errors.length))] as number)
      : NaN;
  return {
    windows: errors.length,
    medianErrorPct: round(pick(0.5), 3),
    p95ErrorPct: round(pick(0.95), 3),
    maxErrorPct: round(errors.length ? (errors[errors.length - 1] as number) : NaN, 3),
  };
}

export function measure(r: Rendered): Measurement {
  const durationS = r.left.length / r.sampleRate;
  return {
    durationS: round(durationS, 2),
    samplePeakDbfs: round(toDb(Math.max(samplePeak(r.left), samplePeak(r.right)))),
    truePeakDbtp: round(toDb(Math.max(truePeak(r.left), truePeak(r.right)))),
    loudnessLufs: round(integratedLoudness([r.left, r.right], r.sampleRate), 1),
    rmsDbfs: round(rmsDbfs(r.left), 1),
    dcOffset: Number(
      Math.max(Math.abs(dcOffset(r.left)), Math.abs(dcOffset(r.right))).toExponential(2),
    ),
    maxStep: round(Math.max(maxStep(r.left), maxStep(r.right)), 4),
    limiterMinGainDb: r.limiterMinGainDb,
    tracking: trackFiringFrequency(r),
    layersDbfs: r.layers,
    realtimeRatio: r.processMs > 0 ? round((durationS * 1000) / r.processMs, 1) : 0,
  };
}
