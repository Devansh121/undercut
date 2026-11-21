/**
 * Projection and ground inside the barriers, densely, on Spa and Singapore.
 *
 * The lap projection can accept a non-solution: a point well inside the barriers maps to a
 * distant part of the lap, and the ground steps there (review of PR #18). The fix is in PR #19
 * (packages/track/src/path.ts). Until it is merged into this branch the failing checks are
 * declared with `it.fails`, named "FAILS UNTIL PR #19": vitest reports them as passing while
 * the defect is there and as FAILING as soon as the fix arrives, so the marker cannot outlive
 * the fix. When that happens, turn each `it.fails` back into `it`.
 */
import { createSurfaceHint, createSurfaceSample } from '@undercut/sim';
import { describe, expect, it } from 'vitest';
import singapore from '../data/singapore.json';
import spa from '../data/spa.json';
import { createPathPoint, createVec3 } from '../src/path';
import { TrackSurface } from '../src/surface';
import { LEFT, RIGHT, Track, VERGE_FALL } from '../src/track';
import { steepestKerbSlope } from '../test/fixtures';

const UNTIL_19 = 'FAILS UNTIL PR #19 (lap projection fix) is merged:';

/** World point at (s, d), its projection without a hint and with one 60 m ahead. */
function roundTrip(track: Track, s: number, d: number): { miss: number; err: number; got: string } {
  const lap = track.lap;
  const p = createVec3();
  const r = createVec3();
  const q = createPathPoint();
  lap.pointAt(s, d, p);
  let miss = 0;
  let err = 0;
  let got = '';
  for (const index of [-1, lap.sampleIndex(s + 60)]) {
    lap.project(p.x, p.z, { index }, q);
    lap.pointAt(q.s, q.d, r);
    const m = Math.hypot(r.x - p.x, r.z - p.z);
    const e = Math.max(Math.abs(track.lapDelta(q.s, s)), Math.abs(q.d - d));
    if (m > miss || e > err) got = `s ${q.s.toFixed(3)} d ${q.d.toFixed(3)}`;
    miss = Math.max(miss, m);
    err = Math.max(err, e);
  }
  return { miss, err, got };
}

/** Dense round trips: every sample, d every 0.5 m out to 0.999 of the barrier on both sides. */
function denseRoundTrips(track: Track): { worst: number; where: string; cases: number } {
  const n = track.lap.count;
  const step = track.length / n;
  let worst = 0;
  let where = '';
  let cases = 0;
  for (let i = 0; i < n; i++) {
    const s = (i + 0.5) * step;
    for (const k of [LEFT, RIGHT] as const) {
      const sign = k === LEFT ? 1 : -1;
      const b = 0.999 * Math.min(track.barrier[k][i]!, track.barrier[k][(i + 1) % n]!);
      for (let a = 0; a <= b; a += 0.5) {
        const r = roundTrip(track, s, sign * a);
        cases++;
        if (r.err > worst) {
          worst = r.err;
          where = `s ${s.toFixed(2)} d ${(sign * a).toFixed(2)}: got ${r.got}, miss ${r.miss.toFixed(2)} m`;
        }
      }
    }
  }
  return { worst, where, cases };
}

/**
 * Ground the sampler reports, probed every 10 cm across the track at every sample and every
 * half sample (barrier to barrier), each probe from a fresh hint as after a teleport or a
 * respawn, and along the lap (hint carried, as a moving wheel does) at half and 0.95 of the barrier offset on each side. Returns the
 * largest height change between neighbouring probes.
 */
