import { FixedStepAccumulator } from '@undercut/core';
import type { DeviceKind } from '@undercut/input';
import type { ControlInput } from '@undercut/sim';
import type { DriveSession, SessionEvent } from './session';

/** One sim tick of driver demand, as the input layer (or a script) produces it. */
export interface DriverFrame {
  readonly control: ControlInput;
  device: DeviceKind;
  lookBack: boolean;
  events: readonly ({ type: 'action'; action: string } | { type: string })[];
}

/**
 * Where driver demand comes from, sampled exactly once per sim tick: the input layer for a
 * player, a fixed script or an autopilot for tests and tools.
 */
export interface ControlSource {
  sample(dt: number, speed: number): DriverFrame;
}

export interface FrameResult {
  /** Sim steps taken this frame. */
  steps: number;
  events: SessionEvent[];
  /** One-shot actions the loop did not handle itself (camera, menu navigation). */
  actions: string[];
  lookBack: boolean;
  /**
   * Hardest barrier impact of any step this frame, m/s (normal speed). The sim resets it every
   * step, so reading telemetry once per frame would miss most impacts.
   */
  wallImpact: number;
}

/** Longest real frame time accepted before the sim stops catching up (a stall). */
export const STALL_CLAMP = 0.25;
/** Largest time scale the debug API may set. */
export const MAX_TIME_SCALE = 8;

/**
 * The game loop without the browser: fixed-step sim through the accumulator, input sampled
 * once per tick, pause that freezes the sim, the clock and the interpolation factor, and a
 * stall clamp. The app calls `frame` from requestAnimationFrame with real elapsed seconds.
 */
export class GameLoop {
  readonly session: DriveSession;
  private source: ControlSource;
  private readonly clock: FixedStepAccumulator;
  private scale = 1;
  private frozenAlpha = 0;
  private lookBackValue = false;

  constructor(session: DriveSession, source: ControlSource) {
    this.session = session;
    this.source = source;
    this.clock = new FixedStepAccumulator({
      step: session.world.step,
      maxFrameTime: STALL_CLAMP * MAX_TIME_SCALE,
    });
  }

  /** Swap the driver (player, script, autopilot) from the next tick. */
  setSource(source: ControlSource): void {
    this.source = source;
  }

  get timeScale(): number {
    return this.scale;
  }

  set timeScale(value: number) {
    this.scale = Number.isFinite(value) ? Math.min(MAX_TIME_SCALE, Math.max(0, value)) : 1;
  }

  get paused(): boolean {
    return this.session.phase === 'paused';
  }

  /** Render interpolation factor between the last two sim states. */
  get alpha(): number {
    return this.session.phase === 'running' ? this.clock.alpha : this.frozenAlpha;
  }

  /** Interpolated sim time for rendering. */
  get renderTime(): number {
    const w = this.session.world;
    return Math.max(0, w.time - w.step) + this.alpha * w.step;
  }

  get lookBack(): boolean {
    return this.lookBackValue;
  }

  start(): boolean {
    this.clock.reset();
    return this.session.start();
  }

  pause(): boolean {
    const alpha = this.clock.alpha;
    if (!this.session.pause()) return false;
    this.frozenAlpha = alpha;
    this.lookBackValue = false;
    return true;
  }

  resume(): boolean {
    if (!this.session.resume()) return false;
    // Pick up where the frame left off: no time passes while paused.
    return true;
  }

  quit(): void {
    this.session.end();
  }

  restartLap(): SessionEvent[] {
    const events = this.session.restartLap();
    this.clock.reset();
    return events;
  }

  resetToTrack(): SessionEvent[] {
    const events = this.session.resetToTrack();
    this.clock.reset();
    return events;
  }

  frame(elapsed: number): FrameResult {
    const result: FrameResult = {
      steps: 0,
      events: [],
      actions: [],
      lookBack: this.lookBackValue,
      wallImpact: 0,
    };
    if (this.session.phase !== 'running') return result;
    const real = Number.isFinite(elapsed) && elapsed > 0 ? Math.min(elapsed, STALL_CLAMP) : 0;
    const steps = this.clock.advance(real * this.scale);
    const session = this.session;
    const dt = session.world.step;
    for (let i = 0; i < steps; i++) {
      const frame = this.source.sample(dt, session.car.state.vx);
      this.lookBackValue = frame.lookBack;
      let stop = false;
      for (const event of frame.events) {
        if (event.type !== 'action' || !('action' in event)) continue;
        if (event.action === 'pause') stop = true;
        else if (event.action === 'resetToTrack')
          result.events.push(...this.session.resetToTrack());
        else result.actions.push(event.action);
      }
      result.events.push(...session.tick(frame.control, frame.device));
      result.steps++;
      const impact = Math.max(
        session.car.state.wallImpactSpeed,
        session.car.state.breakableImpactSpeed,
      );
      if (impact > result.wallImpact) result.wallImpact = impact;
      if (stop) {
        this.pause();
        break;
      }
    }
    result.lookBack = this.lookBackValue;
    return result;
  }
}
