import { SINE_MASK, SINE_STEPS, SINE_TABLE } from './sine';

/**
 * Short synthesised tones for the menus and the start lights, on the UI bus. Each cue is up to
 * two notes; each note is a sine with an optional octave partial, a 4 ms linear attack, an
 * exponential decay and a 12 ms linear release to exact zero, so no cue starts or ends with a
 * step. Two players alternate, so a new cue never cuts off the one still sounding.
 */

export type AudioCue = 'focus' | 'accept' | 'back' | 'light' | 'go';
export const AUDIO_CUES: readonly AudioCue[] = ['focus', 'accept', 'back', 'light', 'go'];

export interface CueNote {
  /** Start after the cue begins, s. */
  at: number;
  /** Fundamental, Hz. */
  hz: number;
  /** Length including the release, s. */
  length: number;
  /** Peak level, linear. */
  level: number;
  /** Level of the octave partial relative to the fundamental. */
  octave: number;
  /** Exponential decay time constant, s. */
  decay: number;
}

/**
 * The tone set. Menu cues are quiet and short: a tick for focus, a rising fifth for accept, a
 * falling fifth for back. Start lights: one 1 kHz tone per lamp and a brighter 2 kHz tone,
 * longer, at lights out.
 */
export const CUE_SET: Readonly<Record<AudioCue, readonly CueNote[]>> = {
  focus: [{ at: 0, hz: 1200, length: 0.03, level: 0.03, octave: 0, decay: 0.012 }],
  accept: [
    { at: 0, hz: 880, length: 0.07, level: 0.05, octave: 0.15, decay: 0.04 },
    { at: 0.045, hz: 1320, length: 0.1, level: 0.05, octave: 0.15, decay: 0.05 },
  ],
  back: [
    { at: 0, hz: 990, length: 0.07, level: 0.045, octave: 0.1, decay: 0.04 },
    { at: 0.045, hz: 660, length: 0.1, level: 0.045, octave: 0.1, decay: 0.05 },
  ],
  light: [{ at: 0, hz: 1000, length: 0.18, level: 0.07, octave: 0.3, decay: 0.15 }],
  go: [{ at: 0, hz: 2000, length: 0.4, level: 0.07, octave: 0.2, decay: 0.3 }],
};

const ATTACK = 0.004;
const RELEASE = 0.012;

class CuePlayer {
  notes: readonly CueNote[] = [];
  age = 0;
  end = 0;

  start(notes: readonly CueNote[], sampleRate: number): void {
    this.notes = notes;
    this.age = 0;
    let end = 0;
    for (const note of notes) end = Math.max(end, note.at + note.length);
    this.end = Math.ceil(end * sampleRate);
  }

  render(left: Float64Array, right: Float64Array, n: number, sampleRate: number): void {
    if (this.age >= this.end) return;
    const notes = this.notes;
    const table = SINE_TABLE;
    const steps = SINE_STEPS;
    const mask = SINE_MASK;
    for (let i = 0; i < n && this.age < this.end; i++) {
      const time = this.age / sampleRate;
      let v = 0;
      for (let j = 0; j < notes.length; j++) {
        const note = notes[j] as CueNote;
        const t = time - note.at;
        if (t < 0 || t >= note.length) continue;
        const env =
          Math.min(1, t / ATTACK, (note.length - t) / RELEASE) * Math.exp(-t / note.decay);
        // Fundamental and octave, read inline from the sine table (phase in turns).
        let x = note.hz * t * steps;
        let q = x | 0;
        let k = q & mask;
        const s1 =
          (table[k] as number) + (x - q) * ((table[k + 1] as number) - (table[k] as number));
        x = 2 * note.hz * t * steps;
        q = x | 0;
        k = q & mask;
        const s2 =
          (table[k] as number) + (x - q) * ((table[k + 1] as number) - (table[k] as number));
        v += note.level * env * (s1 + note.octave * s2);
      }
      left[i] = (left[i] as number) + v;
      right[i] = (right[i] as number) + v;
      this.age++;
    }
  }
}

export class Cues {
  private readonly players = [new CuePlayer(), new CuePlayer()];
  private next = 0;
  private readonly sampleRate: number = 48_000;

  constructor(sampleRate: number) {
    this.sampleRate = sampleRate;
  }

  play(cue: AudioCue): void {
    const notes = CUE_SET[cue];
    if (!notes) return;
    (this.players[this.next] as CuePlayer).start(notes, this.sampleRate);
    this.next = 1 - this.next;
  }

  /** True while any cue is sounding. */
  get active(): boolean {
    return this.players.some((p) => p.age < p.end);
  }

  render(left: Float64Array, right: Float64Array, n: number): void {
    (this.players[0] as CuePlayer).render(left, right, n, this.sampleRate);
    (this.players[1] as CuePlayer).render(left, right, n, this.sampleRate);
  }
}
