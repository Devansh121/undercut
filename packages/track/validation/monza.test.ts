/**
 * Validation of the committed Monza track file against published facts and the format's own
 * invariants. Reference values: docs/track-data.md section 4 (official length 5.793 km,
 * 11 corners, clockwise, FIA reference width 10 m, elevation range 12.8 m +/- 2 m, timing
 * offsets) and docs/physics-validation.md section 4.6.
 */
import { createRng } from '@undercut/core';
import { SurfaceKind, createSurfaceHint, createSurfaceSample } from '@undercut/sim';
import { describe, expect, it } from 'vitest';
import raw from '../data/monza.json';
import { detectCorners } from '../src/corners';
import { validateTrackData } from '../src/data';
import { createPathPoint, createVec3 } from '../src/path';
import { TrackSurface } from '../src/surface';
import { LEFT, RIGHT, Track, VERGE_FALL, createGround } from '../src/track';
import { steepestKerbSlope } from '../test/fixtures';

const data = validateTrackData(raw);
const track = new Track(data);
const lap = track.lap;
const L = track.length;
const n = lap.count;
const scale = data.source.scale;
const OFFICIAL_LENGTH = 5793;
const corner = (k: number): number => data.corners[k - 1]!.s;
const near = (a: number, b: number): number => Math.abs(track.lapDelta(a, b));

describe('Monza: centreline', () => {
  it('is a closed loop sampled evenly, so s increases monotonically', () => {
    const chord = Array.from(lap.chord);
    const mean = chord.reduce((a, b) => a + b, 0) / chord.length;
    // The closing segment (last sample back to the first) is as long as the others.
    expect(Math.abs(chord[n - 1]! - mean)).toBeLessThan(0.01);
    // Samples are evenly spaced in arc length; chords are shorter than the arc by up to 0.1 %
    // in the 13 m turn 1, and coordinates are rounded to the millimetre.
    expect(Math.max(...chord) / Math.min(...chord)).toBeLessThan(1.003);
    expect(L / n).toBeCloseTo(2, 2);
  });

  it('is within 1 % of the official length and equal to the scaled measured length', () => {
    const geometric = lap.chord.reduce((a, b) => a + b, 0);
    expect(L).toBe(OFFICIAL_LENGTH);
    expect(Math.abs(geometric * scale - L)).toBeLessThan(0.5);
    expect(Math.abs(scale - 1)).toBeLessThan(0.01);
    expect(Math.abs((data.source.osmLength as number) / OFFICIAL_LENGTH - 1)).toBeLessThan(0.01);
  });

  it('runs clockwise and leaves the line heading north toward turn 1', () => {
    let area = 0;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      area += lap.x[i]! * lap.z[j]! - lap.x[j]! * lap.z[i]!;
    }
    // Shoelace in (x, z) with z south: positive is clockwise seen from above.
    expect(area).toBeGreaterThan(0);
    expect(data.direction).toBe('clockwise');
    const heading = (Math.atan2(lap.tx[0]!, -lap.tz[0]!) * 180) / Math.PI;
    expect(heading).toBeGreaterThan(0);
    expect(heading).toBeLessThan(15);
  });

  it('has bounded, continuous curvature', () => {
    let max = 0;
    let jump = 0;
    for (let i = 0; i < n; i++) {
      max = Math.max(max, Math.abs(lap.curvature[i]!));
      jump = Math.max(jump, Math.abs(lap.curvature[i]! - lap.curvature[(i + n - 1) % n]!));
    }
    // Tightest corner (turn 1) is about 13 m radius on the centreline.
    expect(max).toBeLessThan(1 / 8);
    expect(jump).toBeLessThan(0.03);
  });

  it('has the official corners, in order, at the curvature peaks', () => {
    const found = detectCorners(lap.curvature, L / n / scale);
    expect(found).toHaveLength(11);
    expect(data.corners).toHaveLength(11);
    const directions = [
      'right',
      'left',
      'right',
      'left',
      'right',
      'right',
      'right',
      'left',
      'right',
      'left',
      'right',
    ];
    found.forEach((c, k) => {
      const meta = data.corners[k]!;
      expect(meta.number).toBe(k + 1);
      expect(meta.direction).toBe(directions[k]);
      expect(c.sign).toBe(meta.direction === 'left' ? 1 : -1);
      expect(near(c.apex * (L / n), meta.s)).toBeLessThan(10);
    });
    // Named by place: both chicanes, the Lesmo pair, the Vialone sequence, the Parabolica.
    expect(data.corners.map((c) => c.name)).toEqual([
      'Variante del Rettifilo',
      'Variante del Rettifilo',
      'Curva Biassono',
      'Variante della Roggia',
      'Variante della Roggia',
      'Lesmo 1',
      'Lesmo 2',
      'Vialone',
      'Vialone',
      'Vialone',
      'Parabolica',
    ]);
    // The Parabolica turns through most of a half circle.
    expect(found[10]!.turnDeg).toBeGreaterThan(150);
  });

  it('matches the published elevation range', () => {
    const y = Array.from(lap.y);
    const range = Math.max(...y) - Math.min(...y);
    expect(Math.abs(range - 12.8)).toBeLessThan(2);
    // Steepest gradient on a flat parkland circuit stays small.
    expect(Math.max(...Array.from(lap.grade, Math.abs))).toBeLessThan(0.04);
  });

  it('has sane widths and banking', () => {
    for (let i = 0; i < n; i++) {
      const l = track.halfWidth[LEFT][i]!;
      const r = track.halfWidth[RIGHT][i]!;
      expect(l + r).toBeGreaterThanOrEqual(10);
      expect(l + r).toBeLessThanOrEqual(15);
      expect(Math.abs(track.bank[i]!)).toBeLessThan((3 * Math.PI) / 180);
    }
  });
});

