/**
 * An online race on the drive screen (a `DriveExtension`). The local car is simulated here as in
 * any session; this layer adds what the room needs and what the other players' cars need:
 *
 * - the car starts standing on its grid slot and is held until the server's lights out, which
 *   both browsers read from the same schedule on their synced clocks;
 * - its state goes to the room as snapshots at the protocol's rate, and each lap is claimed with
 *   the crossing timed on the server clock;
 * - the other cars come from the client library's snapshot buffer, through the smoother, into the
 *   renderer's fleet and onto the map; at 240 Hz, non-ghost remote cars participate in planar
 *   symmetric contact via latency-compensated proxies, with mandatory post-contact barrier clamping.
 */
import { circuitInfo, type CircuitInfo } from '@undercut/race';
import { startLightMask, type CarLivery, type RaceView } from '@undercut/render';
import {
  createCarPose,
  extrapolateRemoteBody,
  readCarPose,
  resolveRemoteCarContacts,
  type CarPose,
  type RemoteContactBody,
} from '@undercut/sim';
import { createPathPoint, type Track } from '@undercut/track';
import { CAR_FLAG, type RoomClient, type StartSchedule, type TimingMessage } from '@undercut/protocol';
import type { DriveExtension, DriveExtensionContext } from '../drive';
import type { ControlSource, DriverFrame } from '../game/loop';
import type { SessionEvent } from '../game/session';
import type { DeltaClass } from '../game/timing';
import type { HudState, TowerRow } from '../ui/hud';
import { S } from '../ui/strings';
import { poseFromView, toSnapshot } from './car-state';
import { seatLivery } from './liveries';
import { LineCounter } from './progress';
import { StartGate } from './start-gate';
import { RaceHud } from './race-hud';
import {
  enforceAssistPolicy,
  lapClaim,
  lightsOn,
  liveOrder,
  localProgress,
  onlineDriverName,
  remoteProgress,
} from './race-rules';
import { RemoteCarSmoother } from './smoother';
import type { OnlineSession } from './session';

/** Grace period after a reset/teleport during which contact with that car is disabled, ms. */
const RESET_GRACE_MS = 2000;

const REASON_TEXT: Record<string, string> = {
  lap_too_fast: 'faster than the circuit allows',
  timestamp_implausible: 'timed off the race clock',
  ahead_of_race_clock: 'ahead of the race clock',
  s_inconsistent: 'not where the car was seen',
  crossed_while_disconnected: 'crossed while disconnected',
  race_time_mismatch: 'lap and race time disagree',
  gap_too_fast: 'too quick for the laps skipped',
  lap_not_monotonic: 'already counted',
};

/** What the start and the race looked like from this browser (debug API and tests). */
export interface OnlineRaceReport {
  circuit: string;
  trim: string;
  seat: number;
  gridPosition: number;
  released: boolean;
  start: StartSchedule | null;
  /** Lights out converted to this browser's clock, as wall-clock ms (comparable across tabs). */
  lightsOutLocalEpoch: number | null;
  /** Wall-clock observation of the first released tick (may run in a catch-up batch). */
  releasedEpoch: number | null;
  /** Local epoch of that simulation tick, from its server-clock mapping. */
  releasedSimEpoch: number | null;
  releasedServerAt: number | null;
  releasedSimTime: number | null;
  elapsedRaceMs: number;
  /** Clock-sync error bound when the car was let go, ms. */
  clockErrorMs: number | null;
  laps: number;
  /** Current lap elapsed seconds shown on the HUD (0 before lights out). */
  lapTimeSec: number;
  /** Live running order as seat numbers (leader first). */
  order: number[];
  claims: { lap: number; raceMs: number; lapMs: number }[];
  timing: { lap: number; status: string; reason: string | null }[];
  snapshotsSent: number;
  remote: { seat: number; x: number; z: number; opacity: number; mode: string }[];
  smoother: { snaps: number; corrections: number; maxCorrectionM: number };
  contacts: { count: number; maxSpeed: number; maxImpulse: number };
  position: number | null;
}

