/** All positions/velocities are listener relative, in metres and m/s; +z is right. */
export interface OtherCarSound {
  x: number;
  z: number;
  vx: number;
  vz: number;
  engineSpeed: number;
  throttle: number;
}
export interface AudioScene {
  cars: readonly OtherCarSound[];
  circuit: 'forest' | 'park' | 'city';
  /** Distance along the lap divided by lap length, wrapped to [0,1). */
  progress: number;
  /** -1 outside the start procedure, 0–5 red lamps, 6 release. */
  lights: number;
}
export type AudioCue = 'focus' | 'accept' | 'back' | 'light' | 'go';
export const OTHER_CAR_CAPACITY = 19;
export const AUDIBLE_CARS = 6;
const clamp = (x: number, lo: number, hi: number) =>
  Number.isFinite(x) ? Math.max(lo, Math.min(hi, x)) : lo;

/** Fixed identity slots: culling never resets phase; 50 ms fades avoid slot-switch clicks. */
export class SceneSound {
  private readonly voices = Array.from({ length: OTHER_CAR_CAPACITY }, () => ({
    distance: Infinity,
    frequency: 225,
    targetFrequency: 225,
    gain: 0,
    targetGain: 0,
    pan: 0,
    targetPan: 0,
    load: 0,
    targetLoad: 0,
    phase: 0,
    doppler: 1,
    targetDoppler: 1,
  }));
  private readonly selected = new Uint8Array(OTHER_CAR_CAPACITY);
  private readonly k: number;
  private crowd = 0;
  private crowdTarget = 0;
  private forest = 0;
  private forestTarget = 0;
  private city = 0;
  private cityTarget = 0;
  private noise = 1;
  private low = 0;
  private clock = 0;
  private cueAge = 1e9;
  private cueHz = 700;
  private cueDuration = 0.06;
  private lights = -1;
  private enabled = false;
  constructor(
    private readonly sampleRate: number,
    seed = 1,
  ) {
    this.k = 1 - Math.exp(-1 / (0.05 * sampleRate));
    this.noise = seed || 1;
  }
  get audibleCount(): number {
    return this.selected.reduce((a, b) => a + b, 0);
  }
  set(scene: AudioScene): void {
    this.enabled = true;
    this.selected.fill(0);
    for (let i = 0; i < OTHER_CAR_CAPACITY; i++) {
      const v = this.voices[i]!;
      const c = scene.cars[i];
      v.targetGain = 0;
      v.distance = c ? Math.hypot(clamp(c.x, -1e5, 1e5), clamp(c.z, -1e5, 1e5)) : Infinity;
      if (!c) continue;
      const d = Math.max(1, v.distance);
      const radial =
        (clamp(c.x, -1e5, 1e5) * clamp(c.vx, -150, 150) +
          clamp(c.z, -1e5, 1e5) * clamp(c.vz, -150, 150)) /
        d;
      v.targetDoppler = clamp(343 / (343 + clamp(radial, -100, 100)), 0.8, 1.25);
      v.targetFrequency = (clamp(c.engineSpeed, 0, 1571) * 3) / (2 * Math.PI);
      v.targetLoad = clamp(c.throttle, 0, 1);
      v.targetPan = clamp(c.z / d, -1, 1);
    }
    for (let n = 0; n < AUDIBLE_CARS; n++) {
      let nearest = -1;
      let distance = 250;
      for (let i = 0; i < OTHER_CAR_CAPACITY; i++) {
        if (!this.selected[i] && this.voices[i]!.distance < distance) {
          nearest = i;
          distance = this.voices[i]!.distance;
        }
      }
      if (nearest < 0) break;
      this.selected[nearest] = 1;
      this.voices[nearest]!.targetGain = 0.09 / (1 + (distance / 12) ** 2);
    }
    const p = clamp(scene.progress, 0, 1);
    this.crowdTarget = Math.max(0, 1 - Math.min(p, 1 - p) / 0.055);
    this.forestTarget =
      scene.circuit === 'forest' ? 1 - this.crowdTarget : scene.circuit === 'park' ? 0.35 : 0;
    this.cityTarget = scene.circuit === 'city' ? 1 : 0;
    if (scene.lights !== this.lights) {
      if (scene.lights > 0 && scene.lights <= 6) this.cue(scene.lights === 6 ? 'go' : 'light');
      this.lights = scene.lights;
    }
  }
  cue(cue: AudioCue): void {
    this.cueHz = { focus: 650, accept: 1100, back: 420, light: 880, go: 1760 }[cue];
    this.cueDuration = cue === 'go' ? 0.25 : cue === 'light' ? 0.12 : 0.06;
    this.cueAge = 0;
  }
  render(
    engineL: Float64Array,
    engineR: Float64Array,
    ambL: Float64Array,
    ambR: Float64Array,
    uiL: Float64Array,
    uiR: Float64Array,
    n: number,
  ): void {
    if (!this.enabled && this.cueAge >= this.cueDuration) return;
    const k = this.k;
    for (const v of this.voices) {
      if (v.targetGain === 0 && v.gain < 1e-7) {
        v.gain = 0;
        continue;
      }
      for (let i = 0; i < n; i++) {
        v.gain += (v.targetGain - v.gain) * k;
        v.frequency += (v.targetFrequency - v.frequency) * k;
        v.doppler += (v.targetDoppler - v.doppler) * k;
        v.load += (v.targetLoad - v.load) * k;
        v.pan += (v.targetPan - v.pan) * k;
        v.phase = (v.phase + (v.frequency * v.doppler) / this.sampleRate) % 1;
        const p = v.phase * 2 * Math.PI;
        const sound =
          (Math.sin(p) + v.load * (0.4 * Math.sin(2 * p) + 0.2 * Math.sin(3 * p))) *
          (0.35 + 0.65 * v.load) *
          v.gain;
        engineL[i] = engineL[i]! + sound * Math.sqrt((1 - v.pan) * 0.5);
        engineR[i] = engineR[i]! + sound * Math.sqrt((1 + v.pan) * 0.5);
      }
    }
    for (let i = 0; i < n; i++) {
      this.crowd += (this.crowdTarget - this.crowd) * k;
      this.forest += (this.forestTarget - this.forest) * k;
      this.city += (this.cityTarget - this.city) * k;
      let r = this.noise;
      r ^= r << 13;
      r ^= r >>> 17;
      r ^= r << 5;
      this.noise = r;
      const noise = (r >>> 0) / 2147483648 - 1;
      this.low += (noise - this.low) * 0.04;
      const t = this.clock++ / this.sampleRate;
      const crowd = this.low * 0.13 * this.crowd * (0.7 + 0.3 * Math.sin(t * 2.1));
      const birds =
        Math.sin(t * 2 * Math.PI * (2400 + 200 * Math.sin(t * 3))) *
        Math.max(0, Math.sin(t * 1.7) - 0.92) *
        0.035;
      const city = this.low * 0.045 + Math.sin(t * 2 * Math.PI * 100) * 0.002;
      ambL[i] = ambL[i]! + crowd + this.forest * (noise * 0.002 + birds) + this.city * city;
      ambR[i] =
        ambR[i]! +
        crowd * 0.85 +
        this.forest * (-noise * 0.002 + birds * 0.7) +
        this.city * city * 0.9;
      if (this.cueAge < this.cueDuration) {
        const age = this.cueAge;
        const env = Math.min(1, age / 0.005, (this.cueDuration - age) / 0.015);
        const cue = Math.sin(age * this.cueHz * 2 * Math.PI) * Math.max(0, env) * 0.08;
        uiL[i] = uiL[i]! + cue;
        uiR[i] = uiR[i]! + cue;
        this.cueAge += 1 / this.sampleRate;
      }
    }
  }
}
