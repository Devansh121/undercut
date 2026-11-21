import { onePoleCoefficient } from './biquad';
import { CHUNK } from './controls';

/**
 * Ducking rules: which bus turns down while another speaks. Depths are the most each bus is
 * turned down, dB; the side-chain sets how much of that applies.
 *
 * 1. A UI cue (anything on the UI bus) ducks ambience by up to 8 dB and the engine and effects
 *    by up to 3 dB, so menu, pit and penalty sounds read over the car. Full depth once the UI
 *    bus envelope reaches `UI_FULL` (about −20 dBFS).
 * 2. An impact ducks ambience by up to 6 dB for its duration: the crash should not compete
 *    with the crowd.
 * 3. The engine and the road never duck each other: they are the game, and the loudness
 *    checks already balance them.
 *
 * Envelopes rise over `ATTACK` and fall over `RELEASE`; gains move per sample, so ducking
 * never steps. Design values from common game-mix practice, not from a standard.
 */
export const DUCKING = {
  uiDuck: { ambience: -8, engine: -3, effects: -3 },
  impactDuck: { ambience: -6 },
  /** UI bus envelope (peak, linear) at which UI ducking is full. */
  UI_FULL: 0.1,
  /** Impact envelope (`ImpactVoice.envelope`) at which impact ducking is full. */
  IMPACT_FULL: 0.5,
  ATTACK: 0.01,
  RELEASE: 0.3,
} as const;

const fromDb = (db: number) => Math.pow(10, db / 20);

/**
 * Side-chain gains for one chunk: `engine`, `effects` and `ambience` hold the per-sample gain
 * for that bus. Set `impact` (a field, so no number is boxed) before `process`.
 */
export class Ducker {
  readonly engine = new Float64Array(CHUNK).fill(1);
  readonly effects = new Float64Array(CHUNK).fill(1);
  readonly ambience = new Float64Array(CHUNK).fill(1);
  /** Impact envelope for this chunk (`ImpactVoice.envelope`). */
  impact = 0;
  private uiEnv = 0;
  private impactEnv = 0;
  private readonly kAttack: number;
  private readonly kRelease: number;
  private readonly uiAmb = 1 - fromDb(DUCKING.uiDuck.ambience);
  private readonly uiEng = 1 - fromDb(DUCKING.uiDuck.engine);
  private readonly uiFx = 1 - fromDb(DUCKING.uiDuck.effects);
  private readonly impAmb = 1 - fromDb(DUCKING.impactDuck.ambience);

  constructor(sampleRate: number) {
    this.kAttack = onePoleCoefficient(DUCKING.ATTACK, sampleRate);
    this.kRelease = onePoleCoefficient(DUCKING.RELEASE, sampleRate);
  }

  /** Fill the gain arrays for `n` frames from the UI bus channels. */
  process(uiLeft: Float64Array, uiRight: Float64Array, n: number): void {
    const ka = this.kAttack;
    const kr = this.kRelease;
    const invUi = 1 / DUCKING.UI_FULL;
    let imp = this.impact * (1 / DUCKING.IMPACT_FULL);
    imp = imp > 1 ? 1 : imp < 0 ? 0 : imp;
    for (let i = 0; i < n; i++) {
      const l = uiLeft[i] as number;
      const r = uiRight[i] as number;
      let x = (l < 0 ? -l : l) > (r < 0 ? -r : r) ? (l < 0 ? -l : l) : r < 0 ? -r : r;
      x = x * invUi;
      x = x > 1 ? 1 : x;
      this.uiEnv += (x - this.uiEnv) * (x > this.uiEnv ? ka : kr);
      this.impactEnv += (imp - this.impactEnv) * (imp > this.impactEnv ? ka : kr);
      if (this.uiEnv < 1e-9) this.uiEnv = 0;
      if (this.impactEnv < 1e-9) this.impactEnv = 0;
      const u = this.uiEnv;
      const a = (1 - this.uiAmb * u) * (1 - this.impAmb * this.impactEnv);
      this.ambience[i] = a;
      this.engine[i] = 1 - this.uiEng * u;
      this.effects[i] = 1 - this.uiFx * u;
    }
  }
}
