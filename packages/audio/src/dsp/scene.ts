import { Ambience, AMBIENCE_KINDS, type AmbienceKind } from './ambience';
import { CHUNK } from './controls';
import { Cues, type AudioCue } from './cues';
import { OpponentVoice, OPPONENT_LEVEL, REFERENCE_DISTANCE } from './opponent-voice';

/**
 * Everything around the player's car: other cars, the circuit's ambience and the cues (start
 * lights, menus). The game sends an `AudioScene` at frame rate; it travels to the worklet
 * packed in a `Float64Array` (`packScene`), and the core reads that packed form.
 */

/** One other car, relative to the listener (the player's car): body frame, +x forward, +z right. */
export interface OtherCarSound {
  /** Position, m. */
  x: number;
  z: number;
  /** Velocity relative to the listener, m/s. */
  vx: number;
  vz: number;
  /** Crankshaft speed, rad/s. */
  engineSpeed: number;
  /** Throttle, 0–1. */
  throttle: number;
}

export interface AudioScene {
  /** Up to `OTHER_CAR_CAPACITY` cars, each always in the same slot (the race index). */
  cars: readonly OtherCarSound[];
  /** The circuit's location bed. */
  ambience: AmbienceKind;
  /** Crowd level reaching each ear, 0–1 (1 is a full stand about 20 m away). */
  crowdLeft: number;
  crowdRight: number;
  /** −1 outside the start procedure, 0–5 red lamps lit, 6 lights out. */
  lights: number;
  /**
   * How many cars may have a voice of their own, 0–`AUDIBLE_CARS` (default `AUDIBLE_CARS`);
   * the rest go to the far field. The game lowers it on the Mobile preset to save CPU.
   */
  voices?: number;
}

export type { AudioCue, AmbienceKind };
export const OTHER_CAR_CAPACITY = 19;
/** Most voices rendered individually: the nearest cars within `CULL_DISTANCE`. */
export const AUDIBLE_CARS = 6;
/**
 * Beyond this, a car has no voice of its own. Over the last `CROSSFADE` metres its voice fades
 * and the far field takes its power over (constant power), so its level falls smoothly.
 */
export const CULL_DISTANCE = 300;
export const CROSSFADE = 80;
/** Cars without a voice but nearer than this are summed into one far-field voice; their share
 * fades out over the last `FIELD_FADE` metres. */
export const FIELD_DISTANCE = 600;
export const FIELD_FADE = 100;

const HEADER = 6;
const PER_CAR = 6;
/** Length of a packed scene. */
export const SCENE_LENGTH = HEADER + OTHER_CAR_CAPACITY * PER_CAR;

/** Pack a scene for the worklet. Allocates nothing when `out` is given. */
export function packScene(
  scene: Readonly<AudioScene>,
  out: Float64Array = new Float64Array(SCENE_LENGTH),
): Float64Array {
  const count = Math.min(OTHER_CAR_CAPACITY, scene.cars.length);
  out[0] = count;
  out[1] = AMBIENCE_KINDS.indexOf(scene.ambience);
  out[2] = scene.crowdLeft;
  out[3] = scene.crowdRight;
  out[4] = scene.lights;
  out[5] = scene.voices ?? AUDIBLE_CARS;
  for (let i = 0; i < count; i++) {
    const c = scene.cars[i] as OtherCarSound;
    const o = HEADER + i * PER_CAR;
    out[o] = c.x;
    out[o + 1] = c.z;
    out[o + 2] = c.vx;
    out[o + 3] = c.vz;
    out[o + 4] = c.engineSpeed;
    out[o + 5] = c.throttle;
  }
  return out;
}

/**
 * Range of every packed field, and what a non-finite value becomes. Positions have no fallback:
 * a car with a non-finite position is absent.
 */
