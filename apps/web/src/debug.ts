/**
 * The debug and automation API on `window.__undercut`, installed only with `?debug=1` in the
 * URL or in a test build (`vite build --mode test`). Browser tests and the screenshot tool
 * drive the game through it instead of timing key presses.
 *
 *   await __undercut.start()                 // launch screen -> Time Trial at Monza
 *   __undercut.state()                       // screen, phase, lap, timing, s/d, camera
 *   __undercut.telemetry()                   // CarTelemetry (SI units)
 *   __undercut.teleport(s, d?, kmh?)         // place the car on the lap; timing restarts
 *   __undercut.setTimeScale(k)               // 0..8; 1 is real time
 *   __undercut.drive({ throttle: 1 })        // hold a scripted ControlInput; drive(null) ends it
 *   __undercut.autopilot(true)               // keyboard-only autopilot through the input layer
 *   __undercut.camera('cockpit')             // set the camera; camera() reads it
 *   __undercut.pause() / resume() / restartLap() / resetToTrack()
 *   __undercut.capture()                     // state + telemetry + HUD text + recent events
 *   __undercut.frameTimes() / resetFrameTimes()
 */
import type { CameraName } from '@undercut/render';
import type { ControlInput } from '@undercut/sim';
import type { DriveHandle } from './drive';

export interface DebugApi {
  start(): Promise<void>;
  state(): Record<string, unknown>;
  telemetry(): Record<string, unknown>;
  teleport(s: number, d?: number, kmh?: number): void;
  setTimeScale(scale: number): void;
  drive(control: Partial<ControlInput> | null): void;
  autopilot(on: boolean): void;
  camera(name?: CameraName): string;
  pause(): void;
  resume(): void;
  restartLap(): void;
  resetToTrack(): void;
  capture(): Record<string, unknown>;
  frameTimes(): number[];
  resetFrameTimes(): void;
  renderStats(): Record<string, unknown>;
  /** The page renderer's live geometries, textures and programs (works between sessions). */
  rendererInfo(): Record<string, number>;
  /** Start-up phase times of the current session, ms. */
  loadTimes(): Record<string, number>;
  /** Audio engine status ('none' before the first gesture creates it). */
  audioStatus(): string;
  /** What the steering-wheel display last drew (cockpit camera), or null. */
  dashboard(): { gear: string; speed: string; revs: number } | null;
  /** The player's car's projected bounding box, CSS px. */
  carScreenRect(): { left: number; top: number; right: number; bottom: number };
  /** The RaceView itself, for render experiments from tools. */
  view(): unknown;
  quit(): void;
}

declare global {
  interface Window {
    __undercut?: DebugApi;
  }
}

export function debugEnabled(): boolean {
  if (import.meta.env.MODE === 'test') return true;
  return new URLSearchParams(window.location.search).get('debug') === '1';
}

export function installDebugApi(
  getDrive: () => DriveHandle | null,
  start: () => Promise<DriveHandle>,
  rendererInfo: () => Record<string, number>,
  audioStatus: () => string,
): void {
  const need = (): DriveHandle => {
    const d = getDrive();
    if (!d) throw new Error('No session: call start() first');
    return d;
  };
  const plain = (v: unknown): unknown =>
    v instanceof Float64Array || v instanceof Float32Array ? Array.from(v) : v;
  const telemetry = (): Record<string, unknown> => {
    const t = need().telemetry() as unknown as Record<string, unknown>;
    return Object.fromEntries(Object.entries(t).map(([k, v]) => [k, plain(v)]));
  };
  const state = (): Record<string, unknown> => {
    const d = getDrive();
    if (!d) return { screen: 'launch' };
    const s = d.session;
    const timer = s.timer;
    return {
      screen: 'drive',
      phase: s.phase,
      paused: d.loop.paused,
      tick: s.world.tick,
      time: s.world.time,
      timeScale: d.loop.timeScale,
      s: s.s,
      d: s.d,
      surface: s.surfaceUnderCar(),
      wheelsOff: s.wheelsOff,
      drsAvailable: s.drsAvailable,
      camera: d.view.cameraName,
      device: s.device,
      assists: { ...s.assists },
      lap: timer.lap,
      running: timer.running,
      valid: timer.valid,
      sector: timer.sector,
      lapTime: timer.currentLapTime(s.world.time),
      sectors: [...timer.currentSectors],
      lastLap: timer.lastLap,
      bestLap: timer.bestLap,
      record: timer.record.lap,
      ghost: s.ghost !== null,
    };
  };
  window.__undercut = {
    start: async () => {
      if (!getDrive()) await start();
    },
    state,
    telemetry,
    teleport: (s, d = 0, kmh = 0) => need().teleport(s, d, kmh / 3.6),
    setTimeScale: (scale) => {
      need().loop.timeScale = scale;
    },
    drive: (control) => need().drive(control),
    autopilot: (on) => need().autopilot(on),
    camera: (name) => {
      const d = need();
      if (name) d.setCamera(name);
      return d.view.cameraName;
    },
    pause: () => need().pause(),
    resume: () => need().resume(),
    restartLap: () => need().restartLap(),
    resetToTrack: () => need().resetToTrack(),
    capture: () => ({
      state: state(),
      telemetry: getDrive() ? telemetry() : null,
      hud: getDrive()?.hudText() ?? null,
      events: getDrive()?.events().slice(-30) ?? [],
    }),
    frameTimes: () => need().frameTimes(),
    resetFrameTimes: () => need().resetFrameTimes(),
    view: () => need().view,
    carScreenRect: () => need().view.carScreenRect(),
    dashboard: () => need().view.dashboard,
    rendererInfo,
    loadTimes: () => need().loadTimes(),
    audioStatus,
    renderStats: () => ({ ...need().view.stats(), quality: need().view.quality.name }),
    quit: () => need().quit(),
  };
}