/** Holds the car on the brakes until released; otherwise passes the driver's demand through. */
class StartHold implements ControlSource {
  constructor(
    private readonly inner: ControlSource,
    private readonly held: () => boolean,
  ) {}
  sample(dt: number, speed: number): DriverFrame {
    const f = this.inner.sample(dt, speed);
    if (!this.held()) return f;
    return { ...f, control: { ...f.control, throttle: 0, brake: 1, overtake: false } };
  }
}

export class OnlineRace implements DriveExtension {
  readonly label = 'Online race';
  readonly quitLabel = 'Leave the race';
  readonly raceTrim = true;
  readonly livery: CarLivery;
  private readonly client: RoomClient;
  private track!: Track;
  private circuit!: CircuitInfo;
  private readonly seat: number;
  private readonly gridPosition: number;
  private counter!: LineCounter;
  private length = 0;
  private sectorStarts: number[] = [];
  private trackBound = false;
  private readonly smoother = new RemoteCarSmoother();
  private readonly hud = new RaceHud();
  private readonly poses = new Map<number, CarPose>();
  private readonly finishedAt = new Map<number, number>();
  private readonly behindLine = new Map<number, boolean>();
  private readonly projHints = new Map<number, { index: number }>();
  private readonly projPoint = createPathPoint();
  private readonly latestProgress = new Map<number, number>();
  private latestOrder: number[] = [];
  private readonly contactProxies: RemoteContactBody[] = [];
  private readonly remoteResets = new Map<number, number>();
  private readonly remoteResetUntil = new Map<number, number>();
  private localResetUntil = 0;
  private readonly unsubscribe: (() => void)[] = [];
  private ctx: DriveExtensionContext | null = null;
  /** Lamps last shown on the start gantry (bits as `startLightMask`). */
  private gantryMask = -1;
  private gantryView: RaceView | null = null;
  private wheelDrop = [0.35, 0.35, 0.35, 0.35];
  private released = false;
  private loadedSent = false;
  private readonly gate = new StartGate();
  private resets = 0;
  /** Which word of the broken-object set the next snapshot carries (0 to 63). */
  private brokenCursor = 0;
  private lastRaceMs = 0;
  private lapStartSimTime: number | null = null;
  private sectorStartSimTime: number | null = null;
  private currentSector = 0;
  private prevSectorLineS: number | null = null;
  private currentSectors: (number | null)[] = [null, null, null];
  private currentSectorClasses: (DeltaClass | null)[] = [null, null, null];
  private bestSectors: (number | null)[] = [null, null, null];
  private lastLapSec: number | null = null;
  private lastLapClass: DeltaClass | null = null;
  private bestLapSec: number | null = null;
  private goUntil = 0;
  private position: number | null = null;
  private readonly report: OnlineRaceReport;

  constructor(
    online: OnlineSession,
    private readonly epochOf: (local: number) => number,
    track?: Track,
  ) {
    const client = online.client;
    const room = client?.room;
    const seat = client?.seat;
    if (!client || !room?.grid || seat === null || seat === undefined) {
      throw new Error('An online race needs a room on the grid');
    }
    this.client = client;
    this.seat = seat;
    this.gridPosition = Math.max(
      0,
      room.grid.findIndex((g) => g.seat === seat),
    );
    this.latestOrder = room.grid.map((g) => g.seat);
    const l = seatLivery(seat);
    this.livery = {
      team: l.team,
      primary: l.primary,
      secondary: l.secondary,
      accent: l.accent,
      number: l.number,
      code: l.code,
    };
    this.report = {
      circuit: room.settings.circuit.id,
      trim: 'low',
      seat,
      gridPosition: this.gridPosition + 1,
      released: false,
      start: room.start,
      lightsOutLocalEpoch: null,
      releasedEpoch: null,
      releasedSimEpoch: null,
      releasedServerAt: null,
      releasedSimTime: null,
      elapsedRaceMs: 0,
      clockErrorMs: null,
      laps: 0,
      lapTimeSec: 0,
      order: [...this.latestOrder],
      claims: [],
      timing: [],
      snapshotsSent: 0,
      remote: [],
      smoother: this.smoother.stats,
      contacts: { count: 0, maxSpeed: 0, maxImpulse: 0 },
      position: null,
    };
    if (track) this.bindTrack(track);
  }

  startAt = (track: Track): { s: number; d: number } => this.bindTrack(track);

