import { describe, expect, it } from 'vitest';
import {
  bandPower,
  findPeak,
  integratedLoudness,
  magnitudeSpectrum,
  spectralCentroid,
} from '../src/analysis/index';
import { AudioCore, DEFAULT_POWER_UNIT, rpmToRadPerSecond } from '../src/index';
import { engineState, FS, identical, render, steady, type Clip } from './helpers';

const FFT_LEN = 16384;

/** Spectrum of the last `FFT_LEN` samples (steady state), zero-padded 4x. */
function tail(clip: Clip): Float64Array {
  return magnitudeSpectrum(clip.left, clip.left.length - FFT_LEN, FFT_LEN, FFT_LEN * 4);
}

function db(x: number): number {
  return 10 * Math.log10(x);
}

describe('firing frequency follows rpm', () => {
  // rpm/60 × 3 firing events per second for a four-stroke V6.
  for (const load of [1, 0.05]) {
    it(`tracks within 0.05 % from idle to the limiter at load ${load}`, () => {
      for (const rpm of [4500, 6000, 7500, 9000, 10_500, 11_800, 12_500]) {
        const { clip } = steady(engineState(rpm, load), 0.6);
        const mags = tail(clip);
        const expected = rpm / 20;
        const peak = findPeak(mags, FS, expected * 0.92, expected * 1.08);
        const errorPct = (100 * Math.abs(peak.frequency - expected)) / expected;
        expect(errorPct, `${rpm} rpm`).toBeLessThan(0.05);

        // It is a real line, not noise: well above the floor between the half orders.
        let floor = 0;
        let count = 0;
        const binHz = FS / (FFT_LEN * 4);
        for (const [lo, hi] of [
          [expected * 0.86, expected * 0.94],
          [expected * 1.06, expected * 1.14],
        ] as const) {
          for (let k = Math.ceil(lo / binHz); k <= hi / binHz; k++) {
            floor += mags[k] as number;
            count++;
          }
        }
        expect(
          20 * Math.log10(peak.magnitude / (floor / count)),
          `${rpm} rpm prominence`,
        ).toBeGreaterThan(30);
      }
    });
  }

  it('is the strongest line below 2 kHz at full load', () => {
    for (const rpm of [6000, 9000, 12_000]) {
      const mags = tail(steady(engineState(rpm, 1), 0.6).clip);
      const strongest = findPeak(mags, FS, 60, 2000);
      expect(Math.abs(strongest.frequency - rpm / 20) / (rpm / 20)).toBeLessThan(0.005);
    }
  });
});

describe('tone follows load', () => {
  for (const rpm of [7000, 11_000]) {
    it(`full throttle and trailing throttle at ${rpm} rpm measure different`, () => {
      const full = tail(steady(engineState(rpm, 1), 0.8).clip);
      const trailing = tail(steady(engineState(rpm, 0.03), 0.8).clip);
      // Brighter: the spectral centroid rises by at least a quarter.
      expect(spectralCentroid(full, FS)).toBeGreaterThan(1.25 * spectralCentroid(trailing, FS));
      // More high harmonics: the share of energy above 2 kHz rises by at least 6 dB.
      const share = (m: Float64Array) =>
        bandPower(m, FS, 2000, 20_000) / bandPower(m, FS, 20, 20_000);
      expect(db(share(full)) - db(share(trailing))).toBeGreaterThan(6);
      // And louder.
      expect(
        db(bandPower(full, FS, 20, 20_000)) - db(bandPower(trailing, FS, 20, 20_000)),
      ).toBeGreaterThan(5);
    });
  }

  it('keeps the pitch when only the load changes', () => {
    const full = findPeak(tail(steady(engineState(11_000, 1), 0.6).clip), FS, 500, 600);
    const off = findPeak(tail(steady(engineState(11_000, 0.03), 0.6).clip), FS, 500, 600);
    expect(Math.abs(full.frequency - off.frequency)).toBeLessThan(0.1);
  });
});

