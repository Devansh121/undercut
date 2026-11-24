import type { AudioCue, AudioScene, AudioView, AudioCarState } from '@undercut/audio';
import { createAudioEngine, type AudioEngine } from '@undercut/audio/web';
import type { StoragePort } from '@undercut/input';
import type { CarAudioSink } from './game/audio-seam';
import { AudioSettingsStore, type AudioSettingKey } from './game/audio-settings';

/** What counts as a menu control for the menu sounds. */
const CONTROL = 'button, [role="button"], input, select, [data-nav]';
/** Controls that go back: the kit's Back buttons carry `data-action="back"` (or `…-back`). */
const BACK = '[data-action="back"], [data-action$="-back"]';

/** The menu control an event happened on, or null. */
function control(target: EventTarget | null): Element | null {
  return typeof Element === 'function' && target instanceof Element
    ? target.closest(CONTROL)
    : null;
}

/** The cue for a focus or click on a menu control: none for a disabled one or no control. */
export function menuCue(
  type: 'focusin' | 'click',
  target: Pick<Element, 'matches'> | null,
): AudioCue | null {
  if (!target || target.matches(':disabled, [aria-disabled="true"]')) return null;
  if (type === 'focusin') return 'focus';
  return target.matches(BACK) ? 'back' : 'accept';
}

/** How long the context keeps running after a menu sound before it is suspended again, ms. */
const MENU_LINGER = 800;

/**
 * The page's engine audio: one engine for the page's lifetime, created on the first user
 * gesture (browsers keep audio blocked until then) and resumed or suspended as sessions start,
 * pause and end. Bus volumes are saved with the other settings.
 */
export class PageAudio {
  private engine: AudioEngine | null = null;
  private gestured = false;
  private active = false;
  private fallback: string | null = null;
  private pointerAt = -Infinity;
  /** `?debug=1&audioProfile=1`: the worklet measures its own processing time. */
  private readonly profiling: boolean;
  private profileReport: Readonly<Record<string, unknown>> | null = null;
  private menuTimer: ReturnType<typeof setTimeout> | null = null;
  readonly settings: AudioSettingsStore;

  constructor(storage: StoragePort, win: Window = window) {
    this.settings = new AudioSettingsStore(storage);
    const query = new URLSearchParams(win.location.search);
    this.profiling = query.get('debug') === '1' && query.get('audioProfile') === '1';
    void this.settings.load().then(() => this.applyVolumes());
    // The first key, click or touch anywhere counts as the gesture that unlocks audio.
    const onGesture = (): void => this.gesture();
    // Menu sounds: a tick when a control takes focus (not when a pointer press focuses it), and
    // accept or back when one is pressed.
    win.addEventListener('pointerdown', () => (this.pointerAt = win.performance.now()), {
      capture: true,
      passive: true,
    });
    win.addEventListener('focusin', (event) => {
      if (win.performance.now() - this.pointerAt < 250) return;
      const cue = menuCue('focusin', control(event.target));
      if (cue) this.uiCue(cue);
    });
    win.addEventListener('click', (event) => {
      const cue = menuCue('click', control(event.target));
      if (cue) {
        this.gesture();
        this.uiCue(cue);
      }
    });
    // Browsers grant the activation that may start audio on different events: a touch counts
    // on its release (pointerup, touchend), not on touchstart, in Chromium and in iOS Safari.
    // The touch controls cancel the touch's click, so the release events are the ones that
    // reach here while driving.
    for (const type of [
      'pointerdown',
      'pointerup',
      'touchstart',
      'touchend',
      'keydown',
      'mousedown',
    ] as const) {
      win.addEventListener(type, onGesture, { capture: true, passive: true });
    }
  }

  /**
   * Whether this browser can run the audio worklet at all. AudioWorklet exists only in secure
   * contexts (HTTPS or localhost); elsewhere the engine falls back to silent.
   */
  static get supported(): boolean {
    return typeof AudioWorkletNode === 'function' && typeof AudioContext === 'function';
  }

  /** Why the engine went silent, or null. */
  get fallbackReason(): string | null {
    return this.fallback;
  }