describe('Monza: timing and rules metadata', () => {
  it('carries the timing line measured on the circuit map, 320.5 m before the start line', () => {
    expect(data.timingLine.s).toBe(5472.5);
    expect(data.timingLine.uncertainty).toBe(13);
    expect(track.timingLine).toBe(5472.5);
    expect(track.lapDelta(0, data.timingLine.s)).toBeCloseTo(-320.5, 6);
    expect(data.environment!.lighting).toBe('daylight');
  });

  it('puts every metadata point inside the lap', () => {
    const points = [
      ...data.timing.sectors,
      data.timing.speedTrap,
      ...data.timing.drs.flatMap((z) => [z.detection, z.activation, z.end]),
      ...data.corners.flatMap((c) => [c.s, c.start, c.end]),
      ...data.grid.map((g) => g.s),
      data.pit.entryS,
      data.pit.exitS,
    ];
    for (const s of points) {
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThan(L);
    }
  });

  it('places sectors and the speed trap at the published offsets, in order', () => {
    const [s0, s1, s2] = data.timing.sectors;
    expect(s0).toBe(0);
    expect(s1!).toBeLessThan(s2!);
    expect(near(s1!, corner(4) - 233)).toBeLessThan(0.01);
    expect(near(s2!, corner(8) - 215)).toBeLessThan(0.01);
    expect(near(data.timing.speedTrap, corner(1) - 212)).toBeLessThan(0.01);
    expect(track.sectorAt(corner(3))).toBe(0);
    expect(track.sectorAt(corner(6))).toBe(1);
    expect(track.sectorAt(corner(11))).toBe(2);
  });

  it('has two ordered, non-overlapping DRS zones at the published points', () => {
    const [z1, z2] = data.timing.drs;
    expect(data.timing.drs).toHaveLength(2);
    expect(near(z1!.detection, corner(7) - 95)).toBeLessThan(0.01);
    expect(near(z1!.activation, corner(7) + 170)).toBeLessThan(0.01);
    expect(near(z2!.detection, corner(11) + 20)).toBeLessThan(0.01);
    // "12 m after the finish line": the map's finish line is the timing (control) line, 320.5 m
    // before the start line at s = 0, so the zone opens before s = 0 and runs through it.
    expect(near(z2!.activation, data.timingLine.s + 12)).toBeLessThan(0.01);
    expect(near(z2!.activation, 5484.5)).toBeLessThan(0.01);
    for (const z of data.timing.drs) {
      // Detection comes before activation (zone 2: in the Parabolica, then past the line),
      // activation before the end of the zone.
      expect(track.forwardDistance(z.detection, z.activation)).toBeLessThan(1000);
      expect(track.forwardDistance(z.activation, z.end)).toBeGreaterThan(300);
      expect(track.forwardDistance(z.activation, z.end)).toBeLessThan(1200);
    }
    // Zone 1 is the run from Lesmo 2 to the Vialone, zone 2 the main straight, wrapping through
    // the start line: activation before s = 0, end after it.
    expect(track.drsZoneAt((corner(7) + corner(8)) / 2)).toBe(0);
    expect(z2!.activation).toBeGreaterThan(L - 400);
    expect(z2!.end).toBeLessThan(corner(1));
    for (const s of [z2!.activation + 1, L - 1, 0, 1, 300, z2!.end - 1])
      expect(track.drsZoneAt(s)).toBe(1);
    expect(track.drsZoneAt(z2!.activation - 1)).toBe(-1);
    expect(track.drsZoneAt(z2!.end + 1)).toBe(-1);
    expect(track.drsZoneAt(corner(3))).toBe(-1);
  });

  it('has twenty grid slots on the track, behind the line, not overlapping', () => {
    expect(track.gridSlots).toHaveLength(20);
    const carHalfWidth = 1.0;
    track.gridSlots.forEach((g, k) => {
      const side = g.d >= 0 ? LEFT : RIGHT;
      expect(Math.abs(g.d) + carHalfWidth).toBeLessThan(track.halfWidthAt(g.s, side));
      expect(track.lapDelta(0, g.s)).toBeLessThan(0);
      for (let m = 0; m < k; m++) {
        const o = track.gridSlots[m]!;
        expect(Math.hypot(g.x - o.x, g.z - o.z)).toBeGreaterThan(6);
      }
    });
    // Pole to the turn 1 braking zone: published as 472 m (physics-validation 4.7).
    const poleToApex = track.forwardDistance(track.gridSlots[0]!.s, corner(1));
    expect(poleToApex).toBeGreaterThan(472);
    expect(poleToApex).toBeLessThan(472 + 200);
  });

  it('joins the pit lane to the track at both ends', () => {
    const pit = track.pit;
    const q = createPathPoint();
    const pp = pit.path;
    lap.project(pp.x[0]!, pp.z[0]!, { index: -1 }, q);
    expect(near(q.s, pit.entryS)).toBeLessThan(3);
    expect(Math.abs(q.d)).toBeLessThan(track.halfWidthAt(q.s, RIGHT));
    lap.project(pp.x[pp.count - 1]!, pp.z[pp.count - 1]!, { index: -1 }, q);
    expect(near(q.s, pit.exitS)).toBeLessThan(3);
    expect(Math.abs(q.d)).toBeLessThan(track.halfWidthAt(q.s, RIGHT));
    // It leaves at the Parabolica exit and rejoins after the line, on the right.
    expect(pit.entryS).toBeGreaterThan(corner(11));
    expect(pit.exitS).toBeLessThan(corner(1));
    expect(Math.abs(pit.length - 742)).toBeLessThan(5);
    expect(pit.speedLimit).toBeCloseTo(80 / 3.6, 3);
    expect(pit.limitStart).toBeLessThan(pit.limitEnd);
    // Boxes sit inside the speed-limited stretch.
    for (const b of pit.boxes) expect(pit.inSpeedLimit(b.s)).toBe(true);
    let right = 0;
    for (let j = 0; j < pp.count; j += 10) {
      lap.project(pp.x[j]!, pp.z[j]!, { index: -1 }, q);
      if (q.d < 0) right++;
    }
    expect(right).toBeGreaterThan(Math.floor(pp.count / 10) - 2);
  });
});

