import {
  PathFollower,
  createTrafficCar,
  createTrafficView,
  type Driver,
  type DriverMemory,
  type FollowerState,
  type TrafficView,
} from '@undercut/ai';
import {
  BODY_HALF_WIDTH,
  NEUTRAL_INPUT,
  type CarParams,
  type CarTelemetry,
  type ControlInput,
} from '@undercut/sim';
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
  /**
   * Every car's facts, this one's included (index = car number): where the others are, as a
   * driver sees them from the cockpit and the mirrors. Racing drivers read it; humans ignore it.
   */
  readonly field: readonly CarFacts[];
  /**
   * Cars the drivers do not see this tick (index = car number): retired, parked out of the
   * race as ghosts, or standing still as a ghost for holding up traffic (see `RaceSession`).
   * A blocking ghost that moves off is seen again, as traffic, before it turns solid.
   */
  readonly unseen: readonly boolean[];
}

export interface CarController {
  readonly kind: 'human' | 'ai';
  /** The session engages the pit limiter for this car in the pit lane. */
  readonly autoLimiter: boolean;
  control(ctx: ControlContext, out: ControlInput): void;
  /** Forget carried state (after a teleport). */
  reset(): void;
  /** Everything carried between ticks, as plain JSON; restoring it continues bit for bit. */
  snapshot(): ControllerState;
  restore(state: ControllerState): void;
}

/** A controller's carried state, as plain JSON. */
export interface ControllerState {
  driver?: DriverMemory;
  launching?: boolean;
  launchCap?: number;
  /** Sim time the fifth light came on (a jump start counts from it), or null. */
  fifthAt?: number | null;
  pit?: PitLaneState | null;
}

interface PitLaneState {
  mode: 'none' | 'in' | 'out';
  follower: FollowerState;
  /** Seconds stopped in the lane short of the box (bumped off the path), s. */
  still?: number;
  /** Seconds stopped on the way to the lane, s. */
  stillBefore?: number;
}

/** Half a car's length, m (5.6 m nose to tail). */
const CAR_HALF_LENGTH = 2.8;
/** Seconds after its start reaction that a car boxed in behind a stalled one stops launching, s. */
const LAUNCH_BOXED_IN = 1.5;

/** A car standing still within 30 m ahead of this one, in its lane (a car stalled on the grid). */
function stalledAhead(ctx: ControlContext): boolean {
  const me = ctx.facts;
  const L = ctx.circuit.length;
  for (let j = 0; j < ctx.field.length; j++) {
    if (j === ctx.car || ctx.unseen[j]) continue;
    const o = ctx.field[j]!;
    const ahead = forward(L, me.s, o.s);
    if (ahead > 0 && ahead < 30 && Math.abs(o.d - me.d) < 2.5 && o.speed < 1) return true;
  }
  return false;
}
/** Seconds stopped short of the box before a car gives the stop up and drives out. */
const PIT_STALL = 3;
/** How far past the track edge a car in the pit lane still counts as traffic, m. */
const PIT_SEEN = 3;

