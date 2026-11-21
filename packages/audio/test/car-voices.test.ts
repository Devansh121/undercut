import { describe, expect, it } from 'vitest';
import {
  bandPower,
  findPeak,
  integratedLoudness,
  magnitudeSpectrum,
  maxStep,
} from '../src/analysis/index';
import { Ducker, DUCKING } from '../src/dsp/ducking';
import {
  AudioCore,
  AUDIO_VIEWS,
  DEFAULT_POWER_UNIT,
  defaultCarState,
  SLIP_LIMIT,
  type AudioCarState,
  type AudioView,
  type LayerName,
  VIEW_BALANCE,
} from '../src/index';
import { engineState, FS, render, type Clip } from './helpers';

const FFT_LEN = 16384;
const db = (x: number) => 10 * Math.log10(x);

function tail(x: Float32Array, len = FFT_LEN): Float64Array {
  return magnitudeSpectrum(x, x.length - len, len, len * 4);
}

/** Render `state` for `seconds` and report one layer's RMS over the last half. */
function layerRms(state: AudioCarState, layer: LayerName, seconds = 0.6, view?: AudioView): number {
  const core = new AudioCore({ sampleRate: FS, ...(view ? { view } : {}) });
  render(core, seconds / 2, () => state);
  core.meters.reset();
  render(core, seconds / 2, () => state);
  return core.meters.rms(layer);
}

/** Step-size check around a change at `T`, as in safety.test.ts. */
const T = 0.4;
const RATIO = 1.2;
function stepsAround(clip: Clip): { before: number; during: number; after: number } {
  const x = clip.left;
  const t = Math.round(T * FS);
  return {
    before: maxStep(x, Math.round(0.1 * FS), t),
    during: maxStep(x, t, t + Math.round(0.15 * FS)),
    after: maxStep(x, x.length - Math.round(0.4 * FS), x.length),
  };
}

const road = (extra: Partial<AudioCarState>): AudioCarState => ({
  ...defaultCarState(),
  speed: 40,
  ...extra,
});

describe('gear shift: the upshift crack', () => {
  const upshift = (load: number) => (t: number) =>
    engineState(10_000, load, {
      gear: t < T ? 4 : 5,
      shifting: t >= T && t < T + 0.03,
      shiftDirection: 1,
    });

  it('cracks when the ignition comes back on a loaded upshift, not on a lifted one', () => {
    const loaded = new AudioCore({ sampleRate: FS });
    render(loaded, 0.8, upshift(1));
    expect(loaded.meters.rms('crack')).toBeGreaterThan(1e-4);
    const lifted = new AudioCore({ sampleRate: FS });
    render(lifted, 0.8, upshift(0));
    expect(lifted.meters.rms('crack')).toBe(0);
  });

  it('lands within one 128-frame block of the sim event that ends the shift', () => {
    // Render with and without the shift; the outputs agree exactly until the shift starts,
    // and the crack's own layer starts exactly when the shift ends.
    const withShift = render(new AudioCore({ sampleRate: FS }), 0.7, upshift(1));
    const without = render(new AudioCore({ sampleRate: FS }), 0.7, (t) =>
      engineState(10_000, 1, { gear: t < T ? 4 : 5 }),
    );
    let first = -1;
    for (let i = 0; i < withShift.left.length && first < 0; i++)
      if (withShift.left[i] !== without.left[i]) first = i;
    // States go in at 120 Hz: the shift flag is applied at the update at or after T.
    const update = Math.ceil(T * 120 - 1e-9) / 120;
    expect(first).toBeGreaterThanOrEqual(Math.round(update * FS) - 1);
    expect(first - Math.round(update * FS)).toBeLessThan(128);
  });
});

