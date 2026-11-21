import type { CircuitInfo } from '../src/circuit';
import { RaceControl, type RaceControlOptions } from '../src/control';
import type { RaceEvent, ServiceAction } from '../src/events';
import { createFacts, type CarFacts } from '../src/facts';
import type { SessionSpec } from '../src/kinds';
import type { RaceRules } from '../src/rules';

/**
 * Cars on rails for scripted rules tests: no vehicle model, so the tests do not move when the
 * car's physics do. A 1000 m loop; the timing line is 50 m before the file's s = 0 to exercise
 * the timing-line offset. The pit lane runs alongside from s = 850 to s = 100 (250 m, mapped
 * 1:1 onto the lap) with the speed limit from s_pit 20 to 230, the timing line at s_pit 100 and boxes from 130.
 */
export const RAIL_CIRCUIT: CircuitInfo = {
  id: 'rails',
  length: 1000,
  timingLine: 950,
  sectorLines: [950, 300, 650],
  speedTrap: 200,
  drsZones: [{ detection: 780, activation: 900, end: 150 }],
  pit: {
    entryS: 850,
    exitS: 100,
    length: 250,
    speedLimit: 20,
    limitStart: 20,
    limitEnd: 230,
    boxes: [
      { s: 130, d: -4 },
      { s: 145, d: -4 },
      { s: 160, d: -4 },
      { s: 175, d: -4 },
      { s: 190, d: -4 },
    ],
  },
  grid: Array.from({ length: 10 }, (_, i) => ({ s: 990 - 8 * i, d: i % 2 ? 2.8 : -2.8 })),
  lastCornerStart: 700,
  raceLaps: 50,
};

export const STEP = 1 / 240;

export interface RailScript {
  /** Cruising speed, m/s, or a function of time and lap position. */
  speed: number | ((t: number, s: number) => number);
  /** Wheels off as a function of time and lap position. */
  wheelsOff?: (t: number, s: number) => number;
  /** Lateral offset. */
  d?: number;
  /** Delay after lights out before moving, s (reaction). */
  reaction?: number;
  /** Move at this speed from this time even before lights out (jump start). */
  creepFrom?: number;
  /** Do not stop in the box even when asked in (drive-through). */
  noStop?: boolean;
  /** Freeze in place from this time (a stopped car). */
  stopAt?: number;
}

interface Rail {
  script: RailScript;
  s: number;
  mode: 'track' | 'pit';
  pitS: number;
  pitD: number;
  v: number;
  stoppedInBox: boolean;
}

function forward(L: number, from: number, to: number): number {
  const d = (to - from) % L;
  return d < 0 ? d + L : d;
}

/** A race control over rail cars, with a step loop and an event log. */
export class RailRace {
  readonly control: RaceControl;
  readonly circuit: CircuitInfo;
  readonly rails: Rail[];
  readonly log: RaceEvent[] = [];
  readonly facts: CarFacts[];
  time = 0;

  constructor(
    session: SessionSpec,
    scripts: RailScript[],
    o: { seed?: number; rules?: Partial<RaceRules>; circuit?: CircuitInfo; teams?: number[] } = {},
  ) {
    this.circuit = o.circuit ?? RAIL_CIRCUIT;
    const opts: RaceControlOptions = {
      circuit: this.circuit,
      session,
      entrants: scripts.map((_, i) => ({ team: o.teams?.[i] ?? i })),
      seed: o.seed ?? 1,
    };
    if (o.rules) opts.rules = o.rules;
    this.control = new RaceControl(opts);
    const start = this.control.strategy.start;
    this.rails = scripts.map((script, i) => {
      const r: Rail = { script, s: 0, mode: 'track', pitS: 0, pitD: 0, v: 0, stoppedInBox: false };
      if (start === 'grid') {
        r.s = this.circuit.grid[i]!.s;
      } else if (start === 'pit') {
        const box = this.control.pitBox(i)!;
        r.mode = 'pit';
        r.pitS = box.s;
        r.pitD = box.d;
        r.stoppedInBox = true;
        r.s = this.lapS(box.s);
      } else {
        r.s = this.circuit.timingLine - 100 - 10 * i;
        r.v = this.speedOf(r, 0);
      }
      return r;
    });
    this.facts = scripts.map(() => createFacts());
    this.writeFacts();
  }

