import type { StoragePort } from '@undercut/input';

/** Bus volumes the pause menu sets, 0–1. */
export interface AudioSettings {
  master: number;
  engine: number;
  effects: number;
  ui: number;
  ambience: number;
}

export type AudioSettingKey = keyof AudioSettings;

export const AUDIO_DEFAULTS: Readonly<AudioSettings> = Object.freeze({
  master: 0.8,
  engine: 1,
  effects: 0.8,
  ui: 0.8,
  ambience: 0.6,
});

const KEY = 'settings.audio';

/** Volumes saved beside the other settings; storage failures leave them in memory. */
export class AudioSettingsStore {
  private value: AudioSettings = { ...AUDIO_DEFAULTS };

  constructor(private readonly port: StoragePort) {}

  get current(): Readonly<AudioSettings> {
    return this.value;
  }

  async load(): Promise<AudioSettings> {
    let text: string | null;
    try {
      text = await this.port.load(KEY);
    } catch {
      return { ...this.value };
    }
    if (text !== null) this.value = parse(text);
    return { ...this.value };
  }

  async set(key: AudioSettingKey, volume: number): Promise<void> {
    this.value = { ...this.value, [key]: clamp(volume, AUDIO_DEFAULTS[key]) };
    try {
      await this.port.save(KEY, JSON.stringify(this.value));
    } catch {
      // Kept in memory for the session.
    }
  }
}

function parse(text: string): AudioSettings {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ...AUDIO_DEFAULTS };
  }
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  return {
    master: clamp(r.master, AUDIO_DEFAULTS.master),
    engine: clamp(r.engine, AUDIO_DEFAULTS.engine),
    effects: clamp(r.effects, AUDIO_DEFAULTS.effects),
    ui: clamp(r.ui, AUDIO_DEFAULTS.ui),
    ambience: clamp(r.ambience, AUDIO_DEFAULTS.ambience),
  };
}

function clamp(v: unknown, fallback: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  return Math.min(1, Math.max(0, v));
}
