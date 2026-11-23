import type { AudioCue } from '../dsp/cues';
import type { AudioView } from '../dsp/view';
import type { GainId } from '../dsp/voice';

/** Name the processor registers under. */
export const PROCESSOR_NAME = 'undercut-car-audio';

/** Main thread → audio thread. */
export type ToProcessor =
  /** A scene packed by `packScene`. */
  | { type: 'scene'; packed: Float64Array }
  | { type: 'cue'; cue: AudioCue }
  | { type: 'state'; packed: Float64Array }
  | { type: 'gain'; id: GainId; value: number }
  | { type: 'pause'; paused: boolean }
  | { type: 'view'; view: AudioView };

/** Options passed to the processor at construction. */
export interface ProcessorOptions {
  seed: number;
  /** Opt-in offline benchmark; never enabled by the game. */
  profile?: boolean;
  /** Start silent (paused) until a `{ type: 'pause', paused: false }` message. */
  startPaused?: boolean;
}