  /** The worklet's latest processing-time report (`?debug=1&audioProfile=1` only), or null. */
  get profile(): Readonly<Record<string, unknown>> | null {
    return this.profileReport;
  }

  /** Engine status, or 'none' before the engine exists. */
  get status(): string {
    return this.engine?.status ?? 'none';
  }

  /**
   * A user gesture happened. Runs inside the gesture's event handler, so it may start the audio
   * context: iOS Safari keeps a context stopped unless it is resumed there, and stops it again
   * after an interruption (a call, Siri, the app in the background).
   */
  gesture(): void {
    this.gestured = true;
    if (this.active) this.play();
    this.engine?.unlock();
  }

  /**
   * The Start press: the last gesture before a session that loads for a few seconds and then
   * asks for sound outside any gesture. Create the engine and unlock its context now, silent
   * until the session starts, so iOS Safari lets it play then.
   */
  prime(): void {
    this.gestured = true;
    this.create().unlock();
    if (this.active) this.play();
  }

  /** A session is driving (true) or paused or gone (false). */
  setActive(active: boolean): void {
    this.active = active;
    if (this.menuTimer !== null) clearTimeout(this.menuTimer);
    this.menuTimer = null;
    if (active) {
      if (this.gestured) this.play();
    } else {
      // Close the car and circuit buses while fading out, so a later menu cue starts from them
      // closed (the core also snaps gains on the way back in).
      this.applyVolumes();
      void this.engine?.suspend();
    }
  }

  /** The sink the drive screen publishes the player's car to. */
  readonly sink: CarAudioSink = (
    state: Readonly<AudioCarState>,
    _paused: boolean,
    view?: AudioView,
    scene?: AudioScene,
  ) => {
    if (_paused) return;
    if (scene) this.engine?.setScene(scene);
    if (view) this.engine?.setView(view);
    this.engine?.setCarState(state as AudioCarState);
  };

  /**
   * Play a menu cue, once the engine exists (the first session start creates it). A menu press
   * never creates the engine itself: that would start an AudioContext and fetch the worklet in
   * the same click as whatever the press does, such as reloading into a new build (the offline
   * worker's handover then stalled the reload in CI). Outside a driving session the context runs
   * just long enough for the cue, with only the UI bus open.
   */
  uiCue(cue: AudioCue): void {
    const engine = this.engine;
    if (!this.gestured || !engine) return;
    if (!this.active) {
      this.applyVolumes(); // the car and circuit buses at 0 outside a session
      void engine.resume();
      if (this.menuTimer !== null) clearTimeout(this.menuTimer);
      this.menuTimer = setTimeout(() => {
        this.menuTimer = null;
        if (!this.active) void this.engine?.suspend();
      }, MENU_LINGER);
    }
    engine.cue(cue);
  }

  get volumes(): Readonly<Record<AudioSettingKey, number>> {
    return this.settings.current;
  }

  setVolume(key: AudioSettingKey, value: number): void {
    void this.settings.set(key, value).then(() => this.applyVolumes());
    this.applyVolumes();
  }

  private create(): AudioEngine {
    // A browser without the worklet is not an error: the game runs silent and the pause menu
    // says so, without a console warning.
    this.engine ??= createAudioEngine({
      onFallback: (reason) => {
        this.fallback = reason;
      },
      ...(this.profiling ? { onProfile: (report) => (this.profileReport = report) } : {}),
    });
    return this.engine;
  }

  private play(): void {
    // Created inside the gesture's call stack where there is one, so the context may start.
    const engine = this.create();
    this.applyVolumes();
    void engine.resume();
  }

  private applyVolumes(): void {
    const v = this.settings.current;
    if (!this.engine) return;
    this.engine.setVolume('master', v.master);
    this.engine.setVolume('ui', v.ui);
    // In the menus the car and circuit stay silent; their levels apply once a session drives.
    const vehicle = this.active ? 1 : 0;
    this.engine.setVolume('engine', v.engine * vehicle);
    this.engine.setVolume('effects', v.effects * vehicle);
    this.engine.setVolume('ambience', v.ambience * vehicle);
  }
}
