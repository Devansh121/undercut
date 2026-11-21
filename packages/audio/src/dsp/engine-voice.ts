import { Biquad, BiquadKind, onePoleCoefficient } from './biquad';
import { CHUNK, type CarControls } from './controls';
import { L, type LayerMeters } from './meters';
import { Noise } from './noise';
import { pulseTables, TABLE_SIZE } from './pulse-tables';
import type { PowerUnitSoundSpec } from './spec';
import { F } from './state';
import type { Voice } from './voice';

const TWO_PI = 2 * Math.PI;
const CYLINDERS = 6;

/**
 * Per-cylinder level trims: no two cylinders and runners are identical. Small and fixed,
 * they put energy into the half orders without making the engine sound broken.
 */
const CYLINDER_TRIM = [1.0, 0.96, 1.02, 0.95, 0.99, 0.97];

/**
 * Ignition-cut masks, one entry per firing event (1 fires, 0 is cut). The rev limiter cuts
 * in long runs, which gives the hard stutter; the pit limiter cuts single events in an
 * irregular pattern, which gives the lighter "brap" at constant speed.
 */
const REV_LIMIT_PATTERN = [1, 1, 1, 1, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0];
const PIT_LIMIT_PATTERN = [1, 1, 0, 1, 0, 1, 1, 0, 0, 1, 0, 1, 1, 0];
/** A cut cylinder still pumps air: what is left of its pulse. */
const CUT_RESIDUAL = 0.25;

/** Mix levels of the layers, linear. Design values, checked by the loudness tests. */
const LEVEL = {
  exhaust: 0.24,
  intake: 0.17,
  combustion: 0.12,
  turboWhine: 0.012,
  turboHiss: 0.008,
  ers: 0.01,
  /** Thousandths, integer: see `Burst.trigger`. */
  popMilli: 220,
  clackMilli: 120,
};

/**
 * One short noise burst through a resonator: an overrun pop or a gearbox clack.
 * A trigger names the sample of the current chunk it starts on, and the burst renders
 * sample-accurately from there, so the result does not depend on how blocks are split.
 */
class Burst {
  private pos = 0;
  private length = 0;
  private ring = 0;
  private amplitude = 0;
  private active = false;
  private pendingAt = -1;
  private pendingLength = 0;
  private pendingRing = 0;
  private pendingAmplitude = 0;
  private pendingFrequency = 0;
  private pendingQ = 0;
  private readonly filter: Biquad;
  private readonly scratch = new Float64Array(CHUNK);

  constructor(sampleRate: number) {
    this.filter = new Biquad(sampleRate);
    this.filter.kind = BiquadKind.Bandpass;
  }

  /** Whether the burst is sounding at sample `offset` of the chunk being rendered. */
  activeAt(offset: number): boolean {
    if (this.pendingAt >= 0 && this.pendingAt <= offset) return true;
    return this.active && this.pos + offset < this.length + this.ring;
  }

  /**
   * Start a burst at sample `offset` of the chunk being rendered. Every argument is an
   * integer (frames, thousandths, hertz, tenths), so the call never has to box a
   * fractional number on the audio thread. A second trigger in the same chunk replaces it.
   */
  trigger(
    offset: number,
    lengthFrames: number,
    ringFrames: number,
    amplitudeMilli: number,
    frequencyHz: number,
    qTenths: number,
  ): void {
    this.pendingAt = offset;
    this.pendingLength = lengthFrames < 2 ? 2 : lengthFrames;
    this.pendingRing = ringFrames;
    this.pendingAmplitude = amplitudeMilli;
    this.pendingFrequency = frequencyHz;
    this.pendingQ = qTenths;
  }

