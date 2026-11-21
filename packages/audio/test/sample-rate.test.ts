import { describe, expect, it } from 'vitest';
import { magnitudeSpectrum } from '../src/analysis/index';
import { MIN_SAMPLE_RATE } from '../src/dsp/core';
import { pulseTables } from '../src/dsp/pulse-tables';
import { AudioCore, CAR_STATE_RANGE, type AudioCarState } from '../src/index';
import { engineState } from './helpers';

function renderAt(sampleRate: number, state: AudioCarState, seconds: number): Float32Array {
  const core = new AudioCore({ sampleRate });
  const n = Math.round(seconds * sampleRate);
  const left = new Float32Array(n);
  const right = new Float32Array(n);
  const per = Math.round(sampleRate / 120);
  for (let f = 0; f < n; f += per) {
    core.setCarState(state);
    const m = Math.min(per, n - f);
    core.process([left.subarray(f, f + m), right.subarray(f, f + m)], m);
  }
  return left;
}

/** Strong, narrow spectral lines below `fMax`: frequency of each local maximum that stands
 * at least `prominence` dB over the median of the surrounding ±`span` Hz and within 60 dB
 * of the strongest line. */
function lines(
  x: Float32Array,
  sampleRate: number,
  fMax: number,
  prominence = 20,
  span = 150,
): number[] {
  const size = 16_384;
  const mags = magnitudeSpectrum(x, x.length - size, size, size * 4);
  const binHz = sampleRate / (size * 4);
  const db = Array.from(mags, (m) => 20 * Math.log10(m + 1e-12));
  const top = Math.max(...db.slice(1, Math.floor(fMax / binHz)));
  const half = Math.round(span / binHz);
  const out: number[] = [];
  for (let k = half; k < Math.floor(fMax / binHz) && k + half < db.length; k++) {
    const v = db[k] as number;
    if (v < top - 60 || v < (db[k - 1] as number) || v < (db[k + 1] as number)) continue;
    const around = db.slice(k - half, k + half).sort((a, b) => a - b);
    if (v - (around[around.length >> 1] as number) >= prominence) out.push(k * binHz);
  }
  return out;
}

describe('sample rates', () => {
  it(`rejects rates below ${MIN_SAMPLE_RATE} Hz`, () => {
    expect(MIN_SAMPLE_RATE).toBe(22_050);
    for (const rate of [8000, 16_000, 22_049]) {
      expect(() => new AudioCore({ sampleRate: rate }), String(rate)).toThrow(RangeError);
    }
    expect(() => new AudioCore({ sampleRate: 22_050 })).not.toThrow();
  });

  it('builds pulse tables that stay under 0.45 × the rate up to the highest engine speed', () => {
    for (const rate of [22_050, 44_100, 48_000]) {
      const maxCycleHz = CAR_STATE_RANGE.engineSpeed[1] / (4 * Math.PI);
      expect(pulseTables(rate).harmonics * maxCycleHz).toBeLessThanOrEqual(0.45 * rate);
    }
  });

  it('puts no aliased line into the spectrum at the minimum rate, at the most extreme inputs', () => {
    // Every tonal source at its highest frequency: limiter speed, full spool, full ERS.
    for (const ersPower of [200_000, -200_000]) {
      const state = engineState(15_000, 1, { boost: 1, ersPower, gear: 8 });
      // 6 s, so the turbo has finished spooling and every line is steady in both windows.
      const low = renderAt(MIN_SAMPLE_RATE, state, 6);
      const ref = renderAt(96_000, state, 6);
      const fMax = 0.45 * MIN_SAMPLE_RATE;
      const refLines = lines(ref, 96_000, fMax, 12);
      for (const f of lines(low, MIN_SAMPLE_RATE, fMax)) {
        const near = refLines.some((g) => Math.abs(g - f) < 4);
        expect(near, `line at ${f.toFixed(1)} Hz has no counterpart at 96 kHz`).toBe(true);
      }
    }
  });
});
