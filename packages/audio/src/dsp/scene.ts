import { Ambience, AMBIENCE_KINDS, type AmbienceKind } from './ambience';
import { CHUNK } from './controls';
import { Cues, type AudioCue } from './cues';
import { distanceGain, OpponentVoice, OPPONENT_LEVEL, REFERENCE_DISTANCE } from './opponent-voice';

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
}

export type { AudioCue, AmbienceKind };
export const OTHER_CAR_CAPACITY = 19;
/** Voices rendered individually: the nearest cars within `CULL_DISTANCE`. */
export const AUDIBLE_CARS = 6;
/** Beyond this, a car has no voice of its own; its level fades out over the last 80 m. */
export const CULL_DISTANCE = 300;
/** Cars without a voice but nearer than this are summed into one distant-field voice. */
export const FIELD_DISTANCE = 600;

const HEADER = 5;
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

const finite = (x: number, lo: number, hi: number, fallback: number): number =>
  x - x === 0 ? Math.max(lo, Math.min(hi, x)) : fallback;

/** Smoothing for every voice parameter: 50 ms, so a 60 Hz scene never steps. */
const VOICE_TIME = 0.05;

export class SceneSound {
  private readonly voices: OpponentVoice[];
  private readonly field: OpponentVoice;
  private readonly ambience: Ambience;
  private readonly cues: Cues;
  private readonly packed = new Float64Array(SCENE_LENGTH);
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
    const count = finite(p[0] as number, 0, OTHER_CAR_CAPACITY, 0) | 0;

    // Positions first: every slot gets its distance, absent or invalid slots none.
    for (let i = 0; i < OTHER_CAR_CAPACITY; i++) {
      const v = this.voices[i] as OpponentVoice;
      v.silence();
      if (i >= count) continue;
      const o = HEADER + i * PER_CAR;
      const x = p[o] as number;
      const z = p[o + 1] as number;
      if (x - x !== 0 || z - z !== 0) continue;
      v.distance = Math.hypot(x, z);
    }
    // The nearest `AUDIBLE_CARS` within the cull distance get a voice.
    this.picked.fill(0);
    for (let n = 0; n < AUDIBLE_CARS; n++) {
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
    // Aim the picked voices; sum the rest within the field distance by power.
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
      const engine = finite(p[o + 4] as number, 0, 1571, 0); // 15 000 rpm
      const throttle = finite(p[o + 5] as number, 0, 1, 0);
      if (this.picked[i]) {
        const fade = Math.min(1, Math.max(0, (CULL_DISTANCE - d) / 80));
        v.aim(
          x,
          z,
          finite(p[o + 2] as number, -150, 150, 0),
          finite(p[o + 3] as number, -150, 150, 0),
          engine,
          throttle,
          OPPONENT_LEVEL * distanceGain(d) * fade,
        );
        v.distance = d;
      } else if (d < FIELD_DISTANCE) {
        const g = OPPONENT_LEVEL * distanceGain(d) * (0.4 + 0.6 * throttle);
        const w = g * g;
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
      const at = Math.max(30, (REFERENCE_DISTANCE * OPPONENT_LEVEL) / level);
      const norm = Math.hypot(dirX, dirZ) || 1;
      const fx = norm > 1e-12 ? dirX / norm : 1;
      const fz = norm > 1e-12 ? dirZ / norm : 0;
      this.field.aim(fx * at, fz * at, 0, 0, hz / power, load / power, level);
    } else this.field.silence();

    const kind = AMBIENCE_KINDS[finite(p[1] as number, 0, AMBIENCE_KINDS.length - 1, 0) | 0];
    this.ambience.set(
      kind ?? 'none',
      finite(p[2] as number, 0, 2, 0),
      finite(p[3] as number, 0, 2, 0),
    );

    const lights = Math.round(finite(p[4] as number, -1, 6, -1));
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
