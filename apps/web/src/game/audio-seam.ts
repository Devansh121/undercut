import type { AudioScene, AudioView, AudioCarState } from '@undercut/audio';

/**
 * The seam between the drive screen and engine audio. Every frame the drive screen maps the
 * player's car to an `AudioCarState` (`toAudioCarState`) and hands it to the sink with whether
 * the session is paused (pause and tab-hide suspend sound). The page wires the sink to the
 * audio engine (`apps/web/src/audio.ts`); without one the game is silent.
 */
export type CarAudioSink = (
  state: Readonly<AudioCarState>,
  paused: boolean,
  view?: AudioView,
  scene?: AudioScene,
) => void;

/** The default sink: no sound. */
export const silentAudio: CarAudioSink = () => {};
