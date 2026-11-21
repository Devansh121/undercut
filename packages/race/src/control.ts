import { createRng, type Rng, type RngState } from '@undercut/core';
import type { CircuitInfo } from './circuit';
import { signedDelta, type CoreCar, type Penalty, type RaceCore } from './core';
import type { PenaltyReason, Phase, RaceEvent, ServiceAction } from './events';
import { copyFacts, createFacts, factsFromJson, factsToJson, type CarFacts } from './facts';
import { createStrategy, type SessionSpec, type SessionStrategy } from './kinds';
import { resolveRules, type RaceRules } from './rules';
import { DrsSystem, type DrsState } from './systems/drs';
import { FlagSystem, type FlagsState } from './systems/flags';
import { LimitsSystem, type LimitsState } from './systems/limits';
import { PitSystem, type PitPhase, type PitState } from './systems/pit';
import { Watchdog, type Anomaly, type WatchdogState } from './systems/watchdog';
import {
  LapTimer,
  crossingFraction,
  type LapTimerState,
  type TimingBests,
} from './timing/lap-timer';
import { GapTower, type TowerState } from './timing/tower';

export interface EntrantRules {
  /** Team index: two cars of a team share a pit box. */
  team: number;
  /** Compound fitted at the start. Default 'medium'. */
  compound?: string;
}

export interface RaceControlOptions {
  circuit: CircuitInfo;
  session: SessionSpec;
  entrants: readonly EntrantRules[];
  seed: number;
  rules?: Partial<RaceRules>;
  /** Sim time when the session begins. Default 0. */
  startTime?: number;
  /** Overall bests to compare with (time trial: the record kept on this device). */
  record?: TimingBests;
}

/** One row of a timing tower. */
export interface StandingRow {
  car: number;
  position: number;
  status: CoreCar['status'];
  /** Lap in progress (race) or laps completed so far. */
  lap: number;
  lapsCompleted: number;
  /** Gap to the leader and to the car ahead, s; null with laps between or no common point. */
  gap: number | null;
  interval: number | null;
  lapsDown: number;
  bestLap: number | null;
  lastLap: number | null;
  inPit: boolean;
  pitStops: number;
  penaltySeconds: number;
}

/** Everything the race engine remembers, as plain JSON. */
export interface RaceControlSnapshot {
  version: 1;
  time: number;
  prevTime: number;
  seen: boolean;
  phase: Phase;
  lightsOn: number;
  lightsStart: number;
  lightsOutTime: number;
  lightsOutAt: number | null;
  greenAt: number | null;
  chequeredAt: number | null;
  finishCount: number;
  rng: RngState;
  overall: TimingBests;
  fastest: { car: number; lap: number; time: number } | null;
  speedTrapBest: number | null;
  order: number[];
  cars: CoreCar[];
  facts: Record<string, number | boolean | null>[];
  prevFacts: Record<string, number | boolean | null>[];
  timers: LapTimerState[];
  tower: TowerState;
  limits: LimitsState;
  flags: FlagsState;
  drs: DrsState;
  pit: PitState;
  watchdog: WatchdogState;
}

/**
 * The race engine: rules over per-tick car facts. Feed it the sim time and every car's facts
 * once per fixed step (`tick`); it returns what happened as typed events and answers what each
 * car may do (DRS, held in the box, flags). Pure and deterministic; the whole state snapshots
 * to JSON and restores (`snapshot` / `restore`).
 *
 * Systems run in a fixed order each tick: start procedure, track limits, timing lines (and the
 * finish), positions, places gained off track, flags, DRS, pit lane, watchdog, session end.
 */
