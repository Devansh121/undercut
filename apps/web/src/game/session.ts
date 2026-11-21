import {
  InputController,
  RaceSession,
  type LapResult,
  type LapTimer,
  type RaceEvent,
  type TimingEvent,
  type WheelsOffCounter,
} from '@undercut/race';
import { HIGH_KERB, type Track } from '@undercut/track';
import {
  SurfaceKind,
  checkCarInvariants,
  computeMass,
  createAssistState,
  createCarParams,
  createCarPose,
  createCarTelemetry,
  createSurfaceHint,
  createSurfaceSample,
  invariantLimits,
  readCarTelemetry,
  type AssistState,
  type CarParams,
  type CarPose,
  type CarTelemetry,
  type ControlInput,
  type InvariantLimits,
  type MassState,
  type SurfaceHint,
  type World,
  type WorldCar,
} from '@undercut/sim';
import type { DeviceKind } from '@undercut/input';
import { applyDriverAids, assistsFor, type AssistConfig, type AssistOverrides } from './assists';
import type { Ghost } from './ghost';
import { GhostRecorder, decodeGhost, encodeGhost } from './ghost';
import type { CircuitRecord, RecordUpdate } from './records';

export type { WheelsOffCounter } from '@undercut/race';

/** Sim step: 240 Hz (ADR 0007). */
export const SIM_STEP = 1 / 240;
/** Time-trial fuel load, kg: a light qualifying-style load, topped up at every line crossing. */
export const TIME_TRIAL_FUEL = 20;
/** Rolling start speed, m/s (150 km/h). */
export const ROLLING_START_SPEED = 150 / 3.6;
/** Rolling start: this far before the circuit's timing line, on the centreline, m. */
export const ROLLING_START_RUN_UP = 160;

export type SessionPhase = 'ready' | 'running' | 'paused' | 'ended';

export type SessionEvent =
  | TimingEvent
  | { type: 'invalidated'; reason: 'limits' | 'reset' | 'safety' }
  /** Something to persist: a new best lap, better sector minima, or both. */
  | { type: 'record'; circuit: string; update: RecordUpdate }
  /** `safety`: the car's pose broke the sim's invariants and the session put it back. */
  | { type: 'reset'; reason: 'track' | 'restart' | 'teleport' | 'safety' };

export interface DriveSessionOptions {
  track: Track;
  seed: number;
  params?: CarParams;
  /** All-time best for this circuit, from storage. */
  record?: CircuitRecord | null;
  /** Date stamp for new records (YYYY-MM-DD); the session never reads a clock. */
  today?: string;
  /** Track-limit counter; defaults to `TrackLimits` on this track. */
  limits?: WheelsOffCounter;
}

/**
 * A time-trial session: one car on the race engine (`@undercut/race`, time-trial rules: timing
 * from the circuit's timing line, laps invalidated over the track limits, DRS free in the zones,
 * ERS lap and fuel reset at the line), plus what only time trial has: driver assists by device,
 * the ghost of the best lap, records, and the commands the pause menu and the debug API need.
 * Pure: no DOM, no renderer, no clock; the game loop drives `tick`.
 */
export class DriveSession {
  readonly track: Track;
  readonly race: RaceSession;
  readonly world: World;
  readonly car: WorldCar;
  readonly timer: LapTimer;
  readonly params: CarParams;
  private phaseValue: SessionPhase = 'ready';
  private readonly recorder = new GhostRecorder();
  private ghostValue: Ghost | null = null;
  private assistMemory: AssistState = createAssistState();
  private overrides: AssistOverrides = {};
  private assistValue: AssistConfig = assistsFor('keyboard', {});
  private deviceValue: DeviceKind = 'keyboard';
  private readonly pending: ControlInput;
  private readonly sampleHint = createSurfaceHint();
  private readonly wheelHints = [
    createSurfaceHint(),
    createSurfaceHint(),
    createSurfaceHint(),
    createSurfaceHint(),
  ];
  private readonly mass: MassState = {
    total: 0,
    sprung: 0,
    a: 0,
    b: 0,
    sprungA: 0,
    sprungB: 0,
    yawInertia: 0,
  };
  private readonly sample = createSurfaceSample();
  private readonly telemetry: CarTelemetry = createCarTelemetry();
  private readonly today: string;
  private readonly poseLimits: InvariantLimits;
  private safetyResetsValue = 0;
  private wallHitsValue = 0;

