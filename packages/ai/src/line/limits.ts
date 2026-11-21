import { SurfaceKind } from '@undercut/sim';
import {
  LEFT,
  RIGHT,
  createGround,
  createPathPoint,
  createVec3,
  type Ground,
  type PathPoint,
  type SideIndex,
  type Track,
  type Vec3,
} from '@undercut/track';
import type { Corridor } from './corridor';

/**
 * Track limits, one definition for the racing line and for judging a lap.
 *
 * The rule (the real series' and this game's, `apps/web/src/game/limits.ts`): a wheel is off
 * when its tyre is wholly beyond the white line, that is when its centre is more than half a
 * tread past it, and a lap is invalid when all four wheels are off at once. So a car may run
 * with its centre well past the line as long as one wheel still touches it.
 *
 * The legal corridor is where the car's centre may be planned so that, with the car's real
 * footprint, a heading error and the driver's tracking error, the lap stays legal and every
 * tyre stays on ground that carries it: track, a kerb up to its crest (never over a kerb's
 * outer drop or onto its raised sausage part) and asphalt run-off. Grass, gravel and barriers
 * are forbidden with a margin. Surfaces inside the corridor are not forbidden but cost what
 * they cost: the speed profile reads the grip under the wheels (`geometry.ts`).
 */

/** Half the tread of the game's track-limit rule, m (`apps/web`'s TYRE_HALF_TREAD). */
export const TYRE_HALF_TREAD = 0.18;

/** A wheel centre at (s, d) is off when its tyre is wholly past that side's white line. */
export function wheelOff(track: Track, s: number, d: number, halfTread = TYRE_HALF_TREAD): boolean {
  const side: SideIndex = d >= 0 ? LEFT : RIGHT;
  return Math.abs(d) - halfTread > track.halfWidthAt(s, side);
}

/** One wheel of the car's footprint, relative to the point the line describes (the CoG). */
export interface FootprintWheel {
  /** Forward of the CoG, m. */
  x: number;
  /** Left of the CoG, m. */
  y: number;
  /** Half the tyre's width, m. */
  halfWidth: number;
}

export interface LegalCorridorOptions {
  /** Discriminates this corridor from the fixed-margin one. */
  rule: 'four-wheels';
  /** The car's four wheels: the footprint the corridor is checked with. */
  wheels: readonly FootprintWheel[];
  /** Half the contact patch's length, m: the footprint's corners lie this far fore and aft. */
  patchHalfLength: number;
  /** Half tread of the rule, m. */
  halfTread: number;
  /** Largest heading error between the car and the centreline the corridor allows for, rad. */
  maxYaw: number;
  /** The driver's tracking error the corridor allows for, outward, m. */
  allowance: number;
  /** Further distance kept between every tyre's edge and forbidden ground, m. */
  surfaceMargin: number;
  /** Kerb profiles (by name) the tyres may not ride; default none. */
  avoidKerbs?: readonly string[];
}

/**
 * How far beyond the white line the ground carries a tyre, m, at a sample and side: across a
 * kerb up to its crest (where the profile drops to the verge, or where a raised part starts),
 * else across asphalt run-off up to the next zone; 0 where grass or gravel meets the line.
 */
export function usableBeyondLine(
  track: Track,
  i: number,
  side: SideIndex,
  avoidKerbs: readonly string[] = [],
): number {
  const k = track.kerb[side][i]!;
  if (k >= 0) {
    const p = track.kerbProfiles[k]!;
    if (avoidKerbs.includes(p.name)) return 0;
    // Crest: the last profile point before the profile falls toward the verge.
    let crest = p.u[p.u.length - 1]!;
    for (let m = p.u.length - 1; m > 0; m--) {
      if (p.h[m]! < p.h[m - 1]!) crest = p.u[m - 1]!;
      else break;
    }
    if (p.highFrom < p.highTo) crest = Math.min(crest, p.highFrom);
    return crest;
  }
  const hw = track.halfWidth[side][i]!;
  if (track.inner[side][i] === SurfaceKind.RunoffAsphalt) {
    let edge = track.split[side][i]!;
    if (track.outer[side][i] === SurfaceKind.RunoffAsphalt) edge = track.barrier[side][i]!;
    return Math.max(0, edge - hw);
  }
  return 0;
}

/** Headings the footprint is checked at, as fractions of the allowed heading error. */
const YAW_STEPS = [-1, -0.5, 0, 0.5, 1] as const;

