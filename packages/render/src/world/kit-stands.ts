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

/** Tile human-scale ten-row banks into the mapped footprint; rear banks step up by ten risers. */
export function placeKitStands(
  frames: readonly StandFrame[],
  kit: PropKitAssets | null | undefined,
  props: PropRegistry,
  crowd: number,
  shadows: boolean,
  spectator: (seat: KitSpectator) => void,
): { fallback: StandFrame[]; modules: number; crowd: number } {
  const result = { fallback: [] as StandFrame[], modules: 0, crowd: 0 };
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
      const lods = kit.lodsFor(kitId, {
        maxDistanceScale: 2.7,
        distanceCaps: [8, 80, 1200],
        slotColors: { seat: [1, 1, 1] },
      })!;
      const rise = bank * 4.2;
      for (const lod of lods) {
        const positions = lod.geometry.getAttribute('position');
        // Extend the bottom columns and fascia down to the ground under a raised bank.
        for (let v = 0; v < positions.count; v++) {
          const y = positions.getY(v);
          if (y < 1.6) positions.setY(v, y - rise * (1 - Math.max(0, y) / 1.6));
        }
        lod.geometry.scale(sx, 1, sz);
        lod.geometry.computeBoundingSphere();
      }
      const id = `stand-kit-${i}-${bank}`;
      props.define({ id, lods, gridCell: 50, castShadow: shadows, shadowMaxDistance: 240 });
      for (let module = 0; module < n; module++) {
        const depth = (4.76 + bank * 8.5) * sx;
        const x = frame.ox + frame.ax * ((module + 0.5) * pitch) + frame.bx * depth;
        const z = frame.oz + frame.az * ((module + 0.5) * pitch) + frame.bz * depth;
        const y = frame.base + rise;
        props.place(id, { x, y, z, yaw, s: frame.s, colour: frame.seat });
        result.modules++;
        for (const [row, marker] of (entry.attachments ?? [])
          .filter((a) => a.name.startsWith('crowd-row-'))
          .entries()) {
          for (let j = 0; j < (marker.count ?? 0); j++) {
            const k = i * 1000000 + bank * 100000 + module * 1000 + row * 30 + j;
            if (hash01(k, 77) > crowd * 0.85) continue;
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