  constructor(options: DriveSessionOptions) {
    this.track = options.track;
    this.params = options.params ?? createCarParams('low');
    this.today = options.today ?? '';
    this.pending = {
      steer: 0,
      throttle: 0,
      brake: 0,
      gearShift: 0,
      drs: false,
      overtake: false,
      pitLimiter: false,
    };
    const record = options.record ?? null;
    const limits = options.limits;
    this.race = new RaceSession({
      track: this.track,
      session: { kind: 'timeTrial' },
      seed: options.seed,
      params: this.params,
      fuel: TIME_TRIAL_FUEL,
      step: SIM_STEP,
      rollingStart: { before: ROLLING_START_RUN_UP, speed: ROLLING_START_SPEED },
      cars: [
        {
          entrant: { id: 'player', name: 'Player', code: 'PLY', team: 0 },
          controller: new InputController((_ctx, out) => this.drive(out)),
        },
      ],
      ...(record ? { record: { lap: record.lap, sectors: record.bestSectors } } : {}),
      ...(limits ? { limits: () => limits } : {}),
    });
    this.world = this.race.world;
    this.car = this.race.worldCar(0);
    this.timer = this.race.control.timer(0);
    this.ghostValue = record?.ghost ? decodeGhost(record.ghost) : null;
    this.poseLimits = invariantLimits(this.car.state.model);
  }

  /**
   * How many times the safety net put the car back because its pose broke the sim's
   * invariants. The fixes are in the sim and the track; this is the last line, and it stays
   * zero in normal play (a browser test checks).
   */
  get safetyResets(): number {
    return this.safetyResetsValue;
  }

  /** Steps on which the car struck a barrier (moving into it) since the session began. */
  get wallHits(): number {
    return this.wallHitsValue;
  }

  /** The player's input for this tick, with the device's assists, written into the car. */
  private drive(out: ControlInput): void {
    applyDriverAids(
      this.deviceValue,
      this.assistValue,
      this.assistMemory,
      this.car.state,
      this.pending,
      this.world.step,
      out,
    );
  }

  get phase(): SessionPhase {
    return this.phaseValue;
  }

  /** Track position of the car's reference point. */
  get s(): number {
    return this.race.carFacts(0).s;
  }

  get d(): number {
    return this.race.carFacts(0).d;
  }

  get wheelsOff(): number {
    return this.race.carFacts(0).wheelsOff;
  }

  /** The car is inside a DRS zone, so the flap may open on request. */
  get drsAvailable(): boolean {
    return this.race.control.drsAllowed(0);
  }

  /** A ghost of the current lap is being recorded (false once the lap is invalid or too long). */
  get ghostRecording(): boolean {
    return this.recorder.recording;
  }

  /** The record lap's ghost, if there is one. */
  get ghost(): Ghost | null {
    return this.ghostValue;
  }

  get assists(): Readonly<AssistConfig> {
    return this.assistValue;
  }

  get device(): DeviceKind {
    return this.deviceValue;
  }

  /** Change one assist from the pause menu; it sticks across device changes. */
  setAssist<K extends keyof AssistConfig>(key: K, value: AssistConfig[K]): void {
    this.overrides = { ...this.overrides, [key]: value };
    this.assistValue = assistsFor(this.deviceValue, this.overrides);
  }

  start(): boolean {
    if (this.phaseValue !== 'ready') return false;
    this.phaseValue = 'running';
    return true;
  }

  pause(): boolean {
    if (this.phaseValue !== 'running') return false;
    this.phaseValue = 'paused';
    return true;
  }

  resume(): boolean {
    if (this.phaseValue !== 'paused') return false;
    this.phaseValue = 'running';
    return true;
  }

