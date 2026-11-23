import { describe, expect, it } from 'vitest';
import {
  AudioCore,
  AUDIBLE_CARS,
  DOPPLER_MAX,
  DOPPLER_MIN,
  MAX_ITD,
  SceneSound,
  type AmbienceKind,
  type AudioScene,
  type OtherCarSound,
} from '../src';
import {
  bandPower,
  findPeak,
  magnitudeSpectrum,
  maxStep,
  rmsDbfs,
  samplePeak,
  spectralCentroid,
} from '../src/analysis';
import { engineState, FS, identical } from './helpers';

const RPM = 9000;
/** Firing frequency of a four-stroke V6: rpm / 60 × 3. */
const FIRING = (RPM / 60) * 3;

const car = (x: number, z = 0, extra: Partial<OtherCarSound> = {}): OtherCarSound => ({
  x,
  z,
  vx: 0,
  vz: 0,
  engineSpeed: (RPM * Math.PI) / 30,
  throttle: 1,
  ...extra,
});

const scene = (cars: OtherCarSound[], extra: Partial<AudioScene> = {}): AudioScene => ({
  cars,
  ambience: 'none',
  crowdLeft: 0,
  crowdRight: 0,
  lights: -1,
  ...extra,
});

interface Clip {
  left: Float32Array;
  right: Float32Array;
}

/**
 * Render `seconds`, applying `at(t)` every `1/60` s (frame rate), in host blocks of `block`
 * frames that never straddle an update.
 */
function render(
  seconds: number,
  at: (t: number) => AudioScene | undefined,
  options: { block?: number; core?: AudioCore } = {},
): Clip {
  const core = options.core ?? new AudioCore({ sampleRate: FS, seed: 3 });
  const total = Math.round(seconds * FS);
  const left = new Float32Array(total);
  const right = new Float32Array(total);
  const block = options.block ?? 128;
  let frame = 0;
  let updates = 0;
  let next = 0;
  while (frame < total) {
    if (frame >= next) {
      const s = at(frame / FS);
      if (s) core.setScene(s);
      updates++;
      next = Math.round((updates * FS) / 60);
    }
    const n = Math.min(block, total - frame, next - frame);
    core.process([left.subarray(frame, frame + n), right.subarray(frame, frame + n)], n);
    frame += n;
  }
  return { left, right };
}

const still = (s: AudioScene, seconds = 1) => render(seconds, () => s);
const spectrum = (x: Float32Array, startS = 0.5, fft = 65536) =>
  magnitudeSpectrum(x, Math.round(startS * FS), Math.min(fft, x.length - startS * FS), fft);
const db = (power: number) => 10 * Math.log10(power);