describe('lift-off: overrun burble', () => {
  it('burbles on the overrun after a lift and never on throttle', () => {
    const core = new AudioCore({ sampleRate: FS });
    render(core, 1.5, (t) =>
      engineState(t < 0.3 ? 11_500 : 11_500 - 1500 * (t - 0.3), t < 0.3 ? 1 : 0),
    );
    expect(core.meters.rms('burble')).toBeGreaterThan(1e-4);
    expect(layerRms(engineState(11_000, 1), 'burble')).toBe(0);
  });

  it('roughens the overrun note: the firing line stands 6 dB less above the floor beside it', () => {
    // Same rpm and load; only whether the throttle was just shut differs.
    const prominence = (x: Float32Array) => {
      const m = tail(x, 8192);
      const f0 = 450;
      const line = findPeak(m, FS, f0 * 0.97, f0 * 1.03).magnitude ** 2;
      const floor = bandPower(m, FS, f0 * 0.62, f0 * 0.88) + bandPower(m, FS, f0 * 1.12, f0 * 1.38);
      return db(line / floor);
    };
    const held = render(new AudioCore({ sampleRate: FS }), 1.2, () =>
      engineState(9000, 0.02, { throttle: 0.5 }),
    );
    const lifted = render(new AudioCore({ sampleRate: FS }), 1.2, (t) =>
      engineState(9000, t < 0.8 ? 1 : 0.02),
    );
    expect(prominence(lifted.left)).toBeLessThan(prominence(held.left) - 6);
  });
});

describe('tone follows load', () => {
  for (const rpm of [7000, 11_000]) {
    it(`harmonic balance shifts up by 6 dB or more from trailing to full throttle at ${rpm} rpm`, () => {
      const harmonics = (x: Float32Array, from: number, to: number) => {
        const m = tail(x);
        const f0 = rpm / 20;
        let sum = 0;
        for (let k = from; k <= to; k++)
          sum += findPeak(m, FS, f0 * (k - 0.1), f0 * (k + 0.1)).magnitude ** 2;
        return sum;
      };
      const balance = (x: Float32Array) => db(harmonics(x, 4, 16) / harmonics(x, 1, 3));
      const full = render(new AudioCore({ sampleRate: FS }), 0.8, () => engineState(rpm, 1));
      const trailing = render(new AudioCore({ sampleRate: FS }), 0.8, () => engineState(rpm, 0.03));
      expect(balance(full.left) - balance(trailing.left)).toBeGreaterThan(6);
    });
  }
});

describe('transmission whine', () => {
  const gear = 5;
  const rpm = 10_000;
  const mesh = (rpm / 60) * (DEFAULT_POWER_UNIT.gearbox.pinionTeeth[gear - 1] as number);

  it(`whines at the engaged pair's mesh frequency (${mesh.toFixed(0)} Hz in 5th at 10 000 rpm)`, () => {
    const clip = render(new AudioCore({ sampleRate: FS, view: 'cockpit' }), 0.8, () =>
      engineState(rpm, 0.05, { gear }),
    );
    const peak = findPeak(tail(clip.left), FS, mesh * 0.98, mesh * 1.02);
    expect(Math.abs(peak.frequency - mesh) / mesh).toBeLessThan(0.002);
  });

  it('is louder on the overrun than under full load, and silent in neutral', () => {
    const over = layerRms(engineState(rpm, 0.05, { gear }), 'gearWhine');
    const pull = layerRms(engineState(rpm, 1, { gear }), 'gearWhine');
    expect(db(over * over) - db(pull * pull)).toBeGreaterThan(3);
    expect(layerRms(engineState(rpm, 0.05, { gear: 0 }), 'gearWhine')).toBe(0);
  });
});

