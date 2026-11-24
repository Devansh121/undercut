/**
 * What the menus remember between visits: the mode, circuit, team and driver last chosen, the
 * session settings and the player's settings (graphics aside, which has its own key). Kept
 * through the storage port (Web Storage now, IndexedDB in M6) as one JSON document; anything
 * missing or malformed falls back to its default field by field, so an old or damaged save never
 * stops the game.
 */
import type { DeviceKind, StoragePort } from '@undercut/input';

export const PREFS_KEY = 'menu.prefs';
export const PREFS_VERSION = 1;

export type ModeId = 'timeTrial' | 'quickRace' | 'weekend' | 'championship' | 'online';
export const MODE_IDS: readonly ModeId[] = [
  'timeTrial',
  'quickRace',
  'weekend',
  'championship',
  'online',
];

export type AiSkill = 'club' | 'pro' | 'elite' | 'alien';
export type GridRule = 'qualifying' | 'random' | 'set';
export type FieldRule = 'tiers' | 'equal';

/** Assist overrides on top of a device's preset; absent keys follow the preset. */
export interface AssistChoice {
  tractionControl?: number;
  abs?: number;
  autoGears?: boolean;
  steering?: number;
  stability?: number;
  braking?: number;
  racingLine?: 'off' | 'braking' | 'full';
}

export interface RaceSetup {
  automaticPitLimiter: boolean;
  /** Laps (5 to the circuit's full distance; clamped per circuit when a race starts). */
  laps: number;
  aiSkill: AiSkill;
  grid: GridRule;
  /** Grid slot (1-based) when `grid` is `set`. */
  slot: number;
  field: FieldRule;
}

export interface PlayerSettings {
  units: 'kmh' | 'mph';
  reducedMotion: 'system' | 'on' | 'off';
  colourBlind: boolean;
  /** HUD scale, 0.8 to 1.2. */
  hudScale: number;
  subtitles: boolean;
  /**
   * Force feedback for kerbs and contacts: gamepad rumble, and the phone's vibration motor on
   * touch controls where the browser has the Vibration API (Android; not iOS Safari).
   */
  haptics: boolean;
}

export interface MenuPrefs {
  version: typeof PREFS_VERSION;
  mode: ModeId;
  circuit: string;
  team: string;
  /** 0 or 1: the team's first or second driver. */
  driver: 0 | 1;
  /** Time-of-day preset per circuit id. */
  timeOfDay: Record<string, string>;
  race: RaceSetup;
  assists: Partial<Record<DeviceKind, AssistChoice>>;
  settings: PlayerSettings;
}