function groundSteps(track: Track): { worst: number; where: string } {
  const surface = new TrackSurface(track);
  const out = createSurfaceSample();
  const lap = track.lap;
  const n = lap.count;
  const step = track.length / n;
  const p = createVec3();
  let worst = 0;
  let where = '';
  const probe = (s: number, d: number, hint: ReturnType<typeof createSurfaceHint>): number => {
    lap.pointAt(s, d, p);
    surface.sample(p.x, p.z, hint, out);
    return out.height;
  };
  for (let j = 0; j < 2 * n; j++) {
    const s = (j * step) / 2;
    const i = j >> 1;
    const fresh = (): ReturnType<typeof createSurfaceHint> => createSurfaceHint();
    const left = 0.999 * Math.min(track.barrier[LEFT][i]!, track.barrier[LEFT][(i + 1) % n]!);
    const right = 0.999 * Math.min(track.barrier[RIGHT][i]!, track.barrier[RIGHT][(i + 1) % n]!);
    let last = probe(s, -right, fresh());
    for (let d = -right + 0.1; d <= left; d += 0.1) {
      const h = probe(s, d, fresh());
      if (Math.abs(h - last) > worst) {
        worst = Math.abs(h - last);
        where = `across at s ${s.toFixed(1)} d ${d.toFixed(2)}`;
      }
      last = h;
    }
  }
  for (const k of [LEFT, RIGHT] as const) {
    for (const f of [0.5, 0.95]) {
      const sign = k === LEFT ? 1 : -1;
      const hint = createSurfaceHint();
      const dAt = (s: number): number => sign * f * track.barrier[k][lap.sampleIndex(s)]!;
      let last = probe(0, dAt(0), hint);
      for (let s = 0.1; s < track.length; s += 0.1) {
        const d = dAt(s);
        const h = probe(s, d, hint);
        // The offset itself steps where the barrier offset does; only compare like with like.
        if (Math.abs(d - dAt(s - 0.1)) < 0.05 && Math.abs(h - last) > worst) {
          worst = Math.abs(h - last);
          where = `along at s ${s.toFixed(1)} d ${d.toFixed(2)}`;
        }
        last = h;
      }
    }
  }
  return { worst, where };
}

/**
 * The largest legitimate change over 10 cm: the steepest kerb flank (the sausage kerb's outer
 * edge drops 0.13 m in 0.15 m), the verge fall and an allowance for grade and banking. A
 * projection onto the wrong part of the lap steps by tens of centimetres to metres.
 */
const stepBound = (track: Track): number => (steepestKerbSlope(track) + VERGE_FALL + 0.15) * 0.1;

describe('Spa: projection and ground inside the barriers', { timeout: 120_000 }, () => {
  const track = Track.fromJSON(spa);

  it.fails(`${UNTIL_19} round-trips (6579, 13.664322) near the Bus Stop (review of PR #18)`, () => {
    const r = roundTrip(track, 6579, 13.664322);
    expect(r.miss, r.got).toBeLessThan(1e-6);
    expect(r.err, r.got).toBeLessThan(1e-6);
  });

  it.fails(
    `${UNTIL_19} round-trips every point inside the barriers, with and without a hint`,
    () => {
      const { worst, where, cases } = denseRoundTrips(track);
      expect(cases).toBeGreaterThan(100_000);
      expect(worst, where).toBeLessThan(1e-6);
    },
  );

  it.fails(`${UNTIL_19} reports a ground without steps anywhere inside the barriers`, () => {
    const { worst, where } = groundSteps(track);
    expect(worst, where).toBeLessThan(stepBound(track));
  });
});

describe('Singapore: projection and ground inside the barriers', { timeout: 120_000 }, () => {
  const track = Track.fromJSON(singapore);

  it.fails(
    `${UNTIL_19} round-trips (257, -25.974) in the turn 1 escape road (review of PR #18)`,
    () => {
      const r = roundTrip(track, 257, -25.974);
      expect(r.miss, r.got).toBeLessThan(1e-6);
      expect(r.err, r.got).toBeLessThan(1e-6);
    },
  );

  it.fails(
    `${UNTIL_19} round-trips every point inside the barriers, with and without a hint`,
    () => {
      const { worst, where, cases } = denseRoundTrips(track);
      expect(cases).toBeGreaterThan(50_000);
      expect(worst, where).toBeLessThan(1e-6);
    },
  );

  it.fails(`${UNTIL_19} reports a ground without steps anywhere inside the barriers`, () => {
    const { worst, where } = groundSteps(track);
    expect(worst, where).toBeLessThan(stepBound(track));
  });
});
