/**
 * Persistence is a port: the input layer saves its profile through whatever storage the game
 * injects. M6 brings IndexedDB; until then an in-memory adapter and a Web Storage adapter
 * (`@undercut/input/dom`) cover it. The port is async so IndexedDB fits without changes.
 */
import {
  deserializeProfile,
  serializeProfile,
  type InputProfile,
  type LoadedProfile,
} from './bindings';

export interface StoragePort {
  load(key: string): Promise<string | null>;
  save(key: string, value: string): Promise<void>;
}

export class MemoryStorage implements StoragePort {
  private readonly data = new Map<string, string>();

  load(key: string): Promise<string | null> {
    return Promise.resolve(this.data.get(key) ?? null);
  }

  save(key: string, value: string): Promise<void> {
    this.data.set(key, value);
    return Promise.resolve();
  }
}

export const PROFILE_KEY = 'input.profile';

/** Loads and saves the input profile. Storage failures never stop the game: it runs on defaults. */
export class ProfileStore {
  constructor(
    private readonly storage: StoragePort,
    private readonly key = PROFILE_KEY,
  ) {}

  async load(): Promise<LoadedProfile> {
    let text: string | null;
    try {
      text = await this.storage.load(this.key);
    } catch {
      return { ...deserializeProfile(null), problem: 'Saved controls could not be read' };
    }
    return deserializeProfile(text);
  }

  /** Returns false when the profile could not be saved. */
  async save(profile: InputProfile): Promise<boolean> {
    try {
      await this.storage.save(this.key, serializeProfile(profile));
      return true;
    } catch {
      return false;
    }
  }
}