export function defaultPrefs(): MenuPrefs {
  return {
    version: PREFS_VERSION,
    mode: 'timeTrial',
    circuit: 'monza',
    team: 'calder',
    driver: 0,
    timeOfDay: {},
    race: {
      automaticPitLimiter: true,
      laps: 5,
      aiSkill: 'pro',
      grid: 'qualifying',
      slot: 10,
      field: 'tiers',
    },
    assists: {},
    settings: {
      units: 'kmh',
      reducedMotion: 'system',
      colourBlind: false,
      hudScale: 1,
      subtitles: true,
      haptics: true,
    },
  };
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const oneOf = <T extends string>(v: unknown, values: readonly T[], fallback: T): T =>
  typeof v === 'string' && (values as readonly string[]).includes(v) ? (v as T) : fallback;
const int = (v: unknown, min: number, max: number, fallback: number): number =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : fallback;
const id = (v: unknown, fallback: string): string =>
  typeof v === 'string' && /^[a-z0-9-]{1,40}$/.test(v) ? v : fallback;

function readAssists(v: unknown): AssistChoice {
  const out: AssistChoice = {};
  if (!isRecord(v)) return out;
  if (typeof v.tractionControl === 'number') out.tractionControl = int(v.tractionControl, 0, 3, 0);
  if (typeof v.abs === 'number') out.abs = int(v.abs, 0, 3, 0);
  if (typeof v.autoGears === 'boolean') out.autoGears = v.autoGears;
  if (typeof v.steering === 'number') out.steering = int(v.steering, 0, 3, 0);
  if (typeof v.stability === 'number') out.stability = int(v.stability, 0, 1, 0);
  if (typeof v.braking === 'number') out.braking = int(v.braking, 0, 3, 0);
  if (v.racingLine === 'off' || v.racingLine === 'braking' || v.racingLine === 'full')
    out.racingLine = v.racingLine;
  return out;
}

/** Parse saved prefs; never throws. */
export function parsePrefs(text: string | null): MenuPrefs {
  const d = defaultPrefs();
  if (!text) return d;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return d;
  }
  if (!isRecord(raw) || raw.version !== PREFS_VERSION) return d;
  const race = isRecord(raw.race) ? raw.race : {};
  const settings = isRecord(raw.settings) ? raw.settings : {};
  const tod: Record<string, string> = {};
  if (isRecord(raw.timeOfDay)) {
    for (const [k, v] of Object.entries(raw.timeOfDay)) {
      if (/^[a-z0-9-]{1,40}$/.test(k) && typeof v === 'string' && /^[a-z0-9-]{1,40}$/.test(v))
        tod[k] = v;
    }
  }
  const assists: MenuPrefs['assists'] = {};
  if (isRecord(raw.assists)) {
    for (const device of ['keyboard', 'gamepad', 'touch'] as const) {
      if (raw.assists[device] !== undefined) assists[device] = readAssists(raw.assists[device]);
    }
  }
  const scale = settings.hudScale;
  return {
    version: PREFS_VERSION,
    mode: oneOf(raw.mode, MODE_IDS, d.mode),
    circuit: id(raw.circuit, d.circuit),
    team: id(raw.team, d.team),
    driver: raw.driver === 1 ? 1 : 0,
    timeOfDay: tod,
    race: {
      automaticPitLimiter:
        typeof race.automaticPitLimiter === 'boolean' ? race.automaticPitLimiter : true,
      laps: int(race.laps, 1, 200, d.race.laps),
      aiSkill: oneOf(race.aiSkill, ['club', 'pro', 'elite', 'alien'] as const, d.race.aiSkill),
      grid: oneOf(race.grid, ['qualifying', 'random', 'set'] as const, d.race.grid),
      slot: int(race.slot, 1, 20, d.race.slot),
      field: oneOf(race.field, ['tiers', 'equal'] as const, d.race.field),
    },
    assists,
    settings: {
      units: oneOf(settings.units, ['kmh', 'mph'] as const, d.settings.units),
      reducedMotion: oneOf(
        settings.reducedMotion,
        ['system', 'on', 'off'] as const,
        d.settings.reducedMotion,
      ),
      colourBlind:
        typeof settings.colourBlind === 'boolean' ? settings.colourBlind : d.settings.colourBlind,
      hudScale:
        typeof scale === 'number' && Number.isFinite(scale) && scale >= 0.8 && scale <= 1.2
          ? Math.round(scale * 20) / 20
          : d.settings.hudScale,
      subtitles:
        typeof settings.subtitles === 'boolean' ? settings.subtitles : d.settings.subtitles,
      haptics: typeof settings.haptics === 'boolean' ? settings.haptics : d.settings.haptics,
    },
  };
}

/**
 * The prefs for the page: loaded once, read synchronously after, saved (coalesced) on every
 * change. A failing port leaves the values in memory.
 */
export class PrefsStore {
  private value: MenuPrefs = defaultPrefs();
  private pending: Promise<void> | null = null;
  private dirty = false;

  constructor(private readonly port: StoragePort) {}

  async load(): Promise<MenuPrefs> {
    let text: string | null;
    try {
      const t: unknown = await this.port.load(PREFS_KEY);
      text = typeof t === 'string' ? t : null;
    } catch {
      text = null;
    }
    this.value = parsePrefs(text);
    return this.value;
  }

  get(): Readonly<MenuPrefs> {
    return this.value;
  }

  /** Change some fields and save. */
  update(change: (p: MenuPrefs) => void): void {
    const next = structuredClone(this.value);
    change(next);
    this.value = next;
    this.save();
  }

  /** Resolves when the latest change is written. */
  flush(): Promise<void> {
    return this.pending ?? Promise.resolve();
  }

  private save(): void {
    this.dirty = true;
    if (this.pending) return;
    this.pending = (async () => {
      while (this.dirty) {
        this.dirty = false;
        try {
          await this.port.save(PREFS_KEY, JSON.stringify(this.value));
        } catch {
          // Storage failed: the values stay in memory for this page.
        }
      }
      this.pending = null;
    })();
  }
}