/**
 * Is a car whose centre sits at (s, d) legal and on usable ground, with the outward tracking
 * allowance and every heading in the allowed range? Each wheel centre and each corner of each
 * tyre's footprint is placed in the world and projected back onto the lap.
 */
function footprintFits(
  track: Track,
  s: number,
  d: number,
  sign: number,
  o: LegalCorridorOptions,
  scratch: FootprintScratch,
): boolean {
  const { p, t, q, g, hint } = scratch;
  track.lap.tangent(s, t);
  const head0 = Math.atan2(-t.z, t.x);
  track.lap.pointAt(s, d + sign * o.allowance, p);
  for (const f of YAW_STEPS) {
    const h = head0 + f * o.maxYaw;
    const fx = Math.cos(h);
    const fz = -Math.sin(h);
    let on = 0;
    for (const w of o.wheels) {
      const wx = p.x + fx * w.x + fz * w.y;
      const wz = p.z + fz * w.x - fx * w.y;
      track.project(wx, wz, hint, q);
      if (!wheelOff(track, q.s, q.d, o.halfTread)) on++;
      for (const a of [-o.patchHalfLength, o.patchHalfLength]) {
        for (const b of [-w.halfWidth, w.halfWidth]) {
          track.project(wx + fx * a + fz * b, wz + fz * a - fx * b, hint, q);
          track.ground(q.s, q.d, g);
          if (!usableGround(track, q.s, q.d, g, o)) return false;
        }
      }
    }
    if (on === 0) return false;
  }
  return true;
}

interface FootprintScratch {
  p: Vec3;
  t: Vec3;
  q: PathPoint;
  g: Ground;
  hint: { index: number };
}

/**
 * Does the ground at (s, d) (its cross-section already in `g`) carry a tyre with the margin?
 * Track, a kerb inside its crest and asphalt run-off do; grass, gravel, a raised kerb and the
 * ground behind the barriers do not.
 */
export function usableGround(
  track: Track,
  s: number,
  d: number,
  g: Ground,
  o: Pick<LegalCorridorOptions, 'surfaceMargin' | 'avoidKerbs'>,
): boolean {
  if (
    g.kind === SurfaceKind.Grass ||
    g.kind === SurfaceKind.Gravel ||
    g.kind === SurfaceKind.OutOfBounds ||
    g.highKerb
  ) {
    return false;
  }
  const side: SideIndex = d >= 0 ? LEFT : RIGHT;
  const beyond = Math.abs(d) - track.halfWidthAt(s, side);
  if (beyond <= 0) return true;
  return beyond <= usableBeyondLine(track, g.sample, side, o.avoidKerbs) - o.surfaceMargin;
}

/**
 * The car centre's lateral bound on one side at sample i (positive, from the centreline): the
 * largest offset at which the footprint fits (`footprintFits`), found by bisection, and never
 * past the track frame's own limit.
 */
export function legalBound(
  track: Track,
  i: number,
  side: SideIndex,
  o: LegalCorridorOptions,
  scratch: FootprintScratch = {
    p: createVec3(),
    t: createVec3(),
    q: createPathPoint(),
    g: createGround(),
    hint: { index: -1 },
  },
): number {
  const s = i * track.lap.step;
  const sign = side === LEFT ? 1 : -1;
  const hw = track.halfWidth[side][i]!;
  let lo = 0;
  let hi = Math.min(hw + 3, track.frameLimit[side][i]!);
  if (!footprintFits(track, s, sign * lo, sign, o, scratch)) return 0;
  if (footprintFits(track, s, sign * hi, sign, o, scratch)) return hi;
  for (let k = 0; k < 12; k++) {
    const mid = 0.5 * (lo + hi);
    if (footprintFits(track, s, sign * mid, sign, o, scratch)) lo = mid;
    else hi = mid;
  }
  return lo;
}

export function buildLegalCorridor(track: Track, o: LegalCorridorOptions): Corridor {
  const n = track.lap.count;
  const lo = new Float64Array(n);
  const hi = new Float64Array(n);
  const scratch: FootprintScratch = {
    p: createVec3(),
    t: createVec3(),
    q: createPathPoint(),
    g: createGround(),
    hint: { index: -1 },
  };
  for (let i = 0; i < n; i++) {
    hi[i] = legalBound(track, i, LEFT, o, scratch);
    lo[i] = -legalBound(track, i, RIGHT, o, scratch);
    if (!(lo[i]! < hi[i]!)) throw new Error(`legal corridor closes at sample ${i}`);
  }
  return { lo, hi };
}
