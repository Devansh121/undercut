/** Offline-only full-lap gates; the short DSP checks remain in CI. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type { Measurement } from './measure';
import type { Rendered } from './scenarios';

export function sampleHash(r: Rendered): string {
  const h = createHash('sha256');
  for (const channel of [r.left, r.right])
    h.update(new Uint8Array(channel.buffer, channel.byteOffset, channel.byteLength));
  return h.digest('hex');
}

export function checkReference(m: Measurement): void {
  assert(m.durationS > 60, 'complete lap required');
  assert(m.tracking.windows > 100, 'enough steady pitch windows');
  assert(m.tracking.medianErrorPct < 0.25, 'median pitch error < 0.25%');
  assert(m.tracking.maxErrorPct < 1, 'maximum pitch error < 1%');
  assert(m.samplePeakDbfs < 0 && m.truePeakDbtp < 0, 'no clipping');
  assert(m.dcOffset < 1e-3, 'no DC');
  assert(m.loudnessLufs >= -28 && m.loudnessLufs <= -14, 'reference loudness window');
}