export class RaceControl implements RaceCore {
  readonly rules: RaceRules;
  readonly circuit: CircuitInfo;
  readonly strategy: SessionStrategy;
  readonly rng: Rng;
  readonly cars: CoreCar[];
  readonly facts: CarFacts[];
  readonly prevFacts: CarFacts[];
  readonly timers: LapTimer[];
  readonly tower: GapTower;
  readonly limits: LimitsSystem;
  readonly flags: FlagSystem;
  readonly drs: DrsSystem;
  readonly pit: PitSystem;
  readonly watchdog: Watchdog;
  private readonly overall: TimingBests;
  private timeValue: number;
  private prevTimeValue: number;
  private seen = false;
  private phaseValue: Phase;
  private lightsOn = 0;
  private lightsStart: number;
  private lightsOutTime: number;
  private lightsOutValue: number | null = null;
  private greenAt: number | null;
  private chequeredAt: number | null = null;
  private finishCount = 0;
  private fastestValue: { car: number; lap: number; time: number } | null = null;
  private speedTrapBestValue: number | null = null;
  private orderValue: number[];
  private events: RaceEvent[] = [];

  constructor(o: RaceControlOptions) {
    this.circuit = o.circuit;
    this.rules = resolveRules(o.rules);
    this.strategy = createStrategy(o.session, o.circuit);
    this.rng = createRng((o.seed ^ 0x2c1b3c6d) >>> 0);
    const n = o.entrants.length;
    const count = o.circuit.sectorLines.length;
    this.overall = o.record
      ? {
          lap: o.record.lap,
          sectors: Array.from({ length: count }, (_, i) => o.record?.sectors[i] ?? null),
        }
      : { lap: null, sectors: Array.from({ length: count }, () => null) };
    const lines = { length: o.circuit.length, sectors: o.circuit.sectorLines };
    this.timers = o.entrants.map(() => new LapTimer(lines, undefined, this.overall));
    this.cars = o.entrants.map((e, i) => {
      const compound = e.compound ?? 'medium';
      return {
        status: 'running',
        reason: null,
        team: e.team,
        startS: null,
        finishTime: null,
        finishDist: null,
        finishOrder: null,
        finishLaps: null,
        position: i + 1,
        penalties: [],
        warnings: 0,
        compound,
        compounds: [compound],
        pitStops: 0,
        speedTrapBest: null,
        jumpStart: false,
        bestAt: null,
        bestLapNumber: null,
        dist: 0,
        prevDist: 0,
      };
    });
    this.facts = o.entrants.map(() => createFacts());
    this.prevFacts = o.entrants.map(() => createFacts());
    this.tower = new GapTower(n, o.circuit.length);
    this.limits = new LimitsSystem(n);
    this.flags = new FlagSystem(
      n,
      o.circuit.length,
      o.circuit.timingLine,
      this.rules.marshalSectorLength,
    );
    this.drs = new DrsSystem(n, o.circuit.drsZones.length, (a, b) =>
      this.flags.yellowBetween(a, b),
    );
    this.pit = new PitSystem(
      o.entrants.map((e) => e.team),
      o.circuit.pit.boxes.length,
    );
    this.watchdog = new Watchdog(n, (car) => this.pit.held(car));
    this.orderValue = o.entrants.map((_, i) => i);
    const t0 = o.startTime ?? 0;
    this.timeValue = t0;
    this.prevTimeValue = t0;
    const r = this.rules;
    this.lightsStart = t0 + r.gridTime;
    this.lightsOutTime =
      this.lightsStart + 4 * r.lightInterval + this.rng.range(r.lightsHoldMin, r.lightsHoldMax);
    if (this.strategy.start === 'grid') {
      this.phaseValue = 'grid';
      this.greenAt = null;
    } else {
      this.phaseValue = 'green';
      this.greenAt = t0;
    }
    if (this.strategy.start === 'pit') {
      for (let i = 0; i < n; i++) {
        this.pit.startInGarage(i, t0 + this.strategy.releaseInterval * (i + 1));
      }
    }
  }

  // ---- RaceCore ----

  get time(): number {
    return this.timeValue;
  }