  private bindTrack(track: Track): { s: number; d: number } {
    this.track = track;
    const circuit = circuitInfo(track, { timingLine: track.timingLine });
    this.circuit = circuit;
    this.length = track.length;
    const slot = circuit.grid[this.gridPosition] ?? circuit.grid[0] ?? { s: 0, d: 0 };
    this.counter = new LineCounter({
      length: track.length,
      timingLine: circuit.timingLine,
      startS: slot.s,
    });
    this.sectorStarts = circuit.sectorLines.map((s) => this.counter.lineS(s));
    this.behindLine.clear();
    const grid = this.client.room?.grid ?? [];
    for (let i = 0; i < grid.length; i++) {
      const g = grid[i]!;
      const gSlot = circuit.grid[i] ?? circuit.grid[0] ?? { s: 0, d: 0 };
      this.behindLine.set(g.seat, this.counter.lineS(gSlot.s) > this.length / 2);
    }
    this.report.circuit = track.id;
    this.trackBound = true;
    return { s: slot.s, d: slot.d };
  }

  wrapControl(source: ControlSource): ControlSource {
    return new StartHold(source, () => this.heldForTick());
  }

  beforeFrame(elapsed: number): void {
    const ctx = this.ctx;
    const now = this.client.serverNow();
    if (!ctx || now === null) return;
    this.gate.beginFrame(
      now,
      elapsed,
      ctx.loop.alpha * ctx.session.world.step,
      ctx.session.world.time,
      this.released ? null : (this.client.room?.start?.lightsOutAt ?? null),
    );
    const sampleAt = this.gate.tickAt(ctx.session.world.time);
    this.prepareContactProxies(Number.isFinite(sampleAt) ? sampleAt : now);
  }

  /**
   * Sample every non-ghost remote car at current server time (extrapolating along its yaw-rate
   * arc when ahead of its newest snapshot) so 240 Hz contact tests against where the peer is now,
   * not where it was one interpolation delay ago.
   */
  private prepareContactProxies(serverTime: number): void {
    this.contactProxies.length = 0;
    const room = this.client.room;
    const finishedSeats = new Set<number>(this.finishedAt.keys());
    if (room?.grid) {
      for (const g of room.grid) {
        if (g.state !== 'racing') finishedSeats.add(g.seat);
      }
    }
    for (const seat of this.client.remoteCars.seatList) {
      if (seat === this.seat) continue;
      const view = this.client.remoteCars.sampleSeat(seat, serverTime);
      if (!view) continue;
      const prevReset = this.remoteResets.get(seat);
      if (prevReset !== undefined && prevReset !== view.resets) {
        this.remoteResetUntil.set(seat, serverTime + RESET_GRACE_MS);
      }
      this.remoteResets.set(seat, view.resets);
      if (view.mode === 'held' || view.opacity < 1) continue;
      if ((view.flags & (CAR_FLAG.retired | CAR_FLAG.pitLane)) !== 0) continue;
      if (finishedSeats.has(seat)) continue;
      if ((this.remoteResetUntil.get(seat) ?? 0) > serverTime) continue;

      const proxy: RemoteContactBody = {
        seat,
        x: view.x,
        z: view.z,
        yaw: view.yaw,
        vx: view.vx,
        vz: view.vz,
        yawRate: view.yawRate,
      };
      if (view.mode === 'extrapolated') {
        const latest = this.client.remoteCars.latest(seat);
        if (latest) {
          extrapolateRemoteBody(
            {
              seat,
              x: latest.x,
              z: latest.z,
              yaw: latest.yaw,
              vx: latest.vx,
              vz: latest.vz,
              yawRate: latest.yawRate,
            },
            Math.max(0, (serverTime - latest.t) / 1000),
            proxy,
          );
        }
      }
      this.contactProxies.push(proxy);
    }
  }