describe('other cars: the voice pool', () => {
  it('keeps nineteen slots, voices the nearest six and sums the rest into the far field', () => {
    const sound = new SceneSound(FS);
    sound.set(scene(Array.from({ length: 30 }, (_, i) => car(10 + i * 20))));
    expect(sound.audibleCount).toBe(AUDIBLE_CARS);
    expect(sound.fieldLevel).toBeGreaterThan(0);
    sound.set(scene([car(301)]));
    expect(sound.audibleCount, 'past the cull distance').toBe(0);
    expect(sound.fieldLevel, 'but inside the far field').toBeGreaterThan(0);
    sound.set(scene([car(601)]));
    expect(sound.fieldLevel).toBe(0);
  });

  it('pitches each car at its firing frequency', () => {
    const clip = still(scene([car(10)]));
    const peak = findPeak(spectrum(clip.left), FS, 300, 700).frequency;
    expect(Math.abs(peak - FIRING)).toBeLessThan(0.5);
  });

  it('brightens with throttle at the same rpm', () => {
    const on = spectralCentroid(spectrum(still(scene([car(10)])).left), FS, 100, 12000);
    const off = spectralCentroid(
      spectrum(still(scene([car(10, 0, { throttle: 0 })])).left),
      FS,
      100,
      12000,
    );
    expect(on / off).toBeGreaterThan(1.3);
  });

  it('falls 6 dB per doubling of distance at the firing frequency', () => {
    const level = (x: number) =>
      findPeak(spectrum(still(scene([car(x)])).left), FS, 400, 500).magnitude;
    const drop = 20 * Math.log10(level(10) / level(40));
    expect(drop).toBeGreaterThan(11);
    expect(drop).toBeLessThan(13);
  });

  it('loses high frequencies with distance (air absorption)', () => {
    const tilt = (x: number) => {
      const m = spectrum(still(scene([car(x)])).left);
      return db(bandPower(m, FS, 4000, 8000)) - db(bandPower(m, FS, 400, 500));
    };
    expect(tilt(10) - tilt(150)).toBeGreaterThan(6);
  });

  it('places a car to the right by level and by arrival time', () => {
    const clip = still(scene([car(0, 10)]));
    expect(rmsDbfs(clip.right) - rmsDbfs(clip.left)).toBeGreaterThan(8);
    // The left ear hears it later: find the lag that best aligns left with right.
    let best = 0;
    let bestLag = 0;
    for (let lag = 0; lag < 60; lag++) {
      let sum = 0;
      for (let i = 24000; i < 40000; i++) sum += clip.right[i]! * clip.left[i + lag]!;
      if (sum > best) {
        best = sum;
        bestLag = lag;
      }
    }
    const itd = MAX_ITD * FS;
    expect(bestLag).toBeGreaterThanOrEqual(Math.floor(itd));
    expect(bestLag).toBeLessThanOrEqual(Math.ceil(itd) + 4); // plus the head shadow's group delay
  });

  it('sounds darker behind than in front at the same distance', () => {
    const tilt = (x: number) => {
      const m = spectrum(still(scene([car(x)])).left);
      return db(bandPower(m, FS, 3000, 8000)) - db(bandPower(m, FS, 400, 500));
    };
    expect(tilt(10) - tilt(-10)).toBeGreaterThan(3);
  });

  it('shifts pitch by Doppler, bounded', () => {
    const pitch = (vx: number) =>
      findPeak(spectrum(still(scene([car(20, 0, { vx })])).left), FS, 300, 650).frequency;
    expect(Math.abs(pitch(-30) - (FIRING * 343) / 313)).toBeLessThan(0.5);
    expect(Math.abs(pitch(-150) - FIRING * DOPPLER_MAX)).toBeLessThan(0.5);
    expect(Math.abs(pitch(150) - FIRING * DOPPLER_MIN)).toBeLessThan(0.5);
  });

  it('glides through a pass without a jump in pitch', () => {
    // A car 4 m to the right closes at 50 m/s from 100 m ahead and ends 100 m behind.
    const clip = render(4, (t) => scene([car(100 - 50 * t, 4, { vx: -50 })]));
    const track: number[] = [];
    for (let start = 0; start + 4096 <= clip.left.length; start += 2048) {
      const m = magnitudeSpectrum(clip.right, start, 4096, 16384);
      track.push(findPeak(m, FS, 330, 600).frequency);
    }
    expect(Math.abs(track[3]! - (FIRING * 343) / 293)).toBeLessThan(2);
    expect(Math.abs(track.at(-1)! - (FIRING * 343) / 393)).toBeLessThan(2);
    for (let i = 1; i < track.length; i++) expect(track[i]!).toBeLessThan(track[i - 1]! + 0.5);
  });

  it('fades a culled car out instead of cutting it', () => {
    const clip = render(1, (t) => scene(t < 0.5 ? [car(10)] : []));
    const cut = Math.round(0.5 * FS); // the first update without the car
    const before = rmsDbfs(clip.left.subarray(cut - 480, cut));
    const after = rmsDbfs(clip.left.subarray(cut, cut + 480));
    expect(before - after).toBeLessThan(2); // 10 ms windows either side
    expect(rmsDbfs(clip.left.subarray(cut + 0.4 * FS))).toBeLessThan(before - 60);
  });

  it('renders bit-identically however the host splits blocks', () => {
    const at = (t: number) =>
      scene(
        Array.from({ length: 19 }, (_, i) =>
          car(150 - 40 * t + i * 12, (i % 3) - 1, { vx: -40, throttle: (i % 4) / 3 }),
        ),
        {
          ambience: 'forest',
          crowdLeft: t < 1 ? 0.8 : 0.2,
          crowdRight: 0.4,
          lights: Math.min(6, Math.floor(t * 4)),
        },
      );
    const a = render(2, at, { block: 128 });
    const b = render(2, at, { block: 127 });
    const c = render(2, at, { block: 4096 });
    expect(identical(a.left, b.left) && identical(a.right, b.right)).toBe(true);
    expect(identical(a.left, c.left) && identical(a.right, c.right)).toBe(true);
  });

  it('survives invalid car data', () => {
    const bad = NaN;
    const clip = still(
      scene([
        { x: bad, z: Infinity, vx: bad, vz: -Infinity, engineSpeed: bad, throttle: Infinity },
        car(10, 0, { vx: bad, engineSpeed: Infinity, throttle: -3 }),
      ]),
    );
    expect(clip.left.every(Number.isFinite) && clip.right.every(Number.isFinite)).toBe(true);
  });
});

