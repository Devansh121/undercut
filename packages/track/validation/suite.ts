/**
 * The checks every committed circuit passes, against published facts and the format's own
 * invariants (docs/track-data.md sections 4 and 5). Each circuit's test file passes its facts in
 * a `CircuitFacts` and adds its own checks. Nothing here assumes a direction of travel: `d` is
 * positive to the left whichever way the lap turns.
 */
import { createRng } from '@undercut/core';
import { SurfaceKind, createSurfaceHint, createSurfaceSample } from '@undercut/sim';
import { describe, expect, it } from 'vitest';
import { CORNER_RULE, detectCorners, type CornerRule } from '../src/corners';
import { validateTrackData, type TrackData } from '../src/data';
import { createPathPoint, createVec3 } from '../src/path';
import { TrackSurface } from '../src/surface';
import { LEFT, RIGHT, Track, VERGE_FALL, createGround } from '../src/track';
import { steepestKerbSlope } from '../test/fixtures';

export interface CircuitFacts {
  name: string;
  raw: unknown;
  officialLength: number;
  direction: 'clockwise' | 'anticlockwise';
  /** Heading of travel at the start line, degrees from north (clockwise), as [min, max]. */
  startHeading: readonly [number, number];
  /** Official corner directions in order ('L' or 'R') and names by place. */
  directions: string;
  names: readonly string[];
  /** Overrides of the default corner rule this circuit's numbering needs. */
  cornerRule: Partial<CornerRule>;
  /** Largest |curvature| (1/m) and largest change between samples. */
  maxCurvature: number;
  maxCurvatureJump: number;
  /** Published elevation range and its tolerance, and the steepest grade allowed. */
  elevationRange: readonly [number, number];
  maxGrade: number;
  /** Total width bounds (m) and the largest bank angle (degrees). */
  width: readonly [number, number];
  maxBankDeg: number;
  /** Expected positions (s) of the sector lines and the speed trap, from the data's corners. */
  sectors: (c: Corners) => readonly number[];
  speedTrap: (c: Corners) => number;
  /** Expected DRS detection and activation points. */
  drs: (c: Corners) => readonly (readonly [number, number])[];
  timingLine: { s: number; uncertainty: number };
  /** Published distance from pole to the turn 1 braking point (physics-validation 4.7). */
  poleToBraking: number;
  pit: { side: 'left' | 'right'; osmLength: number };
  /** Lap stretches [from, to] where other parts of the lap run close by: sampled densely. */
  closeRuns: readonly (readonly [number, number])[];
}

export interface Corners {
  apex(k: number): number;
  start(k: number): number;
  end(k: number): number;
}

export function corners(data: TrackData): Corners {
  return {
    apex: (k) => data.corners[k - 1]!.s,
    start: (k) => data.corners[k - 1]!.start,
    end: (k) => data.corners[k - 1]!.end,
  };
}

