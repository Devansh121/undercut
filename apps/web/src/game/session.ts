import {
  addCar,
  applyAssists,
  beginErsLap,
  checkCarInvariants,
  createAssistState,
  createCarParams,
  createCarPose,
  createCarState,
  createCarTelemetry,
  createSurfaceHint,
  createSurfaceSample,
  createWorld,
  invariantLimits,
  readCarPose,
  readCarTelemetry,
  restoreCar,
  snapshotCar,
  stepWorld,
  type AssistState,
  type CarParams,
  type CarPose,
  type CarState,
  type CarTelemetry,
  type ControlInput,
  type InvariantLimits,
  SurfaceKind,
  computeMass,
  type MassState,
  type SurfaceHint,
  type World,
  type WorldCar,
} from '@undercut/sim';
import {
  HIGH_KERB,
  TrackSurface,
  createPathPoint,
  createVec3,
  type Pose,
  type Track,
} from '@undercut/track';
import type { DeviceKind } from '@undercut/input';
import { assistSteer, assistsFor, type AssistConfig, type AssistOverrides } from './assists';
import type { Ghost } from './ghost';
import { GhostRecorder, decodeGhost, encodeGhost } from './ghost';
import { TrackLimits } from './limits';
import type { CircuitRecord, RecordUpdate } from './records';
import { LapTimer, type TimingEvent } from './timing';

/** Sim step: 240 Hz (ADR 0007). */
export const SIM_STEP = 1 / 240;
/** Time-trial fuel load, kg: a light qualifying-style load, topped up at every line crossing. */
export const TIME_TRIAL_FUEL = 20;
/** Rolling start speed, m/s (150 km/h), from the last grid slot. */
export const ROLLING_START_SPEED = 150 / 3.6;

export type SessionPhase = 'ready' | 'running' | 'paused' | 'ended';

export type SessionEvent =
  | TimingEvent
  | { type: 'invalidated'; reason: 'limits' | 'reset' | 'safety' }
  /** Something to persist: a new best lap, better sector minima, or both. */
  | { type: 'record'; circuit: string; update: RecordUpdate }
  /** `safety`: the car's pose broke the sim's invariants and the session put it back. */
  | { type: 'reset'; reason: 'track' | 'restart' | 'teleport' | 'safety' };

/** Counts wheels wholly past the track-limit lines. `TrackLimits` in play; scripts in tests. */
export interface WheelsOffCounter {
  wheelsOff(car: CarState): number;
  /** Forget cached search positions (after a teleport). */
  reset(): void;
}

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
 * A time-trial session: one car on one track, the rules around it (timing, track limits, DRS
 * zones, ERS lap, fuel), the ghost of the best lap, and the commands the pause menu and the
 * debug API need. Pure: no DOM, no renderer, no clock; the game loop drives `tick`.
 */
export class DriveSession {
  readonly track: Track;
  readonly world: World;
  readonly car: WorldCar;
  readonly timer: LapTimer;
  readonly params: CarParams;
  private phaseValue: SessionPhase = 'ready';
  private readonly limits: WheelsOffCounter;
  private readonly recorder = new GhostRecorder();
  private ghostValue: Ghost | null = null;
  private assistMemory: AssistState = createAssistState();
  private overrides: AssistOverrides = {};
  private assistValue: AssistConfig = assistsFor('keyboard', {});
  private deviceValue: DeviceKind = 'keyboard';
  private readonly hint = { index: -1 };
  private readonly q = createPathPoint();
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
  private sValue = 0;
  private dValue = 0;
  private wheelsOffValue = 0;
  private drsAvailableValue = false;
  private readonly today: string;
  private readonly poseLimits: InvariantLimits;
  private safetyResetsValue = 0;

  constructor(options: DriveSessionOptions) {
    this.track = options.track;
    this.params = options.params ?? createCarParams('low');
    this.today = options.today ?? '';
    const surface = new TrackSurface(this.track);
    this.world = createWorld({ step: SIM_STEP, seed: options.seed, surface });
    const start = this.rollingStartPose();
    this.car = addCar(this.world, this.params, {
      x: start.x,
      z: start.z,
      yaw: start.yaw,
      speed: ROLLING_START_SPEED,
      fuel: TIME_TRIAL_FUEL,
    });
    const record = options.record ?? null;
    this.timer = new LapTimer(
      { length: this.track.length, sectors: this.track.sectors },
      record ? { lap: record.lap, sectors: record.bestSectors } : undefined,
    );
    this.ghostValue = record?.ghost ? decodeGhost(record.ghost) : null;
    this.limits = options.limits ?? new TrackLimits(this.track);
    this.poseLimits = invariantLimits(this.car.state.model);
    this.locate();
  }

  /**
   * How many times the safety net put the car back because its pose broke the sim's
   * invariants. The fixes are in the sim and the track; this is the last line, and it stays
   * zero in normal play (a browser test checks).
   */
  get safetyResets(): number {
    return this.safetyResetsValue;
  }

  get phase(): SessionPhase {
    return this.phaseValue;
  }

  /** Track position of the car's reference point. */
  get s(): number {
    return this.sValue;
  }

  get d(): number {
    return this.dValue;
  }

  get wheelsOff(): number {
    return this.wheelsOffValue;
  }

