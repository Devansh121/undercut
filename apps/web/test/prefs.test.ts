import { MemoryStorage, type StoragePort } from '@undercut/input';
import { describe, expect, it } from 'vitest';
import { PREFS_KEY, PrefsStore, defaultPrefs, parsePrefs } from '../src/ui/data/prefs';

describe('menu prefs', () => {
  it('round-trips through the storage port', async () => {
    const port = new MemoryStorage();
    const store = new PrefsStore(port);
    await store.load();
    store.update((p) => {
      p.mode = 'quickRace';
      p.team = 'kestrel';
      p.driver = 1;
      p.timeOfDay.monza = 'overcast-day';
      p.race.laps = 12;
      p.assists.gamepad = { tractionControl: 0, autoGears: false };
      p.settings.hudScale = 1.1;
    });
    await store.flush();
    const again = new PrefsStore(port);
    expect(await again.load()).toEqual(store.get());
    expect(again.get().assists.gamepad).toEqual({ tractionControl: 0, autoGears: false });
  });

  it('falls back field by field on damaged or foreign data', () => {
    expect(parsePrefs(null)).toEqual(defaultPrefs());
    expect(parsePrefs('{not json')).toEqual(defaultPrefs());
    expect(parsePrefs(JSON.stringify({ version: 99, mode: 'quickRace' }))).toEqual(defaultPrefs());
    const p = parsePrefs(
      JSON.stringify({
        version: 1,
        mode: 'drift',
        circuit: '../../etc',
        team: 'sable',
        driver: 7,
        timeOfDay: { monza: 'night-floodlit', '<b>': 'x' },
        race: { laps: -3, aiSkill: 'elite', grid: 'set', slot: 21, field: 'equal' },
        assists: { keyboard: { tractionControl: 9, abs: 2, steering: 'max' } },
        settings: {
          units: 'mph',
          hudScale: 3,
          colourBlind: 'yes',
          subtitles: false,
          textSize: 'huge',
          touchLayout: 'mirrored',
        },
      }),
    );
    expect(p.mode).toBe('timeTrial');
    expect(p.circuit).toBe('monza');
    expect(p.team).toBe('sable');
    expect(p.driver).toBe(0);
    expect(p.timeOfDay).toEqual({ monza: 'night-floodlit' });
    expect(p.race).toEqual({ laps: 5, aiSkill: 'elite', grid: 'set', slot: 10, field: 'equal' });
    expect(p.assists.keyboard).toEqual({ tractionControl: 0, abs: 2 });
    expect(p.settings).toEqual({
      ...defaultPrefs().settings,
      units: 'mph',
      subtitles: false,
      touchLayout: 'mirrored',
    });
  });

  it('keeps working in memory when storage fails', async () => {
    const broken: StoragePort = {
      load: () => Promise.reject(new Error('blocked')),
      save: () => Promise.reject(new Error('blocked')),
    };
    const store = new PrefsStore(broken);
    expect(await store.load()).toEqual(defaultPrefs());
    store.update((p) => {
      p.circuit = 'spa';
    });
    await store.flush();
    expect(store.get().circuit).toBe('spa');
    expect(PREFS_KEY).toBe('menu.prefs');
  });
});