describe('circuit ambience', () => {
  const bed = (ambience: AmbienceKind, extra: Partial<AudioScene> = {}) =>
    still(scene([], { ambience, ...extra }), 6);
  const band = (clip: Clip, lo: number, hi: number) =>
    db(bandPower(spectrum(clip.left, 2, 131072), FS, lo, hi));

  it('is exactly silent with no ambience and no crowd', () => {
    const clip = bed('none');
    expect(clip.left.every((x) => x === 0)).toBe(true);
  });

  it('has twice the wind in the trees in the forest as in the park', () => {
    const difference = band(bed('forest'), 450, 650) - band(bed('park'), 450, 650);
    expect(Math.abs(difference - 20 * Math.log10(1 / 0.45))).toBeLessThan(1.5);
  });

  it('carries birdsong in the forest: calls stand well above the bed', () => {
    const clip = still(scene([], { ambience: 'forest' }), 12);
    const levels: number[] = [];
    for (let s = 2 * FS; s + 2048 <= clip.left.length; s += 1024) {
      levels.push(db(bandPower(magnitudeSpectrum(clip.left, s, 2048, 2048), FS, 2800, 4600)));
    }
    levels.sort((a, b) => a - b);
    const at = (q: number) => levels[Math.floor(q * (levels.length - 1))]!;
    expect(at(0.98) - at(0.5)).toBeGreaterThan(10); // measured 14.4 dB at seed 3
  });

  it('hums at twice the mains frequency and rumbles low in the city at night', () => {
    const city = bed('city-night');
    expect(
      Math.abs(findPeak(spectrum(city.left, 2, 131072), FS, 80, 120).frequency - 100),
    ).toBeLessThan(0.5);
    expect(band(city, 30, 150) - band(bed('forest'), 30, 150)).toBeGreaterThan(15);
  });

  it('puts the crowd on the side of the stands and scales with it', () => {
    const left = bed('none', { crowdLeft: 1, crowdRight: 0.25 });
    const side = rmsDbfs(left.left.subarray(2 * FS)) - rmsDbfs(left.right.subarray(2 * FS));
    expect(Math.abs(side - 12.04)).toBeLessThan(0.5);
    const quarter = bed('none', { crowdLeft: 0.25 });
    const drop = rmsDbfs(left.left.subarray(2 * FS)) - rmsDbfs(quarter.left.subarray(2 * FS));
    expect(Math.abs(drop - 12.04)).toBeLessThan(0.5);
  });

  it('cheers at lights out', () => {
    const clip = render(5, (t) =>
      scene([], { crowdLeft: 0.5, crowdRight: 0.5, lights: t < 2 ? 5 : 6 }),
    );
    const before = rmsDbfs(clip.left.subarray(1.4 * FS, 1.9 * FS));
    const after = rmsDbfs(clip.left.subarray(3.2 * FS, 3.7 * FS));
    expect(after - before).toBeGreaterThan(4);
  });
});

