import type { RngState } from '@undercut/core';
import {
  CAR_SNAPSHOT_LENGTH,
  addCar,
  beginErsLap,
  createCarParams,
  createCarState,
  createCarTelemetry,
  createWorld,
  readCarPose,
  readCarTelemetry,
  COMPOUNDS,
  compoundIndex,
  fitTyres,
  restoreCar,
  snapshotCar,
  type CompoundId,
  stepWorld,
  type CarParams,
  type CarTelemetry,
  type ErsMode,
  type World,
  type WorldCar,
  setErsMode,
} from '@undercut/sim';
import { TrackSurface, createPathPoint, createVec3, type Track } from '@undercut/track';
import { circuitInfo, type CircuitInfo } from '../circuit';
import { RaceControl, type RaceControlSnapshot } from '../control';
import type { RaceEvent, ServiceAction } from '../events';
import { createFacts, type CarFacts } from '../facts';
import type { SessionSpec } from '../kinds';
import { TrackLimits, type WheelsOffCounter } from '../limits-geometry';
import { buildResult, type EntrantInfo, type SessionResult } from '../results';
import type { RaceRules } from '../rules';
import type { TimingBests } from '../timing/lap-timer';
import type { CarController, ControlContext, ControllerState } from './controllers';
import { wakeStrength } from './wake';

/**
 * Estimated grid condition after an unmodelled formation lap: every starting set (human and
 * AI) is 5 K inside its window. Blankets alone cool further on the run to Monza turn one
 * (seed 5: 16/20 clean); the grid warm-up represents work before the start, not extra grip.
 * Pit sets and practice/qualifying still start at the 70 °C blanket limit [17].
 */
const FORMATION_WARMTH = 5;
function formationTemperature(compound: CompoundId): number {
  return COMPOUNDS[compoundIndex(compound)]!.windowLow + FORMATION_WARMTH;
}

/** Sim step: 240 Hz (ADR 0007). */
export const RACE_STEP = 1 / 240;
/**
 * Fuel load every car runs, kg, topped up at each timing line. Fuel use and strategy arrive in
 * M4; until then every car carries a light, constant load so that the AI's plans (made at
 * qualifying fuel) hold and lap times compare fairly.
 */
export const SESSION_FUEL = 10;

export interface RaceCar {
  entrant: EntrantInfo & { compound?: string };
  controller: CarController;
  /** Car parameters; default the session's. */
  params?: CarParams;
  /** MGU-K mode selected before the start (AI: the driver's own). */
  ersMode?: ErsMode;
}

export interface RaceSessionOptions {
  track: Track;
  /** Rules view of the circuit; default `circuitInfo(track)`. */
  circuit?: CircuitInfo;
  session: SessionSpec;
  cars: readonly RaceCar[];
  seed: number;
  rules?: Partial<RaceRules>;
  /** Default car parameters (the low-drag trim). */
  params?: CarParams;
  /** Fuel load, kg, topped up at every timing line; null: no top-up. Default `SESSION_FUEL`. */
  fuel?: number | null;
  /**
   * A race's start load instead, kg: the cars carry it from the start and burn it, with no
   * top-up and no refuelling (none in the modelled era). Overrides `fuel`.
   */
  startFuel?: number;
  /**
   * Tyre temperature and wear (`@undercut/sim` tyre condition): each car starts on its
   * entrant's compound (else medium) off the blankets, and a pit stop that changes tyres fits a
   * fresh set. Off by default: grip as the reference tyre all race.
   */
  tyres?: boolean;
  step?: number;
  /** Race: grid order, car indices pole first. Default car order. */
  grid?: readonly number[];
  /** Time trial: where the rolling start is, as metres before the timing line, and its speed. */
  rollingStart?: { before: number; d?: number; speed: number };
  /** Overall bests to compare with (time trial: the record kept on this device). */
  record?: TimingBests;
  /** Track-limit counter per car (scripts in tests); default `TrackLimits`. */
  limits?: (car: number) => WheelsOffCounter;
}

