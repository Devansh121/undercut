// Test shards balanced on measured time, for the physics CI job (vitest --shard, with the
// sequencer in tools/ci/weighted-sequencer.ts). Vitest's own sharding cuts the files into equal
// counts by a hash of their paths, which can put the two longest files (each about a third of a
// shard's budget) and their neighbours in one shard.

type Seconds = Readonly<Record<string, number>>;

function medianOf(seconds: Seconds): number {
  const known = Object.values(seconds)
    .filter((s) => Number.isFinite(s) && s > 0)
    .sort((a, b) => a - b);
  return known.length > 0 ? (known[Math.floor(known.length / 2)] as number) : 1;
}

/**
 * Split `files` (paths relative to the repository root, `/`-separated) into `count` shards: the
 * heaviest file first, each to the shard with the least time so far (ties to the lower shard), so
 * shards come out near equal. A file without a measured time counts as the median of the measured
 * ones. Every file lands in exactly one shard; the result is the same for the same input in any
 * order. Returns the files of each shard, heaviest first.
 */
export function assignShards(
  files: readonly string[],
  seconds: Seconds,
  count: number,
): string[][] {
  if (!Number.isInteger(count) || count < 1) throw new Error(`shard count ${count}`);
  const median = medianOf(seconds);
  const weight = (f: string): number => {
    const s = seconds[f];
    return s !== undefined && Number.isFinite(s) && s > 0 ? s : median;
  };
  const order = [...new Set(files)].sort((a, b) => weight(b) - weight(a) || (a < b ? -1 : 1));
  const shards = Array.from({ length: count }, () => ({ files: [] as string[], total: 0 }));
  for (const f of order) {
    let lightest = shards[0] as (typeof shards)[number];
    for (const s of shards) if (s.total < lightest.total) lightest = s;
    lightest.files.push(f);
    lightest.total += weight(f);
  }
  return shards.map((s) => s.files);
}

/** Each shard's total measured time (unknown files at the median), for reports and tests. */
export function shardTotals(shards: readonly (readonly string[])[], seconds: Seconds): number[] {
  const median = medianOf(seconds);
  return shards.map((files) => files.reduce((t, f) => t + (seconds[f] ?? median), 0));
}
