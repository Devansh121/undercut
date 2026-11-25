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
        lapTimeSec: number;
        start: { lightsOutAt: number } | null;
        lightsOutLocalEpoch: number | null;
        clockErrorMs: number | null;
        remote: unknown[];
        claims: unknown[];
        timing: { status: string }[];
      } | null;
    };
    onlineSettings(patch: Record<string, unknown>): boolean;
    start(): Promise<void>;
    startQuickRace(
      laps?: number,
      options?: {
        gridPosition?: number;
        skillSpread?: number;
        fieldStartDelay?: number;
        circuit?: string;
      },
    ): Promise<void>;
    state(): Record<string, unknown>;
    telemetry(): Record<string, unknown>;
    teleport(s: number, d?: number, kmh?: number): void;
    /** World point at lap (s, d) and the track edges and kerbs there (debug.ts `trackPoint`). */
    trackPoint(
      s: number,
      d?: number,
      h?: number,
    ): {
      x: number;
      y: number;
      z: number;
      left: number;
      right: number;
      kerbLeft: boolean;
      kerbRight: boolean;
    };
    setTimeScale(scale: number): void;
    drive(control: Record<string, number | boolean> | null): void;
    autopilot(on: boolean): void;
    raceDriver(on: boolean): void;
    /** The keyboard autopilot as a clumsy player, mistakes seeded. */
    clumsyPilot(seed: number): void;
    camera(name?: string): string;
    drivingLine(mode?: 'off' | 'braking' | 'full'): {
      mode: 'off' | 'braking' | 'full';
      visible: boolean;
      throttleCount: number;
      liftCount: number;
      brakeCount: number;
      firstBrakeDistance: number | null;
    };
    /** The real "new version" bar (pwa/register.ts); false removes it. */
    updateBar(show: boolean): void;
    pause(): void;
    resume(): void;
    restartLap(): void;
    resetToTrack(): void;
    capture(): Record<string, unknown>;
    frameTimes(): number[];
    /** Download what a session here would on a preset (its whole world), then release it. */
    prefetch(quality: string): Promise<void>;
    quit(): void;
    resetForTest(): void;
    loadTimes(): Record<string, number>;
    audioCapability(): { supported: boolean; fallback: string | null };
    /** Audio engine status, or 'none' before it is created. */
    audioStatus(): string;
    /** The worklet's processing-time report (with `&audioProfile=1`), or null. */
    audioProfile(): Record<string, number | string> | null;
    /** What the steering-wheel display last drew, or null before the cockpit was shown. */
    dashboard(): { gear: string; speed: string; revs: number; unit: string } | null;

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
    /** Counts of placed circuit-dressing objects and props. */
    worldCounts(): Record<string, number> | null;
    /** Control the 5 red start-gantry lights (bits 0..4) and green light (bit 5). */
    setStartLights(mask: number): void;
    treeSwap(distance?: number): number;
  }

  interface Window {
    __undercut?: UndercutDebugApi;
  }
}
