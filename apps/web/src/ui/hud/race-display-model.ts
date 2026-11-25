/**
 * Pure event-to-UI state mapper for the race display (no DOM, unit-tested in Node).
 *
 * Consumes typed `RaceEvent`s and `StandingRow[]` from `@undercut/race`, and produces:
 * - Start-lights sequence state (5 red pods + lights-out hold + jump-start indication + 3D gantry mask)
 * - 20-car timing tower rows (position, code, gap/interval toggle, compound + tyre age, pit count, in-pit / retired)
 * - Track flags (yellow by marshalling sector + timing sector summary, blue for player, black & white, chequered)
 * - Safety indicators (blocking ghost)
 * - Short, readable race-control message queue (pit, penalties, track limits, speeding, jump start, served penalties)
 */
import type { Phase, RaceEvent, SessionKind, StandingRow } from '@undercut/race';
import { formatLapTime } from '../../game/format';
import type { TowerFlag } from './tower';
import type { TowerRow, TowerTone } from './tower-rows';
import { compoundMark } from './tyres';

export type TowerGapMode = 'gap' | 'interval';

export type RaceMessageTone = 'invalid' | 'warning' | 'info' | 'personal' | 'overall';

export interface RaceMessage {
  readonly id: number;
  readonly tag: string;
  readonly text: string;
  readonly tone: RaceMessageTone;
  remaining: number;
}

export interface RaceEntrantDisplay {
  readonly id: string;
  readonly name: string;
  readonly code: string;
  readonly teamColour: string;
  readonly teamName: string;
  readonly initialCompound?: string;
}

export interface RaceDisplayInit {
  readonly entrants: readonly RaceEntrantDisplay[];
  readonly playerCar?: number;
  readonly sessionKind: SessionKind;
  readonly totalLaps: number | null;
  readonly marshalSectorCount: number;
  /**
   * Timing-sector boundaries forward from the timing line (e.g. `[s1, s2]` in metres),
   * used to turn marshalling-sector indices into broadcast timing sectors (S1 / S2 / S3).
   */
  readonly timingSectorBoundaries: readonly number[];
  readonly trackLength: number;
}

export interface JumpStartNotice {
  readonly car: number;
  readonly code: string;
  readonly player: boolean;
  readonly seconds: number;
}

export interface StartLightsState {
  readonly visible: boolean;
  readonly phase: Phase;
  /** Red pods currently lit, 0 to 5. */
  readonly lit: number;
  /** True briefly right after lights go out so the transition reads clearly. */
  readonly lightsOut: boolean;
  /** Active jump-start indication, if any. */
  readonly jumpStart: JumpStartNotice | null;
  /** Bitmask for the 3D start gantry (`startLightMask` convention: bits 0..4 red). */
  readonly gantryMask: number;
  /** Short caption under the gantry pods. */
  readonly caption: string;
}

export interface RaceFlagBanner {
  readonly flag: 'yellow' | 'blue' | 'blackWhite' | 'chequered';
  readonly title: string;
  readonly detail: string;
}

export interface RaceSafetyIndicator {
  readonly kind: 'ghost';
  readonly title: string;
  readonly detail: string;
}

export interface RaceFlagsSnapshot {
  /** Per marshalling sector, true where a local yellow is active (drives minimap highlight). */
  readonly yellowSectors: readonly boolean[];
  /** Sorted 1-based timing sectors (1..3) currently covered by a yellow flag. */
  readonly yellowTimingSectors: readonly number[];
  /** Blue flag currently shown to the player, with the lapping car's code. */
  readonly blueForPlayer: { readonly byCar: number; readonly byCode: string } | null;
  /** Black-and-white warning flag currently active for the player. */
  readonly blackWhite: boolean;
  readonly chequered: boolean;
  /** Top-priority flag banner for top-centre race control, or null under green. */
  readonly banner: RaceFlagBanner | null;
  /** Status bar state for the timing tower. */
  readonly towerStatus: { readonly flag: TowerFlag; readonly text: string };
}

export interface RaceDisplaySnapshot {
  readonly startLights: StartLightsState;
  readonly flags: RaceFlagsSnapshot;
  readonly safety: RaceSafetyIndicator | null;
  readonly messages: readonly RaceMessage[];
  readonly gapMode: TowerGapMode;
}

