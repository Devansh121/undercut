import { onePoleCoefficient } from './biquad';
import { CHUNK } from './controls';

/**
 * Where the listener is relative to the player's car. Each camera hears a different balance:
 * the airbox sits above the driver's head and the exhaust exits behind the gearbox, so the
 * cockpit and the T-cam hear intake, turbo and gears, the chase camera hears the exhaust, and a
 * trackside microphone hears the exhaust from a distance with the highs absorbed by the air.
 */
export type AudioView = 'cockpit' | 'tcam' | 'chase' | 'trackside';

export const AUDIO_VIEWS: readonly AudioView[] = ['cockpit', 'tcam', 'chase', 'trackside'];

/** Sound groups the view balances. */
export const G = {
  /** Exhaust pulse train, pops, burble and the upshift crack. */
  exhaust: 0,
  /** Airbox resonance. */
  intake: 1,
  /** Combustion noise, gear whine and gearbox clack: heard through the tub. */
  mechanical: 2,
  /** Turbo and MGU-K whine. */
  whine: 3,
  /** Tyres, surfaces, kerbs, plank, impacts. */
  road: 4,
  /** Wind and the DRS flap. */
  wind: 5,
} as const;
export const VIEW_GROUPS = 6;

/**
 * One view's balance: a linear gain per group (`G` order) and the cut-off of the low-pass the
 * exhaust passes through on its way to the listener (helmet and bodywork in the cockpit, air
 * absorption at a distance).
 */
export interface ViewBalance {
  gains: readonly [number, number, number, number, number, number];
  /** Exhaust low-pass cut-off, Hz. */
  exhaustCutoff: number;
}

/**
 * Design values. No measured balance between onboard and external microphones is published;
 * these follow what broadcast onboard and trackside footage makes plain (intake and turbo up
 * front, exhaust behind, distance dulling the top end) and keep every view inside the loudness
 * window. Listening queue item: whether the cockpit is too dull.
 */
export const VIEW_BALANCE: Readonly<Record<AudioView, ViewBalance>> = {
  cockpit: { gains: [0.6, 1.5, 1.3, 1.4, 1.0, 1.3], exhaustCutoff: 3200 },
  tcam: { gains: [0.75, 1.6, 0.9, 1.2, 0.8, 0.9], exhaustCutoff: 6000 },
  chase: { gains: [1.0, 0.6, 0.6, 0.8, 0.75, 0.6], exhaustCutoff: 14_000 },
  trackside: { gains: [0.8, 0.3, 0.3, 0.45, 0.5, 0.25], exhaustCutoff: 4500 },
};

/** Time constant of a view change, s: long enough not to click, short enough to follow a cut. */
const VIEW_GLIDE = 0.08;

/**
 * The current balance, gliding towards the selected view. It moves once per control chunk of
 * the core's clock; inside a chunk each group's gain ramps linearly, so a view change never
 * steps. `first[g]` and `step[g]` describe the part of the chunk being rendered, and depend
 * only on the sample clock, not on how the host splits its blocks.
 */
export class ViewMix {
  /** Gain of each group at the first sample of the part being rendered. */
  readonly first = new Float64Array(VIEW_GROUPS);
  /** Per-sample increment of each group's gain. */
  readonly step = new Float64Array(VIEW_GROUPS);
  /** Exhaust low-pass cut-off for this chunk, Hz. */
  exhaustCutoff = 14_000;
  private readonly start = new Float64Array(VIEW_GROUPS);
  private readonly target = new Float64Array(VIEW_GROUPS);
  private readonly value = new Float64Array(VIEW_GROUPS);
  private cutoffTarget = 14_000;
  private offset = 0;
  private readonly k: number;
  private current: AudioView = 'chase';

  constructor(sampleRate: number, view: AudioView = 'chase') {
    this.k = onePoleCoefficient(VIEW_GLIDE, sampleRate / CHUNK);
    this.set(view);
    this.value.set(this.target);
    this.start.set(this.target);
    this.first.set(this.target);
    this.exhaustCutoff = this.cutoffTarget;
  }

  get view(): AudioView {
    return this.current;
  }

  set(view: AudioView): void {
    const b = VIEW_BALANCE[view];
    if (!b) return;
    this.current = view;
    for (let g = 0; g < VIEW_GROUPS; g++) this.target[g] = b.gains[g] as number;
    this.cutoffTarget = b.exhaustCutoff;
  }

  /** Before rendering `n` frames: a new chunk starts when `aligned`. */
  begin(aligned: boolean): void {
    if (aligned) {
      const k = this.k;
      for (let g = 0; g < VIEW_GROUPS; g++) {
        const v0 = this.value[g] as number;
        const v1 = v0 + ((this.target[g] as number) - v0) * k;
        this.start[g] = v0;
        this.step[g] = (v1 - v0) / CHUNK;
        this.value[g] = v1;
      }
      // Geometric glide: an octave takes the same time anywhere in the range.
      this.exhaustCutoff *= Math.pow(this.cutoffTarget / this.exhaustCutoff, k);
      this.offset = 0;
    }
    for (let g = 0; g < VIEW_GROUPS; g++)
      this.first[g] = (this.start[g] as number) + (this.step[g] as number) * this.offset;
  }

  /** After rendering `n` frames. */
  end(n: number): void {
    this.offset += n;
  }
}
