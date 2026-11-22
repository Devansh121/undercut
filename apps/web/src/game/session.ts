import { createAiField, type SessionResult, type AiController } from '@undercut/race';
import { decodeEnvelope, decodeRacingLine, racingLineOffsets } from '@undercut/ai';
import raceLine from '../../../../packages/ai/data/monza-low.line.json';
import raceEnvelope from '../../../../packages/ai/data/monza-low.envelope.json';
import {
  InputController,
  RaceSession,
  circuitInfo,
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
import {
  applyDriverAids,
  assistsFor,
  type AssistConfig,
  type AssistOverrides,
  type GuidePosition,
  type SpeedGuide,
} from './assists';
import type { Ghost } from './ghost';
import { GhostRecorder, decodeGhost, encodeGhost } from './ghost';
import type { CircuitRecord, RecordUpdate } from './records';

export type { WheelsOffCounter } from '@undercut/race';

/** A spin: sideslip past this, rad; over once back under `SPIN_OVER`. */
const SPIN_SIDESLIP = (30 * Math.PI) / 180;
const SPIN_OVER = (10 * Math.PI) / 180;

/** Sim step: 240 Hz (ADR 0007). */
export const SIM_STEP = 1 / 240;
/** Time-trial fuel load, kg: a light qualifying-style load, topped up at every line crossing. */
export const TIME_TRIAL_FUEL = 20;
/** Rolling start speed, m/s (150 km/h). */
export const ROLLING_START_SPEED = 150 / 3.6;
/** A reset car in a race is parked with its centre this far inside the track edge, m. */
export const PARK_MARGIN = 1.6;
/** Rolling start: this far before the circuit's timing line, on the centreline, m. */
export const ROLLING_START_RUN_UP = 160;

export type SessionPhase = 'ready' | 'running' | 'paused' | 'ended';

export type SessionEvent =
  | TimingEvent
  | { type: 'invalidated'; reason: 'limits' | 'reset' | 'safety' }
  /** Something to persist: a new best lap, better sector minima, or both. */
  | { type: 'record'; circuit: string; update: RecordUpdate }
  /** `safety`: the car's pose broke the sim's invariants and the session put it back. */
  | { type: 'reset'; reason: 'track' | 'restart' | 'teleport' | 'safety' }
  /** Quick Race: something race control tells the player (a penalty, a flag, the finish). */
  | { type: 'notice'; tag: string; text: string; tone: 'info' | 'invalid' };

export interface QuickRaceOptions {
  laps?: number;
  /** Player starting grid position, 1 (pole) to 20 (back). Defaults to 10 (midfield). */
  gridPosition?: number;
  /** Skill spread across the AI field, 0 to 1. */
  skillSpread?: number;
  /** How far AI pace is shuffled against the grid order, 0 to 1 (default 0.5). */
  gridNoise?: number;
  /**
   * Seconds the AI field waits after lights out before leaving the grid (a test fixture: the
   * player is sure to take the flag first). Default 0.
   */
  fieldStartDelay?: number;
}

export interface DriveSessionOptions {
  track: Track;
  quickRace?: QuickRaceOptions;
  seed: number;
  params?: CarParams;
  /** All-time best for this circuit, from storage. */
  record?: CircuitRecord | null;
  /** Date stamp for new records (YYYY-MM-DD); the session never reads a clock. */
  today?: string;
  /** Track-limit counter; defaults to `TrackLimits` on this track. */
  limits?: WheelsOffCounter;
  /** Initial active input device (defaults to keyboard). */
  device?: DeviceKind;
  /** Advised speeds round the circuit (the driving line), for the braking help. */
  guide?: SpeedGuide;
}

/**
 * A time-trial session: one car on the race engine (`@undercut/race`, time-trial rules: timing
 * from the circuit's timing line, laps invalidated over the track limits, DRS free in the zones,
 * ERS lap and fuel reset at the line), plus what only time trial has: driver assists by device,
 * the ghost of the best lap, records, and the commands the pause menu and the debug API need.
 * Pure: no DOM, no renderer, no clock; the game loop drives `tick`.
 */
export class DriveSession {
  readonly quickRace: boolean;
  private playerPilot: AiController | null = null;
  scriptedRaceDriver = false;
  /**
   * Quick Race: the player has taken the chequered flag. Standings are provisional until the
   * session ends (`result`), and the race driver drives the cooldown lap.
   */
  playerFinished = false;
  readonly raceEvents: RaceEvent[] = [];
  result: SessionResult | null = null;
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
  private assistValue: AssistConfig;
  private deviceValue: DeviceKind;
  private readonly initialDevice: DeviceKind;
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
  private readonly guidePosition: GuidePosition | null;
  private readonly poseLimits: InvariantLimits;
  private safetyResetsValue = 0;
  private wallHitsValue = 0;
  /** Racing-line offset per lap sample (Quick Race: where a reset car is parked out of the way). */
  private readonly lineOffsets: ArrayLike<number> | null;
  private spinsValue = 0;
  private spinning = false;

  constructor(options: DriveSessionOptions) {
    this.quickRace = options.quickRace !== undefined;
    this.track = options.track;
    this.guidePosition = options.guide ? { guide: options.guide, s: 0 } : null;
    this.params = options.params ?? createCarParams('low');
    this.today = options.today ?? '';
    this.initialDevice = options.device ?? 'keyboard';
    this.deviceValue = this.initialDevice;
    this.assistValue = assistsFor(this.deviceValue, this.overrides);
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
    const line = this.quickRace ? decodeRacingLine(raceLine) : null;
    this.lineOffsets = line ? racingLineOffsets(line) : null;
    const gridSlot = this.quickRace
      ? Math.max(0, Math.min(19, Math.round(options.quickRace?.gridPosition ?? 10) - 1))
      : 0;
    const field = line
      ? createAiField({
          track: this.track,
          params: this.params,
          line,
          // Pace shuffled against the grid, as qualifying would leave it: cars have to pass.
          gridNoise: options.quickRace?.gridNoise ?? 0.5,
          envelope: decodeEnvelope(raceEnvelope),
          count: 20,
          seed: options.seed,
          ...(options.quickRace?.skillSpread !== undefined
            ? { spread: options.quickRace.skillSpread }
            : {}),
          ...(options.quickRace?.fieldStartDelay !== undefined
            ? {
                startDelay: options.quickRace.fieldStartDelay,
                noDelay: gridSlot,
                jumpStartChance: 0,
              }
            : {}),
        })
      : [];
    this.playerPilot = field[gridSlot] ?? null;
    const aiField = this.quickRace
      ? [...field.slice(0, gridSlot), ...field.slice(gridSlot + 1)]
      : [];
    const grid = this.quickRace
      ? [
          ...Array.from({ length: gridSlot }, (_, i) => i + 1),
          0,
          ...Array.from({ length: 19 - gridSlot }, (_, i) => gridSlot + 1 + i),
        ]
      : undefined;
    this.race = new RaceSession({
      track: this.track,
      // Timed from the control line the track file carries (format 3), for every circuit.
      circuit: circuitInfo(this.track, { timingLine: this.track.timingLine }),
      session: this.quickRace
        ? { kind: 'race', laps: options.quickRace?.laps ?? 5 }
        : { kind: 'timeTrial' },
      seed: options.seed,
      params: this.params,
      fuel: this.quickRace ? 10 : TIME_TRIAL_FUEL,
      step: SIM_STEP,
      rollingStart: { before: ROLLING_START_RUN_UP, speed: ROLLING_START_SPEED },
      ...(grid ? { grid } : {}),
      cars: [
        {
          entrant: { id: 'player', name: 'Player', code: 'PLY', team: 0 },
          controller: new InputController((ctx, out) => {
            if ((this.scriptedRaceDriver || this.playerFinished) && this.playerPilot) {
              this.playerPilot.control(ctx, out);
            } else this.drive(out);
          }),
        },
        ...aiField.map((controller, i) => ({
          entrant: {
            id: `driver${i + 1}`,
            name: `Driver ${i + 1}`,
            code: `D${i + 1}`,
            team: Math.floor((i + 1) / 2),
          },
          controller,
          ersMode: controller.driver.ersMode,
        })),
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

  /**
   * Spins since the session began: body sideslip past 30° above 8 m/s, counted once until
   * the car is pointing along its path again (under 10°).
   */
  get spins(): number {
    return this.spinsValue;
  }

  /** The player's input for this tick, with the device's assists, written into the car. */
  private drive(out: ControlInput): void {
    if (
      this.quickRace &&
      (this.race.control.phase === 'grid' || this.race.control.phase === 'lights')
    ) {
      Object.assign(out, this.pending, { throttle: 0, brake: 1, gearShift: 0 });
      out.wheelBrake = undefined;
      return;
    }
    if (this.guidePosition) this.guidePosition.s = this.s;
    applyDriverAids(
      this.deviceValue,
      this.assistValue,
      this.assistMemory,
      this.car.state,
      this.pending,
      this.world.step,
      out,
      this.guidePosition ?? undefined,
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

  /** Drop pause-menu overrides and restore the initial device's defaults. */
  resetAssists(): void {
    this.overrides = {};
    this.deviceValue = this.initialDevice;
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
    for (const e of this.race.tick()) {
      if (this.quickRace) {
        this.raceEvents.push(e);
        if (this.raceEvents.length > 500) this.raceEvents.shift();
        if (e.type === 'sessionEnd') {
          this.result = this.race.result();
          this.end();
        }
        // The player has the flag: the classification waits for the field (cars still racing
        // are not "not classified"); the race driver takes the car round its cooldown lap.
        if (e.type === 'finish' && e.car === 0 && !this.playerFinished) {
          this.playerFinished = true;
          this.playerPilot?.reset();
        }
      }
      if (!('car' in e) || e.car === 0) this.onRaceEvent(e, events);
    }
    if (checkCarInvariants(this.car.state, this.poseLimits) !== null) {
      this.safetyReset(lastS, events);
      return events;
    }
    if (this.car.state.wallImpactSpeed > 0) this.wallHitsValue++;
    this.countSpin();
    if (this.timer.running && this.recorder.recording) {
      this.recorder.sample(
        this.timer.currentLapTime(this.world.time),
        this.timer.lapDistance,
        this.car.pose,
      );
    }
    return events;
  }

  private countSpin(): void {
    const st = this.car.state;
    const beta = Math.abs(Math.atan2(st.vy, Math.max(Math.abs(st.vx), 1)));
    if (!this.spinning && beta > SPIN_SIDESLIP && Math.hypot(st.vx, st.vy) > 8) {
      this.spinning = true;
      this.spinsValue++;
    } else if (this.spinning && beta < SPIN_OVER) this.spinning = false;
  }

  /**
   * Race events in, time-trial events out, in order. Track limits are resolved before the
   * timing lines (see `@undercut/race` limits), so a lap is never committed or made a record and
   * only then invalidated; a four-off reading in the tick that crosses the line counts against
   * both laps.
   */
  private onRaceEvent(e: RaceEvent, events: SessionEvent[]): void {
    if (this.quickRace) {
      const n = raceNotice(e);
      if (n) events.push(n);
      return;
    }
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
    if (this.quickRace) {
      this.parkOffLine(lastS, events);
      events.push({ type: 'reset', reason: 'safety' });
      return;
    }
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
    if (this.quickRace) {
      // In a race the car is not dropped on the racing line in front of the field: it is parked
      // at the edge on the side away from the line, stopped, and rejoins from there.
      this.parkOffLine(this.s, events);
      if (this.phaseValue === 'paused') this.phaseValue = 'running';
      events.push({ type: 'reset', reason: 'track' });
      return events;
    }
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

  /**
   * Quick Race: stopped at lap position `s`, facing along the lap, at the track edge on the side
   * away from the racing line (the AI drivers see a car parked off line and go by it).
   */
  private parkOffLine(s: number, events: SessionEvent[]): void {
    const track = this.track;
    const s0 = track.wrap(s);
    const offsets = this.lineOffsets;
    const i = Math.round(s0 / track.lap.step) % track.lap.count;
    const lineD = offsets ? (offsets[i] ?? 0) : 0;
    const margin = PARK_MARGIN;
    const d = lineD >= 0 ? -(track.halfWidthAt(s0, 1) - margin) : track.halfWidthAt(s0, 0) - margin;
    const pose = this.race.lapPose(s0, d);
    this.place(pose.x, pose.z, pose.yaw, 0, events);
  }

  /** Move the car without crossing any line; a retired car is back in the session. */
  private place(x: number, z: number, yaw: number, speed: number, events: SessionEvent[]): void {
    for (const e of this.race.placeCar(0, x, z, yaw, speed, true)) this.onRaceEvent(e, events);
    this.assistMemory = createAssistState();
  }
}

const PENALTY_TEXT: Record<string, string> = {
  jumpStart: 'Jump start',
  trackLimits: 'Track limits',
  leavingTrack: 'Place gained off track',
  pitSpeeding: 'Pit lane speeding',
  blueFlags: 'Ignoring blue flags',
};

/** What race control tells the player about one of the player's own race events, if anything. */
export function raceNotice(e: RaceEvent): Extract<SessionEvent, { type: 'notice' }> | null {
  switch (e.type) {
    case 'penalty':
      return {
        type: 'notice',
        tag: `${e.seconds} s penalty`,
        text: PENALTY_TEXT[e.reason] ?? e.reason,
        tone: 'invalid',
      };
    case 'trackLimits':
      return e.outcome === 'penalty'
        ? null
        : {
            type: 'notice',
            tag: e.outcome === 'blackWhite' ? 'Black and white flag' : 'Track limits',
            text: `Warning ${e.strike}`,
            tone: 'invalid',
          };
    case 'flag':
      return e.flag === 'blue' && e.on
        ? { type: 'notice', tag: 'Blue flag', text: 'Let the car behind through', tone: 'info' }
        : null;
    case 'warning':
      return e.reason === 'overtakeUnderYellow'
        ? { type: 'notice', tag: 'Warning', text: 'Passing under yellow', tone: 'invalid' }
        : null;
    case 'penaltyServed':
      return { type: 'notice', tag: 'Penalty served', text: `${e.seconds} s`, tone: 'info' };
    case 'finish':
      return { type: 'notice', tag: 'Chequered flag', text: `P${e.position}`, tone: 'info' };
    default:
      return null;
  }
}

/** A scratch pose for callers that read the ghost. */
export const createGhostPose = createCarPose;
