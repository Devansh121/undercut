import { createRng } from '@undercut/core';
import { SceneSound, type AudioScene, type AudioCue } from './scene';
import { Biquad, onePoleCoefficient } from './biquad';
import { CarControls, CHUNK } from './controls';
import { Ducker } from './ducking';
import { EngineVoice } from './engine-voice';
import { DEFAULT_LIMITER, SoftLimiter, type LimiterOptions } from './limiter';
import { LayerMeters } from './meters';
import { RoadVoice } from './road-voice';
import { DEFAULT_POWER_UNIT, type PowerUnitSoundSpec } from './spec';
import type { AudioCarState } from './state';
import { ViewMix, type AudioView } from './view';
import type { BusId, GainId } from './voice';

/**
 * Lowest supported sample rate. The tonal sources (pulse train up to 15 000 rpm, turbo
 * whine, MGU-K whine) are designed to stay under 0.45 of the rate from here up; browsers
 * run at 44.1 or 48 kHz.
 */
export const MIN_SAMPLE_RATE = 22_050;
export const MAX_SAMPLE_RATE = 384_000;

export interface AudioCoreOptions {
  sampleRate: number;
  /** Seed for every noise source. Same seed and inputs give the same samples. */
  seed?: number;
  powerUnit?: PowerUnitSoundSpec;
  limiter?: LimiterOptions;
  /** Starting listener view (default chase). */
  view?: AudioView;
}

/**
 * One car: its control signals, its voices and where it sits in the stereo image. Every car
 * has the same voice slots, so each render call site always sees one class and the
 * JavaScript engine can keep it optimised (a mixed list of voices made it deoptimise in a
 * loop, allocating on every block).
 */
interface CarSource {
  readonly controls: CarControls;
  readonly engine: EngineVoice;
  readonly road: RoadVoice;
  /** Where the listener is relative to this car. */
  readonly view: ViewMix;
  /** Linear gains into the left and right bus channels. The player's car is centred. */
  panLeft: number;
  panRight: number;
}

const BUSES: readonly BusId[] = ['engine', 'effects', 'ui', 'ambience'];
const GAINS: readonly GainId[] = ['master', 'engine', 'effects', 'ui', 'ambience'];
/** Default gains: full scale; the player turns them down in settings. */
const DEFAULT_GAIN = 1;

/**
 * The deterministic audio core. Pure TypeScript with no DOM or Web Audio types, so the same
 * code runs in the AudioWorklet and in Node. All buffers are allocated up front;
 * `process` allocates nothing.
 *
 * Signal flow: car voices (balanced by the listener's view) → buses (engine, effects, ui,
 * ambience) → ducking (`DUCKING`) and bus gains → master gain and pause fade → DC blocker →
 * look-ahead true-peak limiter and soft clipper → output.
 */
export class AudioCore {
  readonly sampleRate: number;
  readonly scene: SceneSound;
  readonly meters = new LayerMeters();
  readonly limiter: SoftLimiter;
  readonly ducker: Ducker;

  private readonly player: CarSource;
  private readonly sources: CarSource[];
  private readonly scratch = new Float64Array(CHUNK);
  private readonly busLeft: Float64Array[];
  private readonly busRight: Float64Array[];
  private readonly mixLeft = new Float64Array(CHUNK);
  private readonly mixRight = new Float64Array(CHUNK);
  private readonly gainTarget = new Float64Array(GAINS.length).fill(DEFAULT_GAIN);
  private readonly gainValue = new Float64Array(GAINS.length).fill(DEFAULT_GAIN);
  private readonly dcLeft: Biquad;
  private readonly dcRight: Biquad;
  private readonly kGain: number;
  private readonly kPause: number;
  private clock = 0;
  private pauseTarget = 1;
  private pauseEnv = 0;
  private frozen = false;

