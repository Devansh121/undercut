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
    // Point of the run at arc distance `at`, linear between its vertices.
    const pointAt = (at: number): [number, number, number] => {
      let i = 1;
      while (i < vertices - 1 && arc[i]! < at) i++;
      const span = arc[i]! - arc[i - 1]!;
      const u = span > 0 ? Math.min(1, Math.max(0, (at - arc[i - 1]!) / span)) : 0;
      const a = (i - 1) * 3;
      const b = i * 3;
      return [
        points[a]! + (points[b]! - points[a]!) * u,
        points[a + 1]! + (points[b + 1]! - points[a + 1]!) * u,
        points[a + 2]! + (points[b + 2]! - points[a + 2]!) * u,
      ];
    };
    // One module over the run from arc distance a0 to a1: it spans the chord between its two ends
    // on the run, pitched to the chord's slope and stretched to its length, so both ends sit on
    // the run on bends and grades (a level module stair-steps on a grade). Where the chord stands
    // more than 3 cm off the run's middle (a tight bend or a hook at a run's end) the module is
    // halved, down to a quarter of its length, so the sleeve follows the bend.
    const place = (a0: number, a1: number): void => {
      const [x0, y0, z0] = pointAt(a0);
      const [x1, y1, z1] = pointAt(a1);
      const dx = x1 - x0;
      const dz = z1 - z0;
      const length = Math.hypot(dx, dz);
      if (length <= 0) return;
      const x = (x0 + x1) / 2;
      const z = (z0 + z1) / 2;
      const [xm, , zm] = pointAt((a0 + a1) / 2);
      if (Math.hypot(xm - x, zm - z) > 0.03 && a1 - a0 > pitch / 4 + 1e-6) {
        place(a0, (a0 + a1) / 2);
        place((a0 + a1) / 2, a1);
        return;
      }
      const hit = lap.nearest(x, z);
      const nx = -dz / length;
      const nz = dx / length;
      const inward =
        (track.lap.x[hit.index]! - x) * nx + (track.lap.z[hit.index]! - z) * nz >= 0 ? 1 : -1;
      // The module's +Z runs along the chord times -inward; its rise per metre there.
      const rise = (-inward * (y1 - y0)) / length;
      const along = length / pitch;
      props.place(id!, {
        x: x - nx * inward * (face - 0.03),
        y: (y0 + y1) / 2,
        z: z - nz * inward * (face - 0.03),
        yaw: Math.atan2(-nz * inward, nx * inward),
        ...(rise !== 0 && { pitch: -Math.atan(rise) }),
        ...((rise !== 0 || along !== 1) && {
          stretch: [1, 1, along * Math.hypot(1, rise)] as const,
        }),
        s: hit.s,
      });
      count++;
    };
    // Continuous pitch across vertices, including runs sampled more finely than a module.
    for (let at = 0; at + pitch <= arc[vertices - 1]!; at += pitch) place(at, at + pitch);
  }
  return count;
}
