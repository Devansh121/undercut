import { Biquad } from './biquad';
import { CHUNK } from './controls';
import { Noise } from './noise';

const TWO_PI = 2 * Math.PI;

/** Below this normal speed (m/s) a contact is a touch, not an impact: no sound. */
export const IMPACT_MIN_SPEED = 0.3;
/** Normal speed that gives full strength, m/s (about 43 km/h square into a barrier). */
export const IMPACT_FULL_SPEED = 12;

/**
 * Impacts: the car hitting a barrier or another car, from the contact telemetry.
 *
 * Each impact has a strength `a = min(1.5, (v / IMPACT_FULL_SPEED)^0.75)` from the normal
 * speed `v` and three parts, all starting from zero so the onset is steep but never a step:
 *
 * - **Thud:** the tub and the barrier's mass, a sine at 70 Hz (55 Hz at full strength)
 *   decaying over 60–120 ms.
 * - **Crunch:** noise through a broad 380 Hz resonance, 1.5 ms rise, 30–110 ms decay: foam,
 *   tyre wall and bodywork giving.
 * - **Crack:** noise through 3.4 kHz, 0.5 ms rise, 12 ms decay: carbon breaking.
 *
 * Design values; the shape (fast attack, decay lengthening with energy, low body plus a
 * broadband top) is the usual one for collision sounds. A new impact during the decay of the
 * last rises from where the envelopes are, so overlaps do not step either.
 */
export class ImpactVoice {
  /** Overall level, linear. */
  static readonly LEVEL = 0.5;

  /** Envelope of the impact sounding now, 0–1.5 (the ducker reads it). */
  envelope = 0;
  private serial = 0;
  private hasSerial = false;
  /** Normal speed of the impact being started (a field: see `start`). */
  private pendingSpeed = 0;
  private thudPhase = 0;
  private thudFrequency = 70;
  private thudEnv = 0;
  private thudPeak = 0;
  private crunchEnv = 0;
  private crunchPeak = 0;
  private crackEnv = 0;
  private crackPeak = 0;
  private thudDecay = 0;
  private crunchDecay = 0;
  private readonly crackDecay: number;
  private readonly kThudAttack: number;
  private readonly kCrunchAttack: number;
  private readonly kCrackAttack: number;
  private live = false;
  private readonly dt: number;
  private readonly crunch: Biquad;
  private readonly crack: Biquad;
  private readonly noise: Noise;
  private readonly nBuf = new Float64Array(CHUNK);
  private readonly aBuf = new Float64Array(CHUNK);
  private readonly bBuf = new Float64Array(CHUNK);
  private readonly cBuf = new Float64Array(CHUNK);

  constructor(
    private readonly sampleRate: number,
    seed: number,
  ) {
    this.dt = 1 / sampleRate;
    this.crunch = new Biquad(sampleRate).bandpass(380, 0.8);
    this.crack = new Biquad(sampleRate).bandpass(3400, 1.2);
    this.noise = new Noise(seed);
    this.crackDecay = Math.exp(-1 / (0.012 * sampleRate));
    this.kThudAttack = 1 - Math.exp(-1 / (0.002 * sampleRate));
    this.kCrunchAttack = 1 - Math.exp(-1 / (0.0015 * sampleRate));
    this.kCrackAttack = 1 - Math.exp(-1 / (0.0005 * sampleRate));
  }