  /** Add the next `n` samples into `out`, excited by `noise`; add their energy to `meter[slot]`. */
  renderAdd(
    noise: Float64Array,
    out: Float64Array,
    n: number,
    meter: Float64Array,
    slot: number,
  ): void {
    if (!this.active && this.pendingAt < 0) return;
    const x = this.scratch;
    const start = this.pendingAt >= 0 ? this.pendingAt : n;
    let pos = this.pos;
    // The burst already sounding, up to the new trigger (or the end of the chunk).
    let end = 0;
    if (this.active) {
      const left = this.length + this.ring - pos;
      end = left < start ? left : start;
      this.excite(noise, x, 0, end, pos);
      this.filter.processRange(x, x, 0, end);
      pos += end;
      if (pos >= this.length + this.ring) this.active = false;
    }
    for (let i = end; i < start && i < n; i++) x[i] = 0;
    // A new burst from its trigger sample.
    if (this.pendingAt >= 0) {
      if (!this.active) this.filter.reset();
      this.filter.frequency = this.pendingFrequency;
      this.filter.q = this.pendingQ / 10;
      this.filter.design();
      this.length = this.pendingLength;
      this.ring = this.pendingRing;
      this.amplitude = this.pendingAmplitude / 1000;
      this.pendingAt = -1;
      this.active = true;
      const left = this.length + this.ring;
      const stop = start + left < n ? start + left : n;
      this.excite(noise, x, start, stop, 0);
      this.filter.processRange(x, x, start, stop);
      for (let i = stop; i < n; i++) x[i] = 0;
      pos = stop - start;
      if (pos >= this.length + this.ring) this.active = false;
    }
    this.pos = pos;
    let energy = 0;
    for (let i = 0; i < n; i++) {
      const v = x[i] as number;
      out[i] = (out[i] as number) + v;
      energy += v * v;
    }
    meter[slot] = (meter[slot] as number) + energy;
  }

  /** Raised-cosine noise excitation for samples [from, to), the first at burst position `pos`. */
  private excite(
    noise: Float64Array,
    x: Float64Array,
    from: number,
    to: number,
    pos: number,
  ): void {
    const len = this.length;
    const amplitude = this.amplitude;
    for (let i = from; i < to; i++, pos++) {
      if (pos < len) {
        const s = Math.sin((Math.PI * pos) / len);
        x[i] = (noise[i] as number) * s * s * amplitude;
      } else {
        x[i] = 0;
      }
    }
  }
}

/**
 * The power-unit voice: a 1.6 L V6 four-stroke, turbocharged, with an MGU-K.
 *
 * Six exhaust pulses per 720° cycle (firing frequency rpm/60 × 3), read from band-limited
 * wavetables whose shape hardens with load. The second bank's pulses arrive a little late and
 * a little weaker, more so off throttle, which puts energy into the half and 1.5 orders.
 * The pulse train goes through fixed exhaust and intake resonances, so the formants stay put
 * while the harmonic ladder moves with rpm. On top: combustion noise gated by the firing
 * events, turbo whine and hiss from a lagging spool state, MGU-K whine geared to the crank,
 * overrun pops, ignition-cut patterns for the limiters, and gear-change transients.
 *
 * Rendering is staged per chunk: one per-sample loop for the state that has feedback
 * (envelopes, crank phase, firing events), then filters over whole buffers. Hot loops call
 * nothing that returns a number, so the JavaScript engine never boxes one (no allocation).
 */
export class EngineVoice implements Voice {
  readonly bus = 'engine' as const;

  private readonly dt: number;
  private readonly invLimiter: number;
  private readonly soft: Float32Array;
  private readonly hard: Float32Array;
  private readonly burstTable: Float32Array;
  private readonly offsets = new Float64Array(CYLINDERS);
  private readonly prevU = new Float64Array(CYLINDERS);
  private readonly eventGain = new Float64Array(CYLINDERS);

  // Per-chunk buffers.
  private readonly pulseBuf = new Float64Array(CHUNK);
  private readonly softBuf = new Float64Array(CHUNK);
  private readonly burstBuf = new Float64Array(CHUNK);
  private readonly ampBuf = new Float64Array(CHUNK);
  private readonly gateBuf = new Float64Array(CHUNK);
  private readonly loadBuf = new Float64Array(CHUNK);
  private readonly envBuf = new Float64Array(CHUNK);
  private readonly crankBuf = new Float64Array(CHUNK);
  private readonly noiseBuf = new Float64Array(CHUNK);
  private readonly tmpBuf = new Float64Array(CHUNK);
  private readonly tmp2Buf = new Float64Array(CHUNK);
  /** Random numbers for one firing event. */
  private readonly rnd = new Float64Array(4);

  private phase = 0;
  private eventCount = 0;
  private load = 0;
  private engineEnv = 0;
  private cutEnv = 1;
  private blipEnv = 0;
  private liftEnv = 0;
  private downshiftEnv = 0;
  private throttleWasHigh = false;
  private wasShifting = false;
  private crank = 0;
  private spool = 0;
  private turboPhase = 0;
  private ersPhase = 0;
  private deploy = 0;
  private harvest = 0;
  private turboLive = false;
  private ersLive = false;
  private evLoad = 0;
  private evImbalance = 0;
  private evSpeed = 0;
  /** Sample index in the chunk of the event being handled. */
  private evIndex = 0;
  private readonly popRing: number;
  private readonly clackLength: number;