const LOW = new Float64Array(SCENE_LENGTH);
const HIGH = new Float64Array(SCENE_LENGTH);
const FALLBACK = new Float64Array(SCENE_LENGTH);
{
  const field = (i: number, lo: number, hi: number, fallback: number) => {
    LOW[i] = lo;
    HIGH[i] = hi;
    FALLBACK[i] = fallback;
  };
  field(0, 0, OTHER_CAR_CAPACITY, 0);
  field(1, 0, AMBIENCE_KINDS.length - 1, 0);
  field(2, 0, 2, 0);
  field(3, 0, 2, 0);
  field(4, -1, 6, -1);
  field(5, 0, AUDIBLE_CARS, AUDIBLE_CARS);
  for (let i = 0; i < OTHER_CAR_CAPACITY; i++) {
    const o = HEADER + i * PER_CAR;
    field(o, -1e5, 1e5, NaN);
    field(o + 1, -1e5, 1e5, NaN);
    field(o + 2, -150, 150, 0);
    field(o + 3, -150, 150, 0);
    field(o + 4, 0, 1571, 0); // 15 000 rpm, the pulse tables' limit
    field(o + 5, 0, 1, 0);
  }
}

/** Smoothing for every voice parameter: 50 ms, so a 60 Hz scene never steps. */
const VOICE_TIME = 0.05;

export class SceneSound {
  private readonly voices: OpponentVoice[];
  private readonly field: OpponentVoice;
  private readonly ambience: Ambience;
  private readonly cues: Cues;
  private readonly packed = new Float64Array(SCENE_LENGTH);
  /** The far field as one car, in packed layout (it does not move: no Doppler). */
  private readonly fieldCar = new Float64Array(PER_CAR);
  private readonly k: number;
  private readonly picked = new Uint8Array(OTHER_CAR_CAPACITY);
  private lights = -1;
  private clock = 0;

  constructor(sampleRate: number, seed = 1) {
    this.voices = Array.from(
      { length: OTHER_CAR_CAPACITY },
      (_, i) => new OpponentVoice(sampleRate, (seed * 2654435761 + i * 40503) >>> 0),
    );
    this.field = new OpponentVoice(sampleRate, seed ^ 0x9e3779b9);
    this.ambience = new Ambience(sampleRate, seed);
    this.cues = new Cues(sampleRate);
    this.k = 1 - Math.exp(-1 / (VOICE_TIME * sampleRate));
  }

  /** Cars with a voice of their own after the last update. */
  get audibleCount(): number {
    let n = 0;
    for (const v of this.voices) if (v.targetGain > 0) n++;
    return n;
  }

  /** Level of the summed distant-field voice after the last update. */
  get fieldLevel(): number {
    return this.field.targetGain;
  }