export interface RaceSessionSnapshot {
  version: 3;
  control: RaceControlSnapshot;
  world: { tick: number; time: number; rng: RngState; cars: number[][] };
  /** Each car's driver (AI memory, pit-lane follower). */
  controllers: ControllerState[];
  /**
   * Search hints of every projection per car (surface sampling per wheel, the car's lap and
   * pit-lane position, the track-limit wheels): caches, kept so a restore is bit-identical.
   */
  hints: { surface: number[]; lap: number; pit: number; limits: number[] | null }[];
  /** The stopped-queue ghost state per car (absent in older snapshots: none). */
  blockers?: {
    underway: boolean[];
    still: number[];
    block: number[];
    ghost: boolean[];
    /** Has been at speed since the start (absent in older snapshots: as under way). */
    atSpeed?: boolean[];
  };
}

/**
 * A car standing still in the road with traffic held up behind it: after `BLOCK_GHOST_AFTER` of
 * a car behind it held under `HELD_SPEED`, it becomes a ghost, so the cars behind drive on
 * through it. The racing drivers go round a stopped car where there is road beside it, in single
 * file; this is for where there is none (a chicane, a car sideways across the road, two cars
 * stopped side by side) and for the back of a long queue, so the race never waits on a stopped
 * car for more than a few seconds, let alone the full minute before the rules retire it.
 */
const BLOCK_GHOST_AFTER = 6;
/** The same for a car stalled on the grid (never yet at speed), s. */
const STALLED_GHOST_AFTER = 1.5;
/** A player still on the grid: with the start grace, at least six seconds to launch, s. */
const PLAYER_STALLED_GHOST_AFTER = 5;
/** Held up: a car within `HELD_REACH` m behind, on the road anywhere across it, under this speed, m/s. */
const HELD_SPEED = 5;
const HELD_REACH = 60;
/**
 * Under way: has gone faster than this since the start, m/s, or is still racing this long after
 * the lights went out, s (a car stalled on the grid).
 */
const UNDERWAY_SPEED = 10;
const STALL_GRACE = 1;
/** Still: under this speed, m/s (the watchdog's stationary speed). */
const STILL_SPEED = 1;
/** At the head: no other car standing still within this far ahead of it on the road, m. */
const HEAD_REACH = 40;
/** On the road: within this far past the track edge, m. */
const ROAD_MARGIN = 1;
/**
 * A ghost comes back once moving at this speed, m/s, with no car within this box, m, and no
 * solid car behind it in an overlapping lane (within `CLEAR_WIDTH` plus `LANE_MARGIN` across)
 * that would close the gap within `CLOSING_TIME` at its closing speed.
 */
const UNGHOST_SPEED = 5;
const LANE_MARGIN = 1;
const CLOSING_TIME = 2;
/** The drivers see a blocking ghost once it moves faster than this, m/s (traffic again). */
const SEEN_SPEED = 2;
const CLEAR_LENGTH = 6.5;
const CLEAR_WIDTH = 2.6;

/**
 * A session over the sim world: N cars, each driven by a `CarController` (human input or AI),
 * stepped at the fixed rate, with the race rules (`RaceControl`) run over each car's facts every
 * tick. The rules talk back through the cars' inputs: DRS only when allowed, brakes on while the
 * pit crew holds the car, the pit limiter for cars that use the automatic one, and at each
 * timing line a new ERS lap and the fuel top-up.
 *
 * Pure and deterministic: no clock, seeded randomness only.
 */
/** Signed distance along the lap from a to b, m, in (-L/2, L/2]. */
function signedGap(L: number, a: number, b: number): number {
  let x = (b - a) % L;
  if (x > L / 2) x -= L;
  else if (x <= -L / 2) x += L;
  return x;
}

export class RaceSession {
  readonly track: Track;
  readonly circuit: CircuitInfo;
  readonly world: World;
  readonly control: RaceControl;
  readonly cars: readonly RaceCar[];
  readonly entrants: readonly EntrantInfo[];
  readonly params: CarParams;
  readonly seed: number;
  readonly fuel: number | null;
  /** Tyre temperature and wear are modelled (`RaceSessionOptions.tyres`). */
  readonly tyres: boolean;
  private readonly facts: CarFacts[];
  private readonly telemetry: CarTelemetry[];
  private readonly contexts: ControlContext[];
  /** Ghost this tick, per car (retired, or a stopped-queue blocker); time standing still; time blocking a stopped queue. */
  private readonly ghosts: boolean[];
  /** Unseen by the drivers this tick: retired, or a blocking ghost still standing. */
  private readonly unseen: boolean[];
  private readonly blockGhost: boolean[];
  private readonly stillTime: number[];
  private readonly underway: boolean[];
  /** Has been at speed since the start (a car under way only by the clock stalled on the grid). */
  private readonly atSpeed: boolean[];
  private readonly blockTime: number[];
  private readonly limits: WheelsOffCounter[];
  private readonly hints: { index: number }[];
  private readonly pitHints: { index: number }[];
  private readonly q = createPathPoint();
  private readonly pq = createPathPoint();
  private readonly tangent = createVec3();

