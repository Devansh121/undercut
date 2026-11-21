import { Biquad, BiquadKind } from './biquad';
import { CHUNK } from './controls';

/**
 * Most triggers one burst can receive in one control chunk: at most one per cylinder event,
 * and six cylinders can at most all fire on every sample of a chunk. Never reached in
 * practice; it bounds a preallocated queue so no trigger is ever dropped or overwritten.
 */
const MAX_TRIGGERS = 6 * CHUNK;

/**
 * One short noise burst through a resonator: an overrun pop or a gearbox clack.
 * Triggers name the sample of the current chunk they start on and are queued; the burst
 * renders sample-accurately from one trigger to the next, so the result does not depend on
 * how blocks are split, however many triggers land in one chunk.
 */
export class Burst {
  private pos = 0;
  private length = 0;
  private ring = 0;
  private amplitude = 0;
  private active = false;
  private queued = 0;
  private readonly qAt = new Int32Array(MAX_TRIGGERS);
  private readonly qLength = new Int32Array(MAX_TRIGGERS);
  private readonly qRing = new Int32Array(MAX_TRIGGERS);
  private readonly qAmplitude = new Int32Array(MAX_TRIGGERS);
  private readonly qFrequency = new Int32Array(MAX_TRIGGERS);
  private readonly qQ = new Int32Array(MAX_TRIGGERS);
  private readonly filter: Biquad;
  private readonly scratch = new Float64Array(CHUNK);

  constructor(sampleRate: number) {
    this.filter = new Biquad(sampleRate);
    this.filter.kind = BiquadKind.Bandpass;
  }

  /** Whether the burst is sounding at sample `offset` of the chunk being rendered. */
  activeAt(offset: number): boolean {
    // The latest trigger at or before `offset` decides, if there is one.
    for (let k = this.queued - 1; k >= 0; k--) {
      const at = this.qAt[k] as number;
      if (at <= offset) {
        return offset - at < (this.qLength[k] as number) + (this.qRing[k] as number);
      }
    }
    return this.active && this.pos + offset < this.length + this.ring;
  }

  /**
   * Start a burst at sample `offset` of the chunk being rendered (offsets arrive in order).
   * Every argument is an integer (frames, thousandths, hertz, tenths), so the call never has
   * to box a fractional number on the audio thread.
   */
  trigger(
    offset: number,
    lengthFrames: number,
    ringFrames: number,
    amplitudeMilli: number,
    frequencyHz: number,
    qTenths: number,
  ): void {
    const k = this.queued;
    if (k >= MAX_TRIGGERS) return;
    this.qAt[k] = offset;
    this.qLength[k] = lengthFrames < 2 ? 2 : lengthFrames;
    this.qRing[k] = ringFrames;
    this.qAmplitude[k] = amplitudeMilli;
    this.qFrequency[k] = frequencyHz;
    this.qQ[k] = qTenths;
    this.queued = k + 1;
  }

  /** Add the next `n` samples into `out`, excited by `noise`; add their energy to `meter[slot]`. */
  renderAdd(
    noise: Float64Array,
    out: Float64Array,
    n: number,
    meter: Float64Array,
    slot: number,
  ): void {
    if (!this.active && this.queued === 0) return;
    const x = this.scratch;
    let cursor = 0;
    for (let k = 0; k < this.queued; k++) {
      const at = this.qAt[k] as number;
      this.renderSegment(noise, x, cursor, at);
      // Start the queued burst at its sample: from rest if the previous one had ended.
      if (!this.active) this.filter.reset();
      this.filter.frequency = this.qFrequency[k] as number;
      this.filter.q = (this.qQ[k] as number) / 10;
      this.filter.design();
      this.length = this.qLength[k] as number;
      this.ring = this.qRing[k] as number;
      this.amplitude = (this.qAmplitude[k] as number) / 1000;
      this.pos = 0;
      this.active = true;
      cursor = at;
    }
    this.queued = 0;
    this.renderSegment(noise, x, cursor, n);
    let energy = 0;
    for (let i = 0; i < n; i++) {
      const v = x[i] as number;
      out[i] = (out[i] as number) + v;
      energy += v * v;
    }
    meter[slot] = (meter[slot] as number) + energy;
  }

  /** Render the current burst into `x` over [from, to); zeros once it has ended. */
  private renderSegment(noise: Float64Array, x: Float64Array, from: number, to: number): void {
    let end = from;
    if (this.active) {
      const left = this.length + this.ring - this.pos;
      end = from + left < to ? from + left : to;
      const len = this.length;
      const amplitude = this.amplitude;
      let pos = this.pos;
      for (let i = from; i < end; i++, pos++) {
        if (pos < len) {
          const s = Math.sin((Math.PI * pos) / len);
          x[i] = (noise[i] as number) * s * s * amplitude;
        } else {
          x[i] = 0;
        }
      }
      this.filter.processRange(x, x, from, end);
      this.pos = pos;
      if (pos >= this.length + this.ring) this.active = false;
    }
    for (let i = end; i < to; i++) x[i] = 0;
  }
}