  /** Run at 240 Hz right after each fixed sim step: resolve symmetric contact with remote cars. */
  afterStep(dt: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.released) return;
    // Advance remote proxies in lockstep across all substeps of this frame.
    for (let i = 0; i < this.contactProxies.length; i++) {
      const p = this.contactProxies[i]!;
      extrapolateRemoteBody(p, dt, p);
    }
    const now = this.client.serverNow() ?? 0;
    if (
      this.contactProxies.length === 0 ||
      this.finishedAt.has(this.seat) ||
      now < this.localResetUntil
    ) {
      return;
    }
    const car = ctx.session.car;
    const prevImpulse = car.state.carContactImpulse;
    const touched = resolveRemoteCarContacts(
      car.state,
      this.contactProxies,
      ctx.session.world.surface,
    );
    if (touched > 0) {
      readCarPose(car.state, car.pose);
      this.report.contacts.count += touched;
      if (car.state.carContactSpeed > this.report.contacts.maxSpeed) {
        this.report.contacts.maxSpeed = car.state.carContactSpeed;
      }
      const imp = car.state.carContactImpulse - prevImpulse;
      if (imp > this.report.contacts.maxImpulse) this.report.contacts.maxImpulse = imp;
    }
  }

  private heldForTick(): boolean {
    if (this.released) return false;
    const ctx = this.ctx;
    const c = this.client;
    const start = c.room?.start;
    if (!ctx || !start || c.serverNow() === null) return true;
    const tickAt = this.gate.tickAt(ctx.session.world.time);
    if (tickAt < start.lightsOutAt) return true;
    this.released = true;
    this.goUntil = start.lightsOutAt + 1500;
    this.lapStartSimTime = ctx.session.world.time;
    this.sectorStartSimTime = ctx.session.world.time;
    this.currentSector = 0;
    this.prevSectorLineS = this.counter.lineS(ctx.session.s);
    this.currentSectors = [null, null, null];
    this.currentSectorClasses = [null, null, null];
    this.report.released = true;
    this.report.releasedServerAt = tickAt;
    this.report.releasedSimTime = ctx.session.world.time;
    const local = c.localTimeOf(tickAt);
    this.report.releasedSimEpoch = local === null ? null : this.epochOf(local);
    this.report.releasedEpoch = this.epochOf(performance.now());
    const lightsLocal = c.localTimeOf(start.lightsOutAt);
    this.report.lightsOutLocalEpoch = lightsLocal === null ? null : this.epochOf(lightsLocal);
    this.report.clockErrorMs = c.clock.error;
    return false;
  }

  attach(ctx: DriveExtensionContext): void {
    this.ctx = ctx;
    if (!this.trackBound) this.bindTrack(ctx.session.track);
    this.report.trim = ctx.session.trim;
    const pose = ctx.session.car.pose;
    this.wheelDrop = Array.from(pose.wheelY, (y) => y - pose.y);
    this.counter.placed(ctx.session.s, ctx.session.world.time);
    this.prevSectorLineS = this.counter.lineS(ctx.session.s);
    ctx.host.append(this.hud.root);
    const c = this.client;
    this.unsubscribe.push(
      c.on('timing', (m) => this.onTiming(m)),
      c.on('penalty', (m) => {
        if (m.seat !== this.seat) return;
        const why = m.reason === 'jump_start' ? 'Jump start' : 'Track limits';
        ctx.say({ tag: 'Penalty', text: `${m.ms / 1000} s, ${why}`, tone: 'invalid' }, 4);
      }),
      c.on('limits', (m) => {
        if (m.seat !== this.seat) return;
        ctx.say({ tag: 'Track limits', text: `Warning ${m.warnings}`, tone: 'invalid' }, 3);
      }),
    );
  }

  ready(): void {
    const room = this.client.room;
    if (room?.phase !== 'grid' || this.loadedSent) return;
    const me = room.members.find((m) => m.seat === this.seat);
    const peers = room.members.filter((m) => m.seat !== this.seat && m.connected).length;
    // Remote-car materials compile on their first draw too. A ready car must have the other
    // connected players in its view and a drawn frame with every car shader in it: a frame can
    // skip its draw while the GPU is behind (FramePacer), and a first compile after the lights
    // holds the page for seconds on a slow GPU, long enough for the room to mark it away.
    const warm = this.ctx?.view().carsWarm ?? false;
    if (me && !me.loaded && this.report.remote.length >= peers && warm)
      this.loadedSent = this.client.markLoaded();
  }

  detach(): void {
    for (const u of this.unsubscribe.splice(0)) u();
    this.hud.root.remove();
    this.ctx = null;
  }

  private onTiming(m: TimingMessage): void {
    if (m.seat !== this.seat) return;
    this.report.timing.push({ lap: m.lap, status: m.status, reason: m.reason });
    if (m.status === 'rejected' && m.reason !== 'duplicate') {
      const why = (m.reason && REASON_TEXT[m.reason]) ?? 'refused by the room';
      this.ctx?.say({ tag: 'Lap not counted', text: why, tone: 'invalid' }, 4);
    }
  }

  events(events: readonly SessionEvent[]): void {
    const ctx = this.ctx;
    if (!ctx) return;
    for (const e of events) {
      if (e.type === 'reset') {
        this.resets++;
        const now = this.client.serverNow();
        if (now !== null) this.localResetUntil = now + RESET_GRACE_MS;
        this.counter.placed(ctx.session.s, ctx.session.world.time);
        this.prevSectorLineS = this.counter.lineS(ctx.session.s);
      } else if (e.type === 'invalidated' && e.reason === 'limits' && this.racing()) {
        this.client.reportLimits(this.seat, this.counter.laps);
      }
    }
  }

  /** My car is on track and still racing (not finished, not retired). */
  private racing(): boolean {
    const room = this.client.room;
    if (!this.released || !room?.grid) return false;
    if (room.phase !== 'racing' && room.phase !== 'finished') return false;
    return room.grid.find((g) => g.seat === this.seat)?.state === 'racing';
  }

  /** Update sector splits as the local car passes each sector start line along the lap. */
  private trackSectors(lineS: number, simTime: number): void {
    if (!this.released || this.finishedAt.has(this.seat) || this.counter.behindLine) {
      this.prevSectorLineS = lineS;
      return;
    }
    const prev = this.prevSectorLineS;
    this.prevSectorLineS = lineS;
    if (prev === null || this.sectorStartSimTime === null) return;
    // Ignore jumps across more than a quarter lap (teleports/resets or timing-line wraps).
    const step = lineS - prev;
    if (step <= 0 || step > this.length / 4) return;
    while (this.currentSector + 1 < this.sectorStarts.length) {
      const boundary = this.sectorStarts[this.currentSector + 1]!;
      if (prev < boundary && lineS >= boundary) {
        const dt = Math.max(0, simTime - this.sectorStartSimTime);
        const best = this.bestSectors[this.currentSector] ?? null;
        const cls: DeltaClass = best === null || dt < best ? 'personal' : 'slower';
        this.currentSectors[this.currentSector] = dt;
        this.currentSectorClasses[this.currentSector] = cls;
        if (best === null || dt < best) this.bestSectors[this.currentSector] = dt;
        this.currentSector++;
        this.sectorStartSimTime = simTime;
      } else {
        break;
      }
    }
  }

  frame(f: { dt: number; pose: CarPose; paused: boolean }): HudState['others'] {
    const ctx = this.ctx;
    if (!ctx) return [];
    const c = this.client;
    const room = c.room;
    const session = ctx.session;
    const policy = room?.settings.assists;
    if (policy) enforceAssistPolicy(policy, session);
    const now = c.serverNow();
    const start = room?.start ?? null;
    this.report.start = start;

    // Laps: one claim per forward crossing of the timing line, timed on the server clock.
    const lineS = this.counter.lineS(session.s);
    const crossing = this.counter.update(session.s, session.world.time);
    if (crossing && start && now !== null && this.racing()) {
      const telemetry = session.readTelemetry();
      const claim = lapClaim({
        seat: this.seat,
        lap: crossing.lap,
        crossTime: crossing.time,
        simTime: session.world.time,
        serverNow: now,
        lightsOutAt: start.lightsOutAt,
        lastRaceMs: this.lastRaceMs,
        tick: session.world.tick,
        s: lineS,
        speed: Math.abs(telemetry.speed),
      });
      if (claim) {
        c.reportLap(claim);
        this.lastRaceMs = claim.raceMs;
        this.report.claims.push({ lap: claim.lap, raceMs: claim.raceMs, lapMs: claim.lapMs });
        const lapSec = claim.lapMs / 1000;
        const isBest = this.bestLapSec === null || lapSec < this.bestLapSec;
        this.lastLapSec = lapSec;
        this.lastLapClass = isBest ? 'personal' : 'slower';
        if (isBest) this.bestLapSec = lapSec;
        this.lapStartSimTime = crossing.time;
        this.sectorStartSimTime = crossing.time;
        this.currentSector = 0;
        this.currentSectors = [null, null, null];
        this.currentSectorClasses = [null, null, null];
        this.prevSectorLineS = lineS;
      }
    } else {
      this.trackSectors(lineS, session.world.time);
    }
    this.report.laps = this.counter.laps;

    // My car to the room.
    const onTrack =
      room !== null &&
      ['grid', 'formation', 'lights', 'racing', 'finished'].includes(room.phase) &&
      now !== null;
    if (onTrack && c.snapshotDue()) {
      const t = session.readTelemetry();
      const sent = c.sendSnapshots([
        toSnapshot({
          seat: this.seat,
          tick: session.world.tick,
          t: now,
          pose: session.car.pose,
          prevPose: session.car.previousPose,
          step: session.world.step,
          speed: t.speed,
          rpm: t.engineRpm,
          gear: t.gear,
          throttle: t.throttle,
          brake: t.brake,
          wheelSpin: t.wheelSpeed,
          drs: t.drs > 0.5,
          lap: this.counter.laps,
          s: lineS,
          resets: this.resets,
          brokenCursor: this.brokenCursor,
        }),
      ]);
      if (sent) {
        this.report.snapshotsSent++;
        this.brokenCursor = (this.brokenCursor + 1) % 64;
      }
    }

    // The other cars.
    const views = now === null ? [] : this.smoother.update(c.remoteCars.sample(now), f.dt);
    // Objects the other clients have seen broken (on joining, after a reconnect, or more than
    // four at once): consumed here, so this car takes no impulse from them and draws them down.
    const flags = session.car.state.brokenObjects;
    const remoteSet = c.remoteCars.brokenSet;
    for (let w = 0; w < flags.length && w < remoteSet.length; w++)
      flags[w] = flags[w]! | remoteSet[w]!;
    const drawn: { livery: CarLivery; pose: CarPose; opacity: number }[] = [];
    const others: { x: number; z: number; colour: string; opacity: number }[] = [];
    const remote: OnlineRaceReport['remote'] = [];
    for (const v of views) {
      let pose = this.poses.get(v.seat);
      if (!pose) {
        pose = createCarPose();
        this.poses.set(v.seat, pose);
      }
      poseFromView(v, this.wheelDrop, f.dt, pose);
      // A remote hit consumes the lightweight object here too; its debris has no contact.
      const hits = v.breakableHits;
      if (hits)
        for (let k = 0; k < hits.length; k += 4) {
          const id = hits[k]!;
          if (id < 0 || id >= 2048) continue;
          const flags = session.car.state.brokenObjects;
          flags[id >>> 5] = flags[id >>> 5]! | (1 << (id & 31));
        }
      const l = seatLivery(v.seat);
      drawn.push({
        livery: {
          team: l.team,
          primary: l.primary,
          secondary: l.secondary,
          accent: l.accent,
          number: l.number,
          code: l.code,
        },
        pose,
        opacity: v.opacity,
      });
      others.push({ x: v.x, z: v.z, colour: l.primary, opacity: v.opacity });
      remote.push({ seat: v.seat, x: v.x, z: v.z, opacity: v.opacity, mode: v.mode });
    }
    const view: RaceView = ctx.view();
    // Every view, including one rebuilt for a quality switch or a context restore.
    view.warmCars();
    view.setRemoteCars(drawn);
    this.report.remote = remote;

    this.updateOverlay(now, views);
    return others;
  }

  private updateOverlay(
    now: number | null,
    views: readonly { seat: number; lap: number; s: number; x: number; z: number }[],
  ): void {
    const room = this.client.room;
    const start = room?.start ?? null;
    const phase = room?.phase ?? 'lobby';
    const grid = room?.grid ?? [];
    for (const g of grid) {
      if (g.state === 'finished' && !this.finishedAt.has(g.seat)) {
        this.finishedAt.set(g.seat, now ?? 0);
      }
    }
    const myLineS = this.ctx ? this.counter.lineS(this.ctx.session.s) : 0;
    const myProgress = localProgress(
      this.length,
      this.counter.laps,
      myLineS,
      this.counter.behindLine,
    );
    this.latestProgress.clear();
    this.latestProgress.set(this.seat, myProgress);
    const seen = new Set<number>([this.seat]);
    const runners = [
      {
        seat: this.seat,
        lap: this.counter.laps,
        s: myLineS,
        progress: myProgress,
        finishedAt: this.finishedAt.get(this.seat) ?? null,
      },
    ];
    for (const v of views) {
      seen.add(v.seat);
      if (v.lap > 0 || v.s < this.length / 2) this.behindLine.set(v.seat, false);
      let hint = this.projHints.get(v.seat);
      if (!hint) {
        hint = { index: -1 };
        this.projHints.set(v.seat, hint);
      }
      const q = this.track.project(v.x, v.z, hint, this.projPoint);
      const projLineS = this.counter.lineS(q.s);
      const prog = remoteProgress(
        this.length,
        v.lap,
        v.s,
        projLineS,
        this.behindLine.get(v.seat) ?? false,
      );
      this.latestProgress.set(v.seat, prog);
      runners.push({
        seat: v.seat,
        lap: v.lap,
        s: projLineS,
        progress: prog,
        finishedAt: this.finishedAt.get(v.seat) ?? null,
      });
    }
    // Include grid cars without a snapshot yet (e.g. disconnected or still loading) using grid slot.
    for (let i = 0; i < grid.length; i++) {
      const g = grid[i]!;
      if (seen.has(g.seat)) continue;
      const gSlot = this.circuit.grid[i] ?? this.circuit.grid[0] ?? { s: 0, d: 0 };
      const gLineS = this.counter.lineS(gSlot.s);
      const prog = localProgress(this.length, 0, gLineS, this.behindLine.get(g.seat) ?? false);
      this.latestProgress.set(g.seat, prog);
      runners.push({
        seat: g.seat,
        lap: 0,
        s: gLineS,
        progress: prog,
        finishedAt: this.finishedAt.get(g.seat) ?? null,
      });
    }
    const order = this.released ? liveOrder(this.length, runners) : grid.map((g) => g.seat);
    this.latestOrder = order;
    this.report.order = [...order];
    this.position = this.released ? order.indexOf(this.seat) + 1 : this.gridPosition + 1;
    this.report.position = this.position;
    const finished = this.finishedAt.has(this.seat);
    const laps = room?.settings.laps ?? 1;

    let lights: number | null = null;
    let caption = '';
    if (phase === 'grid') {
      lights = 0;
      caption = 'Waiting for every car to load';
    } else if (phase === 'formation') {
      lights = 0;
      caption = 'On the grid';
    } else if (start && now !== null && now < start.lightsOutAt) {
      lights = lightsOn(start, now);
    } else if (now !== null && now < this.goUntil) {
      caption = 'Lights out';
    }
    if (phase === 'finished' && !finished) caption = 'Chequered flag: finish this lap';
    if (finished) caption = room?.phase === 'results' ? '' : 'Waiting for the others to finish';
    // The start gantry over the grid shows the same lamps; all out at lights out.
    // A rebuilt view (quality switch, context restore) gets them again.
    const mask = startLightMask(lights);
    const view = this.ctx?.view() ?? null;
    if (view && (mask !== this.gantryMask || view !== this.gantryView)) {
      this.gantryMask = mask;
      this.gantryView = view;
      view.world?.setStartLights(mask);
    }
    this.hud.update({
      lights,
      lamps: start?.lightCount ?? 5,
      caption,
      position: this.position,
      cars: Math.max(1, grid.length),
      lap: this.counter.laps + 1,
      laps,
      finished,
      reconnecting: this.client.status === 'reconnecting',
    });
  }

  /** Supply live race lap timing and multi-car timing tower rows to the drive HUD. */
  updateHud(h: HudState, renderTime: number): void {
    const room = this.client.room;
    const grid = room?.grid ?? [];
    const laps = room?.settings.laps ?? 1;
    const finished = this.finishedAt.has(this.seat);
    const currentLap = Math.min(laps, Math.max(1, this.counter.laps + 1));

    // Online races have no out lap, no time-trial invalidation flag, and no ghost or record.
    h.lap = currentLap;
    h.valid = true;
    h.record = null;
    h.liveDelta = null;
    h.ghost = false;
    h.last = this.lastLapSec;
    h.lastClass = this.lastLapClass;
    h.best = this.bestLapSec;

    if (!this.released || this.lapStartSimTime === null) {
      h.running = false;
      h.lapTime = 0;
      for (const slot of h.sectors) {
        slot.state = 'none';
        slot.time = null;
        slot.delta = null;
      }
    } else if (finished) {
      h.running = this.lastLapSec !== null;
      h.lapTime = this.lastLapSec ?? 0;
      for (const slot of h.sectors) {
        slot.state = 'none';
        slot.time = null;
        slot.delta = null;
      }
    } else {
      h.running = true;
      h.lapTime = Math.max(0, renderTime - this.lapStartSimTime);
      for (let i = 0; i < 3; i++) {
        const slot = h.sectors[i]!;
        const done = this.currentSectors[i] ?? null;
        if (done !== null) {
          const ref = this.bestSectors[i] ?? null;
          slot.state = this.currentSectorClasses[i] ?? 'slower';
          slot.time = done;
          slot.delta = ref === null ? null : done - ref;
        } else if (i === this.currentSector) {
          slot.state = 'run';
          slot.time = null;
          slot.delta = null;
        } else {
          slot.state = 'none';
          slot.time = null;
          slot.delta = null;
        }
      }
    }
    this.report.lapTimeSec = h.running ? h.lapTime : 0;

    // Timing tower: live order with member names / AI labels instead of Time Trial REC/GHOST.
    const bySeat = new Map(grid.map((g) => [g.seat, g]));
    const nameByMember = new Map((room?.members ?? []).map((m) => [m.id, m.name]));
    const leaderSeat = this.latestOrder[0];
    const leaderProg = leaderSeat === undefined ? 0 : (this.latestProgress.get(leaderSeat) ?? 0);
    const rows: TowerRow[] = [];
    for (let i = 0; i < this.latestOrder.length; i++) {
      const seat = this.latestOrder[i]!;
      const g = bySeat.get(seat);
      const l = seatLivery(seat);
      let value = '—';
      let tone: TowerRow['tone'] = 'empty';
      if (g?.state === 'dnf') {
        value = 'DNF';
        tone = 'empty';
      } else if (g?.state === 'finished' || this.finishedAt.has(seat)) {
        value = 'FIN';
        tone = '';
      } else if (this.released) {
        if (i === 0) {
          value = 'Leader';
          tone = '';
        } else {
          const prog = this.latestProgress.get(seat) ?? leaderProg;
          const gapM = Math.max(0, leaderProg - prog);
          if (gapM >= this.length) {
            value = `+${Math.floor(gapM / this.length)} L`;
          } else {
            value = `+${(gapM / 65).toFixed(1)}s`;
          }
          tone = '';
        }
      }
      const memberName = g?.member ? (nameByMember.get(g.member) ?? null) : null;
      rows.push({
        id: `seat-${seat}`,
        position: i + 1,
        code: onlineDriverName(memberName, g?.aiIndex, seat),
        teamColour: l.primary,
        value,
        tone,
        player: seat === this.seat,
      });
    }
    const phase = room?.phase ?? 'lobby';
    const flag =
      phase === 'finished' || finished
        ? { kind: 'chequered' as const, text: 'Chequered flag' }
        : !this.released
          ? { kind: 'neutral' as const, text: 'Grid' }
          : { kind: 'green' as const, text: S.hud.greenFlag };
    h.tower = {
      lap: currentLap,
      total: laps,
      rows,
      footer: null,
      flag,
    };
  }

  /** The start and the race so far, as plain data. */
  snapshot(): OnlineRaceReport {
    return {
      ...this.report,
      elapsedRaceMs: Math.max(
        0,
        (this.client.serverNow() ?? 0) - (this.client.room?.start?.lightsOutAt ?? Infinity),
      ),
      order: [...this.report.order],
      claims: [...this.report.claims],
      timing: [...this.report.timing],
      smoother: { ...this.smoother.stats },
      contacts: { ...this.report.contacts },
    };
  }
}