  constructor(o: RaceSessionOptions) {
    this.track = o.track;
    this.circuit = o.circuit ?? circuitInfo(o.track);
    this.params = o.params ?? createCarParams('low');
    this.seed = o.seed;
    this.fuel = o.startFuel !== undefined ? null : o.fuel === undefined ? SESSION_FUEL : o.fuel;
    this.tyres = o.tyres ?? false;
    this.cars = o.cars;
    this.entrants = o.cars.map((c) => c.entrant);
    const surface = new TrackSurface(this.track);
    this.world = createWorld({ step: o.step ?? RACE_STEP, seed: o.seed, surface });
    const controlOptions: ConstructorParameters<typeof RaceControl>[0] = {
      circuit: this.circuit,
      session: o.session,
      entrants: o.cars.map((c) => ({
        team: c.entrant.team,
        human: c.controller.kind === 'human',
        ...(c.entrant.compound ? { compound: c.entrant.compound } : {}),
      })),
      seed: o.seed,
      startTime: this.world.time,
    };
    if (o.rules) controlOptions.rules = o.rules;
    if (o.record) controlOptions.record = o.record;
    this.control = new RaceControl(controlOptions);
    const grid = o.grid ?? o.cars.map((_, i) => i);
    const slotOf = new Map(grid.map((car, k) => [car, k]));
    const start = this.control.strategy.start;
    o.cars.forEach((car, i) => {
      const params = car.params ?? this.params;
      const pose = this.startPose(i, start, slotOf.get(i) ?? i, o.rollingStart);
      const wc = addCar(this.world, params, {
        x: pose.x,
        z: pose.z,
        yaw: pose.yaw,
        speed: pose.speed,
        ...(o.startFuel !== undefined
          ? { fuel: o.startFuel }
          : this.fuel !== null
            ? { fuel: this.fuel }
            : {}),
      });
      if (car.ersMode !== undefined) setErsMode(wc.state, car.ersMode);
      if (this.tyres) {
        const compound = this.control.cars[i]!.compound as CompoundId;
        // A race starts after the formation lap: the starting set warmed off its blankets.
        fitTyres(
          wc.state,
          compound,
          o.session.kind === 'race' ? { temperature: formationTemperature(compound) } : {},
        );
      }
    });
    this.facts = o.cars.map(() => createFacts());
    this.telemetry = o.cars.map(() => createCarTelemetry());
    this.limits = o.cars.map((_, i) => (o.limits ? o.limits(i) : new TrackLimits(this.track)));
    this.hints = o.cars.map(() => ({ index: -1 }));
    this.pitHints = o.cars.map(() => ({ index: -1 }));
    this.ghosts = o.cars.map(() => false);
    this.unseen = o.cars.map(() => false);
    this.blockGhost = o.cars.map(() => false);
    this.stillTime = o.cars.map(() => 0);
    this.underway = o.cars.map(() => false);
    this.atSpeed = o.cars.map(() => false);
    this.blockTime = o.cars.map(() => 0);
    this.contexts = o.cars.map((_, i) => ({
      car: i,
      time: 0,
      dt: this.world.step,
      telemetry: this.telemetry[i]!,
      facts: this.facts[i]!,
      control: this.control,
      track: this.track,
      circuit: this.circuit,
      field: this.facts,
      unseen: this.unseen,
    }));
    for (let i = 0; i < o.cars.length; i++) this.locate(i);
  }

