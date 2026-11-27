import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { browserShardIgnores } from './browser-shards';

const { seconds } = JSON.parse(
  fs.readFileSync(new URL('./browser-weights.json', import.meta.url), 'utf8'),
) as { seconds: Record<string, number> };

describe('browser shards', () => {
  for (const project of ['desktop', 'phone']) {
    const files = Object.keys(seconds)
      .filter((key) => key.startsWith(`${project}/`))
      .map((key) => key.slice(project.length + 1));

    it(`runs every ${project} file exactly once, including a new spec`, () => {
      const all = [...files, 'nested/new.spec.ts'];
      expect(browserShardIgnores(project, all, undefined)).toEqual([]);
      for (const count of [1, 2, 3, 7]) {
        const selected = Array.from({ length: count }, (_, i) => {
          const ignored = browserShardIgnores(project, all, `${i + 1}/${count}`);
          return all.filter((f) => !ignored.includes(`**/${f}`));
        }).flat();
        expect(selected.sort()).toEqual([...all].sort());
      }
    });

    it(`balances ${project} measured time across two shards deterministically`, () => {
      const totals = [1, 2].map((i) => {
        const ignored = browserShardIgnores(project, files, `${i}/2`);
        expect(browserShardIgnores(project, [...files].reverse(), `${i}/2`).sort()).toEqual(
          [...ignored].sort(),
        );
        return files
          .filter((f) => !ignored.includes(`**/${f}`))
          .reduce((total, f) => total + (seconds[`${project}/${f}`] ?? 0), 0);
      });
      expect(Math.abs((totals[0] ?? 0) - (totals[1] ?? 0))).toBeLessThan(2);
    });
  }

  it('rejects malformed or out-of-range shard selections', () => {
    for (const shard of ['', '0/2', '3/2', '1/0', '1.5/2', '1/2/3', 'foo'])
      expect(() => browserShardIgnores('desktop', ['new.spec.ts'], shard)).toThrow(
        'Invalid BROWSER_SHARD',
      );
  });
});