  lapS(pitS: number): number {
    return (this.circuit.pit.entryS + pitS) % this.circuit.length;
  }

  private speedOf(r: Rail, t: number): number {
    const sp = r.script.speed;
    return typeof sp === 'number' ? sp : sp(t, r.s);
  }

  request(car: number, actions: ServiceAction[] = [{ kind: 'tyres', compound: 'hard' }]): void {
    this.control.requestPit(car, actions);
  }

  /** One tick; returns its events (also kept in `log`). */
  step(): RaceEvent[] {
    const c = this.control;
    const L = this.circuit.length;
    const pit = this.circuit.pit;
    const t1 = this.time + STEP;
    for (let i = 0; i < this.rails.length; i++) {
      const r = this.rails[i]!;
      const sc = r.script;
      const out = c.lightsOutAt;
      let v: number;
      if (sc.stopAt !== undefined && t1 >= sc.stopAt) v = 0;
      else if (c.phase === 'grid' || c.phase === 'lights') {
        v = sc.creepFrom !== undefined && t1 >= sc.creepFrom ? 2 : 0;
      } else if (out !== null && t1 < out + (sc.reaction ?? 0)) v = 0;
      else v = this.speedOf(r, t1);
      if (c.held(i)) v = 0;
      if (r.mode === 'track') {
        const before = r.s;
        let next = (r.s + v * STEP) % L;
        const toEntry = forward(L, before, pit.entryS);
        if (c.pitRequested(i) && v > 0 && toEntry > 0 && toEntry <= v * STEP) {
          r.mode = 'pit';
          r.pitS = v * STEP - toEntry;
          r.pitD = 0;
          r.stoppedInBox = false;
          next = this.lapS(r.pitS);
        }
        r.s = next;
      } else {
        const box = c.pitBox(i)!;
        const stopPlanned = c.pitRequested(i) && !sc.noStop && !r.stoppedInBox;
        let pv = Math.min(v, pit.speedLimit - 1);
        if (r.pitS < pit.limitStart - 5 || r.pitS > pit.limitEnd) pv = v;
        let nextPit = r.pitS + pv * STEP;
        if (stopPlanned && r.pitS <= box.s && nextPit >= box.s) {
          nextPit = box.s;
          r.pitD = box.d;
          r.stoppedInBox = true;
          pv = 0;
        }
        if (c.held(i)) pv = 0;
        if (!c.held(i) && r.stoppedInBox && pv > 0) r.pitD = 0;
        r.pitS = nextPit;
        r.v = pv;
        if (r.pitS >= pit.length) {
          r.mode = 'track';
          r.s = (pit.exitS + (r.pitS - pit.length)) % L;
          r.stoppedInBox = false;
        } else {
          r.s = this.lapS(r.pitS);
        }
        continue;
      }
      r.v = v;
    }
    this.time = t1;
    this.writeFacts();
    const events = c.tick(this.time, this.facts);
    this.log.push(...events);
    return events;
  }

  private writeFacts(): void {
    for (let i = 0; i < this.rails.length; i++) {
      const r = this.rails[i]!;
      const f = this.facts[i]!;
      f.s = r.s;
      f.d = r.mode === 'pit' ? -10 : (r.script.d ?? 0);
      f.speed = r.v;
      f.wheelsOff = r.script.wheelsOff ? r.script.wheelsOff(this.time, r.s) : 0;
      f.inPitLane = r.mode === 'pit';
      f.pitS = r.mode === 'pit' ? r.pitS : Number.NaN;
      f.pitD = r.mode === 'pit' ? r.pitD : Number.NaN;
    }
  }

  /** Step until `until` returns true or `seconds` pass; returns the events of the run. */
  run(seconds: number, until?: (e: RaceEvent[]) => boolean): RaceEvent[] {
    const out: RaceEvent[] = [];
    const n = Math.round(seconds / STEP);
    for (let k = 0; k < n; k++) {
      const e = this.step();
      out.push(...e);
      if (until?.(e)) break;
    }
    return out;
  }

  runToEnd(maxSeconds = 3600): RaceEvent[] {
    return this.run(maxSeconds, () => this.control.ended);
  }
}

export function ofType<T extends RaceEvent['type']>(
  events: readonly RaceEvent[],
  type: T,
): Extract<RaceEvent, { type: T }>[] {
  return events.filter((e): e is Extract<RaceEvent, { type: T }> => e.type === type);
}