describe('Monza: barriers and surfaces', () => {
  it('puts every pose on the sampled ground: grid, pit boxes, pit entry and exit, start line', () => {
    const surface = new TrackSurface(track);
    const out = createSurfaceSample();
    const poses = [
      ...track.gridSlots.map((p, k) => ['grid ' + (k + 1), p] as const),
      ...track.pit.boxes.map((p, k) => ['box ' + (k + 1), p] as const),
      ['pit entry', track.pit.entryPose] as const,
      ['pit exit', track.pit.exitPose] as const,
      ['start line', track.startPose] as const,
    ];
    let worst = 0;
    let where = '';
    for (const [name, p] of poses) {
      surface.sample(p.x, p.z, createSurfaceHint(), out);
      const gap = Math.abs(p.y - out.height);
      if (gap > worst) {
        worst = gap;
        where = `${name}: pose y ${p.y.toFixed(6)}, ground ${out.height.toFixed(6)}`;
      }
    }
    expect(poses).toHaveLength(20 + 10 + 3);
    expect(worst, where).toBeLessThan(0.001);
    expect(track.startPose.s).toBe(0);
  });

  it('never lets a barrier cross the track or its kerbs', () => {
    const q = createPathPoint();
    const hint = { index: -1 };
    let checked = 0;
    for (const b of track.barriers) {
      const m = b.points.length / 3;
      for (let k = 0; k < m; k++) {
        for (const f of k + 1 < m ? [0, 0.5] : [0]) {
          const x = b.points[3 * k]! + f * ((b.points[3 * k + 3] ?? 0) - b.points[3 * k]!);
          const z = b.points[3 * k + 2]! + f * ((b.points[3 * k + 5] ?? 0) - b.points[3 * k + 2]!);
          lap.project(x, z, hint, q);
          const side = q.d >= 0 ? LEFT : RIGHT;
          const i = lap.sampleIndex(q.s);
          const kp = track.kerb[side][i]!;
          const edge = track.halfWidthAt(q.s, side) + (kp >= 0 ? track.kerbProfiles[kp]!.width : 0);
          expect(Math.abs(q.d)).toBeGreaterThan(edge);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(10000);
    const types = new Set(track.barriers.map((b) => b.type));
    expect([...types].sort()).toEqual(['armco', 'concrete', 'fence', 'tyres']);
  });

  it('has kerbs at every corner and gravel where it is mapped', () => {
    const kerbs = new Set<number>();
    for (const c of data.corners) {
      for (let s = c.s - 30; s <= c.s + 30; s += 2) {
        const i = lap.sampleIndex(s);
        if (track.kerb[LEFT][i]! >= 0 || track.kerb[RIGHT][i]! >= 0) kerbs.add(c.number);
      }
    }
    expect(kerbs.size).toBe(11);
    let gravel = 0;
    for (let i = 0; i < n; i++)
      for (const k of [LEFT, RIGHT] as const)
        if (track.outer[k][i] === SurfaceKind.Gravel) gravel++;
    expect(gravel * (L / n)).toBeGreaterThan(1500);
  });

  it('samples a ground that is continuous in height across zone boundaries', () => {
    const surface = new TrackSurface(track);
    const out = createSurfaceSample();
    const p = createVec3();
    const kinds = new Set<number>();
    // The steepest legitimate ground is a kerb profile edge plus the verge fall; any step
    // between zones would be centimetres. Allow that slope over one probe step, plus 0.1 mm.
    const step = 0.002;
    const bound = (steepestKerbSlope(track) + VERGE_FALL + 0.05) * step + 1e-4;
    let worst = 0;
    let where = '';
    for (let i = 0; i < n; i += 32) {
      const s = i * (L / n);
      const hint = createSurfaceHint();
      const left = track.barrier[LEFT][i]! + 5;
      const right = track.barrier[RIGHT][i]! + 5;
      let last = Number.NaN;
      for (let d = -right; d <= left; d += step) {
        lap.pointAt(s, d, p);
        surface.sample(p.x, p.z, hint, out);
        kinds.add(out.kind);
        const jump = Math.abs(out.height - last);
        if (jump > worst) {
          worst = jump;
          where = `s ${s.toFixed(1)} d ${d.toFixed(3)}`;
        }
        last = out.height;
      }
    }
    expect(worst, where).toBeLessThan(bound);
    for (const k of Object.values(SurfaceKind)) expect(kinds.has(k)).toBe(true);
  });
});

describe('Monza: ground continuity along the lap', () => {
  const g = createGround();
  const heightAt = (s: number, d: number): number => track.ground(s, d, g).height;

  it('has no step where the Vialone kerbs meet', () => {
    // Regression: two probes 2 micrometres apart differed by 4.27 cm.
    const s = 3805.656941;
    expect(Math.abs(heightAt(s + 1e-6, -5.75) - heightAt(s - 1e-6, -5.75))).toBeLessThan(1e-6);
  });

  it('is continuous along s across every kerb start and end and every run-off kind change', () => {
    // Steepest legitimate slope along s: grade and banking (under 0.05) plus a kerb taper
    // (tallest kerb over the shortest taper). Allow that over one 1 mm probe step.
    let tallest = 0;
    let shortest = Infinity;
    for (const kp of track.kerbProfiles) {
      tallest = Math.max(tallest, ...kp.h);
      shortest = Math.min(shortest, kp.taper);
    }
    expect(shortest).toBeGreaterThan(1);
    const bound = (0.05 + tallest / shortest) * 0.001 + 1e-6;
    const step = L / n;
    const sweeps: { s: number; d: number[]; what: string }[] = [];
    for (const k of [LEFT, RIGHT] as const) {
      const sign = k === LEFT ? 1 : -1;
      for (let i = 0; i < n; i++) {
        const h = (i + n - 1) % n;
        const s = (i - 0.5) * step;
        const hw = track.halfWidth[k][i]!;
        const kerb = track.kerb[k][i]! >= 0 ? i : track.kerb[k][h]! >= 0 ? h : -1;
        if (track.kerb[k][i] !== track.kerb[k][h] && kerb >= 0) {
          const kp = track.kerbProfiles[track.kerb[k][kerb]!]!;
          sweeps.push({
            s,
            d: Array.from(kp.u, (u) => sign * (hw + Math.min(u + 0.01, kp.width - 0.01))),
            what: 'kerb',
          });
        }
        if (track.inner[k][i] !== track.inner[k][h])
          sweeps.push({ s, d: [sign * (hw + 3)], what: 'inner kind' });
        if (track.outer[k][i] !== track.outer[k][h]) {
          sweeps.push({
            s,
            d: [(sign * (track.split[k][i]! + track.barrier[k][i]!)) / 2],
            what: 'outer kind',
          });
        }
      }
    }
    expect(sweeps.filter((w) => w.what === 'kerb').length).toBeGreaterThan(40);
    let worst = 0;
    let where = '';
    for (const w of sweeps) {
      for (const d of w.d) {
        let last = heightAt(w.s - 6, d);
        for (let s = w.s - 6 + 0.001; s <= w.s + 6; s += 0.001) {
          const h = heightAt(s, d);
          const jump = Math.abs(h - last);
          if (jump > worst) {
            worst = jump;
            where = `${w.what} at s ${s.toFixed(3)} d ${d.toFixed(2)}`;
          }
          last = h;
        }
      }
    }
    expect(worst, where).toBeLessThan(bound);
  });
});

describe('Monza: (s, d) round trips', () => {
  it('does not snap to the other leg of the Roggia chicane with a nearby hint', () => {
    // Regression: a hint from s = 1893 used to return s = 1890.075, d = -23.945.
    const p = createVec3();
    const q = createPathPoint();
    lap.pointAt(1803, 0, p);
    lap.project(p.x, p.z, { index: lap.sampleIndex(1893) }, q);
    expect(q.s).toBeCloseTo(1803, 6);
    expect(Math.abs(q.d)).toBeLessThan(1e-6);
  });

  it('returns the true (s, d) on the track for any hint within 150 m, densely through the chicanes', () => {
    const rng = createRng(5);
    const p = createVec3();
    const q = createPathPoint();
    const hint = { index: -1 };
    const dense = [
      [corner(1) - 80, corner(2) + 80],
      [corner(4) - 80, corner(5) + 80],
      [corner(8) - 80, corner(10) + 80],
    ];
    const ss: number[] = [];
    for (let s = 0; s < L; s += 10) ss.push(s);
    for (const [a, b] of dense) for (let s = a!; s <= b!; s += 1) ss.push(s);
    let worst = 0;
    let where = '';
    let cases = 0;
    for (const s of ss) {
      const side = rng.next() < 0.5 ? LEFT : RIGHT;
      const d = (side === LEFT ? 1 : -1) * rng.next() * track.halfWidthAt(s, side);
      lap.pointAt(s, d, p);
      for (let off = -150; off <= 150; off += 10) {
        hint.index = lap.sampleIndex(s + off);
        lap.project(p.x, p.z, hint, q);
        const err = Math.max(near(q.s, s), Math.abs(q.d - d));
        cases++;
        if (err > worst) {
          worst = err;
          where = `s ${s.toFixed(1)} d ${d.toFixed(2)} hint ${off}: got s ${q.s.toFixed(3)} d ${q.d.toFixed(3)}`;
        }
      }
    }
    expect(cases).toBeGreaterThan(30000);
    expect(worst, where).toBeLessThan(1e-6);
  });

  it('pointAt then project returns the same (s, d), with and without a hint', () => {
    const rng = createRng(2026);
    const p = createVec3();
    const q = createPathPoint();
    const hint = { index: -1 };
    for (let k = 0; k < 20000; k++) {
      const s = rng.next() * L;
      const side = rng.next() < 0.5 ? LEFT : RIGHT;
      const i = lap.sampleIndex(s);
      // Stay inside the barriers, which the pipeline keeps short of the inside fold.
      const d = (side === LEFT ? 1 : -1) * rng.next() * track.barrier[side][i]! * 0.98;
      lap.pointAt(s, d, p);
      lap.project(p.x, p.z, { index: -1 }, q);
      expect(near(q.s, s)).toBeLessThan(1e-6);
      expect(Math.abs(q.d - d)).toBeLessThan(1e-6);
      hint.index = lap.sampleIndex(s + 4 * (rng.next() - 0.5));
      lap.project(p.x, p.z, hint, q);
      expect(near(q.s, s)).toBeLessThan(1e-6);
      expect(Math.abs(q.d - d)).toBeLessThan(1e-6);
    }
  });

  it('project then pointAt returns the same world point near the track', () => {
    const rng = createRng(11);
    const p = createVec3();
    const q = createPathPoint();
    let tested = 0;
    for (let k = 0; k < 20000; k++) {
      const x = -900 + rng.next() * 1800;
      const z = -1400 + rng.next() * 2800;
      lap.project(x, z, { index: -1 }, q);
      const side = q.d >= 0 ? LEFT : RIGHT;
      if (Math.abs(q.d) > track.barrier[side][lap.sampleIndex(q.s)]!) continue;
      lap.pointAt(q.s, q.d, p);
      expect(Math.hypot(p.x - x, p.z - z)).toBeLessThan(1e-6);
      tested++;
    }
    expect(tested).toBeGreaterThan(500);
  });
});