/** Real-time hold after lights out before hiding the start-lights panel, s. */
export const LIGHTS_OUT_HOLD_S = 1.2;
/** Real-time hold for a jump-start badge after lights out, s. */
export const JUMP_START_HOLD_S = 3.5;
/** Real-time duration for the black-and-white flag banner, s. */
export const BLACK_WHITE_BANNER_S = 5.0;
/** Default message lifetime in the queue, s. */
export const MESSAGE_TTL_S = 4.5;
/** Penalty message lifetime in the queue, s. */
export const PENALTY_MESSAGE_TTL_S = 6.0;

const PENALTY_LABELS: Readonly<Record<string, string>> = {
  jumpStart: 'Jump start',
  trackLimits: 'Track limits',
  leavingTrack: 'Place gained off track',
  pitSpeeding: 'Pit lane speeding',
  blueFlags: 'Ignoring blue flags',
};

const COMPOUND_NAMES: Readonly<Record<string, string>> = {
  soft: 'Soft',
  medium: 'Medium',
  hard: 'Hard',
};

/** Map a 0-based marshalling sector to its 1-based timing sector (1..3). */
export function marshalToTimingSector(
  marshalIndex: number,
  marshalCount: number,
  timingBoundaries: readonly number[],
  trackLength: number,
): number {
  if (marshalCount <= 0 || trackLength <= 0 || timingBoundaries.length === 0) return 1;
  const midDist = ((marshalIndex + 0.5) / marshalCount) * trackLength;
  for (let i = 0; i < timingBoundaries.length; i++) {
    if (midDist < (timingBoundaries[i] as number)) return i + 1;
  }
  return timingBoundaries.length + 1;
}

/** Format a sorted list of 1-based timing sector numbers for flag banners ("Sector 2", "Sectors 1, 2"). */
export function formatYellowSectors(sectors: readonly number[], short = false): string {
  if (sectors.length === 0) return '';
  if (short) return sectors.map((s) => `S${s}`).join(' ');
  if (sectors.length === 1) return `Sector ${sectors[0]}`;
  return `Sectors ${sectors.join(', ')}`;
}

/** Bitmask for `count` red start lights (bits 0..4), matching `@undercut/render`'s `startLightMask`. */
export function lightsBitmask(count: number): number {
  if (count <= 0) return 0;
  return (1 << Math.min(5, Math.floor(count))) - 1;
}

/** Short FIFO message queue keeping up to `capacity` active messages, newest first. */
export class RaceMessageQueue {
  private items: RaceMessage[] = [];
  private nextId = 1;
  private readonly capacity: number;

  constructor(capacity = 6) {
    this.capacity = capacity;
  }

  push(tag: string, text: string, tone: RaceMessageTone, ttl = MESSAGE_TTL_S): void {
    const existing = this.items.find((m) => m.tag === tag && m.text === text);
    if (existing) {
      existing.remaining = Math.max(existing.remaining, ttl);
      return;
    }
    this.items.unshift({ id: this.nextId++, tag, text, tone, remaining: ttl });
    if (this.items.length > this.capacity) this.items.length = this.capacity;
  }

  tick(dt: number): void {
    if (dt <= 0 || this.items.length === 0) return;
    for (let i = this.items.length - 1; i >= 0; i--) {
      const m = this.items[i]!;
      m.remaining -= dt;
      if (m.remaining <= 0) this.items.splice(i, 1);
    }
  }

  visible(limit = 3): readonly RaceMessage[] {
    return this.items.length <= limit ? this.items : this.items.slice(0, limit);
  }

  clear(): void {
    this.items = [];
  }
}

export class RaceDisplayModel {
  private readonly entrants: readonly RaceEntrantDisplay[];
  private readonly playerCar: number;
  private readonly sessionKind: SessionKind;
  private readonly totalLaps: number | null;
  private readonly marshalSectorCount: number;
  private readonly timingSectorBoundaries: readonly number[];
  private readonly trackLength: number;

  private phase: Phase;
  private lit = 0;
  private lightsOutHold = 0;
  private jumpStart: JumpStartNotice | null = null;
  private jumpStartHold = 0;

  private readonly yellowSectors: boolean[];
  private blueForPlayer: { byCar: number; byCode: string } | null = null;
  private blackWhiteHold = 0;
  private chequered = false;
  private playerFinished = false;
  private blockingGhost = false;

  private readonly compounds: string[];
  private readonly lapsCompleted: number[];
  private readonly stintStartLaps: number[];