  get prevTime(): number {
    return this.prevTimeValue;
  }

  get phase(): Phase {
    return this.phaseValue;
  }

  get lightsOutAt(): number | null {
    return this.lightsOutValue;
  }

  get order(): readonly number[] {
    return this.orderValue;
  }

  emit(e: RaceEvent): void {
    this.events.push(e);
  }

  penalise(car: number, reason: PenaltyReason, seconds: number): void {
    const c = this.cars[car]!;
    if (this.strategy.penalties) {
      c.penalties.push({ reason, seconds, served: false, at: this.timeValue });
      this.emit({ type: 'penalty', t: this.timeValue, car, reason, seconds });
    } else {
      c.warnings += 1;
      this.emit({ type: 'warning', t: this.timeValue, car, reason });
    }
  }

  invalidate(car: number, reason: 'limits' | 'reset' | 'deleted'): void {
    const timer = this.timers[car]!;
    if (!timer.running || !timer.valid) return;
    timer.invalidate();
    this.emit({ type: 'invalidated', t: this.timeValue, car, lap: timer.lap, reason });
  }

  retire(car: number, reason: string): void {
    const c = this.cars[car]!;
    if (c.status !== 'running') return;
    c.status = 'dnf';
    c.reason = reason;
    this.emit({ type: 'retired', t: this.timeValue, car, reason });
  }

  racing(car: number): boolean {
    const c = this.cars[car]!;
    return (
      c.status === 'running' &&
      c.finishTime === null &&
      (this.phaseValue === 'green' || this.phaseValue === 'chequered')
    );
  }

  unservedPenalty(car: number): number {
    let s = 0;
    for (const p of this.cars[car]!.penalties) if (!p.served) s += p.seconds;
    return s;
  }

  // ---- Queries ----

  get lightsCount(): number {
    return this.lightsOn;
  }

  get fastestLap(): { car: number; lap: number; time: number } | null {
    return this.fastestValue;
  }

  get chequeredTime(): number | null {
    return this.chequeredAt;
  }

  get greenTime(): number | null {
    return this.greenAt;
  }

  get ended(): boolean {
    return this.phaseValue === 'finished';
  }

  timer(car: number): LapTimer {
    return this.timers[car]!;
  }

  /** May this car's DRS flap open at its position now (before the driver's request)? */
  drsAllowed(car: number): boolean {
    return this.drs.allowed(car);
  }

  /** The pit system holds this car at rest (garage, stop, service). */
  held(car: number): boolean {
    return this.pit.held(car);
  }

  pitPhase(car: number): PitPhase {
    return this.pit.phase(car);
  }

  pitRequested(car: number): boolean {
    return this.pit.requested(car);
  }

  pitBox(car: number): { s: number; d: number } | null {
    return this.circuit.pit.boxes[this.pit.box(car)] ?? null;
  }

  /** In the pit lane before the end of the speed limit: the limiter should be on. */
  limiterZone(car: number): boolean {
    const f = this.facts[car]!;
    return f.inPitLane && f.pitS <= this.circuit.pit.limitEnd;
  }

  /** Car about to lap this one while its blue flag is out, else -1. */
  blueFlag(car: number): number {
    return this.flags.blueFor(car);
  }

  yellowHere(car: number): boolean {
    return this.flags.yellowAt(this.facts[car]!.s);
  }

  anomalies(): readonly Anomaly[] {
    return this.watchdog.anomalies();
  }

  // ---- Commands ----

  requestPit(car: number, actions: readonly ServiceAction[]): void {
    this.pit.request(car, actions);
  }

  cancelPit(car: number): void {
    this.pit.cancel(car);
  }

  /** The lap in progress stops counting (a reset to the track). Returns the events it caused. */
  invalidateLap(car: number, reason: 'reset' | 'limits'): RaceEvent[] {
    this.events = [];
    this.invalidate(car, reason);
    return this.flush();
  }

