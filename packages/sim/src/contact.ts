import type { PatchSample, SurfaceHint, SurfaceSampler } from './contracts';
import { createSurfaceSample } from './contracts';

/**
 * Tyre-to-ground contact: the patch that envelops the ground, and the tyre's vertical force.
 *
 * A tyre does not follow the ground at a point. Its contact patch (about 0.3–0.4 m wide and
 * 0.15 m long) bridges a short feature, so a kerb's 35 mm rise over 0.12 m reaches the wheel as
 * a ramp about as long as the patch is wide. The patch is sampled on a grid across its width and
 * along its length, and the ground the tyre deflects against is the mean height of those points
 * (a box filter, the simplest envelope model); grip and rolling drag are the patch's mean too,
 * so a wheel half on a kerb gets half the kerb's change. The normal is the mean normal. There is
 * no shortcut: three probes cannot tell that a patch lies on one plane (a step along the travel
 * passes between them), so every reading is the whole grid's mean.
 */

/** Grid across the patch width (fractions of the width) and along its length (of the length). */
export const PATCH_ACROSS = [-0.4, -0.2, 0, 0.2, 0.4] as const;
export const PATCH_ALONG = [-1 / 4, 1 / 4] as const;
export const PATCH_POINTS = PATCH_ACROSS.length * PATCH_ALONG.length;
/** Hints one wheel needs: one per grid point (the first also serves a sampler's fast path). */
export const PATCH_HINTS = PATCH_POINTS;

export function createPatchSample(): PatchSample {
  return { height: 0, normalX: 0, normalY: 1, normalZ: 0, grip: 1, drag: 1 };
}

const point = createSurfaceSample();

/**
 * Sample the ground over a contact patch centred at (x, z) whose forward direction in the world
 * is (fx, fz) (unit, horizontal): the mean over the whole grid, always. A sampler with a
 * `samplePatch` fast path provides it; otherwise every grid point is sampled. `hints` holds
 * `PATCH_HINTS` hints for this patch from `first`.
 */
export function samplePatch(
  surface: SurfaceSampler,
  x: number,
  z: number,
  fx: number,
  fz: number,
  width: number,
  length: number,
  hints: readonly SurfaceHint[],
  first: number,
  out: PatchSample,
): PatchSample {
  if (surface.samplePatch) {
    surface.samplePatch(x, z, fx, fz, width, length, hints[first] as SurfaceHint, out);
    return out;
  }
  // Left of travel in the world: forward rotated +90° about +Y.
  const lx = fz;
  const lz = -fx;
  let hSum = 0;
  let nx = 0;
  let ny = 0;
  let nz = 0;
  let grip = 0;
  let drag = 0;
  let k = first;
  for (const a of PATCH_ALONG) {
    for (const c of PATCH_ACROSS) {
      const along = a * length;
      const across = c * width;
      surface.sample(
        x + fx * along + lx * across,
        z + fz * along + lz * across,
        hints[k++] as SurfaceHint,
        point,
      );
      hSum += point.height;
      nx += point.normalX;
      ny += point.normalY;
      nz += point.normalZ;
      grip += point.grip;
      drag += point.drag;
    }
  }
  const inv = 1 / PATCH_POINTS;
  const nl = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz);
  out.height = hSum * inv;
  out.normalX = nx * nl;
  out.normalY = ny * nl;
  out.normalZ = nz * nl;
  out.grip = grip * inv;
  out.drag = drag * inv;
  return out;
}

/**
 * Vertical tyre force for a deflection `comp` (m, positive compressed) and deflection rate
 * `rate` (m/s, positive compressing): stiffness plus carcass damping, never pulling. The damping
 * grows from nothing at first touch to its full value at `full` m of deflection, as the patch
 * itself grows: a tyre that only just touches has no patch to dissipate energy in, so a wheel
 * landing or re-contacting does not take a damping step at zero deflection. Returns the total;
 * `damping` receives the damping share.
 */
export function tyreVerticalForce(
  comp: number,
  rate: number,
  stiffness: number,
  damping: number,
  full: number,
  out: { damping: number },
): number {
  if (!(comp > 0)) {
    out.damping = 0;
    return 0;
  }
  const grow = comp < full ? comp / full : 1;
  let d = damping * grow * rate;
  let f = stiffness * comp + d;
  if (f < 0) {
    f = 0;
    d = -stiffness * comp;
  }
  out.damping = d;
  return f;
}