  private gapModeValue: TowerGapMode = 'gap';
  readonly messages = new RaceMessageQueue(6);

  constructor(init: RaceDisplayInit) {
    this.entrants = init.entrants;
    this.playerCar = init.playerCar ?? 0;
    this.sessionKind = init.sessionKind;
    this.totalLaps = init.totalLaps;
    this.marshalSectorCount = Math.max(1, init.marshalSectorCount);
    this.timingSectorBoundaries = init.timingSectorBoundaries;
    this.trackLength = init.trackLength;

    this.phase = init.sessionKind === 'race' ? 'grid' : 'green';
    this.yellowSectors = Array.from({ length: this.marshalSectorCount }, () => false);
    this.compounds = init.entrants.map((e) => e.initialCompound ?? 'medium');
    this.lapsCompleted = init.entrants.map(() => 0);
    this.stintStartLaps = init.entrants.map(() => 0);
  }

  get gapMode(): TowerGapMode {
    return this.gapModeValue;
  }

  setGapMode(mode: TowerGapMode): void {
    this.gapModeValue = mode;
  }

  toggleGapMode(): TowerGapMode {
    this.gapModeValue = this.gapModeValue === 'gap' ? 'interval' : 'gap';
    return this.gapModeValue;
  }

  /** Sync safety state that lives outside RaceEvents (the blocking-ghost rule). */
  setBlockingGhost(active: boolean): void {
    this.blockingGhost = active;
  }

  /** Sync live yellow sectors from FlagSystem (useful on init or restore). */
  syncYellowSectors(sectors: readonly boolean[]): void {
    for (let i = 0; i < this.yellowSectors.length; i++) {
      this.yellowSectors[i] = Boolean(sectors[i]);
    }
  }

  /** Advance display-only timers (lights-out fade, jump-start hold, banner & message TTLs). */
  tick(dt: number): void {
    if (dt <= 0) return;
    if (this.lightsOutHold > 0) this.lightsOutHold = Math.max(0, this.lightsOutHold - dt);
    if (this.jumpStartHold > 0) {
      this.jumpStartHold = Math.max(0, this.jumpStartHold - dt);
      if (this.jumpStartHold === 0) this.jumpStart = null;
    }
    if (this.blackWhiteHold > 0) this.blackWhiteHold = Math.max(0, this.blackWhiteHold - dt);
    this.messages.tick(dt);
  }

  /** Push a local pit-wall / race-control message directly into the queue (e.g. Box this lap). */
  pushMessage(tag: string, text: string, tone: RaceMessageTone, ttl = MESSAGE_TTL_S): void {
    this.messages.push(tag, text, tone, ttl);
  }

  /** Process a batch of race-engine events in order. */
  ingest(events: readonly RaceEvent[], standings?: readonly StandingRow[]): void {
    for (const e of events) this.onEvent(e, standings);
  }

  private codeOf(car: number): string {
    return this.entrants[car]?.code ?? `C${car + 1}`;
  }

