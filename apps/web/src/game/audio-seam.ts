/**
 * The seam for engine and tyre audio. `packages/audio` was not on master when M1 drive was
 * built, so the drive screen publishes this state every frame to a sink that does nothing yet.
 * Wiring the audio engine is: implement `CarAudioSink`, resume its AudioContext on the first
 * gesture, and pass it as `onCarAudioState` (pause and tab-hide arrive as `paused: true`).
 */
export interface CarAudioState {
  /** Engine speed, rpm. */
  rpm: number;
  /** Throttle as applied, 0–1 (engine load follows it). */
  throttle: number;
  gear: number;
  shifting: boolean;
  /** Forward speed, m/s. */
  speed: number;
  /** MGU-K power, W: positive deploying (whine), negative harvesting. */
  mgukPower: number;
  /** Largest tyre slip ratio and slip angle magnitude across the four tyres (scrub). */
  slipRatio: number;
  slipAngle: number;
  /** Surface under the car (SurfaceKind) for kerb and gravel noise. */
  surface: number;
  /** The session is paused or the tab is hidden: audio should suspend. */
  paused: boolean;
}

export type CarAudioSink = (state: Readonly<CarAudioState>) => void;

/** The default sink until the audio engine lands. */
export const silentAudio: CarAudioSink = () => {};
