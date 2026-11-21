import v8 from 'node:v8';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { dcOffset, maxStep, samplePeak, truePeak } from '../src/analysis/index';
import { DEFAULT_LIMITER, softClip } from '../src/dsp/limiter';
import { SoftLimiter } from '../src/dsp/limiter';
import { AudioCore, type AudioCarState } from '../src/index';
import { engineState, FS, render, type Clip } from './helpers';

/** Everything at once, every gain at its maximum. */
function everything(t: number): AudioCarState {
  return engineState(12_500, 1, {
    boost: 1,
    ersPower: 120_000,
    speed: 95,
    slipFront: 0.3,
    slipRear: 0.3,
    kerb: 1,
    kerbFrequency: 45,
    bottoming: 1,
    revLimiter: true,
    shifting: t % 0.25 < 0.06,
    shiftDirection: t % 0.5 < 0.25 ? 1 : -1,
  });
}

describe('limiter', () => {
  it('holds true peak under 0 dBFS with everything at maximum', () => {
    const core = new AudioCore({ sampleRate: FS });
    for (const id of ['master', 'engine', 'effects', 'ui'] as const) core.setGain(id, 2);
    const clip = render(core, 3, everything);
    expect(core.limiter.minGain, 'the limiter engaged').toBeLessThan(0.9);
    for (const ch of [clip.left, clip.right]) {
      expect(samplePeak(ch)).toBeLessThan(1);
      expect(truePeak(ch)).toBeLessThan(1);
    }
  });

  it('never reaches its ceiling, whatever the input', () => {
    const limiter = new SoftLimiter(FS);
    const n = FS;
    const l = new Float64Array(n);
    const r = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const x = 20 * Math.sin(i * 0.05) + (i % 997 === 0 ? 1e6 : 0);
      l[i] = x;
      r[i] = -x * 1.3;
    }
    for (let i = 0; i < n; i += 128) {
      const m = Math.min(128, n - i);
      limiter.process(l.subarray(i, i + m), r.subarray(i, i + m), m);
    }
    expect(Math.max(samplePeak(l), samplePeak(r))).toBeLessThan(DEFAULT_LIMITER.ceiling);
  });

  it('holds the threshold without the clipper on a sudden overload', () => {
    const limiter = new SoftLimiter(FS);
    const l = new Float64Array(4800);
    for (let i = 0; i < l.length; i++) l[i] = (i > 2000 ? 3 : 0.1) * Math.sin(i * 0.02);
    const r = l.slice();
    limiter.process(l, r, l.length);
    // The look-ahead gain reaches every peak in time: nothing above the threshold.
    expect(samplePeak(l)).toBeLessThanOrEqual(DEFAULT_LIMITER.threshold + 1e-9);
  });

  it('soft clip is the identity below the knee and continuous at it', () => {
    const { knee, ceiling } = DEFAULT_LIMITER;
    expect(softClip(0.5, knee, ceiling)).toBe(0.5);
    expect(softClip(-knee, knee, ceiling)).toBe(-knee);
    expect(Math.abs(softClip(knee + 1e-6, knee, ceiling) - knee)).toBeLessThan(2e-6);
    expect(softClip(1e9, knee, ceiling)).toBeLessThanOrEqual(ceiling);
  });
});

/**
 * Click checks. A click is a step much larger than the signal's own sample-to-sample motion.
 * For each transition we compare the largest step in the 150 ms after it with the largest
 * step in steady state before and after; it may not exceed the larger of the two by more
 * than 20 %. Steady windows are 0.4 s long so their maximum is stable.
 */
const RATIO = 1.2;
const T = 0.4; // transition time in each clip, s

function steps(clip: Clip): { before: number; during: number; after: number } {
  const x = clip.left;
  const at = Math.round(T * FS);
  return {
    before: maxStep(x, at - Math.round(0.35 * FS), at),
    during: maxStep(x, at, at + Math.round(0.15 * FS)),
    after: maxStep(x, x.length - Math.round(0.4 * FS), x.length),
  };
}

