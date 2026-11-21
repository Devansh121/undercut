import {
  SurfaceKind,
  type SurfaceHint,
  type SurfaceSample,
  type SurfaceSampler,
} from '@undercut/sim';
import { createPathPoint, createVec3 } from './path';
import { createGround, type Track } from './track';

/** Friction, rolling drag and texture of a surface. */
export interface SurfaceProperties {
  readonly grip: number;
  readonly drag: number;
  readonly roughness: number;
}

/**
 * Per-kind surface properties. Grip and drag follow docs/physics-validation.md section 4.4
 * (estimates there, as no friction data is published); roughness is an estimate.
 */
export const SURFACE_PROPERTIES: Readonly<Record<SurfaceKind, SurfaceProperties>> = Object.freeze({
  [SurfaceKind.Asphalt]: { grip: 1, drag: 1, roughness: 0 },
  [SurfaceKind.Paint]: { grip: 0.9, drag: 1, roughness: 0.0005 },
  [SurfaceKind.Kerb]: { grip: 0.9, drag: 1, roughness: 0.012 },
  [SurfaceKind.RunoffAsphalt]: { grip: 0.95, drag: 1, roughness: 0.002 },
  [SurfaceKind.Grass]: { grip: 0.4, drag: 2, roughness: 0.03 },
  [SurfaceKind.Gravel]: { grip: 0.35, drag: 8, roughness: 0.04 },
  [SurfaceKind.PitLane]: { grip: 1, drag: 1, roughness: 0 },
  [SurfaceKind.OutOfBounds]: { grip: 0.3, drag: 10, roughness: 0.05 },
});

/** Raised (sausage) kerbs: section 4.4, "Sausage / high kerb". */
export const HIGH_KERB: SurfaceProperties = Object.freeze({
  grip: 0.6,
  drag: 1.5,
  roughness: 0.06,
});

/**
 * The vehicle model's view of the ground on a track. Called once per wheel per tick: it keeps
 * its scratch state in fields and allocates nothing. The caller's hint packs the last lap
 * segment and pit segment for that wheel, so a moving wheel costs a few segment solves.
 */
export class TrackSurface implements SurfaceSampler {
  readonly track: Track;
  private readonly lapHint = { index: -1 };
  private readonly pitHint = { index: -1 };
  private readonly q = createPathPoint();
  private readonly pq = createPathPoint();
  private readonly g = createGround();
  private readonly t = createVec3();

  constructor(track: Track) {
    this.track = track;
  }

  sample(x: number, z: number, hint: SurfaceHint, out: SurfaceSample): void {
    const track = this.track;
    const segs = track.lap.segments;
    let pitIndex = -1;
    if (hint.index >= 0) {
      this.lapHint.index = hint.index % segs;
      pitIndex = Math.floor(hint.index / segs) - 1;
    } else {
      this.lapHint.index = -1;
    }
    const q = track.project(x, z, this.lapHint, this.q);
    const s = q.s;
    const d = q.d;
    const g = track.ground(s, d, this.g);
    let kind = g.kind;
    if (kind !== SurfaceKind.Asphalt && kind !== SurfaceKind.Paint && kind !== SurfaceKind.Kerb) {
      this.pitHint.index = pitIndex;
      if (track.onPitLane(x, z, s, d, this.pitHint, this.pq)) kind = SurfaceKind.PitLane;
      pitIndex = this.pitHint.index;
    }
    hint.index = this.lapHint.index + segs * (pitIndex + 1);

    // Normal from the two surface tangents: along the lap (scaled by 1 - curvature * d, the
    // stretch of a parallel offset curve) and across it.
    const t = track.lap.tangent(s, this.t);
    let m = 1 - track.curvatureAt(s) * d;
    if (m < 0.05) m = 0.05;
    const nx = t.z;
    const nz = -t.x;
    const ax = g.slopeS * nz - m * t.z * g.slopeD;
    const ay = m;
    const az = m * t.x * g.slopeD - g.slopeS * nx;
    const len = Math.sqrt(ax * ax + ay * ay + az * az);
    out.normalX = ax / len;
    out.normalY = ay / len;
    out.normalZ = az / len;
    out.height = g.height;
    const props = kind === SurfaceKind.Kerb && g.highKerb ? HIGH_KERB : SURFACE_PROPERTIES[kind];
    out.grip = props.grip;
    out.drag = props.drag;
    out.roughness = props.roughness;
    out.kind = kind;
    out.s = s;
    out.d = d;
  }
}
