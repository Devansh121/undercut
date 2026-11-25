/** Host-owned AI physics. The room retains authority over ownership, laps and results. */
import {
  createRaceDriver,
  createTrafficView,
  decodeEnvelope,
  decodeRacingLine,
  DEFAULT_RACE_SKILL,
  type Driver,
} from '@undercut/ai';
import { CAR_FLAG, type AiHandover, type CarSnapshot, type GridSlot } from '@undercut/protocol';
import { circuitInfo } from '@undercut/race';
import {
  addCar,
  BODY_HALF_WIDTH,
  beginErsLap,
  createCarParams,
  createCarState,
  createCarTelemetry,
  createWorld,
  readCarPose,
  readCarTelemetry,
  resolveRemoteCarContacts,
  restoreCar,
  setErsMode,
  snapshotCar,
  stepWorld,
  type AeroTrim,
  type RemoteContactBody,
} from '@undercut/sim';
import { createPathPoint, createVec3, TrackSurface, type Track } from '@undercut/track';
import type { RaceArtefacts } from '../game/session';
import { toSnapshot } from './car-state';
import { BlockedCars } from './blocked-cars';
import { LineCounter, type Crossing } from './progress';

export class OnlineAiField {
  readonly world;
  private readonly cars;
  private readonly drivers: Driver[];
  private readonly counters: LineCounter[];
  private readonly lastRaceMs = new Map<number, number>();
  private readonly telemetry = createCarTelemetry();
  private readonly traffic = createTrafficView(20);
  private readonly field = createTrafficView(20);
  private readonly hints;
  private readonly point = createPathPoint();
  private readonly tangent = createVec3();
  private readonly launchCaps: number[];
  private readonly launching: boolean[];
  private elapsed = 0;
  private readonly recovery = new BlockedCars();
  private blocked: ReadonlySet<number> = new Set();
  private readonly crossings: { seat: number; crossing: Crossing }[] = [];

  constructor(
    private readonly track: Track,
    artefacts: RaceArtefacts,
    grid: readonly GridSlot[],
    trim: AeroTrim,
  ) {
    this.world = createWorld({ step: 1 / 240, seed: 1, surface: new TrackSurface(track) });
    const params = createCarParams(trim);
    const line = decodeRacingLine(artefacts.line);
    const envelope = decodeEnvelope(artefacts.envelope);
    const circuit = circuitInfo(track, { timingLine: track.timingLine });
    this.cars = grid.flatMap((g, index) => (g.kind === 'ai' ? [{ ...g, index }] : []));
    this.drivers = this.cars.map((g) => {
      const slot = track.gridSlots[g.index]!;
      const car = addCar(this.world, params, { x: slot.x, z: slot.z, yaw: slot.yaw, fuel: 20 });
      const driver = createRaceDriver({
        track,
        line,
        envelope,
        params,
        skill: { ...DEFAULT_RACE_SKILL, seed: 1 + (g.aiIndex ?? g.seat) * 104729 },
      });
      setErsMode(car.state, driver.ersMode);
      return driver;
    });
    this.counters = this.cars.map((g) => {
      const counter = new LineCounter({
        length: track.length,
        timingLine: circuit.timingLine,
        startS: circuit.grid[g.index]!.s,
      });
      counter.placed(circuit.grid[g.index]!.s, 0);
      return counter;
    });
    this.hints = this.cars.map(() => ({ index: -1 }));
    this.launchCaps = this.cars.map(() => 0.6);
    this.launching = this.cars.map(() => true);
  }

  progress(seat: number): { lap: number; raceMs: number } | null {
    const i = this.cars.findIndex((g) => g.seat === seat);
    return i < 0 ? null : { lap: this.counters[i]!.laps, raceMs: this.lastRaceMs.get(seat) ?? 0 };
  }

  counted(seat: number, raceMs: number): void {
    this.lastRaceMs.set(seat, raceMs);
  }