describe('camera views', () => {
  const state = engineState(9000, 1, { gear: 5, speed: 60 });

  it('the cockpit and T-cam hear the intake level with the exhaust, the chase camera the exhaust', () => {
    // Layer levels are measured before the view; the view's gains then set each one's share.
    const core = new AudioCore({ sampleRate: FS });
    render(core, 0.4, () => state);
    core.meters.reset();
    render(core, 0.4, () => state);
    const intake = core.meters.rms('intake');
    const exhaust = core.meters.rms('exhaust');
    const share = (view: AudioView) => {
      const [ge, gi] = VIEW_BALANCE[view].gains;
      const i = (gi * intake) ** 2;
      return i / (i + (ge * exhaust) ** 2);
    };
    expect(share('cockpit')).toBeGreaterThan(0.4);
    expect(share('tcam')).toBeGreaterThan(0.4);
    expect(share('chase')).toBeLessThan(0.1);
    expect(share('trackside')).toBeLessThan(0.1);
  });

  it('the exhaust reaches the cockpit and trackside dulled: on the overrun, 6 and 3 dB less above 5 kHz', () => {
    // On the overrun the exhaust carries the top of the spectrum (combustion noise, heard
    // through the tub, brightens the cockpit under load, as intended).
    const overrun = engineState(9000, 0.03);
    const top = (view: AudioView) => {
      const m = tail(render(new AudioCore({ sampleRate: FS, view }), 0.8, () => overrun).left);
      return db(bandPower(m, FS, 5000, 20_000) / bandPower(m, FS, 20, 20_000));
    };
    expect(top('chase') - top('cockpit')).toBeGreaterThan(6);
    expect(top('chase') - top('trackside')).toBeGreaterThan(3);
  });

  it('every view sits within 6 LU of the others', () => {
    const levels = AUDIO_VIEWS.map((view) => {
      const clip = render(new AudioCore({ sampleRate: FS, view }), 2, () => state);
      return integratedLoudness([clip.left, clip.right], FS);
    });
    expect(Math.max(...levels) - Math.min(...levels)).toBeLessThanOrEqual(6);
  });

  it('a camera cut glides without a click', () => {
    for (const [from, to] of [
      ['chase', 'cockpit'],
      ['cockpit', 'trackside'],
    ] as const) {
      const core = new AudioCore({ sampleRate: FS, view: from });
      const n = Math.round(1.2 * FS);
      const left = new Float32Array(n);
      const right = new Float32Array(n);
      let frame = 0;
      while (frame < n) {
        if (frame % 400 === 0) core.setCarState(state);
        if (frame === Math.round(T * FS)) core.setView(to);
        // T × FS is a multiple of 400, so the cut lands on an update boundary.
        const m = Math.min(128, n - frame, 400 - (frame % 400));
        core.process([left.subarray(frame, frame + m), right.subarray(frame, frame + m)], m);
        frame += m;
      }
      const s = stepsAround({ left, right });
      expect(s.during, `${from} to ${to}`).toBeLessThanOrEqual(RATIO * Math.max(s.before, s.after));
    }
  });
});

describe('tyres', () => {
  it('scrub rises strictly with slip from its onset up to the grip limit', () => {
    const levels: number[] = [];
    for (let k = 0; k <= 10; k++) {
      levels.push(layerRms(road({ slipFront: (k / 10) * SLIP_LIMIT }), 'scrub'));
    }
    // Silent below the onset (0.3 of the limit), then strictly rising.
    expect(levels[0]).toBe(0);
    expect(levels[3]).toBeLessThan(1e-6);
    for (let k = 4; k <= 10; k++)
      expect(levels[k], `slip ${k / 100}`).toBeGreaterThan(1.05 * (levels[k - 1] as number));
  });

  it('squeals only past the limit', () => {
    expect(layerRms(road({ slipFront: SLIP_LIMIT }), 'squeal')).toBe(0);
    expect(layerRms(road({ slipFront: 1.5 * SLIP_LIMIT }), 'squeal')).toBeGreaterThan(1e-3);
  });

  it('lock-up howls and wheelspin rasps: different voices, each only when asked', () => {
    const lock = road({ slipFront: 0.8, slipRatioFront: -0.8 });
    const spin = road({ slipRear: 0.6, slipRatioRear: 0.6 });
    expect(layerRms(lock, 'lockup')).toBeGreaterThan(1e-3);
    expect(layerRms(lock, 'wheelspin')).toBe(0);
    expect(layerRms(spin, 'wheelspin')).toBeGreaterThan(1e-3);
    expect(layerRms(spin, 'lockup')).toBe(0);
    // A locked tyre howls near 1.35 kHz; a spinning one rasps in the 450–700 Hz band.
    const lockClip = render(new AudioCore({ sampleRate: FS }), 0.8, () => lock);
    const spinClip = render(new AudioCore({ sampleRate: FS }), 0.8, () => spin);
    const lockPeak = findPeak(tail(lockClip.left), FS, 300, 4000).frequency;
    expect(lockPeak).toBeGreaterThan(1250);
    expect(lockPeak).toBeLessThan(1450);
    const lowOverHowl = (x: Float32Array) => {
      const m = tail(x);
      return db(bandPower(m, FS, 450, 700) / bandPower(m, FS, 1250, 1450));
    };
    expect(lowOverHowl(spinClip.left) - lowOverHowl(lockClip.left)).toBeGreaterThan(10);
  });
});

