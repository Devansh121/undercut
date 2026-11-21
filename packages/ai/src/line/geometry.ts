import { HIGH_KERB, SURFACE_PROPERTIES, createGround, type Track } from '@undercut/track';

/**
 * A racing line as a world-space curve: one point per centreline sample, at offset d[i] from
 * centreline sample i. Everything the speed profile and the driver need comes from here:
 * distance, heading, curvature, grade, vertical curvature, banking and the grip under the car.
 */
export interface LineGeometry {
  readonly count: number;
  /** Centreline s of each sample (uniform) and the offset there. */
  readonly s: Float64Array;
  readonly d: Float64Array;
  readonly x: Float64Array;
  readonly y: Float64Array;
  readonly z: Float64Array;
  /** Distance from sample i to i + 1 along the line (3D), and its running sum from sample 0. */
  readonly ds: Float64Array;
  readonly sigma: Float64Array;
  /** Total length of the line, m. */
  readonly length: number;
  /** Heading (yaw convention: 0 faces +X, positive turns left), rad. */
  readonly heading: Float64Array;
  /** Signed horizontal curvature, 1/m, positive turning left. */
  readonly curvature: Float64Array;
  /** Rise per metre along the line. */
  readonly grade: Float64Array;
  /** Vertical curvature d²y/dσ², 1/m: positive in a compression (concave up). */
  readonly verticalCurvature: Float64Array;
  /** tan of the bank angle, positive with the left side higher. */
  readonly tanBank: Float64Array;
  /** Mean surface grip under the four wheels (1 on clean asphalt). */
  readonly grip: Float64Array;
}

export interface GeometryOptions {
  /** Wheel-centre half track, for the grip under the wheels. Default 0.81 m. */
  halfTrack?: number;
}

export function computeLineGeometry(
  track: Track,
  d: ArrayLike<number>,
  options: GeometryOptions = {},
): LineGeometry {
  const lap = track.lap;
  const n = lap.count;
  const halfTrack = options.halfTrack ?? 0.81;
  const s = new Float64Array(n);
  const dd = Float64Array.from(d);
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  const z = new Float64Array(n);
  const grip = new Float64Array(n);
  const g = createGround();
  const surfaceGrip = (si: number, di: number): number => {
    track.ground(si, di, g);
    return g.highKerb ? HIGH_KERB.grip : SURFACE_PROPERTIES[g.kind].grip;
  };
  for (let i = 0; i < n; i++) {
    s[i] = i * lap.step;
    x[i] = lap.x[i]! + dd[i]! * lap.nx[i]!;
    z[i] = lap.z[i]! + dd[i]! * lap.nz[i]!;
    y[i] = track.heightAt(s[i]!, dd[i]!);
    grip[i] =
      0.5 * (surfaceGrip(s[i]!, dd[i]! + halfTrack) + surfaceGrip(s[i]!, dd[i]! - halfTrack));
  }
  const ds = new Float64Array(n);
  const flat = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const dx = x[j]! - x[i]!;
    const dz = z[j]! - z[i]!;
    const dy = y[j]! - y[i]!;
    flat[i] = Math.hypot(dx, dz);
    ds[i] = Math.sqrt(dx * dx + dy * dy + dz * dz);
  }
  const sigma = new Float64Array(n);
  for (let i = 1; i < n; i++) sigma[i] = sigma[i - 1]! + ds[i - 1]!;
  const length = sigma[n - 1]! + ds[n - 1]!;
  const heading = new Float64Array(n);
  const curvature = new Float64Array(n);
  const grade = new Float64Array(n);
  const vcurv = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = (i + n - 1) % n;
    const b = (i + 1) % n;
    const ex0 = x[i]! - x[a]!;
    const ez0 = z[i]! - z[a]!;
    const ex1 = x[b]! - x[i]!;
    const ez1 = z[b]! - z[i]!;
    heading[i] = Math.atan2(-(z[b]! - z[a]!), x[b]! - x[a]!);
    const run = flat[a]! + flat[i]!;
    const cross = ex0 * ez1 - ez0 * ex1;
    const dot = ex0 * ex1 + ez0 * ez1;
    // Same convention as the track path: a left turn has negative cross with +Z south.
    curvature[i] = (-Math.atan2(cross, dot) * 2) / run;
    grade[i] = (y[b]! - y[a]!) / run;
    const slope1 = (y[b]! - y[i]!) / flat[i]!;
    const slope0 = (y[i]! - y[a]!) / flat[a]!;
    vcurv[i] = (slope1 - slope0) / (0.5 * run);
  }
  return {
    count: n,
    s,
    d: dd,
    x,
    y,
    z,
    ds,
    sigma,
    length,
    heading,
    curvature,
    grade,
    verticalCurvature: vcurv,
    tanBank: Float64Array.from(track.tanBank),
    grip,
  };
}
