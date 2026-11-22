/**
 * An online race on the drive screen (a `DriveExtension`). The local car is simulated here as in
 * any session; this layer adds what the room needs and what the other players' cars need:
 *
 * - the car starts standing on its grid slot and is held until the server's lights out, which
 *   both browsers read from the same schedule on their synced clocks;
 * - its state goes to the room as snapshots at the protocol's rate, and each lap is claimed with
 *   the crossing timed on the server clock;
 * - the other cars come from the client library's snapshot buffer, through the smoother, into the
 *   renderer's fleet and onto the map. They are ghosts for contact in this slice.
 */
import { circuitInfo } from '@undercut/race';
import { startLightMask, type CarLivery, type RaceView } from '@undercut/render';
import { createCarPose, type CarPose } from '@undercut/sim';
import type { Track } from '@undercut/track';
import type { RoomClient, StartSchedule, TimingMessage } from '@undercut/protocol';
import type { DriveExtension, DriveExtensionContext } from '../drive';
import type { ControlSource, DriverFrame } from '../game/loop';
import type { SessionEvent } from '../game/session';
import type { HudState } from '../ui/hud';
import { poseFromView, toSnapshot } from './car-state';
import { seatLivery } from './liveries';
import { LineCounter } from './progress';
import { StartGate } from './start-gate';
import { RaceHud } from './race-hud';
import { enforceAssistPolicy, lapClaim, lightsOn, liveOrder } from './race-rules';
import { RemoteCarSmoother } from './smoother';
import type { OnlineSession } from './session';

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
  claims: { lap: number; raceMs: number; lapMs: number }[];
  timing: { lap: number; status: string; reason: string | null }[];
  snapshotsSent: number;
  remote: { seat: number; x: number; z: number; opacity: number; mode: string }[];
  smoother: { snaps: number; corrections: number; maxCorrectionM: number };
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
  readonly startAt: { s: number; d: number };
  readonly livery: CarLivery;
  private readonly client: RoomClient;
  private readonly seat: number;
  private readonly gridPosition: number;
  private readonly counter: LineCounter;
  private readonly length: number;
  private readonly smoother = new RemoteCarSmoother();
  private readonly hud = new RaceHud();
  private readonly poses = new Map<number, CarPose>();
  private readonly finishedAt = new Map<number, number>();
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
  private lastRaceMs = 0;
  private goUntil = 0;
  private position: number | null = null;
  private readonly report: OnlineRaceReport;

  constructor(
    online: OnlineSession,
    track: Track,
    private readonly epochOf: (local: number) => number,
  ) {
    const client = online.client;
    const room = client?.room;
    const seat = client?.seat;
    if (!client || !room?.grid || seat === null || seat === undefined) {
      throw new Error('An online race needs a room on the grid');
    }
    this.client = client;
    this.seat = seat;
    const circuit = circuitInfo(track);
    this.length = track.length;
    this.gridPosition = Math.max(
      0,
      room.grid.findIndex((g) => g.seat === seat),
    );
    const slot = circuit.grid[this.gridPosition] ?? circuit.grid[0] ?? { s: 0, d: 0 };
    this.startAt = { s: slot.s, d: slot.d };
    this.counter = new LineCounter({
      length: track.length,
      timingLine: circuit.timingLine,
      startS: slot.s,
    });
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
      claims: [],
      timing: [],
      snapshotsSent: 0,
      remote: [],
      smoother: this.smoother.stats,
      position: null,
    };
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
    const pose = ctx.session.car.pose;
    this.wheelDrop = Array.from(pose.wheelY, (y) => y - pose.y);
    this.counter.placed(ctx.session.s, ctx.session.world.time);
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
    // Remote-car materials compile on their first draw too. A ready car must have
    // rendered the other connected players, not just its own body and the track.
    if (me && !me.loaded && this.report.remote.length >= peers)
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
        this.counter.placed(ctx.session.s, ctx.session.world.time);
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
        s: this.counter.lineS(session.s),
        speed: Math.abs(telemetry.speed),
      });
      if (claim) {
        c.reportLap(claim);
        this.lastRaceMs = claim.raceMs;
        this.report.claims.push({ lap: claim.lap, raceMs: claim.raceMs, lapMs: claim.lapMs });
      }
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
          s: this.counter.lineS(session.s),
          resets: this.resets,
        }),
      ]);
      if (sent) this.report.snapshotsSent++;
    }

    // The other cars.
    const views = now === null ? [] : this.smoother.update(c.remoteCars.sample(now), f.dt);
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
    view.setRemoteCars(drawn);
    this.report.remote = remote;

    this.updateHud(now, views);
    return others;
  }

  private updateHud(
    now: number | null,
    views: readonly { seat: number; lap: number; s: number }[],
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
    const runners = [
      {
        seat: this.seat,
        lap: this.counter.laps,
        s: this.ctx ? this.counter.lineS(this.ctx.session.s) : 0,
        finishedAt: this.finishedAt.get(this.seat) ?? null,
      },
      ...views.map((v) => ({
        seat: v.seat,
        lap: v.lap,
        s: v.s,
        finishedAt: this.finishedAt.get(v.seat) ?? null,
      })),
    ];
    const order = liveOrder(this.length, runners);
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

  /** The start and the race so far, as plain data. */
  snapshot(): OnlineRaceReport {
    return {
      ...this.report,
      elapsedRaceMs: Math.max(
        0,
        (this.client.serverNow() ?? 0) - (this.client.room?.start?.lightsOutAt ?? Infinity),
      ),
      claims: [...this.report.claims],
      timing: [...this.report.timing],
      smoother: { ...this.smoother.stats },
    };
  }
}
