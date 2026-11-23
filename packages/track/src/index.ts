/**
 * Track data, the (s, d) frame, the surface sampler and renderer-agnostic track meshes.
 * Pure: no DOM, no three.js, no clock.
 */
export {
  BARRIER_TYPES,
  OLDEST_TRACK_FORMAT_VERSION,
  RUNOFF_KINDS,
  TRACK_FORMAT,
  TRACK_FORMAT_VERSION,
  TrackDataError,
  migrateTrackData,
  validateTrackData,
  type BarrierType,
  type CornerData,
  type DrsZoneData,
  type EnvironmentData,
  type FloodlightData,
  type KerbProfileData,
  type PitData,
  type RunoffKind,
  type Side,
  type SideData,
  type TimingLineData,
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
  type TrackOptions,
} from './track';
export { HIGH_KERB, SURFACE_PROPERTIES, TrackSurface, type SurfaceProperties } from './surface';
export {
  CORNER_RULE,
  detectCorners,
  smoothClosed,
  type CornerRule,
  type DetectedCorner,
} from './corners';

/**
 * A position in track coordinates: `s` metres along the centreline from the
 * start/finish line, `d` metres of lateral offset, positive to the left.
 */
export interface TrackCoord {
  s: number;
  d: number;
}
export {
  MESH_LOD,
  MeshSurface,
  buildTrackMeshes,
  type MeshData,
  type TrackMeshOptions,
  type TrackMeshes,
} from './mesh';

export {
  BREAKABLE_EDGE_CLEARANCE,
  DRESSING_CONTACT,
  barrierSigns,
  tracksideObjects,
  type BarrierSign,
  type TracksideObject,
} from './objects';
