import { describe, expect, it } from 'vitest';
import { defaultProfile, rebind } from '../src/bindings';
import { MemoryStorage, ProfileStore, type StoragePort } from '../src/storage';
import { ASSIST_PRESETS, assistPresetFor } from '../src/assists';

describe('ProfileStore', () => {
  it('returns defaults when nothing is saved and round-trips a saved profile', async () => {
    const store = new ProfileStore(new MemoryStorage());
    expect((await store.load()).profile).toEqual(defaultProfile());
    const profile = defaultProfile();
    profile.bindings = rebind(profile.bindings, 'keyboard', 'drs', 0, 'key:KeyG').map;
    expect(await store.save(profile)).toBe(true);
    expect((await store.load()).profile).toEqual(profile);
  });

  it('keeps working on defaults when storage throws', async () => {
    const broken: StoragePort = {
      load: () => Promise.reject(new Error('SecurityError')),
      save: () => Promise.reject(new Error('QuotaExceededError')),
    };
    const store = new ProfileStore(broken);
    const loaded = await store.load();
    expect(loaded.profile).toEqual(defaultProfile());
    expect(loaded.problem).toMatch(/could not be read/);
    expect(await store.save(defaultProfile())).toBe(false);
  });
});

describe('assist presets', () => {
  it('give each device a starting set, most help on touch and least on a gamepad', () => {
    expect(Object.keys(ASSIST_PRESETS).sort()).toEqual(['gamepad', 'keyboard', 'touch']);
    expect(assistPresetFor('touch')).toMatchObject({ steering: 'high', gears: 'automatic' });
    expect(assistPresetFor('gamepad').steering).toBe('low');
    // Presets are data: callers get a copy they can change.
    const mine = assistPresetFor('keyboard');
    mine.abs = 'off';
    expect(ASSIST_PRESETS.keyboard.abs).toBe('on');
  });
});
