import { PathFollower, type Driver } from '@undercut/ai';
import { NEUTRAL_INPUT, type CarParams, type CarTelemetry, type ControlInput } from '@undercut/sim';
import type { Track } from '@undercut/track';
import type { CircuitInfo } from '../circuit';
import type { RaceControl } from '../control';
import type { CarFacts } from '../facts';
import { pitInPath, pitOutPath } from './pit-paths';

/**
 * What a car's driver may read each tick: its own telemetry and track position, and the race
 * state a real driver gets from the lights, the flags, the pit wall and the dash. Human input
 * and AI drivers sit behind the same `CarController`; the session does not care which.
 *
 * The AI driver interface, for the rules: before lights out it must hold the car; at lights out
 * it may go after its reaction time; when asked in (`pitRequested`) it must take the pit lane,
 * keep to the limit between the lines, stop in its box (`pitBox`) and wait while held; it must
 * read the blue flag and let the faster car by.
 */
export interface ControlContext {
  readonly car: number;
  /** Sim time at the start of this tick, and the step, s. */
  readonly time: number;
  readonly dt: number;
  readonly telemetry: CarTelemetry;
  /** Rules facts from the end of the last tick (track position, pit lane). */
  readonly facts: CarFacts;
  readonly control: RaceControl;
  readonly track: Track;
  readonly circuit: CircuitInfo;
}

export interface CarController {
  readonly kind: 'human' | 'ai';
  /** The session engages the pit limiter for this car in the pit lane. */
  readonly autoLimiter: boolean;
  control(ctx: ControlContext, out: ControlInput): void;
  /** Forget carried state (after a teleport or a restore). */
  reset(): void;
}

function hold(out: ControlInput, steer = 0): void {
  out.steer = steer;
  out.throttle = 0;
  out.brake = 1;
  out.gearShift = 0;
  out.drs = false;
  out.overtake = false;
  out.pitLimiter = false;
}

function forward(length: number, from: number, to: number): number {
  const d = (to - from) % length;
  return d < 0 ? d + length : d;
}

type PitMode = 'none' | 'in' | 'out';

/**
 * Pit-lane driving shared by the AI and the assisted pit lane: into the box when asked in,
 * stopped while held, out to the track when released.
 */
class PitLaneDriving {
  readonly follower: PathFollower;
  mode: PitMode = 'none';
  /** Metres before the pit lane leaves the lap at which the car turns for it. */
  readonly takeover: number;

  constructor(params: CarParams, takeover = 120) {
    this.follower = new PathFollower(params);
    this.takeover = takeover;
  }

  reset(): void {
    this.mode = 'none';
    this.follower.reset();
  }

  /** Writes pit-lane driving into `out` and returns true while the pit lane has the car. */
  drive(ctx: ControlContext, out: ControlInput): boolean {
    const c = ctx.control;
    const i = ctx.car;
    const f = ctx.facts;
    const phase = c.pitPhase(i);
    const L = ctx.circuit.length;
    if (c.held(i)) {
      hold(out);
      this.mode = 'none';
      return true;
    }
    if (phase === 'released' && this.mode !== 'out') {
      this.mode = 'out';
      this.follower.reset();
      this.follower.setPath(pitOutPath(ctx.track, ctx.circuit, f.pitS, f.pitD), false);
    }
    if (this.mode === 'none' && c.pitRequested(i) && phase === 'none' && !f.inPitLane) {
      const toEntry = forward(L, f.s, ctx.circuit.pit.entryS);
      if (toEntry < this.takeover) {
        const box = c.pitBox(i);
        if (box) {
          this.mode = 'in';
          this.follower.reset();
          this.follower.setPath(pitInPath(ctx.track, ctx.circuit, f.s, f.d, box), true);
        }
      }
    }
    if (this.mode === 'in' && phase === 'lane' && !c.pitRequested(i)) {
      // Missed the box (or the stop was cancelled): drive on out.
      this.mode = 'out';
      this.follower.reset();
      this.follower.setPath(pitOutPath(ctx.track, ctx.circuit, f.pitS, 0), false);
    }
    if (this.mode === 'out' && phase === 'none' && !f.inPitLane && this.follower.remaining() < 2) {
      this.mode = 'none';
    }
    if (this.mode === 'none') return false;
    this.follower.drive(ctx.telemetry, ctx.dt, out);
    out.pitLimiter = f.inPitLane && c.limiterZone(i);
    return true;
  }
}

