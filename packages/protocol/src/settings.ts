import { arrayOf, bool, int, num, object, oneOf, str, type Check, type Checked } from './validate';

/** Seats on the grid: humans plus AI. */
export const MAX_CARS = 20;
/** Humans per room. */
export const MAX_HUMANS = 8;
export const MAX_LAPS = 99;

/**
 * What the room needs to know about the circuit to referee timing. The host's client
 * derives it from the track data (`circuitLimits`), so the service never loads tracks.
 */
export interface CircuitInfo {
  id: string;
  /** Lap length along the centreline, metres. */
  lengthM: number;
  /** Fastest plausible lap, ms. A faster claim is rejected. */
  minLapMs: number;
  /** Fastest plausible time for each sector, ms (empty if the circuit has no sectors). */
  minSectorMs: number[];
  /** Slowest lap that still counts as racing, ms; sets the race time cap. */
  maxLapMs: number;
}

export interface Assists {
  abs: boolean;
  tractionControl: boolean;
  autoGears: boolean;
  racingLine: boolean;
  steeringAssist: boolean;
}

export type GridOrder = 'random' | 'join';

export interface RoomSettings {
  circuit: CircuitInfo;
  laps: number;
  /** Every car has the same performance. On by default online. */
  equalCars: boolean;
  /** AI cars wanted; the grid takes at most MAX_CARS minus the humans. */
  aiCount: number;
  /** AI driver skill, 0 to 1. */
  aiSkill: number;
  /** Which assists players may switch on. */
  assists: Assists;
  gridOrder: GridOrder;
}

/**
 * Mean speed no real car of the era sustains over a lap or a sector (342 km/h). Lap
 * and sector floors are distance over this speed: generous for honest drivers, and a
 * lap claimed faster than that is not physically plausible.
 */
export const PLAUSIBLE_MEAN_SPEED = 95;

/**
 * Build the timing limits for a circuit from its length and sector start positions
 * (metres along the centreline, the first being 0).
 */
export function circuitLimits(
  id: string,
  lengthM: number,
  sectorStarts: readonly number[],
  maxLapMs = 300_000,
): CircuitInfo {
  const ends = [...sectorStarts.slice(1), lengthM];
  const minSectorMs =
    sectorStarts.length > 1
      ? sectorStarts.map((start, i) =>
          Math.floor((((ends[i] ?? lengthM) - start) / PLAUSIBLE_MEAN_SPEED) * 1000),
        )
      : [];
  return {
    id,
    lengthM,
    minLapMs: Math.floor((lengthM / PLAUSIBLE_MEAN_SPEED) * 1000),
    minSectorMs,
    maxLapMs,
  };
}

/** The default circuit's limits (5793 m, three sectors). */
export const DEFAULT_CIRCUIT: CircuitInfo = circuitLimits('monza', 5793, [0, 1609.318, 3433.63]);

export const DEFAULT_SETTINGS: RoomSettings = {
  circuit: DEFAULT_CIRCUIT,
  laps: 5,
  equalCars: true,
  aiCount: MAX_CARS - 1,
  aiSkill: 0.7,
  assists: {
    abs: true,
    tractionControl: true,
    autoGears: true,
    racingLine: true,
    steeringAssist: true,
  },
  gridOrder: 'random',
};

const circuitCheck: Check<CircuitInfo> = object({
  id: str(32, /^[a-z0-9][a-z0-9-]*$/),
  lengthM: num(100, 30_000),
  minLapMs: int(1000, 1_800_000),
  minSectorMs: arrayOf(int(0, 1_800_000), 8),
  maxLapMs: int(1000, 3_600_000),
});

const assistsCheck: Check<Assists> = object({
  abs: bool,
  tractionControl: bool,
  autoGears: bool,
  racingLine: bool,
  steeringAssist: bool,
});

const settingsShape = {
  circuit: circuitCheck,
  laps: int(1, MAX_LAPS),
  equalCars: bool,
  aiCount: int(0, MAX_CARS - 1),
  aiSkill: num(0, 1),
  assists: assistsCheck,
  gridOrder: oneOf<GridOrder>(['random', 'join']),
};

export type SettingsPatch = Partial<RoomSettings>;

/** A settings change from the host: any subset of fields, each complete in itself. */
export const settingsPatchCheck: Check<SettingsPatch> = object({}, settingsShape);

const fullSettingsCheck: Check<RoomSettings> = object(settingsShape);

/** Rules that span fields. Returns a reason, or null when the settings hang together. */
function crossCheck(s: RoomSettings): string | null {
  const c = s.circuit;
  if (c.maxLapMs <= c.minLapMs) return 'circuit.maxLapMs must be above circuit.minLapMs';
  const sectorSum = c.minSectorMs.reduce((a, b) => a + b, 0);
  if (sectorSum > c.minLapMs) return 'circuit.minSectorMs add up to more than minLapMs';
  return null;
}

/** Validate a complete settings object (used for stored state and room creation). */
export function checkSettings(value: unknown): Checked<RoomSettings> {
  const r = fullSettingsCheck(value, 'settings');
  if (!r.ok) return r;
  const cross = crossCheck(r.value);
  return cross ? { ok: false, detail: cross } : r;
}

/** Apply a validated patch; returns the new settings or why they are inconsistent. */
export function applySettingsPatch(
  current: RoomSettings,
  patch: SettingsPatch,
): Checked<RoomSettings> {
  const next: RoomSettings = { ...current, ...patch };
  const cross = crossCheck(next);
  return cross ? { ok: false, detail: cross } : { ok: true, value: next };
}