describe('surfaces', () => {
  it('grass and gravel sound only off the asphalt, and take over from its rolling noise', () => {
    expect(layerRms(road({}), 'grass')).toBe(0);
    expect(layerRms(road({}), 'gravel')).toBe(0);
    expect(layerRms(road({ grass: 1 }), 'grass')).toBeGreaterThan(1e-3);
    expect(layerRms(road({ gravel: 1 }), 'gravel')).toBeGreaterThan(1e-3);
    const asphalt = layerRms(road({}), 'roll');
    const onGrass = layerRms(road({ grass: 1 }), 'roll');
    // The asphalt roar goes; the tyre's own cavity resonance stays at half.
    expect(onGrass).toBeLessThan(asphalt / 2);
  });

  it('gravel is the gritty one: more energy at 2.5–4 kHz than grass, relative to its body', () => {
    const top = (s: AudioCarState) => {
      const m = tail(render(new AudioCore({ sampleRate: FS }), 0.8, () => s).left);
      return db(bandPower(m, FS, 2500, 4000) / bandPower(m, FS, 40, 400));
    };
    expect(top(road({ gravel: 1 })) - top(road({ grass: 1 }))).toBeGreaterThan(10);
  });

  it('kerb rumble repeats at the ridge rate', () => {
    const clip = render(new AudioCore({ sampleRate: FS }), 1.2, () =>
      road({ speed: 30, kerb: 1, kerbFrequency: 60 }),
    );
    const peak = findPeak(tail(clip.left, 32768), FS, 40, 260);
    // The rumble is a pulse train at 60 Hz: its strongest line is a multiple of 60 Hz.
    const k = Math.round(peak.frequency / 60);
    expect(Math.abs(peak.frequency - 60 * k)).toBeLessThan(1);
  });
});

describe('wind and DRS', () => {
  it('opening the flap drops the wind by 2 to 4.5 dB and knocks once each way', () => {
    const shut = layerRms(road({ speed: 80 }), 'wind');
    const open = layerRms(road({ speed: 80, drs: 1 }), 'wind');
    const d = db(shut * shut) - db(open * open);
    expect(d).toBeGreaterThan(2);
    expect(d).toBeLessThan(4.5);
    expect(layerRms(road({ speed: 80 }), 'drs')).toBe(0);
    const core = new AudioCore({ sampleRate: FS });
    const clip = render(core, 1.2, (t) => road({ speed: 80, drs: t > T && t < 0.9 ? 1 : 0 }));
    expect(core.meters.rms('drs')).toBeGreaterThan(1e-5);
    const s = stepsAround(clip);
    expect(s.during).toBeLessThanOrEqual(RATIO * Math.max(s.before, s.after));
  });

  it('wind rises with speed', () => {
    const slow = layerRms(road({ speed: 30 }), 'wind');
    const fast = layerRms(road({ speed: 85 }), 'wind');
    expect(fast).toBeGreaterThan(4 * slow);
  });
});

describe('impacts', () => {
  const hit = (speed: number, serial: number) => (t: number) =>
    road({ speed: 30, impactSpeed: t >= T ? speed : 0, impactSerial: t >= T ? serial : 0 });

  it('sound once per new serial, louder for harder hits, nothing for a touch', () => {
    const level = (speed: number) => {
      const core = new AudioCore({ sampleRate: FS });
      render(core, 1, hit(speed, 1));
      return core.meters.rms('impact');
    };
    expect(level(0.2)).toBe(0);
    const levels = [2, 6, 12].map(level);
    expect(levels[1]).toBeGreaterThan(1.5 * (levels[0] as number));
    expect(levels[2]).toBeGreaterThan(1.3 * (levels[1] as number));
    const none = new AudioCore({ sampleRate: FS });
    render(none, 1, () => road({ speed: 30, impactSpeed: 12, impactSerial: 0 }));
    expect(none.meters.rms('impact')).toBe(0);
  });

  it('start at the update that reports them', () => {
    const a = render(new AudioCore({ sampleRate: FS }), 0.6, hit(10, 1));
    const b = render(new AudioCore({ sampleRate: FS }), 0.6, hit(10, 0));
    let first = -1;
    for (let i = 0; i < a.left.length && first < 0; i++) if (a.left[i] !== b.left[i]) first = i;
    const update = Math.round((Math.ceil(T * 120 - 1e-9) / 120) * FS);
    expect(first - update).toBeGreaterThanOrEqual(0);
    expect(first - update).toBeLessThan(128);
  });

  it('a hard hit stays under 0 dBTP with every gain at its maximum', () => {
    const core = new AudioCore({ sampleRate: FS });
    for (const id of ['master', 'engine', 'effects', 'ui', 'ambience'] as const)
      core.setGain(id, 2);
    const clip = render(core, 1, (t) => ({
      ...hit(60, 1)(t),
      ...engineState(12_000, 1),
      speed: 80,
    }));
    let peak = 0;
    for (const x of clip.left) peak = Math.max(peak, Math.abs(x));
    expect(peak).toBeLessThan(1);
  });
});