export interface AiControllerOptions {
  driver: Driver;
  params: CarParams;
  /** Seconds after lights out before the driver moves (the session draws it from the skill and the seed). */
  reaction: number;
  /** Speed above which the launch hands over to the racing driver, m/s. */
  launchSpeed?: number;
  /** Throttle kept under a blue flag (lifting to let the faster car by). */
  blueThrottle?: number;
}

/**
 * An AI car: the racing driver (a `packages/ai` driver on its racing line) plus what the race
 * asks of it that a lap driver does not do: hold on the grid, react to lights out and launch
 * from rest with wheelspin control, obey blue flags, and drive the pit lane.
 *
 * The racing driver is ticked every step, even while another part drives, so its estimates
 * (yaw rate, the line crossing) stay current for the hand-back.
 */
export class AiController implements CarController {
  readonly kind = 'ai' as const;
  readonly autoLimiter = true;
  readonly driver: Driver;
  readonly reaction: number;
  private readonly pit: PitLaneDriving;
  private readonly launchSpeed: number;
  private readonly blueThrottle: number;
  private readonly race: ControlInput = { ...NEUTRAL_INPUT };
  private launching = true;
  private launchCap = 0.6;

  constructor(o: AiControllerOptions) {
    this.driver = o.driver;
    this.reaction = o.reaction;
    this.pit = new PitLaneDriving(o.params);
    this.launchSpeed = o.launchSpeed ?? 25;
    this.blueThrottle = o.blueThrottle ?? 0.85;
  }

  reset(): void {
    this.driver.reset();
    this.pit.reset();
  }

  control(ctx: ControlContext, out: ControlInput): void {
    const c = ctx.control;
    const i = ctx.car;
    const tel = ctx.telemetry;
    this.driver.drive(tel, ctx.dt, this.race);
    const phase = c.phase;
    const status = c.cars[i]!.status;
    if (status === 'dnf' || status === 'dsq') {
      hold(out);
      return;
    }
    if (phase === 'grid' || phase === 'lights') {
      hold(out);
      return;
    }
    const out0 = c.lightsOutAt;
    if (out0 !== null && ctx.time < out0 + this.reaction) {
      hold(out);
      return;
    }
    if (this.pit.drive(ctx, out)) {
      this.launching = false;
      return;
    }
    Object.assign(out, this.race);
    if (this.launching && out0 !== null) {
      // Launch from rest: the racing driver's steering and gears, throttle held under the
      // grip of the driven wheels until it asks for full throttle itself at speed.
      const slip = Math.max(tel.slipRatio[2] ?? 0, tel.slipRatio[3] ?? 0);
      if (slip > 0.12) this.launchCap = Math.max(0.1, this.launchCap - 4 * ctx.dt);
      else this.launchCap = Math.min(1, this.launchCap + 1.5 * ctx.dt);
      if (tel.speed > this.launchSpeed && (this.race.throttle > 0.9 || this.race.brake > 0)) {
        this.launching = false;
      } else {
        out.throttle = this.launchCap;
        out.brake = 0;
        if (tel.gear < 1) out.gearShift = 1;
      }
    }
    if (c.blueFlag(i) >= 0) out.throttle = Math.min(out.throttle, this.blueThrottle);
  }
}

/**
 * A human car: input from the player's devices (already shaped and assisted by the caller),
 * with an optional assisted pit lane (auto-limiter and auto-steer into the box).
 */
export class InputController implements CarController {
  readonly kind = 'human' as const;
  readonly autoLimiter: boolean;
  private readonly source: (ctx: ControlContext, out: ControlInput) => void;
  private readonly pit: PitLaneDriving | null;

  constructor(
    source: (ctx: ControlContext, out: ControlInput) => void,
    o: { params?: CarParams; assistedPitLane?: boolean; autoLimiter?: boolean } = {},
  ) {
    this.source = source;
    this.pit = o.assistedPitLane && o.params ? new PitLaneDriving(o.params) : null;
    this.autoLimiter = o.autoLimiter ?? o.assistedPitLane ?? false;
  }

  reset(): void {
    this.pit?.reset();
  }

  control(ctx: ControlContext, out: ControlInput): void {
    if (this.pit?.drive(ctx, out)) return;
    this.source(ctx, out);
  }
}