  private readonly kLoad: number;
  private readonly kOn: number;
  private readonly kOff: number;
  private readonly kCut: number;
  private readonly kBlip: number;
  private readonly kLift: number;
  private readonly kDownshift: number;
  private readonly kSpoolUp: number;
  private readonly kSpoolDown: number;
  private readonly kErs: number;
  private readonly kCrank: number;

  private readonly formants: Biquad[];
  private readonly intake: Biquad;
  private readonly combustion: Biquad;
  private readonly hiss: Biquad;
  private readonly dcBlock: Biquad;
  private readonly air: Biquad;
  private readonly pops: Burst[];
  private readonly clack: Burst;

  private readonly combNoise: Noise;
  private readonly hissNoise: Noise;
  private readonly popNoise: Noise;
  private readonly eventNoise: Noise;

  constructor(
    private readonly sampleRate: number,
    private readonly spec: PowerUnitSoundSpec,
    seeds: () => number,
  ) {
    this.dt = 1 / sampleRate;
    this.invLimiter = 1 / spec.limiterSpeed;
    this.popRing = Math.round(sampleRate * 0.03);
    this.clackLength = Math.round(sampleRate * 0.003);
    const tables = pulseTables(sampleRate);
    this.soft = tables.soft;
    this.hard = tables.hard;
    this.burstTable = tables.burst;
    for (let c = 0; c < CYLINDERS; c++) {
      // Firing order alternates banks, so odd slots are the second bank.
      this.offsets[c] = c / CYLINDERS + (c % 2 === 1 ? spec.bankDelay : 0);
      this.eventGain[c] = CYLINDER_TRIM[c] as number;
    }
    const k = (t: number) => onePoleCoefficient(t, sampleRate);
    this.kLoad = k(0.02);
    this.kOn = k(0.08);
    this.kOff = k(0.1);
    this.kCut = k(0.0025);
    this.kBlip = k(0.006);
    this.kLift = k(1.2);
    this.kDownshift = k(0.35);
    this.kSpoolUp = k(spec.turboSpoolUp);
    this.kSpoolDown = k(spec.turboSpoolDown);
    this.kErs = k(0.02);
    this.kCrank = k(0.01);

    this.formants = spec.exhaustFormants.map((f) =>
      new Biquad(sampleRate).peaking(f.frequency, f.q, f.gainDb),
    );
    this.intake = new Biquad(sampleRate).bandpass(spec.intake.frequency, spec.intake.q);
    this.combustion = new Biquad(sampleRate).bandpass(3200, 0.8);
    this.hiss = new Biquad(sampleRate).bandpass(5500, 1.4);
    this.dcBlock = new Biquad(sampleRate).highpass(45, 0.7071);
    this.air = new Biquad(sampleRate).highShelf(9000, 0.7071, -3);
    this.pops = [new Burst(sampleRate), new Burst(sampleRate)];
    this.clack = new Burst(sampleRate);

    this.combNoise = new Noise(seeds());
    this.hissNoise = new Noise(seeds());
    this.popNoise = new Noise(seeds());
    this.eventNoise = new Noise(seeds());
  }