function hold(out: ControlInput, steer = 0): void {
  out.wheelBrake = undefined;
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
  private still = 0;
  private stillBefore = 0;

  /** Hand the car back as soon as it leaves the pit lane (a racing driver that can rejoin). */
  readonly handBackOnExit: boolean;

  constructor(params: CarParams, takeover = 120, handBackOnExit = false) {
    this.follower = new PathFollower(params);
    this.takeover = takeover;
    this.handBackOnExit = handBackOnExit;
  }

  reset(): void {
    this.mode = 'none';
    this.still = 0;
    this.stillBefore = 0;
    this.follower.reset();
  }

  getState(): PitLaneState {
    return {
      mode: this.mode,
      follower: this.follower.getState(),
      still: this.still,
      stillBefore: this.stillBefore,
    };
  }

  setState(s: PitLaneState): void {
    this.mode = s.mode;
    this.still = s.still ?? 0;
    this.stillBefore = s.stillBefore ?? 0;
    this.follower.setState(s.follower);
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
    // (Off the road the racing driver gets the car back on it first: the lane follower has no
    // way out of the run-off, and the car stood there until retired.)
    const onRoad =
      Math.abs(f.d) <= ctx.track.halfWidthAt(ctx.track.wrap(f.s), f.d >= 0 ? 0 : 1) + 1;
    if (this.mode === 'none' && c.pitRequested(i) && phase === 'none' && !f.inPitLane && onRoad) {
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
    // Stopped in the lane short of the box and not held (knocked off the path by another car):
    // drive on out, and come in again next lap.
    const stopped = this.mode === 'in' && phase === 'lane' && ctx.telemetry.speed < 0.5;
    // Stopped on the way to the lane (off the road, against a car): the racing driver has it
    // back and recovers; the stop is tried again on a later lap.
    const stalledBefore = this.mode === 'in' && phase === 'none' && ctx.telemetry.speed < 0.5;
    if (stalledBefore) {
      this.stillBefore += ctx.dt;
      if (this.stillBefore > PIT_STALL) {
        this.stillBefore = 0;
        this.mode = 'none';
        this.follower.reset();
        return false;
      }
    } else this.stillBefore = 0;
    this.still = stopped ? this.still + ctx.dt : 0;
    if (this.still > PIT_STALL) {
      this.still = 0;
      this.mode = 'out';
      this.follower.reset();
      this.follower.setPath(pitOutPath(ctx.track, ctx.circuit, f.pitS, f.pitD), false);
    }
    if (this.mode === 'in' && phase === 'lane' && !c.pitRequested(i)) {
      // Missed the box (or the stop was cancelled): drive on out.
      this.mode = 'out';
      this.follower.reset();
      this.follower.setPath(pitOutPath(ctx.track, ctx.circuit, f.pitS, 0), false);
    }
    // Off the pit-lane surface the car is back on the lap: the driver takes over there (a racing
    // driver rejoins off line while the traffic passes; the follower would slow it on the lap).
    if (this.mode === 'out' && phase === 'none' && !f.inPitLane && this.handBackOnExit) {
      this.mode = 'none';
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
  /**
   * A jump start: the driver goes this long after the fifth light comes on, whether or not the
   * lights are out yet (null: never; the field draws it with a small seeded chance).
   */
  jumpAfter?: number | null;
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
  readonly jumpAfter: number | null;
  private readonly traffic: TrafficView = createTrafficView(0);
  private launching = true;
  private launchCap = 0.6;
  private fifthAt: number | null = null;

  constructor(o: AiControllerOptions) {
    this.driver = o.driver;
    this.reaction = o.reaction;
    this.pit = new PitLaneDriving(o.params, 120, o.driver.sense !== undefined);
    this.launchSpeed = o.launchSpeed ?? 25;
    this.blueThrottle = o.blueThrottle ?? 0.85;
    this.jumpAfter = o.jumpAfter ?? null;
  }

  reset(): void {
    this.driver.reset();
    this.pit.reset();
  }

  snapshot(): ControllerState {
    return {
      driver: this.driver.snapshot(),
      launching: this.launching,
      launchCap: this.launchCap,
      fifthAt: this.fifthAt,
      pit: this.pit.getState(),
    };
  }

  restore(s: ControllerState): void {
    if (!s.driver || !s.pit) throw new Error('not an AI controller state');
    this.driver.restore(s.driver);
    this.launching = s.launching === true;
    this.launchCap = s.launchCap ?? this.launchCap;
    this.fifthAt = s.fifthAt ?? null;
    this.pit.setState(s.pit);
  }

  /** The cars around this one, from the field's facts, for a racing driver. */
  private sense(ctx: ControlContext): void {
    const driver = this.driver;
    if (!driver.sense) return;
    const view = this.traffic;
    const field = ctx.field;
    while (view.cars.length < field.length) view.cars.push(createTrafficCar());
    const me = ctx.facts;
    view.self.id = ctx.car;
    view.self.s = me.s;
    view.self.d = me.d;
    view.self.speed = me.speed;
    let n = 0;
    const track = ctx.track;
    for (let j = 0; j < field.length; j++) {
      const f = field[j]!;
      if (j === ctx.car) continue;
      // A ghost (a retired car parked out of the race, or a stopped car the queue behind it
      // drives through) is no traffic until it moves off again.
      if (ctx.unseen[j]) continue;
      // A car in the pit lane is seen only where the lane meets the track (entry and exit):
      // behind the pit wall it is no traffic.
      if (f.inPitLane) {
        const edge = track.halfWidthAt(track.wrap(f.s), f.d >= 0 ? 0 : 1);
        if (Math.abs(f.d) > edge + PIT_SEEN) continue;
      }
      const c = view.cars[n++]!;
      c.id = j;
      c.s = f.s;
      c.d = f.d;
      c.speed = f.speed;
      // The footprint across the track: half its width aligned, up to half its length across.
      const h = f.heading;
      c.halfWidth =
        CAR_HALF_LENGTH * Math.abs(Math.sin(h)) + BODY_HALF_WIDTH * Math.abs(Math.cos(h));
    }
    view.count = n;
    const c = ctx.control;
    view.blueBy = c.blueFlag(ctx.car);
    view.blueFlag = view.blueBy >= 0;
    const out0 = c.lightsOutAt;
    view.active =
      (c.phase === 'green' || c.phase === 'chequered') &&
      c.cars[ctx.car]!.status === 'running' &&
      !c.held(ctx.car) &&
      this.pit.mode === 'none' &&
      c.pitPhase(ctx.car) === 'none' &&
      (out0 === null || ctx.time >= out0 + this.reaction);
    view.launching = this.launching && out0 !== null;
    driver.sense(view);
  }

  control(ctx: ControlContext, out: ControlInput): void {
    const c = ctx.control;
    const i = ctx.car;
    const tel = ctx.telemetry;
    // AI drivers never set the per-wheel brake (only the player's stability assist does).
    out.wheelBrake = undefined;
    this.sense(ctx);
    this.driver.drive(tel, ctx.dt, this.race);
    const phase = c.phase;
    const status = c.cars[i]!.status;
    if (status === 'dnf' || status === 'dsq') {
      hold(out);
      return;
    }
    const out0 = c.lightsOutAt;
    let jumping = false;
    if (phase === 'grid' || phase === 'lights') {
      if (phase === 'lights' && c.lightsCount >= 5 && this.fifthAt === null) {
        this.fifthAt = ctx.time;
      }
      jumping =
        this.jumpAfter !== null &&
        this.fifthAt !== null &&
        ctx.time >= this.fifthAt + this.jumpAfter;
      if (!jumping) {
        hold(out);
        return;
      }
    } else if (out0 !== null && ctx.time < out0 + this.reaction) {
      hold(out);
      return;
    }
    if (this.pit.drive(ctx, out)) {
      this.launching = false;
      return;
    }
    Object.assign(out, this.race);
    if (this.launching && (out0 !== null || jumping)) {
      // Launch from rest: the racing driver's steering and gears, throttle held under the
      // grip of the driven wheels until it asks for full throttle itself at speed. A car ahead
      // still has the last word on the pedals.
      const slip = Math.max(tel.slipRatio[2] ?? 0, tel.slipRatio[3] ?? 0);
      if (slip > 0.12) this.launchCap = Math.max(0.1, this.launchCap - 4 * ctx.dt);
      else this.launchCap = Math.min(1, this.launchCap + 1.5 * ctx.dt);
      // Launched once at speed; or, boxed in behind a car standing still just ahead (a player
      // who stalled on the grid), soon after the lights all the same: the racing driver then
      // goes round it as round any stopped car. (Still launching, the cars behind a stalled
      // player sat on the grid behind it for good.)
      const since = out0 !== null ? ctx.time - out0 - this.reaction : 0;
      const boxedIn = out0 !== null && since > LAUNCH_BOXED_IN && stalledAhead(ctx);
      if (
        boxedIn ||
        (tel.speed > this.launchSpeed && (this.race.throttle > 0.9 || this.race.brake > 0))
      ) {
        this.launching = false;
      } else if (this.driver.following) {
        out.throttle = Math.min(this.race.throttle, this.launchCap);
        if (tel.gear < 1) out.gearShift = 1;
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

  /** The assisted pit lane's state; the player's own input carries nothing here. */
  snapshot(): ControllerState {
    return { pit: this.pit ? this.pit.getState() : null };
  }

  restore(s: ControllerState): void {
    if (this.pit && s.pit) this.pit.setState(s.pit);
  }

  control(ctx: ControlContext, out: ControlInput): void {
    // Only the player's assists set a per-wheel brake; the assisted pit lane never does.
    out.wheelBrake = undefined;
    if (this.pit?.drive(ctx, out)) return;
    this.source(ctx, out);
  }
}
