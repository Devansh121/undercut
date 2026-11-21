import { LEFT, RIGHT, Track } from '@undercut/track';
import monza from '@undercut/track/data/monza.json';
import { SurfaceKind } from '@undercut/sim';
import { describe, expect, it } from 'vitest';
import {
  TYRE_HALF_TREAD,
  buildLegalCorridor,
  legalBound,
  usableBeyondLine,
  wheelOff,
  type LegalCorridorOptions,
} from '../src/line/limits';

const track = Track.fromJSON(monza);
const n = track.lap.count;
const O: LegalCorridorOptions = {
  rule: 'four-wheels',
  halfTrackInner: 0.78,
  halfTrackOuter: 0.81,
  tyreHalfWidth: 0.2275,
  halfTread: TYRE_HALF_TREAD,
  maxYaw: (10 * Math.PI) / 180,
  allowance: 0.3,
  surfaceMargin: 0.2,
};

describe('track-limit rule', () => {
  it('calls a wheel off only when its tyre is wholly past the white line', () => {
    const s = 100;
    const hw = track.halfWidthAt(s, LEFT);
    expect(wheelOff(track, s, hw + TYRE_HALF_TREAD - 0.001)).toBe(false);
    expect(wheelOff(track, s, hw + TYRE_HALF_TREAD + 0.001)).toBe(true);
    const hr = track.halfWidthAt(s, RIGHT);
    expect(wheelOff(track, s, -(hr + TYRE_HALF_TREAD + 0.001))).toBe(true);
  });
});

describe('legal corridor', () => {
  const c = buildLegalCorridor(track, O);

  it('never plans the inner wheels wholly past the line, allowance included', () => {
    for (let i = 0; i < n; i++) {
      for (const [side, bound] of [
        [LEFT, c.hi[i]!],
        [RIGHT, -c.lo[i]!],
      ] as const) {
        const hw = track.halfWidth[side][i]!;
        const inner = bound - O.halfTrackInner * Math.cos(O.maxYaw);
        expect(inner - O.halfTread).toBeLessThanOrEqual(hw - O.allowance + 1e-9);
      }
    }
  });

  it('keeps every tyre off grass and gravel, and on a kerb only up to its crest', () => {
    let kerbs = 0;
    let grass = 0;
    for (let i = 0; i < n; i++) {
      for (const [side, bound] of [
        [LEFT, c.hi[i]!],
        [RIGHT, -c.lo[i]!],
      ] as const) {
        const hw = track.halfWidth[side][i]!;
        const outerEdge = bound + O.halfTrackOuter + O.tyreHalfWidth;
        const usable = usableBeyondLine(track, i, side);
        expect(outerEdge).toBeLessThanOrEqual(hw + usable - O.surfaceMargin + 1e-9);
        const k = track.kerb[side][i]!;
        if (k >= 0) {
          kerbs++;
          const p = track.kerbProfiles[k]!;
          expect(usable).toBeLessThan(p.width);
          if (p.highFrom < p.highTo) expect(usable).toBeLessThanOrEqual(p.highFrom);
        } else if (
          track.inner[side][i] === SurfaceKind.Grass ||
          track.inner[side][i] === SurfaceKind.Gravel
        ) {
          grass++;
          expect(usable).toBe(0);
        }
      }
    }
    expect(kerbs).toBeGreaterThan(0);
    expect(grass).toBeGreaterThan(0);
  });

  it('is wider than the whole car inside the lines wherever a kerb or run-off allows', () => {
    let wider = 0;
    for (let i = 0; i < n; i++) {
      if (legalBound(track, i, LEFT, O) > track.halfWidth[LEFT][i]! - 0.81 - 0.3 + 0.05) wider++;
    }
    expect(wider).toBeGreaterThan(n / 10);
  });
});