  render(
    controls: CarControls,
    out: Float64Array,
    n: number,
    meters: LayerMeters,
    aligned: boolean,
  ): void {
    const b = controls.buffers;
    const m = meters.sumSquares;
    if (aligned) {
      // Control rate: decide which optional layers run.
      const boost = (b[F.boost] as Float64Array)[0] as number;
      const ers = (b[F.ersPower] as Float64Array)[0] as number;
      this.turboLive = this.spool > 0 || boost > 0 || controls.targetOf(F.boost) > 0;
      this.ersLive =
        this.deploy + this.harvest > 0 || ers !== 0 || controls.targetOf(F.ersPower) !== 0;
    }
    this.renderPulses(controls, n);

    const pulse = this.pulseBuf;
    const soft = this.softBuf;
    const burst = this.burstBuf;
    const amp = this.ampBuf;
    const gate = this.gateBuf;
    const load = this.loadBuf;
    const noise = this.noiseBuf;
    const tmp = this.tmpBuf;

    // Exhaust: the pulse train through the fixed exhaust resonances.
    let e = 0;
    for (let i = 0; i < n; i++) out[i] = (pulse[i] as number) * (amp[i] as number) * LEVEL.exhaust;
    for (let f = 0; f < this.formants.length; f++)
      (this.formants[f] as Biquad).processBlock(out, out, n);
    for (let i = 0; i < n; i++) e += (out[i] as number) * (out[i] as number);
    m[L.exhaust] = (m[L.exhaust] as number) + e;

    // Intake: the airbox resonance, fed in proportion to load.
    e = 0;
    for (let i = 0; i < n; i++) {
      tmp[i] =
        (soft[i] as number) *
        (gate[i] as number) *
        (0.15 + 0.85 * (load[i] as number)) *
        LEVEL.intake;
    }
    this.intake.processBlock(tmp, tmp, n);
    for (let i = 0; i < n; i++) {
      const v = tmp[i] as number;
      out[i] = (out[i] as number) + v;
      e += v * v;
    }
    m[L.intake] = (m[L.intake] as number) + e;

    // Combustion noise, gated by the firing events, rising with load.
    e = 0;
    this.combNoise.fill(noise, n);
    for (let i = 0; i < n; i++) {
      const ld = load[i] as number;
      tmp[i] =
        (noise[i] as number) *
        (burst[i] as number) *
        (gate[i] as number) *
        ld *
        ld *
        LEVEL.combustion;
    }
    this.combustion.processBlock(tmp, tmp, n);
    for (let i = 0; i < n; i++) {
      const v = tmp[i] as number;
      out[i] = (out[i] as number) + v;
      e += v * v;
    }
    m[L.combustion] = (m[L.combustion] as number) + e;

    this.dcBlock.processBlock(out, out, n);
    this.air.processBlock(out, out, n);

    if (this.turboLive) this.renderTurbo(controls, out, n, m);
    if (this.ersLive) this.renderErs(controls, out, n, m);

    // Pops and the gearbox clack.
    this.popNoise.fill(noise, n);
    for (let p = 0; p < this.pops.length; p++)
      (this.pops[p] as Burst).renderAdd(noise, out, n, m, L.crackle);
    this.clack.renderAdd(noise, out, n, m, L.shift);
  }

