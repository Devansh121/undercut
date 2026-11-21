/**
 * Track data, the (s, d) frame, the surface sampler and renderer-agnostic track meshes.
 * Pure: no DOM, no three.js, no clock.
 */
export {
  BARRIER_TYPES,
  RUNOFF_KINDS,
  TRACK_FORMAT,
  TRACK_FORMAT_VERSION,
  TrackDataError,
  validateTrackData,
  type BarrierType,
  type CornerData,
  type DrsZoneData,
  type KerbProfileData,
  type PitData,
  type RunoffKind,
  type Side,
  type SideData,
  type TrackData,
  type TrackPoint,
} from './data';
export { TrackPath, createPathPoint, createVec3, type PathPoint, type Vec3 } from './path';
export {
  LEFT,
  PitLane,
  RIGHT,
  Track,
  VERGE_FALL,
  createGround,
  type Barrier,
  type DrsZone,
  type Ground,
  type KerbProfile,
  type Pose,
  type SideIndex,
} from './track';
export { HIGH_KERB, SURFACE_PROPERTIES, TrackSurface, type SurfaceProperties } from './surface';
export { CORNER_RULE, detectCorners, smoothClosed, type DetectedCorner } from './corners';

/**
 * A position in track coordinates: `s` metres along the centreline from the
 * start/finish line, `d` metres of lateral offset, positive to the left.
 */
export interface TrackCoord {
  s: number;
  d: number;
}
