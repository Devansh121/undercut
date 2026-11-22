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
  restoreCar,
  snapshotCar,
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
  version: 2;
  control: RaceControlSnapshot;
  world: { tick: number; time: number; rng: RngState; cars: number[][] };
  /** Each car's driver (AI memory, pit-lane follower). */
  controllers: ControllerState[];
  /**
   * Search hints of every projection per car (surface sampling per wheel, the car's lap and
   * pit-lane position, the track-limit wheels): caches, kept so a restore is bit-identical.
   */
  hints: { surface: number[]; lap: number; pit: number; limits: number[] | null }[];
}

/**
 * A session over the sim world: N cars, each driven by a `CarController` (human input or AI),
 * stepped at the fixed rate, with the race rules (`RaceControl`) run over each car's facts every
 * tick. The rules talk back through the cars' inputs: DRS only when allowed, brakes on while the
 * pit crew holds the car, the pit limiter for cars that use the automatic one, and at each
 * timing line a new ERS lap and the fuel top-up.
 *
 * Pure and deterministic: no clock, seeded randomness only.
 */
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
  private readonly facts: CarFacts[];
  private readonly telemetry: CarTelemetry[];
  private readonly contexts: ControlContext[];
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
    this.fuel = o.fuel === undefined ? SESSION_FUEL : o.fuel;
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
        ...(this.fuel !== null ? { fuel: this.fuel } : {}),
      });
      if (car.ersMode !== undefined) setErsMode(wc.state, car.ersMode);
    });
    this.facts = o.cars.map(() => createFacts());
    this.telemetry = o.cars.map(() => createCarTelemetry());
    this.limits = o.cars.map((_, i) => (o.limits ? o.limits(i) : new TrackLimits(this.track)));
    this.hints = o.cars.map(() => ({ index: -1 }));
    this.pitHints = o.cars.map(() => ({ index: -1 }));
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
    for (let i = 0; i < this.cars.length; i++) {
      const wc = world.cars[i]!;
      readCarTelemetry(wc.state, this.telemetry[i]!);
      const ctx = this.contexts[i]! as { time: number };
      ctx.time = world.time;
      const controller = this.cars[i]!.controller;
      const input = wc.input;
      controller.control(this.contexts[i]!, input);
      const st = control.cars[i]!.status;
      // Retired, the car is parked out of the race where it stopped: a ghost no car touches
      // (and the drivers no longer see), so it never blocks the road (race-rules.md).
      wc.ghost = st === 'dnf' || st === 'dsq';
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
    }
    return events;
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
    restoreCar(wc.state, snapshotCar(fresh));
    wc.state.ersMode = mode;
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
      version: 2,
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
    };
  }

  /**
   * Restore a snapshot taken from a session built with the same options (the same track, cars,
   * drivers and seed): the rules, the world, every driver's memory and every cache, so the
   * session continues exactly as the original would have.
   */
  restore(snap: RaceSessionSnapshot): void {
    if (snap.version !== 2)
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
    });
  }
}