  /** Back to before the first crossing for this car (time trial restart or teleport). */
  restartTiming(car: number): void {
    this.timers[car]!.restart();
  }

  retireCar(car: number, reason: string): RaceEvent[] {
    this.events = [];
    this.retire(car, reason);
    return this.flush();
  }

  /** Gate a driver's DRS request through the rules: true when the flap may be asked open now. */
  gateDrs(car: number, input: { drs: boolean; throttle: number; brake: number }): boolean {
    return this.drs.gate(car, input, this.rules.drsBrake, this.rules.drsLiftThrottle);
  }

  // ---- The tick ----

  /** One fixed step: `time` is the sim time at its end; `facts` one per car, in car order. */
  tick(time: number, facts: readonly CarFacts[]): RaceEvent[] {
    this.events = [];
    if (facts.length !== this.cars.length) throw new RangeError('one CarFacts per car');
    this.prevTimeValue = this.timeValue;
    this.timeValue = time;
    for (let i = 0; i < facts.length; i++) {
      copyFacts(this.facts[i]!, this.prevFacts[i]!);
      copyFacts(facts[i]!, this.facts[i]!);
    }
    if (!this.seen) {
      this.seen = true;
      for (let i = 0; i < facts.length; i++) {
        copyFacts(facts[i]!, this.prevFacts[i]!);
        this.cars[i]!.startS = facts[i]!.s;
      }
    }
    const justStarted = this.stepStart();
    this.limits.tick(this);
    this.stepTiming(justStarted);
    this.stepSessionClock();
    this.stepPositions();
    this.limits.afterPositions(this);
    this.flags.tick(this);
    this.drs.tick(this);
    this.pit.tick(this);
    this.watchdog.tick(this);
    this.stepEnd();
    return this.flush();
  }