  private startPose(
    car: number,
    start: 'grid' | 'pit' | 'rolling',
    slot: number,
    rolling: RaceSessionOptions['rollingStart'],
  ): { x: number; z: number; yaw: number; speed: number } {
    if (start === 'grid') {
      const g = this.track.gridSlots[slot];
      if (!g) throw new RangeError(`no grid slot ${slot + 1} at ${this.track.id}`);
      return { x: g.x, z: g.z, yaw: g.yaw, speed: 0 };
    }
    if (start === 'pit') {
      const box = this.control.pitBox(car);
      const b = box ? this.track.pit.boxes.find((p) => p.s === box.s && p.d === box.d) : undefined;
      const p = b ?? this.track.pit.boxes[0]!;
      return { x: p.x, z: p.z, yaw: p.yaw, speed: 0 };
    }
    const r = rolling ?? { before: 160, speed: 150 / 3.6 };
    const pose = this.lapPose(this.circuit.timingLine - r.before - 12 * car, r.d ?? 0);
    return { ...pose, speed: r.speed };
  }

  get time(): number {
    return this.world.time;
  }

  get ended(): boolean {
    return this.control.ended;
  }

  carFacts(car: number): Readonly<CarFacts> {
    return this.facts[car]!;
  }

  worldCar(car: number): WorldCar {
    return this.world.cars[car]!;
  }

  readTelemetry(car: number): CarTelemetry {
    return readCarTelemetry(this.world.cars[car]!.state, this.telemetry[car]!);
  }

  requestPit(car: number, actions: readonly ServiceAction[]): void {
    this.control.requestPit(car, actions);
  }

  /** One fixed step: drivers, the rules' say on their inputs, the sim, then the rules. */
  tick(): RaceEvent[] {
    const world = this.world;
    const control = this.control;
    this.updateGhosts();
    this.updateWakes();
    for (let i = 0; i < this.cars.length; i++) {
      const wc = world.cars[i]!;
      readCarTelemetry(wc.state, this.telemetry[i]!);
      const ctx = this.contexts[i]! as { time: number };
      ctx.time = world.time;
      const controller = this.cars[i]!.controller;
      const input = wc.input;
      controller.control(this.contexts[i]!, input);
      const st = control.cars[i]!.status;
      wc.ghost = this.ghosts[i]!;
      if (control.held(i) || st === 'dnf' || st === 'dsq') {
        input.throttle = 0;
        input.brake = 1;
        input.overtake = false;
      }
      input.drs = control.gateDrs(i, input);
      if (controller.autoLimiter && control.limiterZone(i)) input.pitLimiter = true;
    }
    stepWorld(world);
    for (let i = 0; i < this.cars.length; i++) this.locate(i);
    const events = control.tick(world, this.facts);
    for (const e of events) {
      if (e.type === 'lapStart' || e.type === 'lap') this.onLine(e.car);
      else if (e.type === 'pit' && e.stage === 'serviceEnd' && this.tyres) {
        // A tyre change fits a fresh set of the compound the rules now have on the car.
        if (e.actions?.some((a) => a.kind === 'tyres')) {
          fitTyres(world.cars[e.car]!.state, control.cars[e.car]!.compound as CompoundId);
        }
      }
    }
    return events;
  }

  /** Straight-line tow, shared by human and computer cars. No aero-load change. */
  private updateWakes(): void {
    for (let i = 0; i < this.cars.length; i++) {
      const state = this.world.cars[i]!.state;
      const f = this.facts[i]!;
      let exposure = 0;
      // The opening-lap pack keeps the measured aero while it sorts through the first
      // corners. The tow joins the racing tools from lap two, alongside race DRS.
      if (
        this.control.racing(i) &&
        !this.ghosts[i] &&
        !f.inPitLane &&
        state.vx > 35 &&
        this.control.timer(i).lap > 1
      ) {
        // Release the tow well before a bend or a stopped queue. The speed plan and
        // recovery controller then see their measured car throughout the braking zone.
        let straight = true;
        for (let x = 0; x <= 120 + state.vx * 2; x += 20) {
          if (Math.abs(this.track.curvatureAt(this.track.wrap(f.s + x))) > 1 / 500) {
            straight = false;
            break;
          }
        }
        for (let j = 0; j < this.cars.length && straight; j++) {
          if (j === i || this.ghosts[j] || this.facts[j]!.inPitLane || !this.control.racing(j))
            continue;
          const other = this.facts[j]!;
          const gap = signedGap(this.track.length, f.s, other.s);
          if (gap > 0 && gap < 300 && other.speed < 15) {
            exposure = 0;
            break;
          }
          exposure = Math.max(exposure, wakeStrength(state, this.world.cars[j]!.state));
        }
      }
      // Estimate: at most 18 % drag relief. Wakes do not stack; grip stays on its plan.
      state.dragScale = 1 - 0.18 * exposure;
    }
  }

