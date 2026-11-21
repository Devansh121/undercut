import type { SessionSpec } from './kinds';
import { POINTS_TABLE } from './rules';
import type { EntrantInfo, SessionResult } from './results';

/**
 * A race weekend: practice, qualifying and the race on one circuit, in order. It hands out each
 * session's spec and grid and keeps the results; qualifying's classification becomes the race
 * grid (cars without a time at the back, in entry order). Plain data: snapshot with `toJSON`.
 */
export interface WeekendPlan {
  circuit: string;
  practice: number | null;
  qualifying: number;
  raceLaps: number;
  raceTimeLimit?: number;
}

export interface WeekendState {
  plan: WeekendPlan;
  results: SessionResult[];
}

export class RaceWeekend {
  readonly plan: WeekendPlan;
  readonly results: SessionResult[] = [];
  private readonly entrants: number;

  constructor(plan: WeekendPlan, entrants: number) {
    this.plan = plan;
    this.entrants = entrants;
  }

  /** The sessions in running order. */
  get schedule(): SessionSpec[] {
    const out: SessionSpec[] = [];
    if (this.plan.practice !== null) out.push({ kind: 'practice', duration: this.plan.practice });
    out.push({ kind: 'qualifying', duration: this.plan.qualifying });
    const race: SessionSpec = { kind: 'race', laps: this.plan.raceLaps };
    if (this.plan.raceTimeLimit !== undefined) race.timeLimit = this.plan.raceTimeLimit;
    out.push(race);
    return out;
  }

  get done(): boolean {
    return this.results.length >= this.schedule.length;
  }

  /** The next session to run, or null when the weekend is over. */
  next(): SessionSpec | null {
    return this.schedule[this.results.length] ?? null;
  }

  /** Grid for the race: car indices, pole first, from qualifying (entry order before it runs). */
  grid(): number[] {
    const q = this.results.find((r) => r.kind === 'qualifying');
    const all = Array.from({ length: this.entrants }, (_, i) => i);
    if (!q) return all;
    const timed = q.entries.filter((e) => e.bestLap !== null).map((e) => e.car);
    const rest = all.filter((i) => !timed.includes(i));
    return [...timed, ...rest];
  }

  complete(result: SessionResult): void {
    const want = this.next();
    if (!want) throw new Error('the weekend is over');
    if (want.kind !== result.kind) throw new Error(`expected ${want.kind}, got ${result.kind}`);
    this.results.push(result);
  }

  /** The race result, once run. */
  race(): SessionResult | null {
    return this.results.find((r) => r.kind === 'race') ?? null;
  }

  toJSON(): WeekendState {
    return JSON.parse(JSON.stringify({ plan: this.plan, results: this.results })) as WeekendState;
  }

  static fromJSON(state: WeekendState, entrants: number): RaceWeekend {
    const w = new RaceWeekend(state.plan, entrants);
    w.results.push(...state.results);
    return w;
  }
}

export interface StandingEntry {
  id: string;
  points: number;
  /** Finishing positions counted for the tie-break: wins, seconds, ... */
  finishes: number[];
}

export interface ChampionshipState {
  circuits: string[];
  rounds: { circuit: string; result: SessionResult }[];
  points: readonly number[];
}

/**
 * Points and standings across a list of circuits. Drivers score by `points` (the race result's
 * own points are ignored, so a championship can use another table); teams add their drivers'.
 * Ties are broken by count-back: most wins, then most second places, and so on.
 */
export class Championship {
  readonly circuits: readonly string[];
  readonly points: readonly number[];
  private readonly rounds: { circuit: string; result: SessionResult }[] = [];

  constructor(circuits: readonly string[], points: readonly number[] = POINTS_TABLE) {
    this.circuits = circuits.slice();
    this.points = points.slice();
  }

  get round(): number {
    return this.rounds.length;
  }

  get done(): boolean {
    return this.rounds.length >= this.circuits.length;
  }

  nextCircuit(): string | null {
    return this.circuits[this.rounds.length] ?? null;
  }

  record(result: SessionResult): void {
    if (result.kind !== 'race') throw new Error('only races score points');
    const want = this.nextCircuit();
    if (want === null) throw new Error('the championship is over');
    if (want !== result.circuit)
      throw new Error(`round ${this.round + 1} is ${want}, not ${result.circuit}`);
    this.rounds.push({ circuit: result.circuit, result });
  }

  private score(position: number, status: string): number {
    return status === 'finished' ? (this.points[position - 1] ?? 0) : 0;
  }

  /** Driver standings, leader first. */
  drivers(): StandingEntry[] {
    const map = new Map<string, StandingEntry>();
    for (const { result } of this.rounds) {
      for (const e of result.entries) {
        const s = map.get(e.id) ?? { id: e.id, points: 0, finishes: [] };
        s.points += this.score(e.position, e.status);
        if (e.status === 'finished') s.finishes.push(e.position);
        map.set(e.id, s);
      }
    }
    return sortStandings([...map.values()]);
  }

  /** Team standings (team index as the id), leader first. */
  teams(entrants: readonly EntrantInfo[]): StandingEntry[] {
    const teamOf = new Map(entrants.map((e) => [e.id, e.team]));
    const map = new Map<string, StandingEntry>();
    for (const d of this.drivers()) {
      const team = String(teamOf.get(d.id) ?? -1);
      const s = map.get(team) ?? { id: team, points: 0, finishes: [] };
      s.points += d.points;
      s.finishes.push(...d.finishes);
      map.set(team, s);
    }
    return sortStandings([...map.values()]);
  }

  toJSON(): ChampionshipState {
    return JSON.parse(
      JSON.stringify({ circuits: this.circuits, rounds: this.rounds, points: this.points }),
    ) as ChampionshipState;
  }

  static fromJSON(state: ChampionshipState): Championship {
    const c = new Championship(state.circuits, state.points);
    c.rounds.push(...state.rounds);
    return c;
  }
}

function sortStandings(list: StandingEntry[]): StandingEntry[] {
  const countAt = (s: StandingEntry, p: number): number => s.finishes.filter((x) => x === p).length;
  return list.sort((a, b) => {
    if (a.points !== b.points) return b.points - a.points;
    for (let p = 1; p <= 40; p++) {
      const d = countAt(b, p) - countAt(a, p);
      if (d !== 0) return d;
    }
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}
