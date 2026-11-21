import type { AudioView } from '../dsp/view';
import type { GainId } from '../dsp/voice';

/** Name the processor registers under. */
export const PROCESSOR_NAME = 'undercut-car-audio';

/** Main thread → audio thread. */
export type ToProcessor =
  | { type: 'state'; packed: Float64Array }
  | { type: 'gain'; id: GainId; value: number }
  | { type: 'pause'; paused: boolean }
  | { type: 'view'; view: AudioView };

/** Options passed to the processor at construction. */
export interface ProcessorOptions {
  seed: number;
  /** Start silent (paused) until a `{ type: 'pause', paused: false }` message. */
  startPaused?: boolean;
}
