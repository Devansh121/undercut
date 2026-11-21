import { SurfaceKind, createSurfaceHint, createSurfaceSample } from '@undercut/sim';
import { describe, expect, it } from 'vitest';
import { TrackDataError, validateTrackData } from '../src/data';
import { createVec3 } from '../src/path';
import { HIGH_KERB, SURFACE_PROPERTIES, TrackSurface } from '../src/surface';
import { LEFT, Track, VERGE_FALL, createGround } from '../src/track';
import { steepestKerbSlope, syntheticTrackData } from './fixtures';

describe('validateTrackData', () => {
  it('accepts a complete file', () => {
    expect(() => validateTrackData(syntheticTrackData())).not.toThrow();
  });

  it('lists every problem it finds', () => {
    const bad = JSON.parse(JSON.stringify(syntheticTrackData())) as Record<string, unknown>;
    (bad.centreline as Record<string, number[]>).x!.pop();
    (bad as { version: number }).version = 2;
    (bad as { extra?: number }).extra = 1;
    ((bad.sides as Record<string, Record<string, unknown>>).left!.inner as unknown[]) = [
      [3, 'grass'],
    ];
    ((bad.timing as Record<string, unknown>).sectors as number[]) = [0, 900, 400];
    try {
      validateTrackData(bad);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(TrackDataError);
      const problems = (e as TrackDataError).problems.join('\n');
      expect(problems).toContain('track.version');
      expect(problems).toContain('track.extra: unknown key');
      expect(problems).toContain('track.centreline.x');
      expect(problems).toContain('track.sides.left.inner[0]');
      expect(problems).toContain('track.timing.sectors[2]');
    }
  });

  it('rejects kerb profiles that would leave a step in the ground', () => {
    const bad = JSON.parse(JSON.stringify(syntheticTrackData())) as ReturnType<
      typeof syntheticTrackData
    >;
    (bad.kerbProfiles[0]!.points as [number, number][])[3] = [1.5, 0.05];
    expect(() => validateTrackData(bad)).toThrow(/end at height 0/);
  });
});

describe('Track', () => {
  const data = syntheticTrackData({
    bank: 0.03,
    height: (s) => 2 * Math.sin((2 * Math.PI * s) / 1176.99),
  });
  const track = new Track(data);
  const L = track.length;

  it('wraps s and measures signed lap distance', () => {
    expect(track.wrap(-1)).toBeCloseTo(L - 1, 9);
    expect(track.lapDelta(L - 10, 15)).toBeCloseTo(25, 9);
    expect(track.lapDelta(15, L - 10)).toBeCloseTo(-25, 9);
    expect(track.forwardDistance(15, 10)).toBeCloseTo(L - 5, 9);
    expect(track.crossed(L - 3, 2, 0)).toBe(true);
    expect(track.crossed(2, L - 3, 0)).toBe(false);
    expect(track.crossed(100, 120, 110)).toBe(true);
    expect(track.crossed(100, 120, 130)).toBe(false);
  });

  it('looks up sectors and DRS zones', () => {
    expect(track.sectorAt(10)).toBe(0);
    expect(track.sectorAt(460)).toBe(1);
    expect(track.sectorAt(L - 1)).toBe(2);
    expect(track.drsZoneAt(100)).toBe(0);
    expect(track.drsZoneAt(10)).toBe(-1);
    expect(track.drsZoneAt(390)).toBe(-1);
  });

  it('gives interpolated centreline quantities', () => {
    const p = createVec3();
    track.positionAt(100, p);
    expect(p.x).toBeCloseTo(-100, 6);
    expect(p.z).toBeCloseTo(-60, 6);
    track.tangentAt(100, p);
    expect(p.x).toBeCloseTo(1, 9);
    track.normalAt(100, p);
    expect(p.z).toBeCloseTo(-1, 9);
    expect(track.curvatureAt(400 + 50)).toBeCloseTo(-1 / 60, 3);
    expect(track.bankAt(77)).toBeCloseTo(0.03, 12);
    expect(track.halfWidthAt(77, LEFT)).toBe(5);
    expect(track.elevationAt(1176.99 / 4)).toBeCloseTo(2, 3);
    expect(track.gradeAt(0)).toBeCloseTo((2 * 2 * Math.PI) / 1176.99, 4);
  });

  it('builds a banked, continuous ground cross-section', () => {
    const g = createGround();
    const s = 100;
    const yc = track.elevationAt(s);
    track.ground(s, 3, g);
    expect(g.kind).toBe(SurfaceKind.Asphalt);
    expect(g.height - yc).toBeCloseTo(3 * Math.tan(0.03), 9);
    track.ground(s, 4.9, g);
    expect(g.kind).toBe(SurfaceKind.Paint);
    track.ground(s, 8, g);
    expect(g.kind).toBe(SurfaceKind.Grass);
    expect(g.height - yc).toBeCloseTo(5 * Math.tan(0.03) - VERGE_FALL * 3, 9);
    track.ground(s, 20, g);
    expect(g.kind).toBe(SurfaceKind.Grass);
    track.ground(500, 20, g);
    expect(g.kind).toBe(SurfaceKind.Gravel);
    track.ground(s, 30, g);
    expect(g.kind).toBe(SurfaceKind.OutOfBounds);
    track.ground(s, -8, g);
    expect(g.kind).toBe(SurfaceKind.RunoffAsphalt);
    track.ground(s, -14.5, g);
    expect(g.kind).toBe(SurfaceKind.OutOfBounds);
    // Kerb on the right of the first bend.
    track.ground(400 + 60, -5.5, g);
    expect(g.kind).toBe(SurfaceKind.Kerb);
  });

  it('places grid slots on the ground facing along the lap', () => {
    expect(track.gridSlots).toHaveLength(6);
    const pole = track.gridSlots[0]!;
    const p = createVec3();
    track.pointAt(pole.s, pole.d, p);
    expect(pole.x).toBeCloseTo(p.x, 9);
    expect(pole.y).toBeCloseTo(p.y, 9);
    // The last stretch before the line heads east-ish around the west bend: yaw from the tangent.
    track.tangentAt(pole.s, p);
    expect(Math.cos(pole.yaw)).toBeCloseTo(p.x, 9);
    expect(-Math.sin(pole.yaw)).toBeCloseTo(p.z, 9);
  });

  it('splits barriers where the type changes and keeps them continuous there', () => {
    const left = track.barriers.filter((b) => b.side === 'left');
    expect(left.map((b) => b.type)).toEqual(['tyres', 'armco']);
    const tyres = left[0]!;
    const armco = left[1]!;
    const lastT = tyres.points.length - 3;
    expect(tyres.points[lastT]).toBeCloseTo(armco.points[0]!, 9);
    expect(tyres.points[lastT + 2]).toBeCloseTo(armco.points[2]!, 9);
    // Armco wraps through s = 0 back to where the tyres start.
    const lastA = armco.points.length - 3;
    expect(armco.points[lastA]).toBeCloseTo(tyres.points[0]!, 9);
    const right = track.barriers.filter((b) => b.side === 'right');
    expect(right).toHaveLength(1);
    expect(right[0]!.closed).toBe(true);
    expect(track.barriers.filter((b) => b.side === 'pit')).toHaveLength(1);
  });

  it('builds track-limit lines at the white-line edges', () => {
    const [l, r] = track.trackLimits;
    expect(l.length).toBe(2 * data.sampleCount);
    // Sample 0 is on the north straight heading east: left is north (-z).
    expect(l[1]).toBeCloseTo(-65, 3);
    expect(r[1]).toBeCloseTo(-55, 3);
  });
});