describe('ducking', () => {
  it('a UI cue ducks ambience 8 dB and the car 3 dB, and lets go', () => {
    const d = new Ducker(FS);
    const n = 32;
    const ui = new Float64Array(n).fill(0.2);
    const quiet = new Float64Array(n);
    for (let k = 0; k < Math.round((0.1 * FS) / n); k++) d.process(ui, ui, n);
    expect(20 * Math.log10(d.ambience[n - 1] as number)).toBeCloseTo(DUCKING.uiDuck.ambience, 1);
    expect(20 * Math.log10(d.engine[n - 1] as number)).toBeCloseTo(DUCKING.uiDuck.engine, 1);
    expect(20 * Math.log10(d.effects[n - 1] as number)).toBeCloseTo(DUCKING.uiDuck.effects, 1);
    for (let k = 0; k < Math.round((3 * FS) / n); k++) d.process(quiet, quiet, n);
    expect(d.ambience[n - 1]).toBeGreaterThan(0.999);
    expect(d.engine[n - 1]).toBeGreaterThan(0.999);
  });

  it('an impact ducks ambience only, smoothly', () => {
    const d = new Ducker(FS);
    const n = 32;
    const quiet = new Float64Array(n);
    d.impact = 1;
    let prev = 1;
    let biggest = 0;
    for (let k = 0; k < Math.round((0.1 * FS) / n); k++) {
      d.process(quiet, quiet, n);
      for (let i = 0; i < n; i++) {
        biggest = Math.max(biggest, Math.abs((d.ambience[i] as number) - prev));
        prev = d.ambience[i] as number;
      }
    }
    expect(20 * Math.log10(d.ambience[n - 1] as number)).toBeCloseTo(
      DUCKING.impactDuck.ambience,
      1,
    );
    expect(d.engine[n - 1]).toBe(1);
    // No step: the gain moves by well under 1 % per sample.
    expect(biggest).toBeLessThan(0.01);
  });

  it('the core ducks ambience while an impact sounds', () => {
    const core = new AudioCore({ sampleRate: FS });
    render(core, 0.6, (t) =>
      road({ speed: 30, impactSpeed: t >= 0.3 ? 12 : 0, impactSerial: t >= 0.3 ? 1 : 0 }),
    );
    // Rendered past the hit: the ducker has engaged.
    expect(core.ducker.ambience[0]).toBeLessThan(0.9);
  });
});

describe('determinism', () => {
  it('the new layers give the same samples for the same inputs, whatever the block size', () => {
    const drive = (t: number): AudioCarState =>
      engineState(9000 + 2000 * Math.sin(3 * t), t % 0.5 < 0.25 ? 1 : 0, {
        gear: 4 + (Math.floor(t * 4) % 3),
        shifting: t % 0.25 < 0.03,
        shiftDirection: 1,
        speed: 60,
        slipFront: 0.2,
        slipRatioFront: t > 0.4 ? -0.7 : 0,
        slipRatioRear: t > 0.6 ? 0.5 : 0,
        grass: t > 0.3 && t < 0.7 ? 0.5 : 0,
        gravel: t > 0.5 ? 0.75 : 0,
        drs: t > 0.2 && t < 0.8 ? 1 : 0,
        impactSpeed: 8,
        impactSerial: Math.floor(t * 3),
      });
    const once = (block: number) => {
      const core = new AudioCore({ sampleRate: FS, seed: 9 });
      const n = FS;
      const left = new Float32Array(n);
      const right = new Float32Array(n);
      let frame = 0;
      let next = 0;
      while (frame < n) {
        if (frame >= next) {
          core.setCarState(drive(frame / FS));
          if (frame === 400 * 50) core.setView('cockpit');
          next += 400;
        }
        const m = Math.min(block, n - frame, next - frame);
        core.process([left.subarray(frame, frame + m), right.subarray(frame, frame + m)], m);
        frame += m;
      }
      return left;
    };
    const ref = once(1);
    for (const block of [7, 128, 4096]) {
      const other = once(block);
      let first = -1;
      for (let i = 0; i < ref.length && first < 0; i++) if (ref[i] !== other[i]) first = i;
      expect(first, `block ${block}`).toBe(-1);
    }
  }, 30_000);
});
