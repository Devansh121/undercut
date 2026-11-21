import type { AudioCarState } from '@undercut/audio';
import { createAudioEngine, type AudioEngine } from '@undercut/audio/web';
import type { StoragePort } from '@undercut/input';
import type { CarAudioSink } from './game/audio-seam';
import { AudioSettingsStore, type AudioSettingKey } from './game/audio-settings';

/**
 * The page's engine audio: one engine for the page's lifetime, created on the first user
 * gesture (browsers keep audio blocked until then) and resumed or suspended as sessions start,
 * pause and end. Bus volumes are saved with the other settings.
 */
export class PageAudio {
  private engine: AudioEngine | null = null;
  private gestured = false;
  private active = false;
  readonly settings: AudioSettingsStore;

  constructor(storage: StoragePort, win: Window = window) {
    this.settings = new AudioSettingsStore(storage);
    void this.settings.load().then(() => this.applyVolumes());
    // The first key, click or touch anywhere counts as the gesture that unlocks audio.
    const onGesture = (): void => this.gesture();
    for (const type of ['pointerdown', 'keydown', 'touchstart'] as const) {
      win.addEventListener(type, onGesture, { capture: true, passive: true });
    }
  }

  /** Engine status, or 'none' before the engine exists. */
  get status(): string {
    return this.engine?.status ?? 'none';
  }

  /** A user gesture happened (also called by the Start button). */
  gesture(): void {
    this.gestured = true;
    if (this.active) this.play();
  }

  /** A session is driving (true) or paused or gone (false). */
  setActive(active: boolean): void {
    this.active = active;
    if (active) {
      if (this.gestured) this.play();
    } else {
      void this.engine?.suspend();
    }
  }

  /** The sink the drive screen publishes the player's car to. */
  readonly sink: CarAudioSink = (state: Readonly<AudioCarState>) => {
    this.engine?.setCarState(state as AudioCarState);
  };

  get volumes(): Readonly<Record<AudioSettingKey, number>> {
    return this.settings.current;
  }

  setVolume(key: AudioSettingKey, value: number): void {
    void this.settings.set(key, value).then(() => this.applyVolumes());
    this.engine?.setVolume(key, this.settings.current[key]);
  }

  private play(): void {
    // Created inside the gesture's call stack, so the AudioContext may start.
    this.engine ??= createAudioEngine();
    this.applyVolumes();
    void this.engine.resume();
  }

  private applyVolumes(): void {
    const v = this.settings.current;
    if (!this.engine) return;
    this.engine.setVolume('master', v.master);
    this.engine.setVolume('engine', v.engine);
    this.engine.setVolume('effects', v.effects);
  }
}
