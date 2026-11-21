import type { OnlineState } from '../../apps/web/src/online/session';

declare global {
  /** The debug API the drive tests use (apps/web/src/debug.ts), typed loosely for tests. */
  interface UndercutDebugApi {
    online(): {
      state: OnlineState | null;
      race: {
        released: boolean;
        releasedEpoch: number | null;
        releasedSimEpoch: number | null;
        releasedServerAt: number | null;
        elapsedRaceMs: number;
        start: { lightsOutAt: number } | null;
        lightsOutLocalEpoch: number | null;
        clockErrorMs: number | null;
        remote: unknown[];
        claims: unknown[];
        timing: { status: string }[];
      } | null;
    };
    start(): Promise<void>;
    startQuickRace(
      laps?: number,
      options?: { gridPosition?: number; skillSpread?: number },
    ): Promise<void>;
    state(): Record<string, unknown>;
    telemetry(): Record<string, unknown>;
    teleport(s: number, d?: number, kmh?: number): void;
    setTimeScale(scale: number): void;
    drive(control: Record<string, number | boolean> | null): void;
    autopilot(on: boolean): void;
    camera(name?: string): string;
    pause(): void;
    resume(): void;
    restartLap(): void;
    resetToTrack(): void;
    capture(): Record<string, unknown>;
    frameTimes(): number[];
    quit(): void;
    resetForTest(): void;
    loadTimes(): Record<string, number>;
    audioCapability(): { supported: boolean; fallback: string | null };
    /** Audio engine status, or 'none' before it is created. */
    audioStatus(): string;
    /** What the steering-wheel display last drew, or null before the cockpit was shown. */
    dashboard(): { gear: string; speed: string; revs: number } | null;
    /** The player's car's projected bounding box in CSS pixels. */
    carScreenRect(): { left: number; top: number; right: number; bottom: number };
    /** The page's renderer: live geometries, textures and compiled programs. */
    rendererInfo(): Record<string, number>;
    /** Draw only the sky dome through one render path until cleared with null. */
    skyProbe(path: 'hdr' | 'direct' | null): void;
    /** Clear the recorded frame intervals. */
    resetFrameTimes(): void;
    /** The view's frame statistics: draw calls, render path, environment bakes and more. */
    renderStats(): Record<string, unknown>;
  }

  interface Window {
    __undercut?: UndercutDebugApi;
  }
}