  private onEvent(e: RaceEvent, standings?: readonly StandingRow[]): void {
    switch (e.type) {
      case 'phase':
        this.phase = e.phase;
        if (e.phase === 'chequered' || e.phase === 'finished') this.chequered = true;
        break;

      case 'lights':
        this.lit = e.count;
        if (e.count > 0) {
          this.phase = 'lights';
          this.lightsOutHold = 0;
        } else {
          this.lightsOutHold = LIGHTS_OUT_HOLD_S;
          if (this.jumpStart) this.jumpStartHold = Math.max(this.jumpStartHold, JUMP_START_HOLD_S);
        }
        break;

      case 'lap':
        if (e.car >= 0 && e.car < this.lapsCompleted.length) {
          this.lapsCompleted[e.car] = (this.lapsCompleted[e.car] ?? 0) + 1;
        }
        break;

      case 'flag':
        if (e.flag === 'yellow' && e.sector !== undefined) {
          if (e.sector >= 0 && e.sector < this.yellowSectors.length) {
            this.yellowSectors[e.sector] = e.on;
          }
        } else if (e.flag === 'blue' && e.car === this.playerCar) {
          if (e.on) {
            const byCar = e.by ?? -1;
            const byCode = byCar >= 0 ? this.codeOf(byCar) : '';
            this.blueForPlayer = { byCar, byCode };
            this.messages.push(
              'Blue flag',
              byCode ? `Let ${byCode} through` : 'Let faster car through',
              'info',
              MESSAGE_TTL_S,
            );
          } else {
            this.blueForPlayer = null;
          }
        } else if (e.flag === 'blackWhite' && e.car === this.playerCar && e.on) {
          this.blackWhiteHold = BLACK_WHITE_BANNER_S;
        } else if (e.flag === 'chequered' && e.on) {
          this.chequered = true;
        }
        break;

      case 'trackLimits':
        if (e.car !== this.playerCar) break;
        if (e.outcome === 'warning') {
          this.messages.push('Track limits', `Warning ${e.strike}`, 'warning', MESSAGE_TTL_S);
        } else if (e.outcome === 'blackWhite') {
          this.blackWhiteHold = BLACK_WHITE_BANNER_S;
          this.messages.push(
            'Black & white',
            `Track limits · warning ${e.strike}`,
            'warning',
            PENALTY_MESSAGE_TTL_S,
          );
        }
        break;

      case 'penalty': {
        const reason = PENALTY_LABELS[e.reason] ?? e.reason;
        if (e.reason === 'jumpStart') {
          const isPlayer = e.car === this.playerCar;
          if (isPlayer || !this.jumpStart?.player) {
            this.jumpStart = {
              car: e.car,
              code: this.codeOf(e.car),
              player: isPlayer,
              seconds: e.seconds,
            };
            this.jumpStartHold = JUMP_START_HOLD_S;
          }
        }
        if (e.car === this.playerCar) {
          this.messages.push(`+${e.seconds} s penalty`, reason, 'invalid', PENALTY_MESSAGE_TTL_S);
        } else if (e.reason === 'jumpStart') {
          this.messages.push(
            'Jump start',
            `${this.codeOf(e.car)} · +${e.seconds} s`,
            'warning',
            MESSAGE_TTL_S,
          );
        }
        break;
      }

      case 'penaltyServed':
        if (e.car === this.playerCar) {
          this.messages.push(
            'Penalty served',
            `${e.seconds} s served in pit box`,
            'info',
            MESSAGE_TTL_S,
          );
        }
        break;

      case 'warning':
        if (e.car !== this.playerCar) break;
        if (e.reason === 'overtakeUnderYellow') {
          this.messages.push('Yellow flag', 'Passing under yellow', 'invalid', MESSAGE_TTL_S);
        } else if (e.reason === 'pitSpeeding') {
          this.messages.push('Pit lane', 'Speeding warning', 'warning', MESSAGE_TTL_S);
        }
        break;

      case 'pit': {
        if (e.stage === 'serviceEnd' && e.actions) {
          const tyreChange = e.actions.find((a) => a.kind === 'tyres');
          if (tyreChange && e.car >= 0 && e.car < this.compounds.length) {
            this.compounds[e.car] = tyreChange.compound;
            this.stintStartLaps[e.car] = this.lapsCompleted[e.car] ?? 0;
          }
        }
        if (e.car !== this.playerCar) break;
        switch (e.stage) {
          case 'entry':
            this.messages.push('Pit lane', 'Entered pit lane', 'info', 3.5);
            break;
          case 'speeding':
            this.messages.push(
              'Pit speeding',
              'Over pit lane limit',
              'invalid',
              PENALTY_MESSAGE_TTL_S,
            );
            break;
          case 'missed':
            this.messages.push('Pit box', 'Missed pit box', 'warning', MESSAGE_TTL_S);
            break;
          case 'penaltyStart':
            this.messages.push(
              'Pit penalty',
              `Serving ${(e.duration ?? 5).toFixed(0)} s penalty`,
              'warning',
              MESSAGE_TTL_S,
            );
            break;
          case 'serviceStart':
            this.messages.push('Pit stop', 'Servicing tyres', 'info', 3.5);
            break;
          case 'serviceEnd': {
            const fitted = e.actions?.find((a) => a.kind === 'tyres')?.compound;
            const label = fitted ? (COMPOUND_NAMES[fitted] ?? fitted) : 'New';
            this.messages.push('Pit stop', `${label} tyres fitted`, 'personal', MESSAGE_TTL_S);
            break;
          }
          case 'release':
            this.messages.push('Pit exit', 'Released from box', 'info', 3.5);
            break;
          default:
            break;
        }
        break;
      }

      case 'fastestLap':
        if (this.sessionKind === 'race') {
          this.messages.push(
            'Fastest lap',
            `${this.codeOf(e.car)} · ${formatLapTime(e.time)}`,
            'overall',
            MESSAGE_TTL_S,
          );
        }
        break;

      case 'finish':
        if (e.car === this.playerCar) {
          this.playerFinished = true;
          const place = standings?.find((r) => r.car === this.playerCar)?.position ?? e.position;
          this.messages.push(
            'Chequered flag',
            `Finished P${place}`,
            'personal',
            PENALTY_MESSAGE_TTL_S,
          );
        }
        break;

      case 'retired':
        if (e.car === this.playerCar) {
          this.messages.push(
            'Retired',
            'Car retired from session',
            'invalid',
            PENALTY_MESSAGE_TTL_S,
          );
        }
        break;

      default:
        break;
    }
  }

