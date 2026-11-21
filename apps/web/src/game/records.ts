import { MemoryStorage, type StoragePort } from '@undercut/input';

/**
 * What is kept per circuit. The best lap travels with its own splits and its ghost; the best
 * time in each sector is kept separately, because the sector minima usually come from
 * different laps (a faster lap can have a slower middle sector).
 */
export interface CircuitRecord {
  lap: number;
  /** The best lap's own sector splits. */
  lapSectors: number[];
  /** Best time in each sector from any valid lap. */
  bestSectors: number[];
  /** `encodeGhost` text of the best lap, or null when it could not be kept. */
  ghost: string | null;
  /** ISO date the best lap was set (YYYY-MM-DD), for the launch screen. */
  date: string;
}

/** What a finished valid lap changes: a new best lap, better sectors, or both. */
export interface RecordUpdate {
  lap: { time: number; sectors: number[]; ghost: string | null } | null;
  /** Sector minima after this lap (null where none is set). */
  bestSectors: (number | null)[];
  date: string;
}

/**
 * A storage port plus whether what it holds outlives the page. Web Storage reports itself
 * blocked by catching the failure and answering from memory, so a rejected promise is not the
 * only sign of failure: `durable()` carries that status across the boundary.
 */
export interface RecordStorage {
  port: StoragePort;
  durable(): boolean;
}

/** Web Storage (or anything that flags `blocked` when it falls back to memory). */
export function durableStorage(port: StoragePort & { readonly blocked: boolean }): RecordStorage {
  return { port, durable: () => !port.blocked };
}

/** Memory only: records last until the page closes. */
export function memoryStorage(port: StoragePort = new MemoryStorage()): RecordStorage {
  return { port, durable: () => false };
}

/**
 * 3: timed from the circuit's timing line (the control line), not the start line. Records of
 * versions 1 and 2 were timed from the start line; their sectors and ghost distances do not
 * compare, so they are dropped.
 */
const VERSION = 3;
const keyOf = (circuit: string): string => `records.${circuit}`;

/**
 * Personal bests per circuit through a storage port (Web Storage or memory now; IndexedDB in
 * M6). Storage that throws, is full or is blocked never stops the game: records then live in
 * memory for the session and `persistent` turns false so the UI can say so.
 */
export class RecordStore {
  private readonly storage: RecordStorage;
  private readonly memory = new Map<string, CircuitRecord>();
  private failed = false;

  constructor(storage: RecordStorage) {
    this.storage = storage;
  }

  /** False when records last only until the page closes. */
  get persistent(): boolean {
    return !this.failed && this.storage.durable();
  }

  async load(circuit: string): Promise<CircuitRecord | null> {
    const cached = this.memory.get(circuit);
    if (cached) return cached;
    let text: string | null;
    try {
      text = await this.storage.port.load(keyOf(circuit));
    } catch {
      this.failed = true;
      return null;
    }
    const record = text === null ? null : parseRecord(text);
    if (record) this.memory.set(circuit, record);
    return record;
  }

  /**
   * Merge `update` into the stored record: a faster lap replaces the best lap with its splits
   * and ghost; each sector keeps its minimum. True when something improved and was written to
   * durable storage; false when nothing improved or it lives in memory only.
   */
  async save(circuit: string, update: RecordUpdate): Promise<boolean> {
    const current = await this.load(circuit);
    const merged = merge(current, update);
    if (!merged) return false;
    this.memory.set(circuit, merged);
    const write = async (record: CircuitRecord): Promise<boolean> => {
      try {
        await this.storage.port.save(
          keyOf(circuit),
          JSON.stringify({ version: VERSION, ...record }),
        );
        return true;
      } catch {
        return false;
      }
    };
    if (await write(merged)) return this.persistent;
    // A ghost is the bulk of a record; try once more without it before giving up.
    if (merged.ghost !== null && (await write({ ...merged, ghost: null }))) return this.persistent;
    this.failed = true;
    return false;
  }
}

/** The record after `update`, or null when nothing improves. */
function merge(current: CircuitRecord | null, u: RecordUpdate): CircuitRecord | null {
  const lapBetter = u.lap !== null && (current === null || u.lap.time < current.lap);
  const count = Math.max(u.bestSectors.length, current?.bestSectors.length ?? 0);
  let sectorsBetter = false;
  const bestSectors: number[] = [];
  for (let i = 0; i < count; i++) {
    const a = current?.bestSectors[i];
    const b = u.bestSectors[i];
    if (typeof b === 'number' && Number.isFinite(b) && b > 0 && (a === undefined || b < a)) {
      bestSectors.push(b);
      sectorsBetter = true;
    } else if (a !== undefined) bestSectors.push(a);
  }
  if (lapBetter && u.lap) {
    return {
      lap: u.lap.time,
      lapSectors: u.lap.sectors.slice(),
      bestSectors,
      ghost: u.lap.ghost,
      date: u.date,
    };
  }
  if (!sectorsBetter || !current) return null;
  return { ...current, bestSectors };
}

function parseRecord(text: string): CircuitRecord | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const positive = (v: unknown): v is number =>
    typeof v === 'number' && Number.isFinite(v) && v > 0;
  const times = (v: unknown): v is number[] =>
    Array.isArray(v) && v.length > 0 && v.length <= 16 && v.every(positive);
  const ghost = typeof r.ghost === 'string' ? r.ghost : null;
  const date = typeof r.date === 'string' ? r.date.slice(0, 32) : '';
  if (!positive(r.lap)) return null;
  if (r.version !== VERSION || !times(r.lapSectors) || !times(r.bestSectors)) return null;
  return {
    lap: r.lap,
    lapSectors: r.lapSectors.slice(),
    bestSectors: r.bestSectors.slice(),
    ghost,
    date,
  };
}
