/** The debug API the drive tests use (apps/web/src/debug.ts), typed loosely for tests. */
interface UndercutDebugApi {
  start(): Promise<void>;
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
}

interface Window {
  __undercut?: UndercutDebugApi;
}