function expectNoClick(name: string, clip: Clip): void {
  const s = steps(clip);
  const reference = Math.max(s.before, s.after);
  expect(
    s.during,
    `${name}: during ${s.during.toFixed(4)}, before ${s.before.toFixed(4)}, after ${s.after.toFixed(4)}`,
  ).toBeLessThanOrEqual(RATIO * reference);
}

describe('no clicks', () => {
  const idle = engineState(4500, 0.08);
  const cruise = engineState(10_000, 1, { boost: 0.8, gear: 6 });

  it('starting from silence', () => {
    const core = new AudioCore({ sampleRate: FS });
    const clip = render(core, 1.2, (t) =>
      t < T ? engineState(0, 0, { engineOn: false }) : cruise,
    );
    expect(maxStep(clip.left, 1, Math.round(T * FS))).toBe(0);
    expectNoClick('engine start', clip);
    // The very first samples a fresh core renders fade in from zero.
    const fresh = render(new AudioCore({ sampleRate: FS }), 0.6, () => cruise);
    expect(maxStep(fresh.left, 1, Math.round(0.02 * FS))).toBeLessThanOrEqual(
      maxStep(fresh.left, Math.round(0.2 * FS)),
    );
  });

  it('stopping the engine', () => {
    const core = new AudioCore({ sampleRate: FS });
    const clip = render(core, 1.4, (t) => (t < T ? cruise : { ...cruise, engineOn: false }));
    expectNoClick('engine stop', clip);
  });

  it('pausing and resuming', () => {
    const core = new AudioCore({ sampleRate: FS });
    const left = new Float32Array(Math.round(2 * FS));
    const right = new Float32Array(left.length);
    let frame = 0;
    const run = (seconds: number) => {
      const end = frame + Math.round(seconds * FS);
      while (frame < end) {
        if (frame % 400 === 0) core.setCarState(cruise);
        const n = Math.min(128, end - frame, 400 - (frame % 400));
        core.process([left.subarray(frame, frame + n), right.subarray(frame, frame + n)], n);
        frame += n;
      }
    };
    run(T);
    core.setPaused(true);
    run(0.6);
    expect(core.silent).toBe(true);
    // Fully paused means exact zeros.
    expect(samplePeak(left.subarray(Math.round((T + 0.2) * FS), frame))).toBe(0);
    const resumeAt = frame;
    core.setPaused(false);
    run(1);
    const before = maxStep(left, Math.round(0.05 * FS), Math.round(T * FS));
    const after = maxStep(left, left.length - Math.round(0.4 * FS), left.length);
    expect(maxStep(left, Math.round(T * FS), Math.round((T + 0.15) * FS))).toBeLessThanOrEqual(
      RATIO * before,
    );
    expect(maxStep(left, resumeAt, resumeAt + Math.round(0.15 * FS))).toBeLessThanOrEqual(
      RATIO * Math.max(before, after),
    );
  });

  it('upshifts and downshifts', () => {
    // A downshift blips the throttle, so for a moment the engine is at full load: the
    // reference is the steady full-load step size at the same rpm.
    const fullLoad = render(new AudioCore({ sampleRate: FS }), 1.2, () =>
      engineState(10_000, 1, { gear: 5 }),
    );
    const reference = maxStep(fullLoad.left, Math.round(0.6 * FS));
    for (const dir of [1, -1]) {
      const core = new AudioCore({ sampleRate: FS });
      const clip = render(core, 1.2, (t) =>
        engineState(10_000, dir > 0 ? 1 : 0, {
          shifting: t >= T && t < T + (dir > 0 ? 0.03 : 0.06),
          shiftDirection: dir,
          gear: 5,
        }),
      );
      const s = steps(clip);
      expect(s.during, dir > 0 ? 'upshift' : 'downshift').toBeLessThanOrEqual(
        RATIO * Math.max(reference, s.before, s.after),
      );
    }
  });

  it('an abrupt jump of every input in one update', () => {
    const core = new AudioCore({ sampleRate: FS });
    const clip = render(core, 1.2, (t) =>
      t < T
        ? idle
        : engineState(12_500, 1, {
            boost: 1,
            ersPower: 120_000,
            speed: 90,
            slipFront: 0.25,
            slipRear: 0.25,
            kerb: 1,
            kerbFrequency: 40,
          }),
    );
    expectNoClick('jump up', clip);
    const down = render(new AudioCore({ sampleRate: FS }), 1.4, (t) =>
      t < T
        ? engineState(12_500, 1, {
            boost: 1,
            ersPower: 120_000,
            speed: 90,
            slipFront: 0.25,
            kerb: 1,
            kerbFrequency: 40,
          })
        : idle,
    );
    expectNoClick('jump down', down);
  });

  it('volume changes', () => {
    const core = new AudioCore({ sampleRate: FS });
    let switched = false;
    const clip = render(core, 1.2, (t) => {
      if (t >= T && !switched) {
        core.setGain('master', 0.1);
        core.setGain('engine', 2);
        switched = true;
      }
      return cruise;
    });
    expectNoClick('gain change', clip);
  });

  it('the rev and pit limiters stay inside the steady-state step size', () => {
    for (const extra of [{ revLimiter: true }, { pitLimiter: true }]) {
      const core = new AudioCore({ sampleRate: FS });
      const clip = render(core, 1.2, (t) =>
        engineState(t < T ? 12_300 : 12_500, 1, t < T ? {} : extra),
      );
      const s = steps(clip);
      expect(s.during).toBeLessThanOrEqual(RATIO * Math.max(s.before, s.after));
    }
  });
});