  end(): void {
    this.phaseValue = 'ended';
    this.recorder.cancel();
  }

  readTelemetry(): CarTelemetry {
    return readCarTelemetry(this.car.state, this.telemetry);
  }

  /**
   * How rough the kerbs under the wheels are, 0–1: the largest kerb roughness at the four
   * contact points as a share of a raised sausage kerb's. Zero off kerbs. For kerb rumble.
   */
  kerbUnderWheels(): number {
    const st = this.car.state;
    const m = computeMass(st.model, st.fuelMass, this.mass);
    const c = Math.cos(st.yaw);
    const sn = Math.sin(st.yaw);
    let rough = 0;
    for (let i = 0; i < 4; i++) {
      const bx = i < 2 ? m.a : -m.b;
      const by = st.model.wheelLeft[i] as number;
      this.world.surface.sample(
        st.x + bx * c - by * sn,
        st.z - bx * sn - by * c,
        this.wheelHints[i] as SurfaceHint,
        this.sample,
      );
      if (this.sample.kind === SurfaceKind.Kerb) {
        rough = Math.max(rough, this.sample.roughness / HIGH_KERB.roughness);
      }
    }
    return Math.min(1, rough);
  }

  /** Surface kind under the car's reference point. */
  surfaceUnderCar(): SurfaceKind {
    const st = this.car.state;
    this.world.surface.sample(st.x, st.z, this.sampleHint, this.sample);
    return this.sample.kind;
  }

  /** Lap time on the current lap at sim time `time` (0 before the first crossing). */
  lapTimeAt(time: number): number {
    return this.timer.currentLapTime(time);
  }

  /** Live gap to the record ghost at the car's position on the lap, s; null without a comparison. */
  liveDelta(): number | null {
    if (!this.ghostValue || !this.timer.running) return null;
    const ref = this.ghostValue.timeAtDistance(this.timer.lapDistance);
    if (ref === null) return null;
    return this.timer.currentLapTime(this.world.time) - ref;
  }

  /** The ghost's pose at render time `time`; false when it is not on track now. */
  ghostPoseAt(time: number, out: CarPose): boolean {
    if (!this.ghostValue || !this.timer.running) return false;
    return this.ghostValue.poseAt(this.timer.currentLapTime(time), out);
  }

  /** One fixed sim step with `control` from the driver on `device`. */
  tick(control: ControlInput, device: DeviceKind): SessionEvent[] {
    if (this.phaseValue !== 'running') return [];
    if (device !== this.deviceValue) {
      this.deviceValue = device;
      this.assistValue = assistsFor(device, this.overrides);
    }
    Object.assign(this.pending, control);
    const events: SessionEvent[] = [];
    const lastS = this.s;
    for (const e of this.race.tick()) this.onRaceEvent(e, events);
    if (checkCarInvariants(this.car.state, this.poseLimits) !== null) {
      this.safetyReset(lastS, events);
      return events;
    }
    if (this.car.state.wallImpactSpeed > 0) this.wallHitsValue++;
    if (this.timer.running && this.recorder.recording) {
      this.recorder.sample(
        this.timer.currentLapTime(this.world.time),
        this.timer.lapDistance,
        this.car.pose,
      );
    }
    return events;
  }

  /**
   * Race events in, time-trial events out, in order. Track limits are resolved before the
   * timing lines (see `@undercut/race` limits), so a lap is never committed or made a record and
   * only then invalidated; a four-off reading in the tick that crosses the line counts against
   * both laps.
   */
  private onRaceEvent(e: RaceEvent, events: SessionEvent[]): void {
    switch (e.type) {
      case 'lapStart':
        events.push({ type: 'lapStart', lap: e.lap, time: e.time });
        this.onLine(e.time);
        break;
      case 'sector': {
        const { t: _t, car: _c, ...rest } = e;
        events.push(rest);
        break;
      }
      case 'lap':
        events.push({ type: 'lap', at: e.at, result: e.result });
        this.onLapComplete(e.at, e.result, events);
        break;
      case 'invalidated':
        this.recorder.cancel();
        events.push({ type: 'invalidated', reason: e.reason === 'reset' ? 'reset' : 'limits' });
        break;
      default:
        break;
    }
  }

