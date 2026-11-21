import { createRng } from '@undercut/core';
import { Biquad, onePoleCoefficient } from './biquad';
import { CarControls, CHUNK } from './controls';
import { EngineVoice } from './engine-voice';
import { DEFAULT_LIMITER, SoftLimiter, type LimiterOptions } from './limiter';
import { LayerMeters } from './meters';
import { RoadVoice } from './road-voice';
import { DEFAULT_POWER_UNIT, type PowerUnitSoundSpec } from './spec';
import type { AudioCarState } from './state';
import type { BusId, GainId } from './voice';

export interface AudioCoreOptions {
  sampleRate: number;
  /** Seed for every noise source. Same seed and inputs give the same samples. */
  seed?: number;
  powerUnit?: PowerUnitSoundSpec;
  limiter?: LimiterOptions;
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
  /** Linear gains into the left and right bus channels. The player's car is centred. */
  panLeft: number;
  panRight: number;
}

const BUSES: readonly BusId[] = ['engine', 'effects', 'ui'];
const GAINS: readonly GainId[] = ['master', 'engine', 'effects', 'ui'];
/** Default gains: full scale; the player turns them down in settings. */
const DEFAULT_GAIN = 1;

/**
 * The deterministic audio core. Pure TypeScript with no DOM or Web Audio types, so the same
 * code runs in the AudioWorklet and in Node. All buffers are allocated up front;
 * `process` allocates nothing.
 *
 * Signal flow: car voices → buses (engine, effects, ui) → bus gains → master gain and
 * pause fade → DC blocker → look-ahead limiter and soft clipper → output.
 */
export class AudioCore {
  readonly sampleRate: number;
  readonly meters = new LayerMeters();
  readonly limiter: SoftLimiter;

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
    if (!(sampleRate >= 8000 && sampleRate <= 384000)) {
      throw new RangeError(`sampleRate ${sampleRate} is outside 8–384 kHz`);
    }
    this.sampleRate = sampleRate;
    const rng = createRng(options.seed ?? 1);
    const seeds = () => rng.nextUint32();
    const controls = new CarControls(sampleRate);
    this.player = {
      controls,
      engine: new EngineVoice(sampleRate, options.powerUnit ?? DEFAULT_POWER_UNIT, seeds),
      road: new RoadVoice(sampleRate, seeds),
      panLeft: 1,
      panRight: 1,
    };
    this.sources = [this.player];
    this.busLeft = BUSES.map(() => new Float64Array(CHUNK));
    this.busRight = BUSES.map(() => new Float64Array(CHUNK));
    this.dcLeft = new Biquad(sampleRate).highpass(12, 0.7071);
    this.dcRight = new Biquad(sampleRate).highpass(12, 0.7071);
    this.limiter = new SoftLimiter(sampleRate, options.limiter ?? DEFAULT_LIMITER);
    this.kGain = onePoleCoefficient(0.03, sampleRate);
    this.kPause = onePoleCoefficient(0.008, sampleRate);
  }

  /** Latest state of the player's car (struct or packed form). Cheap; call per sim step. */
  setCarState(state: AudioCarState | ArrayLike<number>): void {
    this.player.controls.set(state);
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
      source.engine.render(source.controls, this.scratch, n, this.meters, aligned);
      this.mixInto(0, source, n);
      source.road.render(source.controls, this.scratch, n, this.meters, aligned);
      this.mixInto(1, source, n);
    }
    this.meters.frames += n;

    const g = this.gainValue;
    const t = this.gainTarget;
    const k = this.kGain;
    const engL = this.busLeft[0] as Float64Array;
    const engR = this.busRight[0] as Float64Array;
    const fxL = this.busLeft[1] as Float64Array;
    const fxR = this.busRight[1] as Float64Array;
    const uiL = this.busLeft[2] as Float64Array;
    const uiR = this.busRight[2] as Float64Array;
    const mixL = this.mixLeft;
    const mixR = this.mixRight;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < 4; j++)
        g[j] = (g[j] as number) + ((t[j] as number) - (g[j] as number)) * k;
      let pause = this.pauseEnv + (this.pauseTarget - this.pauseEnv) * this.kPause;
      if (this.pauseTarget === 0 && pause < 1e-4) pause = 0;
      this.pauseEnv = pause;
      const master = (g[0] as number) * pause;
      const ge = g[1] as number;
      const gf = g[2] as number;
      const gu = g[3] as number;
      const l =
        ((engL[i] as number) * ge + (fxL[i] as number) * gf + (uiL[i] as number) * gu) * master;
      const r =
        ((engR[i] as number) * ge + (fxR[i] as number) * gf + (uiR[i] as number) * gu) * master;
      // Last line of defence for the DC blocker and limiter state: never pass on NaN or ±Inf.
      mixL[i] = l - l === 0 ? l : 0;
      mixR[i] = r - r === 0 ? r : 0;
    }
    this.dcLeft.processBlock(mixL, mixL, n);
    this.dcRight.processBlock(mixR, mixR, n);
    this.limiter.process(this.mixLeft, this.mixRight, n);
  }
}
