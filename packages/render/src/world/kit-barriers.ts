import type { Track } from '@undercut/track';
import type { PropKitAssets } from '../props/catalog';
import type { PropRegistry } from '../props/registry';
import type { LapIndex } from './lap-index';

/** Visual sleeves on the collision runs. Their track face stands 3 cm proud of the base mesh. */
export function placeKitBarriers(
  track: Track,
  lap: LapIndex,
  kit: PropKitAssets,
  props: PropRegistry,
  street: boolean,
): number {
  let count = 0;
  const kinds = new Map<string, string>();
  for (const bar of track.barriers) {
    if (street && bar.type === 'concrete' && bar.side !== 'pit') continue;
    const kitId =
      bar.type === 'armco'
        ? 'armco-three'
        : bar.type === 'tyres'
          ? 'tyre-wall'
          : bar.type === 'concrete'
            ? 'concrete-wall'
            : null;
    if (!kitId) continue;
    let id = kinds.get(kitId);
    if (!id) {
      const lods = kit.lodsFor(kitId);
      if (!lods) continue;
      id = `barrier-${kitId}`;
      props.define({ id, lods, chunkLength: 40, castShadow: false });
      kinds.set(kitId, id);
    }
    const pitch = kit.entries.get(kitId)?.moduleLength || 4;
    const face = kit.entries.get(kitId)?.bounds?.max[0] ?? 0.3;
    // Walk each polyline at a continuous pitch; no short overlapping module at every vertex.
    let next = pitch / 2;
    let arc = 0;
    for (let i = 3; i < bar.points.length; i += 3) {
      const ax = bar.points[i - 3]!;
      const ay = bar.points[i - 2]!;
      const az = bar.points[i - 1]!;
      const dx = bar.points[i]! - ax;
      const dz = bar.points[i + 2]! - az;
      const length = Math.hypot(dx, dz);
      while (next + pitch / 2 <= arc + length) {
        const u = (next - arc) / length;
        const x = ax + dx * u;
        const z = az + dz * u;
        const hit = lap.nearest(x, z);
        const nx = -dz / length;
        const nz = dx / length;
        const inward =
          (track.lap.x[hit.index]! - x) * nx + (track.lap.z[hit.index]! - z) * nz >= 0 ? 1 : -1;
        props.place(id, {
          x: x - nx * inward * (face - 0.03),
          y: ay + (bar.points[i + 1]! - ay) * u,
          z: z - nz * inward * (face - 0.03),
          yaw: Math.atan2(-nz * inward, nx * inward),
          s: hit.s,
        });
        count++;
        next += pitch;
      }
      arc += length;
      // Advance to the next full module centre when a segment ended inside one module.
      if (next < arc) next = arc + pitch / 2;
    }
  }
  return count;
}
