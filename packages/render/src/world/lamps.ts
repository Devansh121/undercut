import type { Track } from '@undercut/track';
import { bakeLampMap, type LampMap } from '../lighting/lamp-map';
import type { LocalLight } from '../lighting/light-pool';
import { receivingHeight } from './corridor';
import type { LapIndex } from './lap-index';

/** The baked lamp map's cell (m) and how far it reaches past the lap's box (m). */
export const LAMP_MAP_CELL = 2;
export const LAMP_MAP_MARGIN = 120;

/**
 * The ground a street circuit's furniture stands on and its lamps light: the track's own ground
 * by the track (a mast beside a bridge stands on the deck, not on the water's banks below it),
 * the terrain beyond. The world places the street kit on it and the view bakes the lamp map on
 * it, so the banks and the surfaces they light agree.
 */
export function streetGround(
  track: Track,
  lap: LapIndex,
  terrainAt: (x: number, z: number) => number,
): (x: number, z: number) => number {
  return receivingHeight(track, lap, terrainAt);
}

/** The circuit's lamp map: every bank baked over the lap's box, on the street ground. */
export function bakeCircuitLamps(
  track: Track,
  lap: LapIndex,
  terrainAt: (x: number, z: number) => number,
  lights: readonly LocalLight[],
): LampMap {
  const l = track.lap;
  let x0 = Infinity;
  let z0 = Infinity;
  let x1 = -Infinity;
  let z1 = -Infinity;
  for (let i = 0; i < l.count; i++) {
    x0 = Math.min(x0, l.x[i] as number);
    x1 = Math.max(x1, l.x[i] as number);
    z0 = Math.min(z0, l.z[i] as number);
    z1 = Math.max(z1, l.z[i] as number);
  }
  const m = LAMP_MAP_MARGIN;
  return bakeLampMap(
    lights,
    [x0 - m, z0 - m, x1 + m, z1 + m],
    LAMP_MAP_CELL,
    streetGround(track, lap, terrainAt),
  );
}
