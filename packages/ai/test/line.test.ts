import { Track } from '@undercut/track';
import { describe, expect, it } from 'vitest';
import { syntheticTrackData } from '../../track/test/fixtures';
import { buildCorridor, type CorridorOptions } from '../src/line/corridor';
import { computeLineGeometry } from '../src/line/geometry';
import { curvatureCost, minimumCurvatureLine } from '../src/line/min-curvature';

const track = new Track(syntheticTrackData({ straight: 300, radius: 50 }));
const n = track.lap.count;
const OPTIONS: CorridorOptions = { halfTrack: 0.81, margin: 0.3, kerbUse: { flat: 1.0 } };

describe('corridor', () => {
  const c = buildCorridor(track, OPTIONS);

  it('keeps the car centre inside the track by the half track plus the margin', () => {
    for (let i = 0; i < n; i++) {
      expect(c.lo[i]).toBeLessThan(c.hi[i]!);
      expect(c.hi[i]).toBeLessThanOrEqual(track.halfWidth[0][i]! - 0.81 - 0.3 + 1e-9);
    }
  });

  it('lets the wheels onto a kerb by the configured amount, and only there', () => {
    // The fixture's only kerb is on the right of the first bend.
    let onKerb = 0;
    for (let i = 0; i < n; i++) {
      const base = -(track.halfWidth[1][i]! - 0.81 - 0.3);
      if (track.kerb[1][i]! >= 0) {
        onKerb++;
        expect(c.lo[i]).toBeCloseTo(Math.max(base - 1.0, -track.frameLimit[1][i]!), 9);
      } else {
        expect(c.lo[i]).toBeCloseTo(Math.max(base, -track.frameLimit[1][i]!), 9);
      }
    }
    expect(onKerb).toBeGreaterThan(0);
  });

  it('ignores kerb profiles that are not listed', () => {
    const none = buildCorridor(track, { ...OPTIONS, kerbUse: {} });
    for (let i = 0; i < n; i++) expect(none.lo[i]).toBeGreaterThanOrEqual(c.lo[i]!);
  });
});

describe('minimum-curvature line', () => {
  const corridor = buildCorridor(track, OPTIONS);
  const { d } = minimumCurvatureLine(track, corridor);
  const geo = computeLineGeometry(track, d);

  it('stays inside the corridor', () => {
    for (let i = 0; i < n; i++) {
      expect(d[i]).toBeGreaterThanOrEqual(corridor.lo[i]! - 1e-9);
      expect(d[i]).toBeLessThanOrEqual(corridor.hi[i]! + 1e-9);
    }
  });

  it('has less total squared curvature than the centreline or any constant offset', () => {
    const cost = curvatureCost(track, d);
    for (const offset of [0, 1, -1, 2, -2]) {
      expect(cost).toBeLessThan(curvatureCost(track, new Float64Array(n).fill(offset)));
    }
  });

  it('goes outside, inside, outside through a bend', () => {
    const bend = track.corners[0]!;
    const at = (s: number): number => d[track.lap.sampleIndex(s)]!;
    // Right-hand bend: outside is left (positive d), the apex is on the right.
    expect(at(bend.start - 30)).toBeGreaterThan(1.5);
    expect(at(bend.s)).toBeLessThan(-1.5);
    expect(at(bend.end + 30)).toBeGreaterThan(1.5);
  });

  it('is smooth: curvature changes continuously from sample to sample', () => {
    let jump = 0;
    for (let i = 0; i < n; i++) {
      jump = Math.max(jump, Math.abs(geo.curvature[(i + 1) % n]! - geo.curvature[i]!));
    }
    // A 50 m bend entered from a straight: 0.02 1/m reached over tens of metres, never a step.
    expect(jump).toBeLessThan(0.002);
  });

  it('is shorter than the centreline through the bends', () => {
    expect(geo.length).toBeLessThan(track.length);
  });

  it('is deterministic', () => {
    const again = minimumCurvatureLine(track, corridor).d;
    expect(Array.from(again)).toEqual(Array.from(d));
  });
});

describe('line geometry', () => {
  it('reproduces the centreline when the offset is zero', () => {
    const geo = computeLineGeometry(track, new Float64Array(n));
    expect(geo.length).toBeCloseTo(track.length, 0);
    for (let i = 0; i < n; i += 37) {
      expect(geo.x[i]).toBeCloseTo(track.lap.x[i]!, 9);
      expect(geo.curvature[i]).toBeCloseTo(track.lap.curvature[i]!, 6);
    }
  });
});
