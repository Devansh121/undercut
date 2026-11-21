import type { RaceCore, RaceSystem } from '../core';
import type { ServiceAction } from '../events';
import { SERVICE_TIMES } from '../rules';

/**
 * The pit lane and the stop sequence, as a small state machine per car:
 *
 *     none ──entry──▶ lane ──stops in its box──▶ stopped ─┬─▶ penalty ─┐
 *                     │                                   └────────────┴─▶ (queued) ─▶ service
 *                     └──exit──▶ none                       released ◀── waitRelease ◀──┘
 *     garage (session start in the pit lane) ─────────────▶ released ──exit──▶ none
 *
 * - Entry and exit come from the pit geometry (the car is on the pit-lane surface or not).
 * - Between the speed-limit lines the car must not exceed the limit (plus a small tolerance):
 *   a time penalty in a race, a warning otherwise, once per visit.
 * - A stop is the car at rest within its team's box. Unserved time penalties are served first,
 *   stationary, then the service actions run for their service time (data) plus a seeded
 *   spread. A team-mate already in service makes the second car wait (stacking).
 * - Release waits until no car is coming down the lane within `releaseClearBehind` of the box
 *   (unsafe-release avoidance).
 * - While stopped the car is held: the session applies the brakes and ignores the driver.
 */
export type PitPhase =
  | 'none'
  | 'garage'
  | 'lane'
  | 'stopped'
  | 'penalty'
  | 'queued'
  | 'service'
  | 'waitRelease'
  | 'released';

interface PitCar {
  phase: PitPhase;
  until: number;
  releaseAt: number;
  requested: boolean;
  actions: ServiceAction[];
  speeding: boolean;
  wasIn: boolean;
  box: number;
  penaltyServed: number;
}

export interface PitState {
  cars: PitCar[];
}

const HELD: ReadonlySet<PitPhase> = new Set([
  'garage',
  'stopped',
  'penalty',
  'queued',
  'service',
  'waitRelease',
]);

export class PitSystem implements RaceSystem<PitState> {
  private cars: PitCar[];

  constructor(teams: readonly number[], boxes: number) {
    this.cars = teams.map((team) => ({
      phase: 'none' as PitPhase,
      until: 0,
      releaseAt: 0,
      requested: false,
      actions: [],
      speeding: false,
      wasIn: false,
      box: boxes > 0 ? team % boxes : 0,
      penaltyServed: 0,
    }));
  }

  phase(car: number): PitPhase {
    return this.cars[car]!.phase;
  }

  box(car: number): number {
    return this.cars[car]!.box;
  }

  held(car: number): boolean {
    return HELD.has(this.cars[car]!.phase);
  }

  requested(car: number): boolean {
    return this.cars[car]!.requested;
  }

  actions(car: number): readonly ServiceAction[] {
    return this.cars[car]!.actions;
  }

  /** Start the session with the car in its box, leaving at `releaseAt`. */
  startInGarage(car: number, releaseAt: number): void {
    const c = this.cars[car]!;
    c.phase = 'garage';
    c.releaseAt = releaseAt;
    c.wasIn = true;
  }

  /** Ask the car in (its driver reads this) with the actions to carry out. */
  request(car: number, actions: readonly ServiceAction[]): void {
    const c = this.cars[car]!;
    c.requested = true;
    c.actions = actions.map((a) => ({ ...a }));
  }

  cancel(car: number): void {
    const c = this.cars[car]!;
    if (c.phase === 'none' || c.phase === 'lane') {
      c.requested = false;
      c.actions = [];
    }
  }

