import { MemoryStorage, type StoragePort } from '@undercut/input';
import { describe, expect, it } from 'vitest';
import { RecordStore, type CircuitRecord } from '../src/game/records';

class BrokenStorage implements StoragePort {
  loads = 0;
  saves = 0;
  load(): Promise<string | null> {
    this.loads++;
    return Promise.reject(new Error('SecurityError: storage blocked'));
  }
  save(): Promise<void> {
    this.saves++;
    return Promise.reject(new Error('QuotaExceededError'));
  }
}

const RECORD: CircuitRecord = {
  lap: 81.234,
  sectors: [26.1, 27.2, 27.934],
  ghost: 'AAAA',
  date: '2026-11-21',
};

describe('RecordStore', () => {
  it('saves and loads a circuit record through the port', async () => {
    const storage = new MemoryStorage();
    const store = new RecordStore(storage);
    expect(await store.load('monza')).toBeNull();
    expect(await store.save('monza', RECORD)).toBe(true);
    const again = new RecordStore(storage);
    expect(await again.load('monza')).toEqual(RECORD);
    expect(await again.load('spa')).toBeNull();
  });

  it('keeps working in memory when storage throws', async () => {
    const storage = new BrokenStorage();
    const store = new RecordStore(storage);
    expect(await store.load('monza')).toBeNull();
    expect(await store.save('monza', RECORD)).toBe(false);
    expect(store.persistent).toBe(false);
    // The record still lives for the rest of the session.
    expect(await store.load('monza')).toEqual(RECORD);
    // One full save, then one without the ghost.
    expect(storage.saves).toBe(2);
  });

  it('ignores damaged or foreign data', async () => {
    const storage = new MemoryStorage();
    await storage.save('records.monza', '{not json');
    const store = new RecordStore(storage);
    expect(await store.load('monza')).toBeNull();
    await storage.save('records.monza', JSON.stringify({ version: 99, lap: 1 }));
    expect(await new RecordStore(storage).load('monza')).toBeNull();
    await storage.save('records.monza', JSON.stringify({ version: 1, lap: 'fast', sectors: [] }));
    expect(await new RecordStore(storage).load('monza')).toBeNull();
    await storage.save(
      'records.monza',
      JSON.stringify({ version: 1, lap: -3, sectors: [1, 2, 3] }),
    );
    expect(await new RecordStore(storage).load('monza')).toBeNull();
  });

  it('never replaces a record with a slower lap', async () => {
    const store = new RecordStore(new MemoryStorage());
    await store.save('monza', RECORD);
    expect(await store.save('monza', { ...RECORD, lap: 90 })).toBe(false);
    expect((await store.load('monza'))?.lap).toBe(81.234);
    expect(await store.save('monza', { ...RECORD, lap: 80 })).toBe(true);
    expect((await store.load('monza'))?.lap).toBe(80);
  });
});
