import { describe, expect, it } from 'vitest';
import { defaultProfile, deserializeProfile, serializeProfile } from '../src/bindings';
import { MemoryStorage, PROFILE_KEY, ProfileStore } from '../src/storage';

function nested(depth: number): string {
  return '['.repeat(depth) + ']'.repeat(depth);
}

const broken = { toString: null, valueOf: null };
const good = JSON.parse(serializeProfile(defaultProfile())) as Record<string, unknown>;

/** Replace one field of a valid profile at `path` with `value`. */
function withField(path: string[], value: unknown): string {
  const copy = JSON.parse(JSON.stringify(good)) as Record<string, unknown>;
  let node: Record<string, unknown> = copy;
  for (const key of path.slice(0, -1)) node = node[key] as Record<string, unknown>;
  node[path[path.length - 1] as string] = value;
  return JSON.stringify(copy);
}

const WRONG_TYPES: unknown[] = [null, true, 0, -1, 1e308, 'text', [], [1, 2], {}, broken];
const FIELDS = [
  ['version'],
  ['bindings'],
  ['bindings', 'keyboard'],
  ['bindings', 'keyboard', 'throttle'],
  ['bindings', 'gamepad', 'steerLeft'],
  ['bindings', 'touch'],
  ['shaping'],
  ['shaping', 'keyboard'],
  ['shaping', 'keyboard', 'steerRate'],
  ['shaping', 'gamepad', 'stick'],
  ['shaping', 'gamepad', 'stick', 'gamma'],
  ['shaping', 'touch', 'stickRadius'],
  ['shaping', 'drsMode'],
];

const HOSTILE: string[] = [
  '{"version":{"toString":null}}',
  '{"version":{"valueOf":null,"toString":null}}',
  '{"version":[1]}',
  '{"version":null}',
  '{"version":1e999}',
  '{"version":"1"}',
  '{"__proto__":{"version":1},"constructor":{"prototype":{"polluted":true}}}',
  '{"version":1,"bindings":{"__proto__":{"keyboard":{"drs":["key:KeyK"]}}}}',
  '{"version":1,"shaping":{"__proto__":{"drsMode":"hold"}}}',
  'null',
  '[]',
  '[{"version":1}]',
  '"text"',
  '42',
  '1e999',
  'true',
  '{}',
  nested(10_000),
  `{"version":1,"bindings":${nested(5_000)}}`,
  'x'.repeat(100_000),
  ...FIELDS.flatMap((path) => WRONG_TYPES.map((value) => withField(path, value))),
];

describe('deserializeProfile with hostile data', () => {
  it.each(HOSTILE.map((text, i) => [i, text] as const))(
    'case %i never throws and yields a usable profile',
    (_i, text) => {
      const { profile } = deserializeProfile(text);
      const defaults = defaultProfile();
      expect(Object.keys(profile.bindings).sort()).toEqual(['gamepad', 'keyboard', 'touch']);
      expect(profile.version).toBe(defaults.version);
      for (const value of Object.values(profile.shaping.keyboard)) {
        expect(Number.isFinite(value)).toBe(true);
      }
      expect(['toggle', 'hold']).toContain(profile.shaping.drsMode);
      expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    },
  );

  it('uses a fixed message for a version that is not a number', () => {
    const { profile, problem } = deserializeProfile('{"version":{"toString":null}}');
    expect(profile).toEqual(defaultProfile());
    expect(problem).toBe('Saved controls have an invalid version');
  });
});

describe('ProfileStore.load with hostile data', () => {
  it('never throws and falls back to defaults', async () => {
    for (const text of HOSTILE.slice(0, 20)) {
      const storage = new MemoryStorage();
      await storage.save(PROFILE_KEY, text);
      const { profile } = await new ProfileStore(storage).load();
      expect(profile.version).toBe(1);
    }
  });

  it('survives a storage port that returns a non-string', async () => {
    const store = new ProfileStore({
      load: () => Promise.resolve(broken as unknown as string),
      save: () => Promise.resolve(),
    });
    await expect(store.load()).resolves.toMatchObject({ profile: defaultProfile() });
  });
});