  /** Apply a scene, as a struct or packed. Any field may be invalid; none can break the DSP. */
  set(scene: Readonly<AudioScene> | ArrayLike<number>): void {
    const p = this.packed;
    if ('cars' in scene) packScene(scene, p);
    else for (let i = 0; i < SCENE_LENGTH; i++) p[i] = (scene[i] as number) ?? NaN;
    // Clamp every field to its range; non-finite values take the field's fallback. Written as
    // one loop over typed arrays: a helper returning a double, called this often from a long
    // function, would not be inlined and would box every result on the audio thread.
    const low = LOW;
    const high = HIGH;
    const fallback = FALLBACK;
    for (let i = 0; i < SCENE_LENGTH; i++) {
      const x = p[i] as number;
      p[i] =
        x - x === 0
          ? Math.max(low[i] as number, Math.min(high[i] as number, x))
          : (fallback[i] as number);
    }
    const count = (p[0] as number) | 0;

    // Positions first: every slot gets its distance, absent or invalid slots none.
    for (let i = 0; i < OTHER_CAR_CAPACITY; i++) {
      const v = this.voices[i] as OpponentVoice;
      v.silence();
      if (i >= count) continue;
      const o = HEADER + i * PER_CAR;
      const x = p[o] as number;
      const z = p[o + 1] as number;
      if (x - x !== 0 || z - z !== 0) continue;
      v.distance = Math.sqrt(x * x + z * z);
    }
    // The nearest `AUDIBLE_CARS` within the cull distance get a voice.
    this.picked.fill(0);
    const voices = (p[5] as number) | 0;
    for (let n = 0; n < voices; n++) {
      let best = -1;
      let bestDistance = CULL_DISTANCE;
      for (let i = 0; i < count; i++) {
        const d = (this.voices[i] as OpponentVoice).distance;
        if (!this.picked[i] && d < bestDistance) {
          best = i;
          bestDistance = d;
        }
      }
      if (best < 0) break;
      this.picked[best] = 1;
    }
    // Aim the picked voices; sum the rest within the field distance by power. Imported
    // constants are copied to locals and the distance law is written out: the Node module
    // runner reads imports as properties, and a call that returns a double through one boxes it.
    const level0 = OPPONENT_LEVEL;
    const reference = REFERENCE_DISTANCE;
    let power = 0;
    let dirX = 0;
    let dirZ = 0;
    let hz = 0;
    let load = 0;
    for (let i = 0; i < count; i++) {
      const v = this.voices[i] as OpponentVoice;
      const d = v.distance;
      if (d === Infinity) continue;
      const o = HEADER + i * PER_CAR;
      const x = p[o] as number;
      const z = p[o + 1] as number;
      const engine = p[o + 4] as number;
      const throttle = p[o + 5] as number;
      // The car's level at full throttle; the voices apply throttle themselves.
      const g = (level0 * reference) / Math.max(reference, d);
      // Power the far field carries for this car: all of it for a car without a voice (fading
      // out towards the field distance), the share its voice gives up while crossfading.
      let w: number;
      if (this.picked[i]) {
        const fade = Math.min(1, Math.max(0, (CULL_DISTANCE - d) / CROSSFADE));
        v.targetGain = g * fade;
        v.aim(p, o);
        w = g * g * (1 - fade * fade);
      } else {
        const out = Math.min(1, Math.max(0, (FIELD_DISTANCE - d) / FIELD_FADE));
        w = g * g * out * out;
      }
      if (w > 0) {
        const r = Math.max(1, d);
        power += w;
        dirX += (w * x) / r;
        dirZ += (w * z) / r;
        hz += w * engine;
        load += w * throttle;
      }
    }
    if (power > 0) {
      const level = Math.sqrt(power);
      // Place the field where one car of that level would be, so air absorption matches.
      const at = Math.max(30, (reference * level0) / level);
      const norm = Math.sqrt(dirX * dirX + dirZ * dirZ) || 1;
      const fx = norm > 1e-12 ? dirX / norm : 1;
      const fz = norm > 1e-12 ? dirZ / norm : 0;
      const f = this.fieldCar;
      f[0] = fx * at;
      f[1] = fz * at;
      f[4] = hz / power;
      f[5] = load / power;
      this.field.targetGain = level;
      this.field.aim(f, 0);
    } else this.field.silence();

    const kind = AMBIENCE_KINDS[(p[1] as number) | 0];
    this.ambience.set(kind ?? 'none', p, 2);

    const lights = Math.round(p[4] as number);
    if (lights !== this.lights) {
      if (lights >= 1 && lights <= 5 && lights > this.lights) this.cues.play('light');
      if (lights === 6 && this.lights >= 0) {
        this.cues.play('go');
        this.ambience.cheerNow();
      }
      this.lights = lights;
    }
  }

  cue(cue: AudioCue): void {
    this.cues.play(cue);
  }

  /** Add `n` samples (never crossing a 32-frame chunk boundary) into the three buses. */
  render(
    engineL: Float64Array,
    engineR: Float64Array,
    ambL: Float64Array,
    ambR: Float64Array,
    uiL: Float64Array,
    uiR: Float64Array,
    n: number,
  ): void {
    const aligned = this.clock % CHUNK === 0;
    const k = this.k;
    for (let i = 0; i < OTHER_CAR_CAPACITY; i++) {
      const v = this.voices[i] as OpponentVoice;
      if (aligned) v.wake();
      v.render(engineL, engineR, n, k);
    }
    if (aligned) this.field.wake();
    this.field.render(engineL, engineR, n, k);
    this.ambience.render(ambL, ambR, n);
    this.cues.render(uiL, uiR, n);
    this.clock += n;
  }
}
