import { describe, expect, it } from 'vitest';
import {
  findPeak,
  integratedLoudness,
  kWeightingFilters,
  magnitudeSpectrum,
  maxStep,
  samplePeak,
  spectralCentroid,
  truePeak,
} from '../src/analysis/index';

const FS = 48_000;

function sine(freq: number, amp: number, seconds: number, phase = 0): Float32Array {
  const x = new Float32Array(Math.round(seconds * FS));
  for (let i = 0; i < x.length; i++) x[i] = amp * Math.sin((2 * Math.PI * freq * i) / FS + phase);
  return x;
}

describe('spectrum', () => {
  it('finds a sine between bins to within 0.05 Hz and reads its amplitude', () => {
    const x = sine(1234.5, 0.5, 1);
    const mags = magnitudeSpectrum(x, 0, 16384, 65536);
    const peak = findPeak(mags, FS, 1000, 1500);
    expect(Math.abs(peak.frequency - 1234.5)).toBeLessThan(0.05);
    expect(peak.magnitude).toBeGreaterThan(0.45);
    expect(peak.magnitude).toBeLessThan(0.51);
  });

  it('puts the centroid of a single sine on the sine', () => {
    const mags = magnitudeSpectrum(sine(2000, 0.5, 0.5), 0, 16384, 16384);
    expect(Math.abs(spectralCentroid(mags, FS) - 2000)).toBeLessThan(5);
  });
});

describe('BS.1770 loudness', () => {
  it('matches the published K-weighting coefficients at 48 kHz', () => {
    const [shelf, hp] = kWeightingFilters(48_000);
    expect(shelf.b0).toBeCloseTo(1.53512485958697, 6);
    expect(shelf.b1).toBeCloseTo(-2.69169618940638, 6);
    expect(shelf.b2).toBeCloseTo(1.19839281085285, 6);
    expect(shelf.a1).toBeCloseTo(-1.69065929318241, 6);
    expect(shelf.a2).toBeCloseTo(0.73248077421585, 6);
    expect(hp.a1).toBeCloseTo(-1.99004745483398, 6);
    expect(hp.a2).toBeCloseTo(0.99007225036621, 6);
  });

  it('reads a full-scale 997 Hz sine in one channel as -3.01 LUFS', () => {
    const x = sine(997, 1, 5);
    const silent = new Float32Array(x.length);
    expect(integratedLoudness([x, silent], FS)).toBeCloseTo(-3.01, 1);
  });

  it('gates out silence', () => {
    // 2.5 s of tone then 2.5 s of silence. The silent blocks fall under the absolute gate;
    // of the 400 ms blocks touching the tone, 22 are full and three straddle its end at
    // 75, 50 and 25 % energy (all above the relative gate), so the mean power is 23.5/25
    // of the tone's: -0.27 LU. Without gating it would be about 3 LU down.
    const x = new Float32Array(FS * 5);
    x.set(sine(997, 0.1, 2.5));
    const gated = integratedLoudness([x, x], FS);
    const full = integratedLoudness([sine(997, 0.1, 2.5), sine(997, 0.1, 2.5)], FS);
    expect(gated - full).toBeCloseTo(10 * Math.log10(23.5 / 25), 2);
  });
});

describe('peaks and steps', () => {
  it('finds the inter-sample peak that the samples miss', () => {
    // A sine at a quarter of the sample rate, sampled 45° off its peaks.
    const x = sine(FS / 4, 1, 0.1, Math.PI / 4);
    expect(samplePeak(x)).toBeCloseTo(Math.SQRT1_2, 3);
    expect(truePeak(x)).toBeGreaterThan(0.98);
    expect(truePeak(x)).toBeLessThan(1.03);
  });

  it('measures the largest sample-to-sample step', () => {
    const x = new Float32Array([0, 0.1, 0.15, -0.2, -0.1]);
    expect(maxStep(x)).toBeCloseTo(0.35, 6);
  });
});
