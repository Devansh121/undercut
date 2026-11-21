import { SurfaceKind } from '@undercut/sim';
import { LEFT, RIGHT, type SideIndex, type Track } from '@undercut/track';
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

export interface LegalCorridorOptions {
  /** Discriminates this corridor from the fixed-margin one. */
  rule: 'four-wheels';
  /** Wheel-centre half tracks of the car, m: the narrower decides legality, the wider the ground. */
  halfTrackInner: number;
  halfTrackOuter: number;
  /** Half the width of the widest tyre, m: its outer edge must stay on usable ground. */
  tyreHalfWidth: number;
  /** Half tread of the rule, m. */
  halfTread: number;
  /**
   * Largest heading error between the car and the centreline the corridor allows for, rad. The
   * innermost wheel is never further out than d − halfTrackInner·cos(ψ); the wheels toward the
   * line gain from yaw, which is not counted.
   */
  maxYaw: number;
  /**
   * Distance kept from the rule's limit, and from the usable ground's edge, for the driver's
   * tracking error, m.
   */
  allowance: number;
  /** Further distance kept between the outer tyre edge and forbidden ground, m. */
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

/** The car centre's lateral bound on one side at sample i (positive, from the centreline). */
export function legalBound(
  track: Track,
  i: number,
  side: SideIndex,
  o: LegalCorridorOptions,
): number {
  const hw = track.halfWidth[side][i]!;
  const rule = hw + o.halfTrackInner * Math.cos(o.maxYaw) + o.halfTread - o.allowance;
  const ground =
    hw +
    usableBeyondLine(track, i, side, o.avoidKerbs) -
    o.halfTrackOuter -
    o.tyreHalfWidth -
    o.surfaceMargin;
  return Math.min(rule, ground, track.frameLimit[side][i]!);
}

export function buildLegalCorridor(track: Track, o: LegalCorridorOptions): Corridor {
  const n = track.lap.count;
  const lo = new Float64Array(n);
  const hi = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    hi[i] = legalBound(track, i, LEFT, o);
    lo[i] = -legalBound(track, i, RIGHT, o);
    if (!(lo[i]! < hi[i]!)) throw new Error(`legal corridor closes at sample ${i}`);
  }
  return { lo, hi };
}