  tick(core: RaceCore): void {
    const { rules, circuit } = core;
    const pit = circuit.pit;
    for (let i = 0; i < this.cars.length; i++) {
      const c = this.cars[i]!;
      const f = core.facts[i]!;
      const car = core.cars[i]!;
      const inLane = f.inPitLane;
      const t = core.time;
      if (inLane && !c.wasIn && c.phase === 'none') {
        c.phase = 'lane';
        c.speeding = false;
        core.emit({ type: 'pit', t, car: i, stage: 'entry' });
      }
      const box = pit.boxes[c.box];
      switch (c.phase) {
        case 'garage':
          if (t >= c.releaseAt && core.phase !== 'finished' && this.clear(core, i)) {
            c.phase = 'released';
            core.emit({ type: 'pit', t, car: i, stage: 'release' });
          }
          break;
        case 'lane':
          if (
            box &&
            inLane &&
            f.speed < rules.stoppedSpeed &&
            Math.abs(f.pitS - box.s) <= rules.boxToleranceS &&
            Math.abs(f.pitD - box.d) <= rules.boxToleranceD &&
            car.status === 'running'
          ) {
            c.phase = 'stopped';
            core.emit({ type: 'pit', t, car: i, stage: 'stop' });
            this.afterStop(core, i, c);
          } else if (box && inLane && c.requested && f.pitS > box.s + rules.boxToleranceS + 2) {
            c.requested = false;
            core.emit({ type: 'pit', t, car: i, stage: 'missed' });
          }
          break;
        case 'penalty':
          if (t >= c.until) {
            for (const p of car.penalties) if (!p.served) p.served = true;
            core.emit({ type: 'penaltyServed', t, car: i, seconds: c.penaltyServed });
            this.serviceOrQueue(core, i, c);
          }
          break;
        case 'queued':
          this.serviceOrQueue(core, i, c);
          break;
        case 'service':
          if (t >= c.until) {
            const done = c.actions;
            for (const a of done) {
              if (a.kind === 'tyres') {
                car.compound = a.compound;
                if (!car.compounds.includes(a.compound)) car.compounds.push(a.compound);
              }
            }
            car.pitStops += 1;
            c.requested = false;
            c.actions = [];
            c.phase = 'waitRelease';
            core.emit({ type: 'pit', t, car: i, stage: 'serviceEnd', actions: done });
          }
          break;
        case 'waitRelease':
          if (this.clear(core, i)) {
            c.phase = 'released';
            core.emit({ type: 'pit', t, car: i, stage: 'release' });
          }
          break;
        default:
          break;
      }
      // Speed limit between the lines (not while held at rest).
      if (
        inLane &&
        !this.held(i) &&
        !c.speeding &&
        f.pitS >= pit.limitStart &&
        f.pitS <= pit.limitEnd &&
        f.speed > pit.speedLimit + rules.pitSpeedTolerance
      ) {
        c.speeding = true;
        core.emit({ type: 'pit', t, car: i, stage: 'speeding' });
        core.penalise(i, 'pitSpeeding', rules.pitSpeedPenalty);
      }
      if (!inLane && c.wasIn && (c.phase === 'lane' || c.phase === 'released')) {
        c.phase = 'none';
        if (c.requested && c.actions.length === 0) c.requested = false;
        core.emit({ type: 'pit', t, car: i, stage: 'exit' });
      }
      c.wasIn = inLane;
    }
  }

  private afterStop(core: RaceCore, i: number, c: PitCar): void {
    const owed = core.strategy.penalties ? core.unservedPenalty(i) : 0;
    if (owed > 0) {
      c.phase = 'penalty';
      c.until = core.time + owed;
      c.penaltyServed = owed;
      core.emit({ type: 'pit', t: core.time, car: i, stage: 'penaltyStart', duration: owed });
      return;
    }
    this.serviceOrQueue(core, i, c);
  }

  private serviceOrQueue(core: RaceCore, i: number, c: PitCar): void {
    const busy = this.cars.some(
      (o, j) => j !== i && o.box === c.box && (o.phase === 'service' || o.phase === 'penalty'),
    );
    if (busy) {
      c.phase = 'queued';
      return;
    }
    let duration = 0;
    for (const a of c.actions) duration += SERVICE_TIMES[a.kind] ?? 0;
    if (c.actions.length > 0) duration += core.rng.range(0, core.rules.serviceSpread);
    c.phase = 'service';
    c.until = core.time + duration;
    core.emit({ type: 'pit', t: core.time, car: i, stage: 'serviceStart', duration });
  }

  /** No car coming down the lane close behind (or just ahead of) this car's box. */
  private clear(core: RaceCore, i: number): boolean {
    const box = core.circuit.pit.boxes[this.cars[i]!.box];
    if (!box) return true;
    const { releaseClearBehind, releaseClearAhead } = core.rules;
    for (let j = 0; j < this.cars.length; j++) {
      if (j === i) continue;
      const f = core.facts[j]!;
      if (!f.inPitLane || this.held(j) || f.speed < 1) continue;
      if (f.pitS >= box.s - releaseClearBehind && f.pitS <= box.s + releaseClearAhead) return false;
    }
    return true;
  }

  getState(): PitState {
    return { cars: this.cars.map((c) => ({ ...c, actions: c.actions.map((a) => ({ ...a })) })) };
  }

  setState(s: PitState): void {
    this.cars = s.cars.map((c) => ({ ...c, actions: c.actions.map((a) => ({ ...a })) }));
  }
}