export function describeCircuit(f: CircuitFacts): { data: TrackData; track: Track } {
  const data = validateTrackData(f.raw);
  const track = new Track(data);
  const lap = track.lap;
  const L = track.length;
  const n = lap.count;
  const scale = data.source.scale;
  const c = corners(data);
  const near = (a: number, b: number): number => Math.abs(track.lapDelta(a, b));

  describe(`${f.name}: centreline`, () => {
    it('is a closed loop sampled evenly, so s increases monotonically', () => {
      const chord = Array.from(lap.chord);
      const mean = chord.reduce((a, b) => a + b, 0) / chord.length;
      expect(Math.abs(chord[n - 1]! - mean)).toBeLessThan(0.01);
      // Evenly spaced in arc length; chords fall short of the arc in the tightest corners.
      expect(Math.max(...chord) / Math.min(...chord)).toBeLessThan(1.005);
      expect(L / n).toBeCloseTo(2, 1);
    });

    it('is within 1 % of the official length and equal to the scaled measured length', () => {
      const geometric = lap.chord.reduce((a, b) => a + b, 0);
      expect(L).toBe(f.officialLength);
      expect(Math.abs(geometric * scale - L)).toBeLessThan(1);
      expect(Math.abs(scale - 1)).toBeLessThan(0.01);
      expect(Math.abs((data.source.osmLength as number) / f.officialLength - 1)).toBeLessThan(0.01);
    });

    it(`runs ${f.direction} and leaves the start line on the published heading`, () => {
      let area = 0;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        area += lap.x[i]! * lap.z[j]! - lap.x[j]! * lap.z[i]!;
      }
      // Shoelace in (x, z) with z south: positive is clockwise seen from above.
      expect(area > 0).toBe(f.direction === 'clockwise');
      expect(data.direction).toBe(f.direction);
      const heading = ((Math.atan2(lap.tx[0]!, -lap.tz[0]!) * 180) / Math.PI + 360) % 360;
      expect(heading).toBeGreaterThan(f.startHeading[0]);
      expect(heading).toBeLessThan(f.startHeading[1]);
      // The left normal points out of the loop on an anticlockwise lap and into it on a
      // clockwise one: total turning has the sign of the direction.
      let turn = 0;
      for (let i = 0; i < n; i++) turn += lap.curvature[i]! * lap.chord[i]!;
      expect(Math.abs(Math.abs(turn) - 2 * Math.PI)).toBeLessThan(0.05);
      expect(turn > 0).toBe(f.direction === 'anticlockwise');
    });

    it('has bounded, continuous curvature', () => {
      let max = 0;
      let jump = 0;
      for (let i = 0; i < n; i++) {
        max = Math.max(max, Math.abs(lap.curvature[i]!));
        jump = Math.max(jump, Math.abs(lap.curvature[i]! - lap.curvature[(i + n - 1) % n]!));
      }
      expect(max).toBeLessThan(f.maxCurvature);
      expect(jump).toBeLessThan(f.maxCurvatureJump);
    });

    it('has the official corners, in order, at the curvature peaks', () => {
      const rule = { ...CORNER_RULE, ...f.cornerRule };
      expect(data.source.cornerRule).toEqual(rule);
      const found = detectCorners(lap.curvature, L / n / scale, rule);
      expect(found.map((k) => (k.sign > 0 ? 'L' : 'R')).join('')).toBe(f.directions);
      expect(data.corners).toHaveLength(f.directions.length);
      found.forEach((k, i) => {
        const meta = data.corners[i]!;
        expect(meta.number).toBe(i + 1);
        expect(meta.direction).toBe(f.directions[i] === 'L' ? 'left' : 'right');
        expect(near(k.apex * (L / n), meta.s)).toBeLessThan(10);
      });
      expect(data.corners.map((k) => k.name)).toEqual(f.names);
    });

    it('matches the published elevation range with plausible grades', () => {
      const y = Array.from(lap.y);
      const range = Math.max(...y) - Math.min(...y);
      expect(Math.abs(range - f.elevationRange[0])).toBeLessThan(f.elevationRange[1]);
      expect(Math.max(...Array.from(lap.grade, Math.abs))).toBeLessThan(f.maxGrade);
    });

    it('has sane widths and banking', () => {
      for (let i = 0; i < n; i++) {
        const w = track.halfWidth[LEFT][i]! + track.halfWidth[RIGHT][i]!;
        expect(w).toBeGreaterThanOrEqual(f.width[0]);
        expect(w).toBeLessThanOrEqual(f.width[1]);
        expect(Math.abs(track.bank[i]!)).toBeLessThan((f.maxBankDeg * Math.PI) / 180);
      }
    });
  });

  describe(`${f.name}: timing and rules metadata`, () => {
    it('puts every metadata point inside the lap', () => {
      const env = data.environment!;
      const points = [
        ...data.timing.sectors,
        data.timing.speedTrap,
        data.timingLine.s,
        ...data.timing.drs.flatMap((z) => [z.detection, z.activation, z.end]),
        ...data.corners.flatMap((k) => [k.s, k.start, k.end]),
        ...data.grid.map((g) => g.s),
        ...(env.floodlights?.masts ?? []).map((m) => m.s),
        data.pit.entryS,
        data.pit.exitS,
      ];
      for (const s of points) {
        expect(s).toBeGreaterThanOrEqual(0);
        expect(s).toBeLessThan(L);
      }
    });

    it('carries the timing line, measured on the circuit map, before the start line', () => {
      expect(data.timingLine.s).toBeCloseTo(f.timingLine.s, 6);
      expect(data.timingLine.uncertainty).toBe(f.timingLine.uncertainty);
      expect(data.timingLine.source).toMatch(/circuit map/);
      expect(track.timingLine).toBe(data.timingLine.s);
      // The grid lies between the timing line and the start line on these straights.
      expect(track.lapDelta(0, data.timingLine.s)).toBeLessThan(0);
      expect(track.lapDelta(0, data.timingLine.s)).toBeGreaterThan(-400);
    });

    it('carries the environment the renderer and the air density need', () => {
      const env = data.environment!;
      expect(env).not.toBeNull();
      expect(env.latitude).toBe(data.origin.lat);
      expect(env.longitude).toBe(data.origin.lon);
      expect(env.northYaw).toBeCloseTo(Math.PI / 2, 6);
      const ys = Array.from(lap.y);
      const mean = ys.reduce((a, b) => a + b, 0) / ys.length + data.origin.datum;
      expect(Math.abs(env.altitude - mean)).toBeLessThan(0.01);
      // ISA pressure at that altitude, as packages/sim's airDensity computes it.
      expect(env.airPressure).toBeCloseTo(101325 * (1 - 2.25577e-5 * env.altitude) ** 5.25588, -1);
    });

    it('places sectors and the speed trap at the published offsets, in order', () => {
      const want = f.sectors(c);
      expect(data.timing.sectors[0]).toBe(0);
      expect(data.timing.sectors).toHaveLength(want.length + 1);
      want.forEach((s, k) => {
        expect(near(data.timing.sectors[k + 1]!, s)).toBeLessThan(0.01);
        if (k > 0) expect(data.timing.sectors[k + 1]!).toBeGreaterThan(data.timing.sectors[k]!);
      });
      expect(near(data.timing.speedTrap, f.speedTrap(c))).toBeLessThan(0.01);
    });

    it('has ordered DRS zones at the published points, each ending at a braking zone', () => {
      const want = f.drs(c);
      expect(data.timing.drs).toHaveLength(want.length);
      data.timing.drs.forEach((z, k) => {
        expect(near(z.detection, want[k]![0])).toBeLessThan(0.01);
        expect(near(z.activation, want[k]![1])).toBeLessThan(0.01);
        expect(track.forwardDistance(z.detection, z.activation)).toBeLessThan(1000);
        expect(track.forwardDistance(z.activation, z.end)).toBeGreaterThan(200);
        expect(track.forwardDistance(z.activation, z.end)).toBeLessThan(1200);
        // The zone ends where a corner starts.
        expect(data.corners.some((k2) => near(k2.start, z.end) < 0.01)).toBe(true);
        // In the zone, and not just before it.
        const mid = z.activation + track.forwardDistance(z.activation, z.end) / 2;
        expect(track.drsZoneAt(mid)).toBe(k);
        expect(track.drsZoneAt(z.activation - 5)).not.toBe(k);
      });
      // Activation points come in lap order.
      const acts = data.timing.drs.map((z) => z.activation);
      const firstAfterLine = acts.indexOf(Math.min(...acts));
      for (let k = 1; k < acts.length; k++) {
        const a = acts[(firstAfterLine + k - 1) % acts.length]!;
        const b = acts[(firstAfterLine + k) % acts.length]!;
        expect(b).toBeGreaterThan(a);
      }
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
      const poleToApex = track.forwardDistance(track.gridSlots[0]!.s, c.apex(1));
      expect(poleToApex).toBeGreaterThan(f.poleToBraking);
      expect(poleToApex).toBeLessThan(f.poleToBraking + 200);
    });

    it('joins the pit lane to the track at both ends, on the mapped side', () => {
      const pit = track.pit;
      const q = createPathPoint();
      const pp = pit.path;
      const sideIdx = f.pit.side === 'left' ? LEFT : RIGHT;
      expect(pit.side).toBe(f.pit.side);
      lap.project(pp.x[0]!, pp.z[0]!, { index: -1 }, q);
      expect(near(q.s, pit.entryS)).toBeLessThan(3);
      expect(Math.abs(q.d)).toBeLessThan(track.halfWidthAt(q.s, sideIdx));
      lap.project(pp.x[pp.count - 1]!, pp.z[pp.count - 1]!, { index: -1 }, q);
      expect(near(q.s, pit.exitS)).toBeLessThan(3);
      expect(Math.abs(q.d)).toBeLessThan(track.halfWidthAt(q.s, sideIdx));
      expect(Math.abs(pit.length / f.pit.osmLength - 1)).toBeLessThan(0.01);
      expect(pit.speedLimit).toBeCloseTo(80 / 3.6, 3);
      expect(pit.limitStart).toBeLessThan(pit.limitEnd);
      for (const b of pit.boxes) expect(pit.inSpeedLimit(b.s)).toBe(true);
      // The pit lane runs beside the track on the mapped side.
      let onSide = 0;
      let all = 0;
      for (let j = 0; j < pp.count; j += 10) {
        lap.project(pp.x[j]!, pp.z[j]!, { index: -1 }, q);
        if (q.d >= 0 === (f.pit.side === 'left')) onSide++;
        all++;
      }
      expect(onSide).toBeGreaterThan(all - 2);
    });
  });

  describe(`${f.name}: barriers and surfaces`, () => {
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
      expect(poses).toHaveLength(20 + track.pit.boxes.length + 3);
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
          for (const t of k + 1 < m ? [0, 0.5] : [0]) {
            const x = b.points[3 * k]! + t * ((b.points[3 * k + 3] ?? 0) - b.points[3 * k]!);
            const z =
              b.points[3 * k + 2]! + t * ((b.points[3 * k + 5] ?? 0) - b.points[3 * k + 2]!);
            lap.project(x, z, hint, q);
            const side = q.d >= 0 ? LEFT : RIGHT;
            const i = lap.sampleIndex(q.s);
            const kp = track.kerb[side][i]!;
            const edge =
              track.halfWidthAt(q.s, side) + (kp >= 0 ? track.kerbProfiles[kp]!.width : 0);
            expect(Math.abs(q.d)).toBeGreaterThan(edge);
            checked++;
          }
        }
      }
      expect(checked).toBeGreaterThan(5000);
    });

    it('has kerbs at every corner', () => {
      const kerbs = new Set<number>();
      for (const k of data.corners) {
        for (let s = k.s - 30; s <= k.s + 30; s += 2) {
          const i = lap.sampleIndex(s);
          if (track.kerb[LEFT][i]! >= 0 || track.kerb[RIGHT][i]! >= 0) kerbs.add(k.number);
        }
      }
      expect(kerbs.size).toBe(data.corners.length);
    });

    it('samples a ground that is continuous in height across zone boundaries', () => {
      const surface = new TrackSurface(track);
      const out = createSurfaceSample();
      const p = createVec3();
      const step = 0.002;
      const bound = (steepestKerbSlope(track) + VERGE_FALL + 0.05) * step + 1e-4;
      let worst = 0;
      let where = '';
      for (let i = 0; i < n; i += 40) {
        const s = i * (L / n);
        const hint = createSurfaceHint();
        // Out past the barrier, but not past where the (s, d) frame folds (the next test keeps
        // the barrier inside the frame).
        const left = Math.min(track.barrier[LEFT][i]! + 5, track.frameLimit[LEFT][i]!);
        const right = Math.min(track.barrier[RIGHT][i]! + 5, track.frameLimit[RIGHT][i]!);
        let last = Number.NaN;
        for (let d = -right; d <= left; d += step) {
          lap.pointAt(s, d, p);
          surface.sample(p.x, p.z, hint, out);
          const jump = Math.abs(out.height - last);
          if (jump > worst) {
            worst = jump;
            where = `s ${s.toFixed(1)} d ${d.toFixed(3)}`;
          }
          last = out.height;
        }
      }
      expect(worst, where).toBeLessThan(bound);
    });

    it('keeps every barrier inside the one-to-one (s, d) frame', () => {
      for (const k of [LEFT, RIGHT] as const) {
        let worst = Infinity;
        let where = 0;
        for (let i = 0; i < n; i++) {
          const margin = track.frameLimit[k][i]! - track.barrier[k][i]!;
          if (margin < worst) {
            worst = margin;
            where = i * (L / n);
          }
        }
        // Stored offsets are rounded to the centimetre; capped barriers sit on the limit.
        expect(worst, `${k === LEFT ? 'left' : 'right'} at s ${where.toFixed(0)}`).toBeGreaterThan(
          -0.01,
        );
      }
    });

    it('is continuous along s across every kerb start and end and every run-off kind change', () => {
      const g = createGround();
      const heightAt = (s: number, d: number): number => track.ground(s, d, g).height;
      let tallest = 0;
      let shortest = Infinity;
      for (const kp of track.kerbProfiles) {
        tallest = Math.max(tallest, ...kp.h);
        shortest = Math.min(shortest, kp.taper);
      }
      // Steepest legitimate slope along s: grade and banking plus a kerb taper.
      const bound = (f.maxGrade + 0.05 + tallest / shortest) * 0.001 + 1e-6;
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
            sweeps.push({ s, d: [sign * (hw + 1)], what: 'inner kind' });
          if (track.outer[k][i] !== track.outer[k][h]) {
            sweeps.push({
              s,
              d: [(sign * (track.split[k][i]! + track.barrier[k][i]!)) / 2],
              what: 'outer kind',
            });
          }
        }
      }
      expect(sweeps.filter((w) => w.what === 'kerb').length).toBeGreaterThan(30);
      let worst = 0;
      let where = '';
      for (const w of sweeps) {
        for (const d of w.d) {
          let last = heightAt(w.s - 5, d);
          for (let s = w.s - 5 + 0.002; s <= w.s + 5; s += 0.002) {
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
      expect(worst, where).toBeLessThan(2 * bound);
    });

    it('uses every surface kind the sampler knows', () => {
      const kinds = new Set<number>();
      for (const k of [LEFT, RIGHT] as const)
        for (let i = 0; i < n; i++) {
          kinds.add(track.inner[k][i]!);
          kinds.add(track.outer[k][i]!);
        }
      expect(kinds.has(SurfaceKind.RunoffAsphalt)).toBe(true);
    });
  });

  describe(`${f.name}: (s, d) round trips`, () => {
    it('pointAt then project returns the same (s, d), with and without a hint', () => {
      const rng = createRng(2026);
      const p = createVec3();
      const q = createPathPoint();
      const hint = { index: -1 };
      for (let k = 0; k < 15000; k++) {
        const s = rng.next() * L;
        const side = rng.next() < 0.5 ? LEFT : RIGHT;
        const i = lap.sampleIndex(s);
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

    it('returns the true (s, d) for any hint within 150 m, densely where the lap runs close to itself', () => {
      const rng = createRng(5);
      const p = createVec3();
      const q = createPathPoint();
      const hint = { index: -1 };
      const ss: number[] = [];
      for (let s = 0; s < L; s += 10) ss.push(s);
      for (const [a, b] of f.closeRuns) for (let s = a; s <= b; s += 1) ss.push(track.wrap(s));
      let worst = 0;
      let where = '';
      let cases = 0;
      for (const s of ss) {
        const side = rng.next() < 0.5 ? LEFT : RIGHT;
        // Anywhere out to the barrier, where the close stretches come nearest each other.
        const i = lap.sampleIndex(s);
        const d = (side === LEFT ? 1 : -1) * rng.next() * track.barrier[side][i]! * 0.98;
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

    it('project then pointAt returns the same world point near the track', () => {
      const rng = createRng(11);
      const p = createVec3();
      const q = createPathPoint();
      let minX = Infinity;
      let maxX = -Infinity;
      let minZ = Infinity;
      let maxZ = -Infinity;
      for (let i = 0; i < n; i++) {
        minX = Math.min(minX, lap.x[i]!);
        maxX = Math.max(maxX, lap.x[i]!);
        minZ = Math.min(minZ, lap.z[i]!);
        maxZ = Math.max(maxZ, lap.z[i]!);
      }
      let tested = 0;
      for (let k = 0; k < 20000; k++) {
        const x = minX - 50 + rng.next() * (maxX - minX + 100);
        const z = minZ - 50 + rng.next() * (maxZ - minZ + 100);
        lap.project(x, z, { index: -1 }, q);
        const side = q.d >= 0 ? LEFT : RIGHT;
        if (Math.abs(q.d) > track.barrier[side][lap.sampleIndex(q.s)]!) continue;
        lap.pointAt(q.s, q.d, p);
        expect(Math.hypot(p.x - x, p.z - z)).toBeLessThan(1e-6);
        tested++;
      }
      expect(tested).toBeGreaterThan(300);
    });
  });

  return { data, track };
}