  private flush(): RaceEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }

  private setPhase(phase: Phase): void {
    if (this.phaseValue === phase) return;
    this.phaseValue = phase;
    this.emit({ type: 'phase', t: this.timeValue, phase });
  }

  /** Grid, five lights, the random hold, lights out; jump starts. True on the lights-out tick. */
  private stepStart(): boolean {
    if (this.phaseValue !== 'grid' && this.phaseValue !== 'lights') return false;
    const t = this.timeValue;
    const L = this.circuit.length;
    const r = this.rules;
    for (let i = 0; i < this.cars.length; i++) {
      const c = this.cars[i]!;
      const s = this.facts[i]!.s;
      c.prevDist = c.dist;
      c.dist = signedDelta(L, this.circuit.timingLine, s);
      if (c.status !== 'running' || c.jumpStart || c.startS === null) continue;
      if (signedDelta(L, c.startS, s) > r.jumpStartTolerance) {
        c.jumpStart = true;
        this.penalise(i, 'jumpStart', r.jumpStartPenalty);
      }
    }
    if (this.phaseValue === 'grid' && t >= this.lightsStart) this.setPhase('lights');
    if (this.phaseValue !== 'lights') return false;
    const due = Math.min(5, Math.floor((t - this.lightsStart) / r.lightInterval + 1e-9) + 1);
    while (this.lightsOn < due) {
      this.lightsOn += 1;
      this.emit({ type: 'lights', t, count: this.lightsOn });
    }
    if (this.lightsOn < 5 || t < this.lightsOutTime) return false;
    this.lightsOutValue = t;
    this.greenAt = t;
    this.emit({ type: 'lights', t, count: 0 });
    this.setPhase('green');
    for (let i = 0; i < this.cars.length; i++) {
      this.timers[i]!.startAt(t, this.facts[i]!.s);
      const c = this.cars[i]!;
      c.dist = this.timers[i]!.distance;
      c.prevDist = c.dist;
    }
    return true;
  }

  private stepTiming(justStarted: boolean): void {
    const pre = this.phaseValue === 'grid' || this.phaseValue === 'lights';
    if (pre || justStarted) return;
    const L = this.circuit.length;
    const race = this.strategy.classifyBy === 'distance';
    for (let i = 0; i < this.cars.length; i++) {
      const c = this.cars[i]!;
      const timer = this.timers[i]!;
      c.prevDist = c.dist;
      if (c.status !== 'running' || c.finishTime !== null) continue;
      const p = this.prevFacts[i]!;
      const f = this.facts[i]!;
      const evs = timer.update(p.s, f.s, this.prevTimeValue, this.timeValue);
      c.dist = timer.distance;
      for (const e of evs) {
        this.emit({ ...e, t: this.timeValue, car: i });
        if (e.type === 'lapStart') {
          this.limits.onLine(this, i);
          if (this.phaseValue === 'chequered') this.finish(i, e.time);
        } else if (e.type === 'lap') {
          this.limits.onLine(this, i);
          const r = e.result;
          if (r.valid && r.personalBest) {
            c.bestAt = e.at;
            c.bestLapNumber = r.lap;
          }
          if (r.valid && (this.fastestValue === null || r.time < this.fastestValue.time)) {
            this.fastestValue = { car: i, lap: r.lap, time: r.time };
            this.emit({ type: 'fastestLap', t: this.timeValue, car: i, lap: r.lap, time: r.time });
          }
          this.onLapLine(i, r.lap, e.at);
        }
      }
      if (race && timer.running)
        this.tower.update(i, c.prevDist, c.dist, this.prevTimeValue, this.timeValue);
      const frac = crossingFraction(L, p.s, f.s, this.circuit.speedTrap);
      if (frac !== null && timer.running) {
        const speed = p.speed + frac * (f.speed - p.speed);
        const best = this.speedTrapBestValue === null || speed > this.speedTrapBestValue;
        if (best) this.speedTrapBestValue = speed;
        if (c.speedTrapBest === null || speed > c.speedTrapBest) c.speedTrapBest = speed;
        this.emit({ type: 'speedTrap', t: this.timeValue, car: i, speed, best });
      }
    }
  }

  /** A car completed lap `lap` at sim time `at`: the chequered flag, and finishing under it. */
  private onLapLine(car: number, lap: number, at: number): void {
    const s = this.strategy;
    if (this.phaseValue === 'green' && s.laps !== null) {
      const byLaps = lap >= s.laps;
      const byTime =
        s.timeLimit !== null &&
        this.lightsOutValue !== null &&
        at - this.lightsOutValue >= s.timeLimit &&
        this.orderValue[0] === car;
      if (byLaps || byTime) this.showChequered();
    }
    if (this.phaseValue === 'chequered') this.finish(car, at);
  }

  private showChequered(): void {
    if (this.phaseValue === 'chequered' || this.phaseValue === 'finished') return;
    this.chequeredAt = this.timeValue;
    this.emit({ type: 'flag', t: this.timeValue, flag: 'chequered', on: true });
    this.setPhase('chequered');
  }

  private finish(car: number, at: number): void {
    const c = this.cars[car]!;
    if (c.status !== 'running' || c.finishTime !== null) return;
    c.finishTime = at;
    c.finishDist = c.dist;
    c.finishLaps = this.timers[car]!.lapsCompleted;
    c.finishOrder = ++this.finishCount;
    c.status = 'finished';
    this.emit({
      type: 'finish',
      t: this.timeValue,
      car,
      position: c.finishOrder,
      laps: c.finishLaps,
    });
  }

  /** Timed sessions: the flag at the end of the time; cars in the pit lane are done. */
  private stepSessionClock(): void {
    const s = this.strategy;
    if (s.duration === null || this.phaseValue !== 'green' || this.greenAt === null) return;
    if (this.timeValue < this.greenAt + s.duration) return;
    this.showChequered();
    for (let i = 0; i < this.cars.length; i++) {
      if (this.facts[i]!.inPitLane) this.finish(i, this.timeValue);
    }
  }

  private stepPositions(): void {
    const n = this.cars.length;
    const order = this.orderValue.slice();
    if (this.strategy.classifyBy === 'distance') {
      const key = (i: number): number => {
        const c = this.cars[i]!;
        return c.finishDist ?? c.dist;
      };
      const out = (i: number): number => {
        const st = this.cars[i]!.status;
        return st === 'dnf' || st === 'dsq' ? 1 : 0;
      };
      order.sort((a, b) => {
        const g = out(a) - out(b);
        if (g !== 0) return g;
        const d = key(b) - key(a);
        if (d !== 0) return d;
        const fa = this.cars[a]!.finishTime;
        const fb = this.cars[b]!.finishTime;
        if (fa !== null && fb !== null && fa !== fb) return fa - fb;
        if (fa !== null && fb === null) return -1;
        if (fb !== null && fa === null) return 1;
        return a - b;
      });
    } else {
      order.sort((a, b) => {
        const ba = this.timers[a]!.bestLap;
        const bb = this.timers[b]!.bestLap;
        if (ba !== null && bb !== null && ba !== bb) return ba - bb;
        if (ba !== null && bb === null) return -1;
        if (bb !== null && ba === null) return 1;
        if (ba !== null && bb !== null) {
          const ta = this.cars[a]!.bestAt ?? 0;
          const tb = this.cars[b]!.bestAt ?? 0;
          if (ta !== tb) return ta - tb;
        }
        const la = this.timers[a]!.lapsCompleted;
        const lb = this.timers[b]!.lapsCompleted;
        if (la !== lb) return lb - la;
        return a - b;
      });
    }
    const live = this.phaseValue === 'green' || this.phaseValue === 'chequered';
    for (let k = 0; k < n; k++) {
      const car = order[k]!;
      const c = this.cars[car]!;
      const pos = k + 1;
      if (c.position !== pos) {
        if (live)
          this.emit({ type: 'position', t: this.timeValue, car, from: c.position, to: pos });
        c.position = pos;
      }
    }
    this.orderValue = order;
  }

  private stepEnd(): void {
    if (this.phaseValue !== 'chequered' || this.chequeredAt === null) return;
    const allDone = this.cars.every((c) => c.status !== 'running' || c.finishTime !== null);
    if (allDone || this.timeValue >= this.chequeredAt + this.rules.finishTimeout) {
      this.setPhase('finished');
      this.emit({ type: 'sessionEnd', t: this.timeValue });
    }
  }

  // ---- Standings ----

  standings(): StandingRow[] {
    const L = this.circuit.length;
    const order = this.orderValue;
    const leader = order[0];
    const byDistance = this.strategy.classifyBy === 'distance';
    return order.map((car, k) => {
      const c = this.cars[car]!;
      const timer = this.timers[car]!;
      let gap: number | null = null;
      let interval: number | null = null;
      let lapsDown = 0;
      if (k > 0 && leader !== undefined) {
        const ahead = order[k - 1]!;
        if (byDistance) {
          const d = (i: number): number => this.cars[i]!.finishDist ?? this.cars[i]!.dist;
          lapsDown = Math.max(0, Math.floor((d(leader) - d(car)) / L));
          const lead = this.cars[leader]!;
          if (
            c.finishTime !== null &&
            lead.finishTime !== null &&
            c.finishLaps === lead.finishLaps
          ) {
            gap = c.finishTime - lead.finishTime;
          } else if (lapsDown === 0) gap = this.tower.gap(car, leader);
          const aheadCar = this.cars[ahead]!;
          if (
            c.finishTime !== null &&
            aheadCar.finishTime !== null &&
            c.finishLaps === aheadCar.finishLaps
          ) {
            interval = c.finishTime - aheadCar.finishTime;
          } else if (Math.floor((d(ahead) - d(car)) / L) === 0)
            interval = this.tower.gap(car, ahead);
        } else {
          const mine = timer.bestLap;
          const lead = this.timers[leader]!.bestLap;
          const prev = this.timers[ahead]!.bestLap;
          gap = mine !== null && lead !== null ? mine - lead : null;
          interval = mine !== null && prev !== null ? mine - prev : null;
        }
      }
      return {
        car,
        position: k + 1,
        status: c.status,
        lap: timer.lap,
        lapsCompleted: c.finishLaps ?? timer.lapsCompleted,
        gap,
        interval,
        lapsDown,
        bestLap: timer.bestLap,
        lastLap: timer.lastLap,
        inPit: this.facts[car]!.inPitLane,
        pitStops: c.pitStops,
        penaltySeconds: c.penalties.reduce((a, p: Penalty) => a + p.seconds, 0),
      };
    });
  }

  // ---- Snapshot ----

  snapshot(): RaceControlSnapshot {
    return JSON.parse(
      JSON.stringify({
        version: 1,
        time: this.timeValue,
        prevTime: this.prevTimeValue,
        seen: this.seen,
        phase: this.phaseValue,
        lightsOn: this.lightsOn,
        lightsStart: this.lightsStart,
        lightsOutTime: this.lightsOutTime,
        lightsOutAt: this.lightsOutValue,
        greenAt: this.greenAt,
        chequeredAt: this.chequeredAt,
        finishCount: this.finishCount,
        rng: this.rng.getState(),
        overall: this.overall,
        fastest: this.fastestValue,
        speedTrapBest: this.speedTrapBestValue,
        order: this.orderValue,
        cars: this.cars,
        facts: this.facts.map(factsToJson),
        prevFacts: this.prevFacts.map(factsToJson),
        timers: this.timers.map((t) => t.getState()),
        tower: this.tower.getState(),
        limits: this.limits.getState(),
        flags: this.flags.getState(),
        drs: this.drs.getState(),
        pit: this.pit.getState(),
        watchdog: this.watchdog.getState(),
      }),
    ) as RaceControlSnapshot;
  }

  /** Overwrite this engine's state with a snapshot taken from one built with the same options. */
  restore(snap: RaceControlSnapshot): void {
    if (snap.version !== 1)
      throw new Error(`unknown race snapshot version ${String(snap.version)}`);
    if (snap.cars.length !== this.cars.length) throw new Error('snapshot has a different field');
    const s = JSON.parse(JSON.stringify(snap)) as RaceControlSnapshot;
    this.timeValue = s.time;
    this.prevTimeValue = s.prevTime;
    this.seen = s.seen;
    this.phaseValue = s.phase;
    this.lightsOn = s.lightsOn;
    this.lightsStart = s.lightsStart;
    this.lightsOutTime = s.lightsOutTime;
    this.lightsOutValue = s.lightsOutAt;
    this.greenAt = s.greenAt;
    this.chequeredAt = s.chequeredAt;
    this.finishCount = s.finishCount;
    this.rng.setState(s.rng);
    this.overall.lap = s.overall.lap;
    this.overall.sectors.splice(0, this.overall.sectors.length, ...s.overall.sectors);
    this.fastestValue = s.fastest;
    this.speedTrapBestValue = s.speedTrapBest;
    this.orderValue = s.order.slice();
    s.cars.forEach((c, i) => Object.assign(this.cars[i]!, c));
    s.facts.forEach((f, i) => factsFromJson(f, this.facts[i]!));
    s.prevFacts.forEach((f, i) => factsFromJson(f, this.prevFacts[i]!));
    s.timers.forEach((t, i) => this.timers[i]!.setState(t));
    this.tower.setState(s.tower);
    this.limits.setState(s.limits);
    this.flags.setState(s.flags);
    this.drs.setState(s.drs);
    this.pit.setState(s.pit);
    this.watchdog.setState(s.watchdog);
  }
}