describe('TrackSurface', () => {
  const track = new Track(syntheticTrackData({ bank: 0.03 }));
  const surface = new TrackSurface(track);
  const out = createSurfaceSample();

  it('reports height, normal, kind and track coordinates', () => {
    const p = createVec3();
    track.pointAt(100, 2, p);
    surface.sample(p.x, p.z, createSurfaceHint(), out);
    expect(out.s).toBeCloseTo(100, 6);
    expect(out.d).toBeCloseTo(2, 6);
    expect(out.height).toBeCloseTo(p.y, 9);
    expect(out.kind).toBe(SurfaceKind.Asphalt);
    expect(out.grip).toBe(1);
    // Banked left-high: the normal leans to the right of travel (+z on the north straight).
    expect(out.normalY).toBeCloseTo(Math.cos(0.03), 6);
    expect(out.normalZ).toBeCloseTo(Math.sin(0.03), 6);
    expect(Math.hypot(out.normalX, out.normalY, out.normalZ)).toBeCloseTo(1, 12);
  });

  it('uses the kerb, run-off and pit-lane properties', () => {
    const p = createVec3();
    track.pointAt(460, -5.5, p);
    surface.sample(p.x, p.z, createSurfaceHint(), out);
    expect(out.kind).toBe(SurfaceKind.Kerb);
    expect(out.grip).toBe(SURFACE_PROPERTIES[SurfaceKind.Kerb].grip);
    track.pointAt(500, 20, p);
    surface.sample(p.x, p.z, createSurfaceHint(), out);
    expect(out.kind).toBe(SurfaceKind.Gravel);
    expect(out.drag).toBe(8);
    // The pit lane runs 20 m right of the north straight, behind the 14 m barrier.
    surface.sample(0, -40, createSurfaceHint(), out);
    expect(out.kind).toBe(SurfaceKind.PitLane);
    surface.sample(0, -30, createSurfaceHint(), out);
    expect(out.kind).toBe(SurfaceKind.OutOfBounds);
    expect(HIGH_KERB.grip).toBe(0.6);
  });

  it('keeps one hint per moving point and agrees with a fresh lookup', () => {
    const hint = createSurfaceHint();
    const fresh = createSurfaceSample();
    const p = createVec3();
    for (let s = 0; s < 2 * track.length; s += 0.37) {
      track.pointAt(s, -20 + 30 * Math.abs(Math.sin(s / 50)), p);
      surface.sample(p.x, p.z, hint, out);
      surface.sample(p.x, p.z, createSurfaceHint(), fresh);
      expect(out.kind).toBe(fresh.kind);
      expect(out.height).toBeCloseTo(fresh.height, 9);
      expect(out.d).toBeCloseTo(fresh.d, 6);
    }
  });

  it('is continuous in height across lateral zone boundaries', () => {
    const p = createVec3();
    const hint = createSurfaceHint();
    for (const s of [100, 460, 500, 900]) {
      let last = Number.NaN;
      // Steepest legitimate ground: a kerb edge plus the verge fall; a step between zones
      // would be centimetres.
      const step = 0.005;
      const bound = (steepestKerbSlope(track) + VERGE_FALL + 0.05) * step + 1e-4;
      for (let d = -40; d <= 40; d += step) {
        track.lap.pointAt(s, d, p);
        surface.sample(p.x, p.z, hint, out);
        if (!Number.isNaN(last)) expect(Math.abs(out.height - last)).toBeLessThan(bound);
        last = out.height;
      }
    }
  });
});