describe('turbo and ERS layers', () => {
  it('turbo is exactly absent with zero boost and present with boost', () => {
    const off = steady(engineState(11_000, 1, { boost: 0 }), 2);
    const on = steady(engineState(11_000, 1, { boost: 1 }), 2);
    expect(off.core.meters.rms('turbo')).toBe(0);
    expect(on.core.meters.rms('turbo')).toBeGreaterThan(1e-3);
    // The whine is in the mix: about full-spool whine frequency, at least 10 dB over the
    // same band without boost.
    const f = DEFAULT_POWER_UNIT.turboWhine.full;
    const band = (c: Clip) => bandPower(tail(c), FS, f * 0.97, f * 1.01);
    expect(db(band(on.clip)) - db(band(off.clip))).toBeGreaterThan(10);
  });

  it('turbo spools with lag', () => {
    const core = new AudioCore({ sampleRate: FS });
    render(core, 0.5, () => engineState(11_000, 1, { boost: 0 }));
    core.meters.reset();
    render(core, 0.1, () => engineState(11_000, 1, { boost: 1 }));
    const early = core.meters.rms('turbo');
    render(core, 1.5, () => engineState(11_000, 1, { boost: 1 }));
    core.meters.reset();
    render(core, 0.1, () => engineState(11_000, 1, { boost: 1 }));
    expect(core.meters.rms('turbo')).toBeGreaterThan(3 * early);
  });

  for (const [label, power] of [
    ['deploy', 120_000],
    ['harvest', -120_000],
  ] as const) {
    it(`ERS ${label} whine is exactly absent at zero power and present otherwise`, () => {
      const rpm = 10_000;
      const off = steady(engineState(rpm, 1, { ersPower: 0 }), 1);
      const on = steady(engineState(rpm, 1, { ersPower: power }), 1);
      expect(off.core.meters.rms('ers')).toBe(0);
      expect(on.core.meters.rms('ers')).toBeGreaterThan(1e-3);
      const fe =
        (rpmToRadPerSecond(rpm) / (2 * Math.PI)) *
        DEFAULT_POWER_UNIT.mgukRatio *
        DEFAULT_POWER_UNIT.mgukPolePairs;
      const band = (c: Clip) => bandPower(tail(c), FS, fe - 8, fe + 8);
      expect(db(band(on.clip)) - db(band(off.clip))).toBeGreaterThan(10);
    });
  }
});

describe('road layer', () => {
  it('rolls, scrubs, squeals, rumbles and scrapes only when asked', () => {
    const quiet = steady(engineState(0, 0, { engineOn: false, speed: 0 }), 0.5);
    for (const layer of ['roll', 'wind', 'scrub', 'squeal', 'kerb', 'scrape'] as const) {
      expect(quiet.core.meters.rms(layer), layer).toBe(0);
    }
    const busy = steady(
      engineState(0, 0, {
        engineOn: false,
        speed: 60,
        slipFront: 0.2,
        slipRear: 0.15,
        kerb: 1,
        kerbFrequency: 40,
        bottoming: 0.6,
      }),
      0.5,
    );
    for (const layer of ['roll', 'wind', 'scrub', 'squeal', 'kerb', 'scrape'] as const) {
      expect(busy.core.meters.rms(layer), layer).toBeGreaterThan(1e-3);
    }
  });

  it('gets louder with speed', () => {
    const lufs = (speed: number) => {
      const { clip } = steady(engineState(0, 0, { engineOn: false, speed }), 1.5);
      return integratedLoudness([clip.left.subarray(FS / 2), clip.right.subarray(FS / 2)], FS);
    };
    const slow = lufs(20);
    const fast = lufs(85);
    expect(fast - slow).toBeGreaterThan(10);
  });
});

describe('determinism', () => {
  const drive = (t: number) =>
    engineState(6000 + 5000 * t, t < 0.5 ? 1 : 0, {
      boost: 0.8,
      ersPower: t < 0.5 ? 120_000 : -80_000,
      speed: 40 + 20 * t,
      slipFront: 0.1 + 0.1 * t,
      kerb: t > 0.6 ? 0.8 : 0,
      kerbFrequency: 35,
      shifting: t > 0.3 && t < 0.33,
      shiftDirection: 1,
      bottoming: t > 0.7 && t < 0.8 ? 0.4 : 0,
    });

  it('gives identical samples for the same seed and inputs', () => {
    const a = render(new AudioCore({ sampleRate: FS, seed: 7 }), 1, drive);
    const b = render(new AudioCore({ sampleRate: FS, seed: 7 }), 1, drive);
    expect(identical(a.left, b.left)).toBe(true);
    expect(identical(a.right, b.right)).toBe(true);
  });

  it('does not depend on how the host splits blocks', () => {
    const ref = render(new AudioCore({ sampleRate: FS, seed: 7 }), 1, drive, { block: 128 });
    for (const block of [1, 37, 400, 1000]) {
      const other = render(new AudioCore({ sampleRate: FS, seed: 7 }), 1, drive, { block });
      expect(identical(other.left, ref.left), `block ${block}`).toBe(true);
    }
  });

  it('changes with the seed', () => {
    const a = render(new AudioCore({ sampleRate: FS, seed: 7 }), 0.3, drive);
    const b = render(new AudioCore({ sampleRate: FS, seed: 8 }), 0.3, drive);
    expect(identical(a.left, b.left)).toBe(false);
  });

  it('runs at other sample rates', () => {
    for (const sampleRate of [44_100, 96_000]) {
      const core = new AudioCore({ sampleRate });
      core.setCarState(engineState(9000, 1));
      const out = [new Float32Array(sampleRate / 2), new Float32Array(sampleRate / 2)];
      core.process(out, sampleRate / 2);
      const mags = magnitudeSpectrum(out[0] as Float32Array, sampleRate / 2 - 8192, 8192, 32768);
      const peak = findPeak(mags, sampleRate, 450 * 0.92, 450 * 1.08);
      expect(Math.abs(peak.frequency - 450)).toBeLessThan(0.5);
    }
  });
});
