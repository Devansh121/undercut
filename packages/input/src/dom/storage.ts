import type { StoragePort } from '../storage';

/**
 * Web Storage (`localStorage`) behind the storage port. Storage can be blocked (private mode,
 * embedded frames, disabled cookies): reading the property itself may throw. Then the adapter
 * keeps values in memory for the session and reports `blocked`, and the game carries on.
 */
export class WebStorageAdapter implements StoragePort {
  blocked = false;
  private readonly memory = new Map<string, string>();

  constructor(private readonly getStorage: () => Storage = () => window.localStorage) {}

  load(key: string): Promise<string | null> {
    if (!this.blocked) {
      try {
        return Promise.resolve(this.getStorage().getItem(key));
      } catch {
        this.blocked = true;
      }
    }
    return Promise.resolve(this.memory.get(key) ?? null);
  }

  save(key: string, value: string): Promise<void> {
    this.memory.set(key, value);
    if (!this.blocked) {
      try {
        this.getStorage().setItem(key, value);
      } catch {
        this.blocked = true;
      }
    }
    return Promise.resolve();
  }
}