describe('cues', () => {
  it('sounds one 1 kHz tone per lamp and a 2 kHz tone at lights out, once each', () => {
    const lamp = (t: number) => (t < 0.5 ? 0 : t < 5.5 ? Math.min(5, Math.floor(t - 0.5) + 1) : 6);
    const clip = render(7, (t) => scene([], { lights: lamp(t) }));
    for (let i = 0; i < 5; i++) {
      const start = Math.round((0.5 + i) * FS) + 800;
      const m = magnitudeSpectrum(clip.left, start, 4096, 32768);
      expect(Math.abs(findPeak(m, FS, 500, 3000).frequency - 1000), `lamp ${i + 1}`).toBeLessThan(
        2,
      );
    }
    const go = magnitudeSpectrum(clip.left, Math.round(5.5 * FS) + 800, 4096, 32768);
    expect(Math.abs(findPeak(go, FS, 500, 3000).frequency - 2000)).toBeLessThan(2);
    // Between lamps, and after the go tone, the UI bus is silent: no repeats. (The master DC
    // blocker's tail is not exact zero; −100 dBFS is silent.)
    const peak = (from: number, to = 7) =>
      Math.max(...clip.left.subarray(Math.round(from * FS), Math.round(to * FS)).map(Math.abs));
    expect(peak(4.9, 5.5)).toBeLessThan(1e-5);
    expect(peak(6.2)).toBeLessThan(1e-5);
  });

  it('plays every menu cue on the UI bus, ends in silence, and obeys the UI level', () => {
    for (const cue of ['focus', 'accept', 'back', 'light', 'go'] as const) {
      const core = new AudioCore({ sampleRate: FS });
      core.cue(cue);
      const out = [new Float32Array(24000), new Float32Array(24000)];
      core.process(out, 24000);
      expect(rmsDbfs(out[0]!.subarray(0, 2400)), cue).toBeGreaterThan(-50);
      expect(Math.max(...out[0]!.subarray(20000).map(Math.abs)), cue).toBeLessThan(1e-6);
      const muted = new AudioCore({ sampleRate: FS });
      muted.setGain('ui', 0);
      muted.process([new Float32Array(FS), new Float32Array(FS)], FS); // let the gain settle
      muted.cue(cue);
      const quiet = [new Float32Array(24000), new Float32Array(24000)];
      muted.process(quiet, 24000);
      expect(Math.max(...quiet[0]!.map(Math.abs)), `${cue} muted`).toBeLessThan(1e-6);
    }
  });

  it('lets a new cue overlap the last one instead of cutting it', () => {
    const core = new AudioCore({ sampleRate: FS });
    const out = [new Float32Array(9600), new Float32Array(9600)];
    core.cue('accept');
    core.process(
      out.map((c) => c.subarray(0, 1200)),
      1200,
    );
    core.cue('back');
    core.process(
      out.map((c) => c.subarray(1200)),
      8400,
    );
    let step = 0;
    for (let i = 1100; i < 1300; i++)
      step = Math.max(step, Math.abs(out[0]![i]! - out[0]![i - 1]!));
    expect(step).toBeLessThan(0.02);
  });
});

/** Largest sample-to-sample step of either channel over [from, to) seconds. */
const stepIn = (clip: Clip, from: number, to: number) =>
  Math.max(
    maxStep(clip.left, Math.round(from * FS) + 1, Math.round(to * FS)),
    maxStep(clip.right, Math.round(from * FS) + 1, Math.round(to * FS)),
  );