describe('DC', () => {
  it('stays near zero in every kind of state', () => {
    for (const state of [
      engineState(4500, 0.08),
      engineState(11_000, 1, { boost: 1, ersPower: 120_000 }),
      engineState(12_500, 1, { revLimiter: true }),
      engineState(7400, 0.85, { pitLimiter: true }),
      engineState(0, 0, { engineOn: false, speed: 30, kerb: 1, kerbFrequency: 30, bottoming: 0.5 }),
    ]) {
      const clip = render(new AudioCore({ sampleRate: FS }), 2, () => state);
      expect(Math.abs(dcOffset(clip.left.subarray(FS / 2)))).toBeLessThan(1e-3);
    }
  });
});

describe('cost', () => {
  it('does not allocate in steady state', () => {
    // Expose the collector so the heap can be measured from a clean start.
    v8.setFlagsFromString('--expose-gc');
    const gc = runInNewContext('gc') as () => void;
    const core = new AudioCore({ sampleRate: FS });
    const state = everything(0);
    const out = [new Float32Array(128), new Float32Array(128)];
    // Warm up so every function is optimised and every lazily created buffer exists.
    for (let i = 0; i < 4000; i++) {
      if (i % 3 === 0) core.setCarState(state);
      core.process(out, 128);
    }
    const blocks = 15_000; // 40 s of audio
    gc();
    const before = process.memoryUsage().heapUsed;
    for (let i = 0; i < blocks; i++) {
      if (i % 3 === 0) {
        state.shifting = i % 300 < 12;
        core.setCarState(state);
      }
      core.process(out, 128);
    }
    const grown = process.memoryUsage().heapUsed - before;
    // Allocating even 16 bytes per block would grow the heap by 240 kB, or set off a
    // collection that would show up as a large negative change.
    expect(Math.abs(grown)).toBeLessThan(64 * 1024);
  });

  it('renders one car much faster than real time', () => {
    const core = new AudioCore({ sampleRate: FS });
    const out = [new Float32Array(128), new Float32Array(128)];
    const state = engineState(11_000, 1, {
      boost: 1,
      ersPower: 120_000,
      speed: 80,
      slipRear: 0.05,
    });
    for (let i = 0; i < 2000; i++) {
      core.setCarState(state);
      core.process(out, 128);
    }
    const blocks = 7500; // 20 s
    const t0 = performance.now();
    for (let i = 0; i < blocks; i++) {
      if (i % 3 === 0) core.setCarState(state);
      core.process(out, 128);
    }
    const seconds = (performance.now() - t0) / 1000;
    const ratio = (blocks * 128) / FS / seconds;
    process.stderr.write(`audio core: ${ratio.toFixed(1)}x real time (one car, 48 kHz stereo)\n`);
    expect(ratio).toBeGreaterThan(10);
  });
});