  /** The per-sample part: envelopes, crank phase, firing events and the cylinder pulse sums. */
  private renderPulses(controls: CarControls, n: number): void {
    const b = controls.buffers;
    const engineOn = b[F.engineOn] as Float64Array;
    const engineSpeed = b[F.engineSpeed] as Float64Array;
    const throttleBuf = b[F.throttle] as Float64Array;
    const loadIn = b[F.load] as Float64Array;
    const shifting = b[F.shifting] as Float64Array;
    const shiftDir = b[F.shiftDirection] as Float64Array;
    const revLimiter = b[F.revLimiter] as Float64Array;
    const pitLimiter = b[F.pitLimiter] as Float64Array;
    const softT = this.soft;
    const hardT = this.hard;
    const burstT = this.burstTable;
    const offsets = this.offsets;
    const prevU = this.prevU;
    const eventGain = this.eventGain;
    const imbFull = this.spec.bankImbalance.fullLoad;
    const imbRange = this.spec.bankImbalance.overrun - imbFull;
    const cycleScale = this.dt / (2 * TWO_PI);

    for (let i = 0; i < n; i++) {
      const w = engineSpeed[i] as number;
      const throttle = throttleBuf[i] as number;
      const isShifting = (shifting[i] as number) > 0.5;
      const dir = shiftDir[i] as number;
      const on = (engineOn[i] as number) > 0.5;

      // Envelopes.
      this.engineEnv += ((on ? 1 : 0) - this.engineEnv) * (on ? this.kOn : this.kOff);
      if (!on && this.engineEnv < 1e-5) this.engineEnv = 0;
      let li = loadIn[i] as number;
      li = li < 0 ? 0 : li > 1 ? 1 : li;
      this.load += (li - this.load) * this.kLoad;
      this.blipEnv += ((isShifting && dir < 0 ? 1 : 0) - this.blipEnv) * this.kBlip;
      this.cutEnv += ((isShifting && dir > 0 ? 0.3 : 1) - this.cutEnv) * this.kCut;
      const load = this.load > 0.85 * this.blipEnv ? this.load : 0.85 * this.blipEnv;
      const hardness = load * (2 - load);

      this.evIndex = i;
      if (isShifting && !this.wasShifting) this.startShift(dir > 0 ? 1 : -1);
      this.wasShifting = isShifting;
      this.downshiftEnv -= this.downshiftEnv * this.kDownshift;
      if (throttle > 0.6 && w > 730) this.throttleWasHigh = true;
      if (this.throttleWasHigh && throttle < 0.15) {
        this.liftEnv = 1;
        this.throttleWasHigh = false;
      }
      this.liftEnv -= this.liftEnv * this.kLift;

      // Crank gate: 0 below about 300 rpm, 1 above about 1500 rpm, smoothed, so a stopped
      // crank never holds a level.
      let c = (w - 30) / 130;
      c = c < 0 ? 0 : c > 1 ? 1 : c;
      this.crank += (c * c * (3 - 2 * c) - this.crank) * this.kCrank;

      // Crank phase: one cycle is 720°, so the cycle frequency is w / 4π.
      let phase = this.phase + w * cycleScale;
      if (phase >= 1) phase -= 1;
      this.phase = phase;

      const imbalance = imbFull + imbRange * (1 - load);
      let sum = 0;
      let softSum = 0;
      let burst = 0;
      for (let cyl = 0; cyl < CYLINDERS; cyl++) {
        let u = phase - (offsets[cyl] as number);
        if (u < 0) u += 1;
        if (u < (prevU[cyl] as number)) {
          // Event inputs go through fields so the call passes only small integers.
          this.evLoad = load;
          this.evImbalance = imbalance;
          this.evSpeed = w;
          this.fire(
            cyl,
            (revLimiter[i] as number) > 0.5 ? 1 : 0,
            (pitLimiter[i] as number) > 0.5 && throttle > 0.3 ? 1 : 0,
          );
        }
        prevU[cyl] = u;
        const x = u * TABLE_SIZE;
        const j = x | 0;
        const fr = x - j;
        const s0 = softT[j] as number;
        const s = s0 + fr * ((softT[j + 1] as number) - s0);
        const h0 = hardT[j] as number;
        const h = h0 + fr * ((hardT[j + 1] as number) - h0);
        const g = eventGain[cyl] as number;
        sum += g * (s + hardness * (h - s));
        softSum += g * s;
        burst += g * (burstT[j] as number);
      }

      const gate = this.crank * this.engineEnv * this.cutEnv;
      let rpmNorm = w * this.invLimiter;
      rpmNorm = rpmNorm > 1.1 ? 1.1 : rpmNorm;
      this.pulseBuf[i] = sum;
      this.softBuf[i] = softSum;
      this.burstBuf[i] = burst;
      this.gateBuf[i] = gate;
      this.loadBuf[i] = load;
      this.envBuf[i] = this.engineEnv;
      this.crankBuf[i] = this.crank;
      // Louder with load and, less so, with rpm (more air through the engine per second).
      this.ampBuf[i] = (0.42 + 0.58 * load) * (0.6 + 0.4 * rpmNorm) * gate;
    }
  }

  /** Turbo: spool lags the demand; whine and hiss scale with spool. */
  private renderTurbo(controls: CarControls, out: Float64Array, n: number, m: Float64Array): void {
    const boost = controls.buffers[F.boost] as Float64Array;
    const load = this.loadBuf;
    const hissIn = this.tmpBuf;
    const tone = this.tmp2Buf;
    const noise = this.noiseBuf;
    const idle = this.spec.turboWhine.idle;
    const span = this.spec.turboWhine.full - idle;
    const nyquistGuard = 0.45 * this.sampleRate;
    for (let i = 0; i < n; i++) {
      let target = boost[i] as number;
      target = (target < 0 ? 0 : target > 1 ? 1 : target) * (this.envBuf[i] as number);
      this.spool += (target - this.spool) * (target > this.spool ? this.kSpoolUp : this.kSpoolDown);
      if (target === 0 && this.spool < 1e-7) this.spool = 0;
      const fw = idle + span * this.spool;
      this.turboPhase += fw * this.dt;
      if (this.turboPhase >= 1) this.turboPhase -= 1;
      const p = TWO_PI * this.turboPhase;
      const level = this.spool * (0.35 + 0.65 * (load[i] as number));
      const second = 2 * fw < nyquistGuard ? 0.3 * Math.sin(2 * p) : 0;
      tone[i] = (Math.sin(p) + second) * this.spool * level * LEVEL.turboWhine;
      hissIn[i] = level * LEVEL.turboHiss;
    }
    this.hissNoise.fill(noise, n);
    for (let i = 0; i < n; i++) hissIn[i] = (hissIn[i] as number) * (noise[i] as number);
    this.hiss.processBlock(hissIn, hissIn, n);
    let e = 0;
    for (let i = 0; i < n; i++) {
      const v = (tone[i] as number) + (hissIn[i] as number);
      out[i] = (out[i] as number) + v;
      e += v * v;
    }
    m[L.turbo] = (m[L.turbo] as number) + e;
  }