  /** Whether a car is a ghost this tick: no car touches it (retired, or blocking). */
  ghost(car: number): boolean {
    return this.ghosts[car]!;
  }

  /** Whether a car is a ghost for blocking the road (not retired): it turns solid again. */
  blockingGhost(car: number): boolean {
    return this.blockGhost[car]!;
  }

  /**
   * Who is a ghost this tick (race-rules.md). A retired car is parked out of the race where it
   * stopped. A car standing still with traffic held up behind it (see `BLOCK_GHOST_AFTER`) is
   * one until it moves off clear of every car with none closing on it from behind; the drivers
   * see it again as soon as it moves, so the cars behind plan round it before it turns solid.
   * Read from the last tick's facts, before any driver runs, so every driver sees the same
   * field.
   */
  private updateGhosts(): void {
    const f = this.facts;
    const dt = this.world.step;
    const n = this.cars.length;
    for (let i = 0; i < n; i++) {
      // Under way once at speed, or, still on the grid, a couple of seconds after the lights went
      // out: a car stalled at the start holds up the cars behind it like any stopped car.
      const out = this.control.lightsOutAt;
      const stalled = out !== null && this.world.time > out + STALL_GRACE;
      if (f[i]!.speed > UNDERWAY_SPEED && this.control.racing(i)) this.atSpeed[i] = true;
      if ((this.atSpeed[i] || stalled) && this.control.racing(i)) this.underway[i] = true;
      this.stillTime[i] =
        this.queueable(i) && f[i]!.speed < STILL_SPEED ? this.stillTime[i]! + dt : 0;
    }
    for (let i = 0; i < n; i++) {
      const st = this.control.cars[i]!.status;
      if (st === 'dnf' || st === 'dsq') {
        this.ghosts[i] = true;
        this.unseen[i] = true;
        this.blockGhost[i] = false;
        this.blockTime[i] = 0;
        continue;
      }
      if (this.blockGhost[i]) {
        if (!this.control.racing(i) || (f[i]!.speed > UNGHOST_SPEED && this.safeToSolidify(i))) {
          this.blockGhost[i] = false;
        }
      } else if (this.headOfStillQueue(i)) {
        this.blockTime[i]! += dt;
        // (Stalled on the grid, sooner: the cars behind it have not got away at all.)
        const after = this.atSpeed[i]
          ? BLOCK_GHOST_AFTER
          : this.cars[i]!.controller.kind === 'human'
            ? PLAYER_STALLED_GHOST_AFTER
            : STALLED_GHOST_AFTER;
        if (this.blockTime[i]! >= after) {
          this.blockGhost[i] = true;
          this.blockTime[i] = 0;
        }
      } else this.blockTime[i] = 0;
      this.ghosts[i] = this.blockGhost[i]!;
      this.unseen[i] = this.blockGhost[i]! && f[i]!.speed < SEEN_SPEED;
    }
  }

  /** On the road in the race: racing, under way, not in the pit lane, not held. */
  private queueable(i: number): boolean {
    const f = this.facts[i]!;
    return this.control.racing(i) && this.underway[i]! && !f.inPitLane && !this.control.held(i);
  }

  /**
   * Standing still on the road, no other car standing still just ahead of it (that one is the
   * head), and a car held up behind it. Into a chicane the queue lines up on the line, which may
   * be across the road from the stopped car: anywhere across counts.
   */
  private headOfStillQueue(i: number): boolean {
    if (this.stillTime[i]! <= 0) return false;
    const L = this.track.length;
    const me = this.facts[i]!;
    if (!this.onRoad(me)) return false;
    let held = false;
    for (let j = 0; j < this.cars.length; j++) {
      if (j === i || this.ghosts[j] || !this.queueable(j)) continue;
      const o = this.facts[j]!;
      if (!this.onRoad(o)) continue;
      const ds = signedGap(L, me.s, o.s);
      if (ds > 0 && ds < HEAD_REACH && this.stillTime[j]! > 0) return false;
      if (ds < 0 && ds > -HELD_REACH && o.speed < HELD_SPEED) held = true;
    }
    return held;
  }

