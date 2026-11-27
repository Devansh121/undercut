import fs from 'node:fs';
import { assignShards } from './shards';

const { seconds } = JSON.parse(
  fs.readFileSync(new URL('./browser-weights.json', import.meta.url), 'utf8'),
) as { seconds: Record<string, number> };

/**
 * Extra testIgnore globs for a viewport project's weighted CI shard. Keep Playwright's normal
 * discovery and exclusions: new specs run at the median weight, and other projects are untouched.
 * Balance each viewport separately so neither shard inherits all the expensive desktop tests.
 */
export function browserShardIgnores(
  project: string,
  files: readonly string[],
  shard: string | undefined,
): string[] {
  if (shard === undefined) return [];
  const match = /^(\d+)\/(\d+)$/.exec(shard);
  const current = Number(match?.[1]);
  const count = Number(match?.[2]);
  if (
    !Number.isSafeInteger(current) ||
    !Number.isSafeInteger(count) ||
    current < 1 ||
    current > count
  )
    throw new Error(`Invalid BROWSER_SHARD: ${shard}`);
  const keys = files.map((f) => `${project}/${f}`);
  const selected = new Set(assignShards(keys, seconds, count)[current - 1]);
  return files.filter((f) => !selected.has(`${project}/${f}`)).map((f) => `**/${f}`);
}