  /** Handover uses the last service-accepted progress; a crossing is never invented on restore. */
  takeover(handover: readonly AiHandover[]): void {
    this.world.tick = Math.max(this.world.tick, ...handover.map((h) => h.car?.tick ?? 0));
    this.world.time = this.world.tick * this.world.step;
    for (const h of handover) {
      const i = this.cars.findIndex((g) => g.seat === h.seat);
      if (i < 0) continue;
      this.cars[i]!.state = h.state;
      this.lastRaceMs.set(h.seat, h.raceMs);
      const c = this.counters[i]!;
      const s = h.car;
      if (s) {
        const car = this.world.cars[i]!;
        const fresh = createCarState(car.state.params, {
          x: s.x,
          z: s.z,
          yaw: s.yaw,
          speed: 0,
          fuel: 20,
          surface: this.world.surface,
        });
        restoreCar(car.state, snapshotCar(fresh));
        const cos = Math.cos(s.yaw),
          sin = Math.sin(s.yaw);
        car.state.vx = s.vx * cos - s.vz * sin;
        car.state.vy = -s.vx * sin - s.vz * cos;
        car.state.yawRate = s.yawRate;
        car.state.gear = s.gear;
        car.state.engineSpeed = s.rpm * ((2 * Math.PI) / 60);
        car.state.wheelSpeed.set(s.wheelSpin);
        readCarPose(car.state, car.pose);
        readCarPose(car.state, car.previousPose);
        // Seed previous pose so the first outgoing snapshot retains the transferred velocity.
        car.previousPose.x -= s.vx * this.world.step;
        car.previousPose.z -= s.vz * this.world.step;
        car.previousPose.yaw -= s.yawRate * this.world.step;
        const q = this.track.project(s.x, s.z, this.hints[i]!, this.point);
        c.placed(q.s, this.world.time);
        this.launching[i] = Math.hypot(s.vx, s.vz) < 10;
        if ((s.flags & CAR_FLAG.ghost) !== 0 && h.state === 'racing') {
          this.recovery.restore({
            seat: h.seat,
            x: s.x,
            z: s.z,
            yaw: s.yaw,
            vx: s.vx,
            vz: s.vz,
            yawRate: s.yawRate,
          });
        }
      }
      if (h.lap > 0 || h.behindLine === false) c.setLaps(h.lap);
    }
  }

  private halfWidth(s: number, yaw: number): number {
    const tangent = this.track.tangentAt(s, this.tangent);
    const heading = yaw - Math.atan2(-tangent.z, tangent.x);
    return 2.8 * Math.abs(Math.sin(heading)) + BODY_HALF_WIDTH * Math.abs(Math.cos(heading));
  }

