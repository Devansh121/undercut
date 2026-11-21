import { Track } from '@undercut/track';
import { describe, expect, it } from 'vitest';
import { syntheticTrackData } from '../../track/test/fixtures';
import { EnvelopeModel } from '../src/envelope/envelope';
import { buildRacingLine } from '../src/line/build';
import { buildCorridor } from '../src/line/corridor';
import { computeLineGeometry } from '../src/line/geometry';
import { minimumCurvatureLine } from '../src/line/min-curvature';
import { syntheticEnvelope } from './fixtures';

describe('lap-time refinement of the line', () => {
  const track = new Track(syntheticTrackData({ straight: 300, radius: 45 }));
  const model = new EnvelopeModel(syntheticEnvelope());
  const config = {
    corridor: { halfTrack: 0.81, margin: 0.3, kerbUse: {} },
    scale: { lateral: 1, brake: 1, traction: 1 },
    refine: { widths: [20, 45], amplitudes: [0.6, 0.25], spacing: 8, reach: 60 },
  };
  const r = buildRacingLine(track, model, config);
  const corridor = buildCorridor(track, config.corridor);

  it('never makes the planned lap slower than the minimum-curvature line', () => {
    expect(r.lapTime).toBeLessThanOrEqual(r.minCurvatureLapTime);
    expect(r.evaluations).toBeGreaterThan(10);
  });

  it('stays inside the corridor', () => {
    for (let i = 0; i < track.lap.count; i++) {
      expect(r.d[i]).toBeGreaterThanOrEqual(corridor.lo[i]! - 1e-9);
      expect(r.d[i]).toBeLessThanOrEqual(corridor.hi[i]! + 1e-9);
    }
  });

  it('keeps the curvature continuous', () => {
    const geo = computeLineGeometry(track, r.d);
    const base = computeLineGeometry(track, minimumCurvatureLine(track, corridor).d);
    const jump = (g: typeof geo): number => {
      let m = 0;
      for (let i = 0; i < g.count; i++)
        m = Math.max(m, Math.abs(g.curvature[(i + 1) % g.count]! - g.curvature[i]!));
      return m;
    };
    // The bumps are C² at their ends: no step in curvature beyond a few times the base line's.
    expect(jump(geo)).toBeLessThan(Math.max(4 * jump(base), 0.004));
  });

  it('is deterministic', () => {
    expect(Array.from(buildRacingLine(track, model, config).d)).toEqual(Array.from(r.d));
  });
});