  private onRoad(f: CarFacts): boolean {
    const s = this.track.wrap(f.s);
    return Math.abs(f.d) < this.track.halfWidthAt(s, f.d >= 0 ? 0 : 1) + ROAD_MARGIN;
  }

  /**
   * No solid car overlapping it, and none behind it in an overlapping lane that would close the
   * gap within `CLOSING_TIME` (a car arriving at racing speed would run into it).
   */
  private safeToSolidify(i: number): boolean {
    const L = this.track.length;
    const me = this.facts[i]!;
    for (let j = 0; j < this.cars.length; j++) {
      if (j === i || this.ghosts[j]) continue;
      const o = this.facts[j]!;
      const ds = signedGap(L, me.s, o.s);
      const across = Math.abs(o.d - me.d);
      if (Math.abs(ds) < CLEAR_LENGTH && across < CLEAR_WIDTH) return false;
      if (ds < 0 && across < CLEAR_WIDTH + LANE_MARGIN) {
        const closing = o.speed - me.speed;
        if (closing > 0 && -ds - CLEAR_LENGTH < closing * CLOSING_TIME) return false;
      }
    }
    return true;
  }

  /** Step until the session ends or `seconds` of sim time pass; returns every event. */
  run(seconds: number, onEvents?: (events: RaceEvent[]) => void): RaceEvent[] {
    const out: RaceEvent[] = [];
    const n = Math.round(seconds / this.world.step);
    for (let k = 0; k < n && !this.control.ended; k++) {
      const e = this.tick();
      if (e.length > 0) {
        out.push(...e);
        onEvents?.(e);
      }
    }
    return out;
  }

  result(): SessionResult {
    return buildResult(this.control, this.entrants, this.seed);
  }

  /** A new ERS lap and the fuel top-up at the timing line. */
  private onLine(car: number): void {
    const st = this.world.cars[car]!.state;
    beginErsLap(st);
    if (this.fuel !== null) st.fuelMass = this.fuel;
  }

  private locate(i: number): void {
    const st = this.world.cars[i]!.state;
    const f = this.facts[i]!;
    const q = this.track.project(st.x, st.z, this.hints[i]!, this.q);
    f.s = q.s;
    f.d = q.d;
    f.speed = st.vx;
    const t = this.track.tangentAt(q.s, this.tangent);
    const h = st.yaw - Math.atan2(-t.z, t.x);
    f.heading = Math.atan2(Math.sin(h), Math.cos(h));
    f.wheelsOff = this.limits[i]!.wheelsOff(st);
    const inPit = this.track.onPitLane(st.x, st.z, q.s, q.d, this.pitHints[i]!, this.pq);
    if (!inPit) this.pitHints[i]!.index = -1;
    f.inPitLane = inPit;
    f.pitS = inPit ? this.pq.s : Number.NaN;
    f.pitD = inPit ? this.pq.d : Number.NaN;
  }

  /** Lap pose at (s, d), facing along the lap. */
  lapPose(s: number, d: number): { x: number; z: number; yaw: number } {
    const s0 = this.track.wrap(s);
    const p = this.track.pointAt(s0, d, createVec3());
    const t = this.track.tangentAt(s0, createVec3());
    return { x: p.x, z: p.z, yaw: Math.atan2(-t.z, t.x) };
  }

