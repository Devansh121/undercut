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
    const points = bar.points;
    const vertices = points.length / 3;
    if (vertices < 2) continue;
    const arc = new Float64Array(vertices);
    for (let i = 1; i < vertices; i++) {
      arc[i] =
        arc[i - 1]! +
        Math.hypot(
          points[i * 3]! - points[(i - 1) * 3]!,
          points[i * 3 + 2]! - points[(i - 1) * 3 + 2]!,
        );
    }
    let segment = 1;
    // Continuous pitch across vertices, including runs sampled more finely than a module.
    for (let at = pitch / 2; at + pitch / 2 <= arc[vertices - 1]!; at += pitch) {
      while (segment < vertices - 1 && arc[segment]! < at) segment++;
      const lo = (segment - 1) * 3;
      const hi = segment * 3;
      const length = arc[segment]! - arc[segment - 1]!;
      if (length <= 0) continue;
      const u = (at - arc[segment - 1]!) / length;
      const dx = points[hi]! - points[lo]!;
      const dz = points[hi + 2]! - points[lo + 2]!;
      const x = points[lo]! + dx * u;
      const z = points[lo + 2]! + dz * u;
      const hit = lap.nearest(x, z);
      const nx = -dz / length;
      const nz = dx / length;
      const inward =
        (track.lap.x[hit.index]! - x) * nx + (track.lap.z[hit.index]! - z) * nz >= 0 ? 1 : -1;
      props.place(id, {
        x: x - nx * inward * (face - 0.03),
        y: points[lo + 1]! + (points[hi + 1]! - points[lo + 1]!) * u,
        z: z - nz * inward * (face - 0.03),
        yaw: Math.atan2(-nz * inward, nx * inward),
        s: hit.s,
      });
      count++;
    }
  }
  return count;
}