  constructor(options: AudioCoreOptions) {
    const { sampleRate } = options;
    if (!(sampleRate >= MIN_SAMPLE_RATE && sampleRate <= MAX_SAMPLE_RATE)) {
      throw new RangeError(
        `sampleRate ${sampleRate} is outside ${MIN_SAMPLE_RATE}–${MAX_SAMPLE_RATE} Hz`,
      );
    }
    this.sampleRate = sampleRate;
    this.scene = new SceneSound(sampleRate, options.seed ?? 1);
    const rng = createRng(options.seed ?? 1);
    const seeds = () => rng.nextUint32();
    const controls = new CarControls(sampleRate);
    this.player = {
      controls,
      engine: new EngineVoice(sampleRate, options.powerUnit ?? DEFAULT_POWER_UNIT, seeds),
      road: new RoadVoice(sampleRate, seeds),
      view: new ViewMix(sampleRate, options.view ?? 'chase'),
      panLeft: 1,
      panRight: 1,
    };
    this.sources = [this.player];
    this.busLeft = BUSES.map(() => new Float64Array(CHUNK));
    this.busRight = BUSES.map(() => new Float64Array(CHUNK));
    this.dcLeft = new Biquad(sampleRate).highpass(12, 0.7071);
    this.dcRight = new Biquad(sampleRate).highpass(12, 0.7071);
    this.limiter = new SoftLimiter(sampleRate, options.limiter ?? DEFAULT_LIMITER);
    this.ducker = new Ducker(sampleRate);
    this.kGain = onePoleCoefficient(0.03, sampleRate);
    this.kPause = onePoleCoefficient(0.008, sampleRate);
  }

  /** Other cars, ambience and start lights (struct or packed). Cheap; call per frame. */
  setScene(scene: Readonly<AudioScene> | ArrayLike<number>): void {
    this.scene.set(scene);
  }

  /** Play a menu or start-light cue on the UI bus. */
  cue(cue: AudioCue): void {
    this.scene.cue(cue);
  }

  /** Latest state of the player's car (struct or packed form). Cheap; call per sim step. */
  setCarState(state: AudioCarState | ArrayLike<number>): void {
    this.player.controls.set(state);
  }

  /** Where the listener is: the camera's balance of intake, exhaust, mechanics and road. */
  setView(view: AudioView): void {
    this.player.view.set(view);
  }

  /** The current listener view. */
  get view(): AudioView {
    return this.player.view.view;
  }

  /** Set a gain, 0–1 (values up to 2 are allowed). Changes are smoothed over about 30 ms. */
  setGain(id: GainId, value: number): void {
    const index = GAINS.indexOf(id);
    if (index < 0) return;
    this.gainTarget[index] = Number.isFinite(value) ? Math.max(0, Math.min(2, value)) : 0;
  }

  /** Fade everything out (about 10 ms) and stop computing, or fade back in. */
  setPaused(paused: boolean): void {
    this.pauseTarget = paused ? 0 : 1;
  }

  /** True once a pause has fully faded and the core is outputting exact zeros. */
  get silent(): boolean {
    return this.frozen;
  }

  /** Frames rendered so far. */
  get framesRendered(): number {
    return this.clock;
  }

  /**
   * Render `frames` samples into each channel of `output`, overwriting it. One channel gets
   * the mono mix, two get stereo, further channels are zeroed. Any block size works; the
   * result depends only on the sample clock, not on how the frames are split into calls.
   */
  process(output: Float32Array[], frames: number): void {
    let done = 0;
    while (done < frames) {
      const offset = this.clock % CHUNK;
      const n = Math.min(frames - done, CHUNK - offset);
      this.renderChunk(n, offset === 0);
      const left = this.mixLeft;
      const right = this.mixRight;
      const channels = output.length;
      if (channels === 1) {
        const out = output[0] as Float32Array;
        for (let i = 0; i < n; i++)
          out[done + i] = 0.5 * ((left[i] as number) + (right[i] as number));
      } else if (channels >= 2) {
        const outL = output[0] as Float32Array;
        const outR = output[1] as Float32Array;
        for (let i = 0; i < n; i++) {
          outL[done + i] = left[i] as number;
          outR[done + i] = right[i] as number;
        }
        for (let c = 2; c < channels; c++) (output[c] as Float32Array).fill(0, done, done + n);
      }
      done += n;
      this.clock += n;
    }
  }

  /** Add the scratch buffer into a bus with the source's pan gains. */
  private mixInto(bus: number, source: CarSource, n: number): void {
    const bl = this.busLeft[bus] as Float64Array;
    const br = this.busRight[bus] as Float64Array;
    const x = this.scratch;
    const pl = source.panLeft;
    const pr = source.panRight;
    for (let i = 0; i < n; i++) {
      const v = x[i] as number;
      bl[i] = (bl[i] as number) + v * pl;
      br[i] = (br[i] as number) + v * pr;
    }
  }

