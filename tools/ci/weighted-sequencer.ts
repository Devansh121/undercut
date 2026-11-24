import path from 'node:path';
import { BaseSequencer, type TestSpecification } from 'vitest/node';
import weights from './physics-weights.json' with { type: 'json' };
import { assignShards } from './shards';

const SECONDS: Readonly<Record<string, number>> = weights.seconds;

/**
 * Vitest's sequencer with the physics project's files sharded and ordered by measured time
 * (tools/ci/physics-weights.json). `--shard=i/n` gets shard i of a balanced split (shards.mjs)
 * instead of an equal count by path hash; within a run the longest physics files start first, so
 * none of them begins last and stretches the run. Other projects keep vitest's order.
 */
export class WeightedShardSequencer extends BaseSequencer {
  private relative(spec: TestSpecification): string {
    return path.relative(this.ctx.config.root, spec.moduleId).split(path.sep).join('/');
  }

  override async shard(files: TestSpecification[]): Promise<TestSpecification[]> {
    const shard = this.ctx.config.shard;
    if (!shard) return files;
    const shards = assignShards(
      files.map((f) => this.relative(f)),
      SECONDS,
      shard.count,
    );
    const mine = new Set(shards[shard.index - 1] ?? []);
    return files.filter((f) => mine.has(this.relative(f)));
  }

  override async sort(files: TestSpecification[]): Promise<TestSpecification[]> {
    const sorted = await super.sort(files);
    const seconds = (f: TestSpecification): number => SECONDS[this.relative(f)] ?? 0;
    // Stable: only physics files change places, among themselves.
    return sorted.sort((a, b) =>
      a.project.name === 'physics' && b.project.name === 'physics' ? seconds(b) - seconds(a) : 0,
    );
  }
}