  /** Current tyre age (laps completed on the current compound) for `car`. */
  tyreAge(car: number, lapsCompletedNow?: number): number {
    const done = lapsCompletedNow ?? this.lapsCompleted[car] ?? 0;
    const start = this.stintStartLaps[car] ?? 0;
    return Math.max(0, done - start);
  }

  /** Build the ordered `TowerRow[]` for the timing tower from live standings. */
  buildTowerRows(
    standings: readonly StandingRow[],
    o: {
      compounds?: readonly string[];
      fastestCar?: number | null;
      phase?: Phase;
    } = {},
  ): TowerRow[] {
    const phase = o.phase ?? this.phase;
    const preStart = this.sessionKind === 'race' && (phase === 'grid' || phase === 'lights');
    const leaderBest = standings[0]?.bestLap ?? null;
    const timed = this.sessionKind === 'practice' || this.sessionKind === 'qualifying';

    return standings.map((row, index) => {
      const entrant = this.entrants[row.car];
      const compoundId = o.compounds?.[row.car] ?? this.compounds[row.car] ?? 'medium';
      const mark = compoundMark(compoundId);
      const retired = row.status === 'dnf' || row.status === 'dsq';
      let value: string;
      let tone: TowerTone = '';

      if (row.status === 'dnf') {
        value = 'OUT';
        tone = 'out';
      } else if (row.status === 'dsq') {
        value = 'DSQ';
        tone = 'out';
      } else if (row.inPit) {
        value = 'PIT';
        tone = 'pit';
      } else if (timed) {
        if (row.bestLap === null) {
          value = 'NO TIME';
          tone = 'empty';
        } else if (index === 0 || leaderBest === null) {
          value = formatLapTime(row.bestLap);
          tone = 'overall';
        } else {
          value = `+${Math.max(0, row.bestLap - leaderBest).toFixed(3)}`;
          tone = '';
        }
      } else if (preStart) {
        value = index === 0 ? 'POLE' : `P${row.position}`;
        tone = 'empty';
      } else if (index === 0) {
        value = row.status === 'finished' ? 'FIN' : 'LEADER';
        tone = row.status === 'finished' ? 'finished' : '';
      } else if (this.gapModeValue === 'interval') {
        const ahead = standings[index - 1];
        const lapDiff = ahead ? Math.max(0, row.lapsDown - ahead.lapsDown) : row.lapsDown;
        if (lapDiff > 0) {
          value = `+${lapDiff}L`;
        } else if (row.interval !== null && Number.isFinite(row.interval)) {
          value = `+${row.interval.toFixed(3)}`;
        } else if (row.status === 'finished') {
          value = 'FIN';
          tone = 'finished';
        } else {
          value = '—';
          tone = 'empty';
        }
      } else {
        if (row.lapsDown > 0) {
          value = `+${row.lapsDown}L`;
        } else if (row.gap !== null && Number.isFinite(row.gap)) {
          value = `+${row.gap.toFixed(3)}`;
        } else if (row.status === 'finished') {
          value = 'FIN';
          tone = 'finished';
        } else {
          value = '—';
          tone = 'empty';
        }
      }

      return {
        id: entrant?.id ?? `car-${row.car}`,
        position: row.position,
        code: entrant?.code ?? this.codeOf(row.car),
        name: entrant?.name ?? this.codeOf(row.car),
        teamColour: entrant?.teamColour ?? '#626c74',
        value,
        tone,
        player: row.car === this.playerCar,
        compound: mark,
        tyreAge: this.tyreAge(row.car, row.lapsCompleted),
        pitStops: row.pitStops,
        inPit: row.inPit,
        retired,
        fastest: o.fastestCar !== undefined && o.fastestCar === row.car,
      };
    });
  }

