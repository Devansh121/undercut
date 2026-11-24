import {
  Championship,
  RaceWeekend,
  type ChampionshipState,
  type SessionResult,
  type WeekendState,
} from '@undercut/race';
import type { StoragePort } from '@undercut/input';
import type { SessionChoice } from '../ui/screens/hub';

function validResult(r: SessionResult): boolean {
  return (
    Array.isArray(r.entries) &&
    r.entries.length === 20 &&
    new Set(r.entries.map((e) => e.car)).size === 20 &&
    r.entries.every(
      (e) =>
        Number.isInteger(e.car) &&
        e.car >= 0 &&
        e.car < 20 &&
        typeof e.id === 'string' &&
        typeof e.name === 'string' &&
        Number.isInteger(e.position) &&
        e.position >= 1 &&
        e.position <= 20 &&
        ['finished', 'dnf', 'dsq', 'notClassified'].includes(e.status) &&
        Array.isArray(e.compounds) &&
        e.compounds.every((c) => ['soft', 'medium', 'hard'].includes(c)) &&
        Number.isFinite(e.pitStops) &&
        (e.bestLap === null || Number.isFinite(e.bestLap)),
    )
  );
}

export const SEASON_KEY = 'championship.progress';
export const SEASON_CIRCUITS = ['monza', 'spa', 'singapore'];
export interface SeasonSave {
  version: 1;
  choice: SessionChoice;
  laps: number;
  championship: ChampionshipState;
  weekend: WeekendState;
}
/** Save only at session boundaries; an abandoned session restarts with its original grid. */
export class WeekendProgress {
  championship: Championship | null;
  weekend: RaceWeekend;
  durable = true;
  constructor(
    readonly choice: SessionChoice,
    readonly laps = 5,
    championship?: Championship,
    weekend?: RaceWeekend,
  ) {
    this.championship =
      championship ?? (choice.mode === 'championship' ? new Championship(SEASON_CIRCUITS) : null);
    this.weekend = weekend ?? this.newWeekend();
  }
  restartSeason(): void {
    if (!this.championship?.done) return;
    this.championship = new Championship(SEASON_CIRCUITS);
    this.weekend = this.newWeekend();
  }
  private newWeekend(): RaceWeekend {
    return new RaceWeekend(
      {
        circuit: this.championship?.nextCircuit() ?? this.choice.circuit,
        practice: 300,
        qualifying: 1080,
        raceLaps: this.laps,
      },
      20,
    );
  }
  complete(result: SessionResult): void {
    this.weekend.complete(result);
    if (result.kind === 'race') this.championship?.record(result);
  }
  nextRound(): void {
    if (!this.weekend.done || !this.championship || this.championship.done) return;
    this.weekend = this.newWeekend();
  }
  skipPractice(): void {
    if (this.weekend.next()?.kind !== 'practice') return;
    this.weekend = new RaceWeekend({ ...this.weekend.plan, practice: null }, 20);
  }
  async save(port: StoragePort): Promise<void> {
    if (!this.championship) return;
    const state: SeasonSave = {
      version: 1,
      choice: this.choice,
      laps: this.laps,
      championship: this.championship.toJSON(),
      weekend: this.weekend.toJSON(),
    };
    try {
      await port.save(SEASON_KEY, JSON.stringify(state));
    } catch {
      this.durable = false;
    }
  }
  static async load(port: StoragePort): Promise<WeekendProgress | null> {
    try {
      const text = await port.load(SEASON_KEY);
      if (typeof text !== 'string') return null;
      const s = JSON.parse(text) as SeasonSave;
      if (
        s.version !== 1 ||
        s.choice.mode !== 'championship' ||
        !Number.isInteger(s.laps) ||
        s.laps < 5 ||
        s.laps > 100 ||
        JSON.stringify(s.championship.circuits) !== JSON.stringify(SEASON_CIRCUITS)
      )
        return null;
      const c = new Championship(SEASON_CIRCUITS);
      for (const round of s.championship.rounds) {
        if (!validResult(round.result)) return null;
        c.record(round.result);
      }
      const w = new RaceWeekend(s.weekend.plan, 20);
      if (
        !SEASON_CIRCUITS.includes(w.plan.circuit) ||
        !Number.isFinite(w.plan.qualifying) ||
        w.plan.raceLaps !== s.laps
      )
        return null;
      for (const r of s.weekend.results) {
        if (!validResult(r) || r.circuit !== w.plan.circuit) return null;
        w.complete(r);
      }
      if (c.round > 3 || (!w.done && c.nextCircuit() !== w.plan.circuit)) return null;
      return new WeekendProgress(s.choice, s.laps, c, w);
    } catch {
      return null;
    }
  }
}