  /** One fixed step; human proxies are current owned poses or extrapolated peer poses. */
  step(
    released: boolean,
    humans: readonly RemoteContactBody[],
  ): readonly { seat: number; crossing: Crossing }[] {
    this.crossings.length = 0;
    if (released) {
      this.elapsed += this.world.step;
      const bodies = this.bodies();
      this.blocked = this.recovery.update(bodies, this.world.step, [...bodies, ...humans]);
    }
    const field = this.field;
    field.count = 0;
    for (let i = 0; i < this.cars.length; i++) {
      if (this.cars[i]!.state !== 'racing') continue;
      const car = this.world.cars[i]!;
      const q = this.track.project(car.state.x, car.state.z, this.hints[i]!, this.point);
      if (this.blocked.has(this.cars[i]!.seat) && Math.abs(car.state.vx) < 2) continue;
      Object.assign(field.cars[field.count++]!, {
        id: this.cars[i]!.seat,
        s: q.s,
        d: q.d,
        speed: car.state.vx,
        halfWidth: this.halfWidth(q.s, car.state.yaw),
      });
    }
    for (const h of humans) {
      if (h.ghost || field.count >= field.cars.length) continue;
      const q = this.track.project(h.x, h.z, { index: -1 }, this.point);
      Object.assign(field.cars[field.count++]!, {
        id: h.seat,
        s: q.s,
        d: q.d,
        speed: Math.hypot(h.vx, h.vz),
        halfWidth: this.halfWidth(q.s, h.yaw),
      });
    }
    for (let i = 0; i < this.cars.length; i++) {
      const car = this.world.cars[i]!;
      const driver = this.drivers[i]!;
      const traffic = this.traffic;
      traffic.count = 0;
      for (let k = 0; k < this.field.count; k++) {
        const other = this.field.cars[k]!;
        if (other.id !== this.cars[i]!.seat) Object.assign(traffic.cars[traffic.count++]!, other);
      }
      const own = this.track.project(car.state.x, car.state.z, this.hints[i]!, this.point);
      Object.assign(traffic.self, {
        id: this.cars[i]!.seat,
        s: own.s,
        d: own.d,
        speed: car.state.vx,
        halfWidth: this.halfWidth(own.s, car.state.yaw),
      });
      traffic.active = released;
      traffic.launching = this.launching[i]!;
      driver.sense?.(traffic);
      readCarTelemetry(car.state, this.telemetry);
      driver.drive(this.telemetry, this.world.step, car.input);
      const racing = this.cars[i]!.state === 'racing';
      car.ghost = !racing || this.blocked.has(this.cars[i]!.seat);
      if (!released || !racing) {
        car.input.throttle = 0;
        car.input.brake = 1;
      } else if (this.launching[i]) {
        const slip = Math.max(this.telemetry.slipRatio[2]!, this.telemetry.slipRatio[3]!);
        this.launchCaps[i] = Math.max(
          0.1,
          Math.min(1, this.launchCaps[i]! + (slip > 0.12 ? -4 : 1.5) * this.world.step),
        );
        if (this.telemetry.speed > 25 || this.elapsed > 3) this.launching[i] = false;
        else {
          car.input.throttle = driver.following
            ? Math.min(car.input.throttle, this.launchCaps[i]!)
            : this.launchCaps[i]!;
          if (!driver.following) car.input.brake = 0;
          if (this.telemetry.gear < 1) car.input.gearShift = 1;
        }
      }
    }
    stepWorld(this.world);
    for (let i = 0; i < this.cars.length; i++) {
      const car = this.world.cars[i]!;
      if (released && !car.ghost) resolveRemoteCarContacts(car.state, humans, this.world.surface);
      readCarPose(car.state, car.pose);
      const q = this.track.project(car.state.x, car.state.z, this.hints[i]!, this.point);
      const crossing = this.counters[i]!.update(q.s, this.world.time);
      if (released && this.cars[i]!.state === 'racing' && crossing) {
        beginErsLap(car.state);
        car.state.fuelMass = 20;
        this.crossings.push({ seat: this.cars[i]!.seat, crossing });
      }
    }
    return this.crossings;
  }

  states(grid: readonly GridSlot[]): void {
    for (const car of this.cars) car.state = grid.find((g) => g.seat === car.seat)?.state ?? 'dnf';
  }

  bodies(): RemoteContactBody[] {
    return this.cars.map((g, i) => {
      const s = this.world.cars[i]!.state;
      const c = Math.cos(s.yaw),
        sin = Math.sin(s.yaw);
      return {
        seat: g.seat,
        x: s.x,
        z: s.z,
        yaw: s.yaw,
        vx: s.vx * c - s.vy * sin,
        vz: -s.vx * sin - s.vy * c,
        yawRate: s.yawRate,
        ghost: g.state !== 'racing' || this.blocked.has(g.seat),
      };
    });
  }

  snapshots(serverAt: number): CarSnapshot[] {
    return this.cars.map((g, i) => {
      const car = this.world.cars[i]!;
      const t = readCarTelemetry(car.state, this.telemetry);
      const q = this.track.project(car.state.x, car.state.z, this.hints[i]!, this.point);
      const snapshot = toSnapshot({
        seat: g.seat,
        tick: this.world.tick,
        t: serverAt,
        pose: car.pose,
        prevPose: car.previousPose,
        step: this.world.step,
        speed: t.speed,
        rpm: t.engineRpm,
        gear: t.gear,
        throttle: t.throttle,
        brake: t.brake,
        wheelSpin: t.wheelSpeed,
        drs: t.drs > 0.5,
        lap: this.counters[i]!.laps,
        s: this.counters[i]!.lineS(q.s),
        resets: 0,
        brokenCursor: Math.floor(this.world.tick / 8) % 64,
      });
      if (g.state !== 'racing' || this.blocked.has(g.seat)) snapshot.flags |= CAR_FLAG.ghost;
      return snapshot;
    });
  }
}