  /** MGU-K: electrical whine at shaft speed × pole pairs, geared to the crank. */
  private renderErs(controls: CarControls, out: Float64Array, n: number, m: Float64Array): void {
    const power = controls.buffers[F.ersPower] as Float64Array;
    const speed = controls.buffers[F.engineSpeed] as Float64Array;
    const toHz = (this.spec.mgukRatio * this.spec.mgukPolePairs) / TWO_PI;
    const invMax = 1 / this.spec.mgukMaxPower;
    const nyquistGuard = 0.45 * this.sampleRate;
    let e = 0;
    for (let i = 0; i < n; i++) {
      const p = power[i] as number;
      const on = this.envBuf[i] as number;
      this.deploy += ((p > 0 ? p * invMax : 0) * on - this.deploy) * this.kErs;
      this.harvest += ((p < 0 ? -p * invMax : 0) * on - this.harvest) * this.kErs;
      if (p === 0 && this.deploy + this.harvest < 1e-7) {
        this.deploy = 0;
        this.harvest = 0;
      }
      const fe = (speed[i] as number) * toHz;
      this.ersPhase += fe * this.dt;
      if (this.ersPhase >= 1) this.ersPhase -= 1;
      const ph = TWO_PI * this.ersPhase;
      const s1 = Math.sin(ph);
      const h2 = 2 * fe < nyquistGuard ? Math.sin(2 * ph) : 0;
      const h3 = 3 * fe < nyquistGuard ? Math.sin(3 * ph) : 0;
      const d = this.deploy > 1.5 ? 1.5 : this.deploy;
      const h = this.harvest > 1.5 ? 1.5 : this.harvest;
      const v =
        (d * (s1 + 0.35 * h2) + h * 0.8 * (s1 + 0.6 * h3)) *
        (this.crankBuf[i] as number) *
        LEVEL.ers;
      out[i] = (out[i] as number) + v;
      e += v * v;
    }
    m[L.ers] = (m[L.ers] as number) + e;
  }

  /** A cylinder's phase wrapped: decide its next event's level, and maybe a pop. */
  private fire(c: number, revLimiter: number, pitLimiter: number): void {
    const load = this.evLoad;
    const rnd = this.rnd;
    this.eventNoise.draw(rnd, 4);
    const roughness = 0.03 + 0.09 * (1 - load);
    let gain = (CYLINDER_TRIM[c] as number) * (c % 2 === 1 ? 1 - this.evImbalance : 1);
    gain *= 1 + roughness * (2 * (rnd[0] as number) - 1);
    let cut = false;
    if (revLimiter === 1) {
      cut = REV_LIMIT_PATTERN[this.eventCount % REV_LIMIT_PATTERN.length] === 0;
    } else if (pitLimiter === 1) {
      cut = PIT_LIMIT_PATTERN[this.eventCount % PIT_LIMIT_PATTERN.length] === 0;
    }
    this.eventCount++;
    if (cut) gain *= CUT_RESIDUAL;
    this.eventGain[c] = gain;

    if (this.engineEnv < 0.5) return;
    // Unburnt fuel lighting in the exhaust: after a lift, after a downshift, on a cut.
    let rev = (this.evSpeed - 600) / 400;
    rev = rev < 0 ? 0 : rev > 1 ? 1 : rev;
    const overrun = (1 - load) * rev * rev * (3 - 2 * rev);
    const chance =
      0.02 * this.liftEnv * overrun + 0.06 * this.downshiftEnv * overrun + (cut ? 0.08 : 0);
    if (chance > 0 && (rnd[1] as number) < chance) {
      const at = this.evIndex;
      const pop = (this.pops[0] as Burst).activeAt(at)
        ? (this.pops[1] as Burst)
        : (this.pops[0] as Burst);
      const r = rnd[2] as number;
      const a = rnd[3] as number;
      pop.trigger(
        at,
        Math.round(this.sampleRate * (0.0012 + 0.0015 * r)),
        this.popRing,
        Math.round(LEVEL.popMilli * (0.4 + 0.6 * a)),
        Math.round(350 + 1100 * r),
        25,
      );
    }
  }

  private startShift(direction: number): void {
    const up = direction > 0;
    this.clack.trigger(
      this.evIndex,
      this.clackLength,
      this.popRing,
      LEVEL.clackMilli,
      up ? 2400 : 1700,
      30,
    );
    if (!up) this.downshiftEnv = 1;
  }
}
