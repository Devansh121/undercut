import { MemoryStorage, type StoragePort } from '@undercut/input';
import { WebStorageAdapter } from '@undercut/input/dom';
import { describe, expect, it } from 'vitest';
import { RecordStore, durableStorage, memoryStorage, type RecordUpdate } from '../src/game/records';

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

const durable = (port: StoragePort) => ({ port, durable: () => true });

const LAP: RecordUpdate = {
  lap: { time: 30, sectors: [10, 10, 10], ghost: 'AAAA' },
  bestSectors: [10, 10, 10],
  date: '2026-11-21',
};

describe('RecordStore', () => {
  it('saves and loads a circuit record through the port', async () => {
    const storage = new MemoryStorage();
    const store = new RecordStore(durable(storage));
    expect(await store.load('monza')).toBeNull();
    expect(await store.save('monza', LAP)).toBe(true);
    const again = new RecordStore(durable(storage));
    expect(await again.load('monza')).toEqual({
      lap: 30,
      lapSectors: [10, 10, 10],
      bestSectors: [10, 10, 10],
      ghost: 'AAAA',
      date: '2026-11-21',
    });
    expect(await again.load('spa')).toBeNull();
  });

  it('keeps the best lap and its own splits apart from the independent sector minima', async () => {
    const storage = new MemoryStorage();
    const store = new RecordStore(durable(storage));
    await store.save('monza', LAP);
    await store.save('monza', {
      lap: { time: 29, sectors: [9, 11, 9], ghost: 'BBBB' },
      bestSectors: [9, 10, 9],
      date: '2026-11-22',
    });
    const back = await new RecordStore(durable(storage)).load('monza');
    expect(back).toMatchObject({
      lap: 29,
      lapSectors: [9, 11, 9],
      bestSectors: [9, 10, 9],
      ghost: 'BBBB',
    });
  });

  it('stores a sector-only improvement from a slower lap, without touching the best lap', async () => {
    const storage = new MemoryStorage();
    const store = new RecordStore(durable(storage));
    await store.save('monza', LAP);
    expect(
      await store.save('monza', { lap: null, bestSectors: [10, 9.5, 10], date: '2026-11-22' }),
    ).toBe(true);
    const back = await new RecordStore(durable(storage)).load('monza');
    expect(back).toMatchObject({
      lap: 30,
      lapSectors: [10, 10, 10],
      bestSectors: [10, 9.5, 10],
      ghost: 'AAAA',
    });
    // A sector improvement on a lap with the same time is kept too.
    expect(
      await store.save('monza', {
        lap: { time: 30, sectors: [9.9, 10, 10.1], ghost: 'CCCC' },
        bestSectors: [9.9, 9.5, 10],
        date: '2026-11-23',
      }),
    ).toBe(true);
    expect((await new RecordStore(durable(storage)).load('monza'))?.bestSectors).toEqual([
      9.9, 9.5, 10,
    ]);
  });

  it('never makes a record worse', async () => {
    const store = new RecordStore(durable(new MemoryStorage()));
    await store.save('monza', LAP);
    expect(
      await store.save('monza', {
        lap: { time: 31, sectors: [11, 10, 10], ghost: 'DDDD' },
        bestSectors: [11, 12, 13],
        date: '',
      }),
    ).toBe(false);
    expect(await store.load('monza')).toMatchObject({
      lap: 30,
      bestSectors: [10, 10, 10],
      ghost: 'AAAA',
    });
  });

  it('reads version 1 records, whose sectors were the lap splits', async () => {
    const storage = new MemoryStorage();
    await storage.save(
      'records.monza',
      JSON.stringify({ version: 1, lap: 81, sectors: [26, 27, 28], ghost: null, date: 'x' }),
    );
    expect(await new RecordStore(durable(storage)).load('monza')).toMatchObject({
      lap: 81,
      lapSectors: [26, 27, 28],
      bestSectors: [26, 27, 28],
    });
  });

  it('keeps working in memory when storage throws', async () => {
    const storage = new BrokenStorage();
    const store = new RecordStore(durable(storage));
    expect(await store.load('monza')).toBeNull();
    expect(await store.save('monza', LAP)).toBe(false);
    expect(store.persistent).toBe(false);
    expect((await store.load('monza'))?.lap).toBe(30);
  });

  it('ignores damaged or foreign data', async () => {
    const storage = new MemoryStorage();
    await storage.save('records.monza', '{not json');
    expect(await new RecordStore(durable(storage)).load('monza')).toBeNull();
    for (const bad of [
      { version: 99, lap: 1 },
      { version: 1, lap: 'fast', sectors: [] },
      { version: 1, lap: -3, sectors: [1, 2, 3] },
      { version: 2, lap: 30, lapSectors: [10, 10, 10], bestSectors: [10, 'x', 10] },
      { version: 2, lap: Infinity, lapSectors: [1, 2, 3], bestSectors: [1, 2, 3] },
    ]) {
      await storage.save('records.monza', JSON.stringify(bad));
      expect(await new RecordStore(durable(storage)).load('monza')).toBeNull();
    }
  });
});

describe('RecordStore persistence status', () => {
  it('reports in-memory storage as not persistent', async () => {
    const store = new RecordStore(memoryStorage());
    await store.save('monza', LAP);
    expect(store.persistent).toBe(false);
  });

  it('reports Web Storage as persistent when it works', async () => {
    const data = new Map<string, string>();
    const fake = {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
    } as unknown as Storage;
    const store = new RecordStore(durableStorage(new WebStorageAdapter(() => fake)));
    expect(await store.load('monza')).toBeNull();
    await store.save('monza', LAP);
    expect(store.persistent).toBe(true);
    expect(data.has('records.monza')).toBe(true);
  });

  it('reports the real Web Storage adapter as not persistent when storage is blocked', async () => {
    const adapter = new WebStorageAdapter(() => {
      throw new DOMException('The operation is insecure.', 'SecurityError');
    });
    const store = new RecordStore(durableStorage(adapter));
    expect(await store.load('monza')).toBeNull();
    expect(store.persistent).toBe(false);
    await store.save('monza', LAP);
    expect(store.persistent).toBe(false);
    expect((await store.load('monza'))?.lap).toBe(30);
  });

  it('turns not persistent when a save starts failing (quota)', async () => {
    let full = false;
    const data = new Map<string, string>();
    const fake = {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => {
        if (full) throw new DOMException('full', 'QuotaExceededError');
        data.set(k, v);
      },
    } as unknown as Storage;
    const store = new RecordStore(durableStorage(new WebStorageAdapter(() => fake)));
    await store.save('monza', LAP);
    expect(store.persistent).toBe(true);
    full = true;
    await store.save('monza', { lap: null, bestSectors: [9, 9, 9], date: '' });
    expect(store.persistent).toBe(false);
  });
});
