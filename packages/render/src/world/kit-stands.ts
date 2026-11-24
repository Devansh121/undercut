import type { Material } from 'three';
import type { PropKitAssets } from '../props/catalog';
import type { PropRegistry } from '../props/registry';
import { hash01 } from './dressing';
import type { StandFrame } from './grandstands';

export interface KitSpectator {
  x: number;
  y: number;
  z: number;
  yaw: number;
  s: number;
  k: number;
  near?: boolean;
}

/** Within this distance of the eye (to a module's origin) a bank module draws its middle level. */
export const STAND_NEAR_REACH = 25;

/** Tile human-scale ten-row banks into the mapped footprint; rear banks step up by ten risers. */
export function placeKitStands(
  frames: readonly StandFrame[],
  kit: PropKitAssets | null | undefined,
  props: PropRegistry,
  /** Share of seats taken in a stand's row (0 = front), the same rule as the procedural stands. */
  occupancy: (frame: StandFrame, row: number) => number,
  shadows: boolean,
  spectator: (seat: KitSpectator) => void,
  /**
   * The near and far kinds' materials, owned by the caller, with `instanceHandover` at
   * `STAND_NEAR_REACH` applied (near: the kit's material; far: without its sub-pixel grain).
   * Without them, one kind per bank draws both levels by its cells' distance.
   */
  materials?: { near: Material; far: Material },
): { fallback: StandFrame[]; modules: number; crowd: number } {
  const result = { fallback: [] as StandFrame[], modules: 0, crowd: 0 };
  // One geometry per kit model and bank height, shared by every stand: the stand's footprint fit
  // is a per-instance stretch, never baked into geometry (a copy per stand cost hundreds of MiB).
  const kinds = new Map<string, string[]>();
  const kindsFor = (kitId: string, bank: number): string[] => {
    const key = `${kitId}-${bank}`;
    let ids = kinds.get(key);
    if (ids) return ids;
    const lods = kit!.lodsFor(kitId, {
      maxDistanceScale: 2.7,
      distanceCaps: [8, STAND_NEAR_REACH, 1200],
      slotColors: { seat: [1, 1, 1] },
    })!;
    const rise = bank * 4.2;
    if (rise > 0)
      for (const lod of lods) {
        const positions = lod.geometry.getAttribute('position');
        // Extend the bottom columns and fascia down to the ground under a raised bank.
        for (let v = 0; v < positions.count; v++) {
          const y = positions.getY(v);
          if (y < 1.6) positions.setY(v, y - rise * (1 - Math.max(0, y) / 1.6));
        }
        lod.geometry.computeBoundingSphere();
      }
    const id = `stand-kit-${key}`;
    if (!materials) {
      // Shadows from the far level, in the shadow pass only, to 100 m.
      props.define({
        id,
        lods,
        gridCell: 40,
        castShadow: shadows,
        shadowMaxDistance: 100,
        shadowLevel: lods.length - 1,
      });
      ids = [id];
    } else {
      // Two kinds over the same modules, split per module at STAND_NEAR_REACH in the vertex
      // stage. Near: the middle level (4,900 to 5,100 triangles a module) in 40 m cells, so
      // only cells within reach draw at all. Far: the far level (1,100 to 1,300) in 200 m cells,
      // a few draw calls for every bank on the circuit (40 m cells for both levels cost Monza's
      // grid about 130 draw calls). The finest level (18,700) is not used: no view comes
      // within its 8 m of a bank.
      const middle = lods[Math.min(1, lods.length - 1)]!;
      const far = lods[lods.length - 1]!;
      for (const lod of lods) if (lod !== middle && lod !== far) lod.geometry.dispose();
      props.define({
        id: `${id}-near`,
        lods: [{ ...middle, material: materials.near, maxDistance: STAND_NEAR_REACH }],
        gridCell: 40,
        castShadow: false,
      });
      // The far kind casts every module's shadow (its depth pass ignores the handover), from
      // the far level, in the shadow pass only, to 100 m.
      props.define({
        id,
        lods: [{ ...far, material: materials.far, maxDistance: 1200 }],
        gridCell: 200,
        castShadow: shadows,
        shadowMaxDistance: 100,
        shadowLevel: 0,
      });
      ids = [`${id}-near`, id];
    }
    kinds.set(key, ids);
    return ids;
  };
  for (const [i, frame] of frames.entries()) {
    if (!kit?.has('grandstand') || (frame.roof && !kit.has('grandstand-roof'))) {
      result.fallback.push(frame);
      continue;
    }
    const banks = Math.max(1, Math.round(frame.rows / 10));
    const n = Math.max(1, Math.round(frame.length / 10));
    const pitch = frame.length / n;
    const sx = frame.depth / (9.47 + (banks - 1) * 8.5);
    const sz = pitch / 10;
    const yaw = Math.atan2(frame.bz, -frame.bx);
    for (let bank = 0; bank < banks; bank++) {
      const kitId = frame.roof && bank === banks - 1 ? 'grandstand-roof' : 'grandstand';
      const entry = kit.entries.get(kitId)!;
      const ids = kindsFor(kitId, bank);
      const rise = bank * 4.2;
      for (let module = 0; module < n; module++) {
        const depth = (4.76 + bank * 8.5) * sx;
        const x = frame.ox + frame.ax * ((module + 0.5) * pitch) + frame.bx * depth;
        const z = frame.oz + frame.az * ((module + 0.5) * pitch) + frame.bz * depth;
        const y = frame.base + rise;
        const placement = { x, y, z, yaw, stretch: [sx, 1, sz] as const, s: frame.s };
        for (const id of ids) props.place(id, { ...placement, colour: frame.seat });
        result.modules++;
        for (const [row, marker] of (entry.attachments ?? [])
          .filter((a) => a.name.startsWith('crowd-row-'))
          .entries()) {
          for (let j = 0; j < (marker.count ?? 0); j++) {
            const k = i * 1000000 + bank * 100000 + module * 1000 + row * 30 + j;
            if (hash01(k, 77) > occupancy(frame, bank * 10 + row)) continue;
            const lx = marker.position[0] * sx;
            const lz = (marker.position[2] + j * (marker.spacing ?? 0.55)) * sz;
            spectator({
              x: x - frame.bx * lx + frame.ax * lz,
              y: y + marker.position[1],
              z: z - frame.bz * lx + frame.az * lz,
              yaw,
              s: frame.s,
              k,
              near: true,
            });
            result.crowd++;
          }
        }
      }
    }
  }
  return result;
}