describe('no steps, no swells (review of PR 51)', () => {
  it('hears two cars at their own rpm, each on its own side', () => {
    const clip = still(
      scene([
        car(10, -8, { engineSpeed: (9000 * Math.PI) / 30 }),
        car(10, 8, { engineSpeed: (11000 * Math.PI) / 30 }),
      ]),
    );
    const l = spectrum(clip.left);
    const r = spectrum(clip.right);
    const a = findPeak(l, FS, 400, 500);
    const b = findPeak(r, FS, 500, 600);
    expect(Math.abs(a.frequency - 450)).toBeLessThan(0.5);
    expect(Math.abs(b.frequency - 550)).toBeLessThan(0.5);
    expect(a.magnitude).toBeGreaterThan(2 * findPeak(r, FS, 400, 500).magnitude);
    expect(b.magnitude).toBeGreaterThan(2 * findPeak(l, FS, 500, 600).magnitude);
  });

  it('fades a receding car smoothly through the cull and field distances, to silence', () => {
    // 40 m/s away from 200 m to 720 m: voice, crossfade into the far field, field fade-out.
    const clip = render(13, (t) => scene([car(200 + 40 * t, 3, { vx: 40 })]));
    let last = Infinity;
    for (let s = 0.25; s + 0.25 <= 12.5; s += 0.25) {
      const level = rmsDbfs(clip.left.subarray(s * FS, (s + 0.25) * FS));
      if (last > -120) expect(level, `at ${(200 + 40 * s).toFixed(0)} m`).toBeLessThan(last + 0.5);
      last = level;
    }
    expect(samplePeak(clip.left.subarray(12.5 * FS))).toBeLessThan(1e-6);
  });

  it('gives the far field each car once at full throttle (the voice applies throttle)', () => {
    const sound = new SceneSound(FS);
    sound.set(scene([car(400, 0, { throttle: 0 })]));
    const closed = sound.fieldLevel;
    sound.set(scene([car(400, 0, { throttle: 1 })]));
    expect(sound.fieldLevel).toBe(closed);
  });

  it('makes no step when a car enters the pool and another leaves', () => {
    const six = Array.from({ length: 6 }, (_, i) => car(20 + 10 * i, i % 2 ? 3 : -3));
    const clip = render(1.2, (t) => scene(t < 0.5 ? six : [...six, car(8, 2)]));
    const steady = Math.max(stepIn(clip, 0.2, 0.5), stepIn(clip, 0.9, 1.2));
    expect(stepIn(clip, 0.5, 0.65)).toBeLessThanOrEqual(1.2 * steady);
  });

  it('makes no step when the sixth and seventh cars swap places every frame', () => {
    const five = Array.from({ length: 5 }, (_, i) => car(15 + 8 * i, i % 2 ? 3 : -3));
    let flip = false;
    const swap = render(1.5, () => {
      flip = !flip;
      return scene([
        ...five,
        car(flip ? 70 : 72, 4),
        car(flip ? 72 : 70, -4, { engineSpeed: (9500 * Math.PI) / 30 }),
      ]);
    });
    const fixed = render(1.5, () =>
      scene([...five, car(70, 4), car(72, -4, { engineSpeed: (9500 * Math.PI) / 30 })]),
    );
    expect(stepIn(swap, 0.3, 1.5)).toBeLessThanOrEqual(1.2 * stepIn(fixed, 0.3, 1.5));
  });

  it('makes no step when the bed and the crowd change in one update', () => {
    const clip = render(4, (t) =>
      scene(
        [],
        t < 1.5 ? { ambience: 'forest' } : { ambience: 'city-night', crowdLeft: 2, crowdRight: 2 },
      ),
    );
    const steady = Math.max(stepIn(clip, 0.8, 1.5), stepIn(clip, 3.2, 4));
    expect(stepIn(clip, 1.5, 1.65)).toBeLessThanOrEqual(1.2 * steady);
  });

  it('does not let the frozen race mix through when a menu cue follows a pause', () => {
    const drive = (core: AudioCore) => {
      core.setCarState(engineState(11_000, 1, { boost: 1, ersPower: 120_000, speed: 70 }));
      core.setScene(
        scene(
          Array.from({ length: 8 }, (_, i) => car(6 + 6 * i, i % 2 ? 3 : -3)),
          {
            ambience: 'park',
            crowdLeft: 2,
            crowdRight: 1.4,
          },
        ),
      );
    };
    const block = (core: AudioCore, seconds: number) => {
      const out = [new Float32Array(seconds * FS), new Float32Array(seconds * FS)];
      for (let i = 0; i < out[0]!.length; i += 128) {
        core.process(
          out.map((c) => c.subarray(i, i + 128)),
          Math.min(128, out[0]!.length - i),
        );
      }
      return out;
    };
    // Driving, then a pause (tap to pause: the car buses still open), frozen.
    const core = new AudioCore({ sampleRate: FS });
    drive(core);
    block(core, 1);
    core.setPaused(true);
    block(core, 0.2);
    expect(core.silent).toBe(true);
    // The page closes the car and circuit buses, unpauses and plays the cue, in that order.
    for (const id of ['engine', 'effects', 'ambience'] as const) core.setGain(id, 0);
    core.setPaused(false);
    core.cue('focus');
    const after = block(core, 0.15);
    // The cue alone, from a core whose car buses were closed all along.
    const alone = new AudioCore({ sampleRate: FS });
    for (const id of ['engine', 'effects', 'ambience'] as const) alone.setGain(id, 0);
    drive(alone);
    block(alone, 1);
    alone.cue('focus');
    const cue = block(alone, 0.15);
    const peak = (c: Float32Array[]) => Math.max(samplePeak(c[0]!), samplePeak(c[1]!));
    expect(peak(after)).toBeLessThanOrEqual(peak(cue) * 1.001);
  });
});