  /** Snapshot of start lights, flags, safety indicator and message queue for the HUD. */
  snapshot(maxMessages = 3): RaceDisplaySnapshot {
    const startLights = this.startLightsState();
    const flags = this.flagsState();
    const safety: RaceSafetyIndicator | null = this.blockingGhost
      ? {
          kind: 'ghost',
          title: 'Safety ghost',
          detail: 'Traffic passing through your car',
        }
      : null;
    return {
      startLights,
      flags,
      safety,
      messages: this.messages.visible(maxMessages),
      gapMode: this.gapModeValue,
    };
  }

  private startLightsState(): StartLightsState {
    const isRace = this.sessionKind === 'race';
    const pre = isRace && (this.phase === 'grid' || this.phase === 'lights');
    const lightsOut = isRace && !pre && this.lightsOutHold > 0;
    const jumpVisible = isRace && this.jumpStart !== null && (pre || this.jumpStartHold > 0);
    const visible = pre || lightsOut || jumpVisible;
    const lit = this.phase === 'lights' ? this.lit : 0;
    let caption = '';
    if (this.phase === 'grid') {
      const laps = this.totalLaps ?? 5;
      caption = `Grid · ${this.entrants.length} cars · ${laps} ${laps === 1 ? 'lap' : 'laps'}`;
    } else if (this.phase === 'lights') {
      caption = lit > 0 ? `Lights · ${lit} / 5` : 'Stand by';
    } else if (lightsOut) {
      caption = 'Lights out';
    }
    return {
      visible,
      phase: this.phase,
      lit,
      lightsOut,
      jumpStart: jumpVisible ? this.jumpStart : null,
      gantryMask: lightsBitmask(lit),
      caption,
    };
  }

  private flagsState(): RaceFlagsSnapshot {
    const timingSet = new Set<number>();
    for (let k = 0; k < this.yellowSectors.length; k++) {
      if (this.yellowSectors[k]) {
        timingSet.add(
          marshalToTimingSector(
            k,
            this.marshalSectorCount,
            this.timingSectorBoundaries,
            this.trackLength,
          ),
        );
      }
    }
    const yellowTimingSectors = [...timingSet].sort((a, b) => a - b);

    let banner: RaceFlagBanner | null = null;
    if (this.chequered) {
      banner = {
        flag: 'chequered',
        title: 'Chequered flag',
        detail: this.playerFinished ? 'Session complete' : 'Final lap',
      };
    } else if (yellowTimingSectors.length > 0) {
      banner = {
        flag: 'yellow',
        title: 'Yellow flag',
        detail: `${formatYellowSectors(yellowTimingSectors)} · No overtaking`,
      };
    } else if (this.blueForPlayer !== null) {
      banner = {
        flag: 'blue',
        title: 'Blue flag',
        detail: this.blueForPlayer.byCode
          ? `Let ${this.blueForPlayer.byCode} through`
          : 'Let faster car through',
      };
    } else if (this.blackWhiteHold > 0) {
      banner = {
        flag: 'blackWhite',
        title: 'Black & white flag',
        detail: 'Track limits · Final warning',
      };
    }

    let towerStatus: { flag: TowerFlag; text: string };
    if (this.chequered) {
      towerStatus = { flag: 'chequered', text: 'Chequered flag' };
    } else if (yellowTimingSectors.length > 0) {
      towerStatus = {
        flag: 'yellow',
        text: `Yellow · ${formatYellowSectors(yellowTimingSectors, true)}`,
      };
    } else if (this.blueForPlayer !== null) {
      towerStatus = { flag: 'blue', text: 'Blue flag' };
    } else if (this.phase === 'grid' || this.phase === 'lights') {
      towerStatus = {
        flag: 'neutral',
        text: this.phase === 'lights' ? 'Start lights' : 'On the grid',
      };
    } else {
      towerStatus = { flag: 'green', text: 'Green flag' };
    }

    return {
      yellowSectors: this.yellowSectors.slice(),
      yellowTimingSectors,
      blueForPlayer: this.blueForPlayer,
      blackWhite: this.blackWhiteHold > 0,
      chequered: this.chequered,
      banner,
      towerStatus,
    };
  }
}
