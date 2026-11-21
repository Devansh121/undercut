import {
  addCar,
  applyAssists,
  beginErsLap,
  createAssistState,
  createCarParams,
  createCarPose,
  createCarState,
  createCarTelemetry,
  createSurfaceHint,
  createSurfaceSample,
  createWorld,
  readCarPose,
  readCarTelemetry,
  restoreCar,
  snapshotCar,
  stepWorld,
  type AssistState,
  type CarParams,
  type CarPose,
  type CarTelemetry,
  type ControlInput,
  type SurfaceKind,
  type World,
  type WorldCar,
} from '@undercut/sim';
import { TrackSurface, createPathPoint, createVec3, type Pose, type Track } from '@undercut/track';
import type { DeviceKind } from '@undercut/input';
import { assistSteer, assistsFor, type AssistConfig, type AssistOverrides } from './assists';
import type { Ghost } from './ghost';
import { GhostRecorder, decodeGhost, encodeGhost } from './ghost';
import { TrackLimits } from './limits';
import type { CircuitRecord } from './records';
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
  | { type: 'invalidated'; reason: 'limits' | 'reset' }
  | { type: 'record'; circuit: string; record: CircuitRecord }
  | { type: 'reset'; reason: 'track' | 'restart' | 'teleport' };

export interface DriveSessionOptions {
  track: Track;
  seed: number;
  params?: CarParams;
  /** All-time best for this circuit, from storage. */
  record?: CircuitRecord | null;
  /** Date stamp for new records (YYYY-MM-DD); the session never reads a clock. */
  today?: string;
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
  private readonly limits: TrackLimits;
  private readonly recorder = new GhostRecorder();
  private ghostValue: Ghost | null = null;
  private assistMemory: AssistState = createAssistState();
  private overrides: AssistOverrides = {};
  private assistValue: AssistConfig = assistsFor('keyboard', {});
  private deviceValue: DeviceKind = 'keyboard';
  private readonly hint = { index: -1 };
  private readonly q = createPathPoint();
  private readonly sampleHint = createSurfaceHint();
  private readonly sample = createSurfaceSample();
  private readonly telemetry: CarTelemetry = createCarTelemetry();
  private sValue = 0;
  private dValue = 0;
  private wheelsOffValue = 0;
  private drsAvailableValue = false;
  private readonly today: string;

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
      record ? { lap: record.lap, sectors: record.sectors } : undefined,
    );
    this.ghostValue = record?.ghost ? decodeGhost(record.ghost) : null;
    this.limits = new TrackLimits(this.track);
    this.locate();
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
    this.locate();

    const events: SessionEvent[] = [];
    for (const e of this.timer.update(prevS, this.sValue, prevT, this.world.time)) {
      events.push(e);
      if (e.type === 'lapStart') this.onLine(e.time);
      else if (e.type === 'lap') this.onLapComplete(e, events);
    }
    if (this.timer.running) {
      const lapTime = this.timer.currentLapTime(this.world.time);
      this.recorder.sample(lapTime, this.sValue, car.pose);
      this.wheelsOffValue = this.limits.wheelsOff(car.state);
      if (this.wheelsOffValue === 4 && this.timer.valid) {
        this.timer.invalidate();
        events.push({ type: 'invalidated', reason: 'limits' });
      }
    } else {
      this.wheelsOffValue = this.limits.wheelsOff(car.state);
    }
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
    if (this.timer.running && this.timer.valid) {
      this.timer.invalidate();
      events.push({ type: 'invalidated', reason: 'reset' });
    }
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
    if (this.recorder.recording) {
      this.recorder.sample(r.time, this.track.length, this.car.pose, true);
      const ghost = this.recorder.finish(r.time);
      if (r.record) {
        this.ghostValue = ghost;
        events.push({
          type: 'record',
          circuit: this.track.id,
          record: { lap: r.time, sectors: r.sectors, ghost: encodeGhost(ghost), date: this.today },
        });
      }
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