  /**
   * Put a car at a world pose at `speed`, settled on the ground (restart, reset, teleport). The
   * rules see a reposition, not a drive: no line is crossed (`RaceControl.reposition`). With
   * `revive`, a retired car is back in the session where the rules allow it (time trial,
   * practice). Timing beyond that is the caller's business (`control.restartTiming`,
   * `control.invalidateLap`). Returns the rules' events.
   */
  placeCar(
    car: number,
    x: number,
    z: number,
    yaw: number,
    speed: number,
    revive = false,
  ): RaceEvent[] {
    const wc = this.world.cars[car]!;
    const fresh = createCarState(wc.state.params, {
      x,
      z,
      yaw,
      speed,
      ...(this.fuel !== null ? { fuel: this.fuel } : { fuel: wc.state.fuelMass }),
      surface: this.world.surface,
      airDensity: this.world.environment.airDensity,
    });
    const mode = wc.state.ersMode;
    // The car keeps its tyres (compound, temperature, wear) and the field's broken boards across
    // the move.
    const st = wc.state;
    const tyres = {
      compound: st.tyreCompound,
      ambient: st.tyreAmbient,
      temp: Float64Array.from(st.tyreTemp),
      wear: Float64Array.from(st.tyreWear),
      grip: Float64Array.from(st.gripScale),
    };
    const brokenObjects = st.brokenObjects.slice();
    restoreCar(st, snapshotCar(fresh));
    st.brokenObjects.set(brokenObjects);
    st.ersMode = mode;
    st.tyreCompound = tyres.compound;
    st.tyreAmbient = tyres.ambient;
    st.tyreTemp.set(tyres.temp);
    st.tyreWear.set(tyres.wear);
    st.gripScale.set(tyres.grip);
    readCarPose(wc.state, wc.pose);
    readCarPose(wc.state, wc.previousPose);
    this.hints[car]!.index = -1;
    this.pitHints[car]!.index = -1;
    this.limits[car]!.reset();
    this.cars[car]!.controller.reset();
    this.locate(car);
    return this.control.reposition(car, this.facts[car]!, revive);
  }

  snapshot(): RaceSessionSnapshot {
    return {
      version: 3,
      control: this.control.snapshot(),
      world: {
        tick: this.world.tick,
        time: this.world.time,
        rng: this.world.rng.getState(),
        cars: this.world.cars.map((c) => Array.from(snapshotCar(c.state))),
      },
      controllers: this.cars.map(
        (c) => JSON.parse(JSON.stringify(c.controller.snapshot())) as ControllerState,
      ),
      hints: this.world.cars.map((c, i) => ({
        surface: c.state.hints.map((h) => h.index),
        lap: this.hints[i]!.index,
        pit: this.pitHints[i]!.index,
        limits: this.limits[i]!.hintState?.() ?? null,
      })),
      blockers: {
        underway: [...this.underway],
        atSpeed: [...this.atSpeed],
        still: [...this.stillTime],
        block: [...this.blockTime],
        ghost: [...this.blockGhost],
      },
    };
  }

  /**
   * Restore a snapshot taken from a session built with the same options (the same track, cars,
   * drivers and seed): the rules, the world, every driver's memory and every cache, so the
   * session continues exactly as the original would have.
   */
  restore(snap: RaceSessionSnapshot): void {
    if (snap.version !== 3)
      throw new Error(`unknown session snapshot version ${String(snap.version)}`);
    if (
      snap.world.cars.length !== this.world.cars.length ||
      snap.controllers.length !== this.cars.length ||
      snap.world.cars[0]?.length !== CAR_SNAPSHOT_LENGTH
    ) {
      throw new Error('snapshot does not match this session');
    }
    this.control.restore(snap.control);
    this.world.tick = snap.world.tick;
    this.world.time = snap.world.time;
    this.world.rng.setState(snap.world.rng);
    this.world.cars.forEach((c, i) => {
      restoreCar(c.state, snap.world.cars[i]!);
      const h = snap.hints[i]!;
      c.state.hints.forEach((hint, k) => (hint.index = h.surface[k] ?? -1));
      readCarPose(c.state, c.pose);
      readCarPose(c.state, c.previousPose);
      this.hints[i]!.index = h.lap;
      this.pitHints[i]!.index = h.pit;
      if (h.limits && this.limits[i]!.setHintState) this.limits[i]!.setHintState!(h.limits);
      else this.limits[i]!.reset();
      this.cars[i]!.controller.restore(snap.controllers[i]!);
      this.locate(i);
      this.underway[i] = snap.blockers?.underway[i] ?? false;
      this.atSpeed[i] = snap.blockers?.atSpeed?.[i] ?? this.underway[i]!;
      this.stillTime[i] = snap.blockers?.still[i] ?? 0;
      this.blockTime[i] = snap.blockers?.block[i] ?? 0;
      this.blockGhost[i] = snap.blockers?.ghost[i] ?? false;
      const st = this.control.cars[i]!.status;
      this.ghosts[i] = st === 'dnf' || st === 'dsq' || this.blockGhost[i]!;
      this.unseen[i] =
        st === 'dnf' || st === 'dsq' || (this.blockGhost[i]! && this.facts[i]!.speed < SEEN_SPEED);
      c.ghost = this.ghosts[i]!;
    });
  }
}
