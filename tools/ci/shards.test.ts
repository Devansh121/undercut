import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { assignShards, shardTotals } from './shards';

const { seconds } = JSON.parse(
  fs.readFileSync(new URL('./physics-weights.json', import.meta.url), 'utf8'),
) as { seconds: Record<string, number> };
const files = Object.keys(seconds);

describe('physics shards', () => {
  it('puts every file in exactly one shard, for any count', () => {
    for (const count of [1, 2, 3, 4, 7]) {
      const shards = assignShards(
        [...files, 'packages/new/validation/unlisted.test.ts'],
        seconds,
        count,
      );
      expect(shards).toHaveLength(count);
      const all = shards.flat();
      expect(all).toHaveLength(files.length + 1);
      expect(new Set(all).size).toBe(all.length);
      expect(all).toContain('packages/new/validation/unlisted.test.ts');
    }
  });

  it('gives the same split whatever order the files come in', () => {
    const a = assignShards(files, seconds, 3);
    const b = assignShards([...files].reverse(), seconds, 3);
    expect(b).toEqual(a);
  });

  it('balances three shards within the longest file of each other', () => {
    const totals = shardTotals(assignShards(files, seconds, 3), seconds);
    const longest = Math.max(...Object.values(seconds));
    expect(Math.max(...totals) - Math.min(...totals)).toBeLessThanOrEqual(longest);
    // The two longest files never share a shard.
    const [first, second] = [...files].sort((x, y) => (seconds[y] ?? 0) - (seconds[x] ?? 0));
    const shards = assignShards(files, seconds, 3);
    expect(shards.findIndex((s) => s.includes(first))).not.toBe(
      shards.findIndex((s) => s.includes(second)),
    );
  });

  it('lists every physics test file that exists', () => {
    // A new validation file still runs (at the median weight); this keeps the table honest.
    const roots = [
      'packages/input/validation',
      'packages/sim/validation',
      'packages/ai/validation',
      'packages/track/validation',
      'packages/race/validation',
      'apps/web/validation',
    ];
    const onDisk = roots.flatMap((dir) =>
      fs
        .readdirSync(new URL(`../../${dir}`, import.meta.url))
        .filter((f) => f.endsWith('.test.ts') && !f.endsWith('.soak.test.ts'))
        .map((f) => `${dir}/${f}`),
    );
    expect(onDisk.filter((f) => !(f in seconds))).toEqual([]);
  });
});