  /**
   * The pose broke the invariants: back on the centreline where the car last was sane, the lap
   * invalidated through the race engine (as a reset) and reported as a safety reset.
   */
  private safetyReset(lastS: number, events: SessionEvent[]): void {
    this.safetyResetsValue++;
    const pose = this.race.lapPose(lastS, 0);
    this.place(pose.x, pose.z, pose.yaw, 0, events);
    for (const e of this.race.control.invalidateLap(0, 'reset')) {
      if (e.type === 'invalidated') {
        this.recorder.cancel();
        events.push({ type: 'invalidated', reason: 'safety' });
      } else this.onRaceEvent(e, events);
    }
    events.push({ type: 'reset', reason: 'safety' });
  }

  /** Back to the rolling start; timing for the lap in progress is dropped. */
  restartLap(): SessionEvent[] {
    const p = this.race.lapPose(this.race.circuit.timingLine - ROLLING_START_RUN_UP, 0);
    this.place(p.x, p.z, p.yaw, ROLLING_START_SPEED, []);
    this.race.control.restartTiming(0);
    this.recorder.cancel();
    if (this.phaseValue === 'paused') this.phaseValue = 'running';
    return [{ type: 'reset', reason: 'restart' }];
  }

  /** On the centreline at the nearest point, stopped, facing along the lap. Invalidates the lap. */
  resetToTrack(): SessionEvent[] {
    const events: SessionEvent[] = [];
    const pose = this.race.lapPose(this.s, 0);
    this.place(pose.x, pose.z, pose.yaw, 0, events);
    for (const e of this.race.control.invalidateLap(0, 'reset')) this.onRaceEvent(e, events);
    if (this.phaseValue === 'paused') this.phaseValue = 'running';
    events.push({ type: 'reset', reason: 'track' });
    return events;
  }

  /** Debug and tools: put the car at (s, d) at `speed`, timing back to before the line. */
  teleport(s: number, d = 0, speed = 0): SessionEvent[] {
    const pose = this.race.lapPose(this.track.wrap(s), d);
    this.place(pose.x, pose.z, pose.yaw, speed, []);
    this.race.control.restartTiming(0);
    this.recorder.cancel();
    return [{ type: 'reset', reason: 'teleport' }];
  }

  private onLine(time: number): void {
    this.recorder.begin();
    this.recorder.sample(this.world.time - time, this.timer.lapDistance, this.car.pose, true);
  }

  private onLapComplete(at: number, r: LapResult, events: SessionEvent[]): void {
    let ghostText: string | null = null;
    if (this.recorder.recording) {
      this.recorder.sample(r.time, this.track.length, this.car.pose, true);
      const ghost = this.recorder.finish(r.time);
      if (r.record) {
        this.ghostValue = ghost;
        ghostText = encodeGhost(ghost);
      }
    }
    // The best lap keeps its own splits and ghost; sector minima are persisted on their own,
    // including from laps that are not lap records.
    if (r.valid && (r.record || r.sectorRecords.some(Boolean))) {
      events.push({
        type: 'record',
        circuit: this.track.id,
        update: {
          lap: r.record ? { time: r.time, sectors: r.sectors.slice(), ghost: ghostText } : null,
          bestSectors: this.timer.record.sectors.slice(),
          date: this.today,
        },
      });
    }
    this.onLine(at);
  }

  /** Move the car without crossing any line; a retired car is back in the session. */
  private place(x: number, z: number, yaw: number, speed: number, events: SessionEvent[]): void {
    for (const e of this.race.placeCar(0, x, z, yaw, speed, true)) this.onRaceEvent(e, events);
    this.assistMemory = createAssistState();
  }
}

/** A scratch pose for callers that read the ghost. */
export const createGhostPose = createCarPose;