  /** The car is inside a DRS zone, so the flap may open on request. */
  get drsAvailable(): boolean {
    return this.drsAvailableValue;
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

  /** Live gap to the record ghost at the car's position, s; null without a comparison. */
  liveDelta(): number | null {
    if (!this.ghostValue || !this.timer.running) return null;
    const ref = this.ghostValue.timeAtDistance(this.sValue);
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
    const car = this.car;
    const input = car.input;
    const a = this.assistValue;
    input.steer = assistSteer(device, a.steering, control.steer, car.state.vx);
    input.throttle = control.throttle;
    input.brake = control.brake;
    input.gearShift = control.gearShift;
    input.overtake = control.overtake;
    input.pitLimiter = control.pitLimiter;
    // DRS: the time-trial rule is "open on request inside a zone"; there is no car to be near.
    input.drs = control.drs && this.drsAvailableValue;
    applyAssists(a, this.assistMemory, car.state, input, this.world.step, input);

    const prevS = this.sValue;
    const prevT = this.world.time;
    stepWorld(this.world);
    if (checkCarInvariants(car.state, this.poseLimits) !== null) return this.safetyReset(prevS);
    this.locate();

    // Track limits are resolved before the timing lines, so a lap is never committed (or made a
    // record) and only then invalidated. The reading is the car at the end of this tick; when a
    // timing line also falls inside the tick, which happened first is unknown. Policy: a
    // four-off reading counts against every lap that ran during the tick, so it invalidates the
    // outgoing lap before it completes and the lap that starts at the line as well.
    const events: SessionEvent[] = [];
    this.wheelsOffValue = this.limits.wheelsOff(car.state);
    const off = this.wheelsOffValue === 4;
    if (off) this.invalidate('limits', events);
    for (const e of this.timer.update(prevS, this.sValue, prevT, this.world.time)) {
      events.push(e);
      if (e.type === 'lapStart') this.onLine(e.time);
      else if (e.type === 'lap') this.onLapComplete(e, events);
      if (off && (e.type === 'lapStart' || e.type === 'lap')) this.invalidate('limits', events);
    }
    if (this.timer.running && this.recorder.recording) {
      this.recorder.sample(this.timer.currentLapTime(this.world.time), this.sValue, car.pose);
    }
    return events;
  }

  /** Invalidate the running lap once; its ghost recording is dropped (it can never be kept). */
  private invalidate(reason: 'limits' | 'reset' | 'safety', events: SessionEvent[]): void {
    if (!this.timer.running || !this.timer.valid) return;
    this.timer.invalidate();
    this.recorder.cancel();
    events.push({ type: 'invalidated', reason });
  }

  /** The pose broke the invariants: back on the centreline where the car last was sane. */
  private safetyReset(lastS: number): SessionEvent[] {
    const events: SessionEvent[] = [];
    this.safetyResetsValue++;
    const pose = this.lapPose(lastS, 0);
    this.place(pose.x, pose.z, pose.yaw, 0);
    this.invalidate('safety', events);
    events.push({ type: 'reset', reason: 'safety' });
    return events;
  }

  /** Back to the rolling start; timing for the lap in progress is dropped. */
  restartLap(): SessionEvent[] {
    const p = this.rollingStartPose();
    this.place(p.x, p.z, p.yaw, ROLLING_START_SPEED);
    this.timer.restart();
    this.recorder.cancel();
    if (this.phaseValue === 'paused') this.phaseValue = 'running';
    return [{ type: 'reset', reason: 'restart' }];
  }

  /** On the centreline at the nearest point, stopped, facing along the lap. Invalidates the lap. */
  resetToTrack(): SessionEvent[] {
    const events: SessionEvent[] = [];
    const pose = this.lapPose(this.sValue, 0);
    this.place(pose.x, pose.z, pose.yaw, 0);
    this.invalidate('reset', events);
    if (this.phaseValue === 'paused') this.phaseValue = 'running';
    events.push({ type: 'reset', reason: 'track' });
    return events;
  }

  /** Debug and tools: put the car at (s, d) at `speed`, timing back to before the line. */
  teleport(s: number, d = 0, speed = 0): SessionEvent[] {
    const pose = this.lapPose(this.track.wrap(s), d);
    this.place(pose.x, pose.z, pose.yaw, speed);
    this.timer.restart();
    this.recorder.cancel();
    return [{ type: 'reset', reason: 'teleport' }];
  }

  private onLine(time: number): void {
    const st = this.car.state;
    beginErsLap(st);
    st.fuelMass = TIME_TRIAL_FUEL;
    this.recorder.begin();
    this.recorder.sample(this.world.time - time, this.sValue, this.car.pose, true);
  }

  private onLapComplete(e: Extract<TimingEvent, { type: 'lap' }>, events: SessionEvent[]): void {
    const r = e.result;
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
    this.onLine(e.at);
  }

  private rollingStartPose(): Pose {
    const slots = this.track.gridSlots;
    return slots[slots.length - 1] ?? this.track.startPose;
  }

  private lapPose(s: number, d: number): { x: number; z: number; yaw: number } {
    const p = this.track.pointAt(s, d, createVec3());
    const t = this.track.tangentAt(s, createVec3());
    return { x: p.x, z: p.z, yaw: Math.atan2(-t.z, t.x) };
  }

  private place(x: number, z: number, yaw: number, speed: number): void {
    const fresh = createCarState(this.params, {
      x,
      z,
      yaw,
      speed,
      fuel: TIME_TRIAL_FUEL,
      surface: this.world.surface,
      airDensity: this.world.environment.airDensity,
    });
    const car = this.car;
    restoreCar(car.state, snapshotCar(fresh));
    readCarPose(car.state, car.pose);
    readCarPose(car.state, car.previousPose);
    this.assistMemory = createAssistState();
    this.hint.index = -1;
    this.limits.reset();
    this.locate();
  }

  private locate(): void {
    const st = this.car.state;
    const q = this.track.project(st.x, st.z, this.hint, this.q);
    this.sValue = q.s;
    this.dValue = q.d;
    this.drsAvailableValue = this.track.drsZoneAt(q.s) >= 0;
  }
}

/** A scratch pose for callers that read the ghost. */
export const createGhostPose = createCarPose;
