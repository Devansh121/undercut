import { tracksideObjects } from './objects';
import {
  BreakableIndex,
  SurfaceKind,
  type SurfaceHint,
  type SurfaceSample,
  type SurfaceSampler,
  type WallSample,
} from '@undercut/sim';
import { createPathPoint, createVec3 } from './path';
import { LEFT, RIGHT, createGround, type Track } from './track';

/**
 * Gap between the pit lane's garage-side edge and the garage wall, m: the wall `Track` builds
 * for the renderer stands this far out.
 */
export const GARAGE_WALL_GAP = 0.5;

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
  readonly breakables: BreakableIndex;
  private readonly lapHint = { index: -1 };
  private readonly pitHint = { index: -1 };
  private readonly q = createPathPoint();
  private readonly pq = createPathPoint();
  private readonly g = createGround();
  private readonly t = createVec3();
  private readonly pt = createVec3();

  constructor(track: Track) {
    this.track = track;
    this.breakables = new BreakableIndex(tracksideObjects(track));
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
    // The pit lane has its own ground (Track.pitBlend): full weight on its surface, blending
    // back to the lap's ground just beyond its edges.
    this.pitHint.index = pitIndex;
    const w = track.pitBlend(x, z, s, d, this.pitHint, this.pq);
    pitIndex = this.pitHint.index;
    if (w > 0 && kind !== SurfaceKind.Kerb && track.pitLaneSurface(this.pq)) {
      kind = SurfaceKind.PitLane;
    }
    hint.index = this.lapHint.index + segs * (pitIndex + 1);

    const nrm = track.groundNormal(g, this.t);
    let height = g.height;
    if (w > 0) {
      const sp = this.pq.s;
      height += w * (track.pitGroundHeight(sp) - height);
      // The pit ground's normal: flat across the pit lane, rising along it at its grade.
      const grade = track.pitGroundGrade(sp);
      track.pit.path.tangent(sp, this.pt);
      let nx = -grade * this.pt.x;
      let ny = 1;
      let nz = -grade * this.pt.z;
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
      nx = nrm.x + w * (nx / len - nrm.x);
      ny = nrm.y + w * (ny / len - nrm.y);
      nz = nrm.z + w * (nz / len - nrm.z);
      const l2 = Math.sqrt(nx * nx + ny * ny + nz * nz);
      nrm.x = nx / l2;
      nrm.y = ny / l2;
      nrm.z = nz / l2;
    }
    out.normalX = nrm.x;
    out.normalY = nrm.y;
    out.normalZ = nrm.z;
    out.height = height;
    const props = kind === SurfaceKind.Kerb && g.highKerb ? HIGH_KERB : SURFACE_PROPERTIES[kind];
    out.grip = props.grip;
    out.drag = props.drag;
    out.roughness = props.roughness;
    out.kind = kind;
    out.s = s;
    out.d = d;
  }

  /**
   * Barriers as the car meets them. The drivable area is the union of two regions:
   *
   * - the lap: |d| up to the barrier offset on that side, interpolated along s. Where the offset
   *   changes along s (the pit wall's nose, a run of barrier set back) the face is slanted, and
   *   the normal follows the face: the gradient of |d| − barrier(s), not just the lap normal;
   * - the pit lane, where it runs alongside: in its own frame, from its track-side edge to the
   *   garage wall (the lane's garage-side edge plus GARAGE_WALL_GAP).
   *
   * Between the two, along the pit straight, lie the pit wall and its verge: behind a barrier
   * from both sides. Depth is the distance past the nearer region's edge, so a car on either
   * side of the pit wall is pushed back to its own side.
   */
  wall(x: number, z: number, hint: SurfaceHint, out: WallSample): void {
    const track = this.track;
    const lap = track.lap;
    const segs = lap.segments;
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
    const side = d >= 0 ? LEFT : RIGHT;
    const sign = side === LEFT ? 1 : -1;
    lap.seek(s);
    const i0 = lap.cursor;
    const j = lap.next(i0);
    const off = track.barrier[side];
    const b = off[i0]! + (off[j]! - off[i0]!) * lap.cursorT;
    const db = (off[j]! - off[i0]!) / lap.chord[i0]!;
    const t = lap.tangent(s, this.t);
    const tx = t.x;
    const tz = t.z;
    // Left normal (tz, -tx). Along s at offset d, a metre of s is (1 - κd) metres of ground.
    let m = 1 - track.curvatureAt(s) * d;
    if (m < 0.05) m = 0.05;
    // Gradient of f = |d| - b(s) in the world, and the inward normal -∇f / |∇f|.
    const gx = sign * tz - (db / m) * tx;
    const gz = -sign * tx - (db / m) * tz;
    const gl = Math.sqrt(gx * gx + gz * gz);
    let depth = (sign * d - b) / gl;
    let nx = -gx / gl;
    let nz = -gz / gl;

    const near = track.pitNear[lap.sampleIndex(s)]!;
    if (depth > 0 && near >= 0 && side === track.pitSide) {
      const pit = track.pit;
      this.pitHint.index = pitIndex >= 0 ? pitIndex : Math.min(near, pit.path.segments - 1);
      const pq = pit.path.project(x, z, this.pitHint, this.pq);
      pitIndex = this.pitHint.index;
      if (pq.s >= 0 && pq.s <= pit.length) {
        // gs: which way the garages lie in the pit frame (+1 left of the lane's direction).
        const gs = pit.side === 'left' ? 1 : -1;
        const hwG = pit.halfWidth(pq.s, gs > 0 ? LEFT : RIGHT) + GARAGE_WALL_GAP;
        const hwT = pit.halfWidth(pq.s, gs > 0 ? RIGHT : LEFT);
        const garage = gs * pq.d - hwG;
        const trackSide = -gs * pq.d - hwT;
        const pitDepth = garage > trackSide ? garage : trackSide;
        if (pitDepth < depth) {
          const pn = pit.path.normal(pq.s, this.t);
          // Inward from the garage wall is away from the garages, and vice versa.
          const toward = garage > trackSide ? -gs : gs;
          depth = pitDepth;
          nx = toward * pn.x;
          nz = toward * pn.z;
        }
      }
    }
    hint.index = this.lapHint.index + segs * (pitIndex + 1);
    out.depth = depth;
    out.normalX = nx;
    out.normalZ = nz;
  }
}