  private renderChunk(n: number, aligned: boolean): void {
    if (aligned) this.frozen = this.pauseTarget === 0 && this.pauseEnv === 0;
    if (this.frozen) {
      this.mixLeft.fill(0, 0, n);
      this.mixRight.fill(0, 0, n);
      return;
    }

    for (let b = 0; b < BUSES.length; b++) {
      (this.busLeft[b] as Float64Array).fill(0, 0, n);
      (this.busRight[b] as Float64Array).fill(0, 0, n);
    }
    for (let s = 0; s < this.sources.length; s++) {
      const source = this.sources[s] as CarSource;
      source.controls.advance(n);
      source.view.begin(aligned);
      source.engine.render(source.controls, this.scratch, n, this.meters, aligned, source.view);
      this.mixInto(0, source, n);
      source.road.render(source.controls, this.scratch, n, this.meters, aligned, source.view);
      this.mixInto(1, source, n);
      source.view.end(n);
    }
    this.scene.render(
      this.busLeft[0]!,
      this.busRight[0]!,
      this.busLeft[3]!,
      this.busRight[3]!,
      this.busLeft[2]!,
      this.busRight[2]!,
      n,
    );
    this.meters.frames += n;
    const duck = this.ducker;
    duck.impact = this.player.road.impacts.envelope;
    duck.process(this.busLeft[2] as Float64Array, this.busRight[2] as Float64Array, n);
    const dEng = duck.engine;
    const dFx = duck.effects;
    const dAmb = duck.ambience;

    // Gains and the pause fade, smoothed per sample. Once a smoother has settled (its next
    // value equals its current one) it stays there, so a chunk where all have settled skips
    // the updates; the arithmetic is the same either way.
    const g = this.gainValue;
    const t = this.gainTarget;
    const k = this.kGain;
    const kp = this.kPause;
    const pauseTarget = this.pauseTarget;
    let gm = g[0] as number;
    let ge0 = g[1] as number;
    let gf0 = g[2] as number;
    let gu = g[3] as number;
    let ga0 = g[4] as number;
    const tm = t[0] as number;
    const te = t[1] as number;
    const tf = t[2] as number;
    const tu = t[3] as number;
    const ta = t[4] as number;
    let pauseEnv = this.pauseEnv;
    let next = pauseEnv + (pauseTarget - pauseEnv) * kp;
    if (pauseTarget === 0 && next < 1e-4) next = 0;
    const moving =
      gm + (tm - gm) * k !== gm ||
      ge0 + (te - ge0) * k !== ge0 ||
      gf0 + (tf - gf0) * k !== gf0 ||
      gu + (tu - gu) * k !== gu ||
      ga0 + (ta - ga0) * k !== ga0 ||
      next !== pauseEnv;
    const engL = this.busLeft[0] as Float64Array;
    const engR = this.busRight[0] as Float64Array;
    const fxL = this.busLeft[1] as Float64Array;
    const fxR = this.busRight[1] as Float64Array;
    const uiL = this.busLeft[2] as Float64Array;
    const uiR = this.busRight[2] as Float64Array;
    const ambL = this.busLeft[3] as Float64Array;
    const ambR = this.busRight[3] as Float64Array;
    const mixL = this.mixLeft;
    const mixR = this.mixRight;
    for (let i = 0; i < n; i++) {
      if (moving) {
        gm = gm + (tm - gm) * k;
        ge0 = ge0 + (te - ge0) * k;
        gf0 = gf0 + (tf - gf0) * k;
        gu = gu + (tu - gu) * k;
        ga0 = ga0 + (ta - ga0) * k;
        let pause = pauseEnv + (pauseTarget - pauseEnv) * kp;
        if (pauseTarget === 0 && pause < 1e-4) pause = 0;
        pauseEnv = pause;
      }
      const master = gm * pauseEnv;
      const ge = ge0 * (dEng[i] as number);
      const gf = gf0 * (dFx[i] as number);
      const ga = ga0 * (dAmb[i] as number);
      const l =
        ((engL[i] as number) * ge +
          (fxL[i] as number) * gf +
          (uiL[i] as number) * gu +
          (ambL[i] as number) * ga) *
        master;
      const r =
        ((engR[i] as number) * ge +
          (fxR[i] as number) * gf +
          (uiR[i] as number) * gu +
          (ambR[i] as number) * ga) *
        master;
      // Last line of defence for the DC blocker and limiter state: never pass on NaN or ±Inf.
      mixL[i] = l - l === 0 ? l : 0;
      mixR[i] = r - r === 0 ? r : 0;
    }
    g[0] = gm;
    g[1] = ge0;
    g[2] = gf0;
    g[3] = gu;
    g[4] = ga0;
    this.pauseEnv = pauseEnv;
    this.dcLeft.processBlock(mixL, mixL, n);
    this.dcRight.processBlock(mixR, mixR, n);
    this.limiter.process(this.mixLeft, this.mixRight, n);
  }
}
