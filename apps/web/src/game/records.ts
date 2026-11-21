import type { StoragePort } from '@undercut/input';

/** What is kept per circuit: the best valid lap, its sectors and its ghost. */
export interface CircuitRecord {
  lap: number;
  sectors: number[];
  /** `encodeGhost` text, or null when the ghost could not be kept. */
  ghost: string | null;
  /** ISO date the record was set (YYYY-MM-DD), for the launch screen. */
  date: string;
}

const VERSION = 1;
const keyOf = (circuit: string): string => `records.${circuit}`;

/**
 * Personal bests per circuit through a storage port (in-memory or Web Storage now; IndexedDB in
 * M6). Storage that throws or is full never stops the game: records then live in memory for
 * the session and `persistent` turns false so the UI can say so.
 */
export class RecordStore {
  private readonly port: StoragePort;
  private readonly memory = new Map<string, CircuitRecord>();
  private persistentValue = true;

  constructor(port: StoragePort) {
    this.port = port;
  }

  /** False once storage has failed: records last until the page closes. */
  get persistent(): boolean {
    return this.persistentValue;
  }

  async load(circuit: string): Promise<CircuitRecord | null> {
    const cached = this.memory.get(circuit);
    if (cached) return cached;
    let text: string | null;
    try {
      text = await this.port.load(keyOf(circuit));
    } catch {
      this.persistentValue = false;
      return null;
    }
    const record = text === null ? null : parseRecord(text);
    if (record) this.memory.set(circuit, record);
    return record;
  }

  /** Keep `record` if it beats the stored one. True when it was written to storage. */
  async save(circuit: string, record: CircuitRecord): Promise<boolean> {
    const current = await this.load(circuit);
    if (current && current.lap <= record.lap) return false;
    this.memory.set(circuit, record);
    try {
      await this.port.save(keyOf(circuit), JSON.stringify({ version: VERSION, ...record }));
      return true;
    } catch {
      this.persistentValue = false;
      // A ghost is the bulk of a record; try once more without it before giving up.
      try {
        await this.port.save(
          keyOf(circuit),
          JSON.stringify({ version: VERSION, ...record, ghost: null }),
        );
        this.persistentValue = true;
        return true;
      } catch {
        return false;
      }
    }
  }
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
  if (r.version !== VERSION || !positive(r.lap)) return null;
  if (!Array.isArray(r.sectors) || !r.sectors.every(positive)) return null;
  const ghost = typeof r.ghost === 'string' ? r.ghost : null;
  const date = typeof r.date === 'string' ? r.date : '';
  return { lap: r.lap, sectors: r.sectors as number[], ghost, date };
}
