/** Browser audio: `createAudioEngine()` with the bundled worklet. */
import type { AudioEngine, AudioEngineOptions } from './engine';
import { createAudioEngine as create } from './engine';
import { WORKLET_URL } from './worklet-url';

export type { AudioEngine, AudioEngineOptions, AudioEngineStatus } from './engine';
export { SilentAudioEngine } from './engine';

/**
 * The game's audio engine. Never throws: without Web Audio or AudioWorklet support it
 * returns a silent engine and the game runs without sound.
 */
export function createAudioEngine(options: Partial<AudioEngineOptions> = {}): AudioEngine {
  return create({ workletUrl: WORKLET_URL, ...options });
}