  /**
   * Write `n` samples into `out` (zeros when silent). `speed` and `serial` are the control
   * buffers of `impactSpeed` and `impactSerial`; returns nothing, adds energy to `meter[slot]`.
   */
  render(
    speed: Float64Array,
    serial: Float64Array,
    out: Float64Array,
    n: number,
    meter: Float64Array,
    slot: number,
  ): void {
    // The serial is a stepped field: a change can only land at an update, so checking each
    // sample of the chunk finds it at its exact sample.
    for (let i = 0; i < n; i++) {
      const s = serial[i] as number;
      if (!this.hasSerial) {
        this.serial = s;
        this.hasSerial = true;
      }
      if (s !== this.serial) {
        // A new impact.
        this.serial = s;
        const v = speed[i] as number;
        if (v >= IMPACT_MIN_SPEED) {
          // Silent until now in this chunk: the samples before this one are zeros.
          if (!this.live) {
            this.thudBuf.fill(0, 0, i);
            this.bBuf.fill(0, 0, i);
            this.cBuf.fill(0, 0, i);
          }
          this.pendingSpeed = v;
          this.start();
        }
      }
      // While silent the envelope buffers are not read, so nothing is written to them.
      if (this.live) this.envelopes(i);
    }
    if (!this.live) {
      out.fill(0, 0, n);
      return;
    }
    this.noise.fill(this.nBuf, n);
    const nb = this.nBuf;
    const a = this.aBuf;
    const b = this.bBuf;
    for (let i = 0; i < n; i++) {
      a[i] = (nb[i] as number) * (b[i] as number);
    }
    this.crunch.processBlock(a, a, n);
    const c = this.cBuf;
    for (let i = 0; i < n; i++) b[i] = (nb[i] as number) * (c[i] as number);
    this.crack.processBlock(b, b, n);
    let e = 0;
    const thud = this.thudBuf;
    for (let i = 0; i < n; i++) {
      const v = ((thud[i] as number) + (a[i] as number) + (b[i] as number)) * ImpactVoice.LEVEL;
      out[i] = v;
      e += v * v;
    }
    meter[slot] = (meter[slot] as number) + e;
    if (
      this.thudEnv + this.crunchEnv + this.crackEnv < 1e-6 &&
      this.thudPeak + this.crunchPeak + this.crackPeak === 0
    ) {
      this.live = false;
      this.envelope = 0;
    }
  }

  private readonly thudBuf = new Float64Array(CHUNK);

  /** Start an impact of normal speed `pendingSpeed` (passed in a field: no boxed argument). */
  private start(): void {
    let a = Math.pow(this.pendingSpeed / IMPACT_FULL_SPEED, 0.75);
    a = a > 1.5 ? 1.5 : a;
    const f = a > 1 ? 1 : a;
    this.thudFrequency = 70 - 15 * f;
    this.thudPeak = 0.7 * a;
    this.crunchPeak = 1.6 * a;
    this.crackPeak = (0.9 + 0.6 * f) * a;
    this.thudDecay = Math.exp(-1 / ((0.06 + 0.06 * f) * this.sampleRate));
    this.crunchDecay = Math.exp(-1 / ((0.03 + 0.08 * f) * this.sampleRate));
    this.live = true;
  }

  /** Envelopes at sample `i`; the peaks are released once each envelope has reached them. */
  private envelopes(i: number): void {
    // Attack towards the peak, then decay once there (the peak is cleared).
    if (this.thudPeak > 0) {
      this.thudEnv += (this.thudPeak - this.thudEnv) * this.kThudAttack;
      if (this.thudEnv >= 0.98 * this.thudPeak) this.thudPeak = 0;
    } else this.thudEnv *= this.thudDecay;
    if (this.crunchPeak > 0) {
      this.crunchEnv += (this.crunchPeak - this.crunchEnv) * this.kCrunchAttack;
      if (this.crunchEnv >= 0.98 * this.crunchPeak) this.crunchPeak = 0;
    } else this.crunchEnv *= this.crunchDecay;
    if (this.crackPeak > 0) {
      this.crackEnv += (this.crackPeak - this.crackEnv) * this.kCrackAttack;
      if (this.crackEnv >= 0.98 * this.crackPeak) this.crackPeak = 0;
    } else this.crackEnv *= this.crackDecay;
    this.thudPhase += this.thudFrequency * this.dt;
    if (this.thudPhase >= 1) this.thudPhase -= 1;
    this.thudBuf[i] = Math.sin(TWO_PI * this.thudPhase) * this.thudEnv;
    this.bBuf[i] = this.crunchEnv;
    this.cBuf[i] = this.crackEnv;
    const env = this.thudEnv + this.crunchEnv;
    this.envelope = env > 1.5 ? 1.5 : env;
  }
}
