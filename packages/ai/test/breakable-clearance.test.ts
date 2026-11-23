import { BODY_NOSE, BODY_TAIL, touchesBreakable } from '@undercut/sim';
import { Track, createVec3, tracksideObjects } from '@undercut/track';
import monza from '@undercut/track/data/monza.json';
import singapore from '@undercut/track/data/singapore.json';
import spa from '@undercut/track/data/spa.json';
import { describe, expect, it } from 'vitest';
import monzaLine from '../data/monza-low.line.json';
import singaporeLine from '../data/singapore-high.line.json';
import spaLine from '../data/spa-medium.line.json';
import { decodeRacingLine } from '../src/export/racing-line';

/** CoG to front and rear axle, generous for every trim, m. */
const AXLE_FRONT = 2.2;
const AXLE_REAR = 1.8;
/** Extra room kept round each object's footprint, m. */
const MARGIN = 0.5;

const CIRCUITS = [
  ['monza', monza, monzaLine],
  ['spa', spa, spaLine],
  ['singapore', singapore, singaporeLine],
] as const;

describe('light trackside objects stand clear of the racing line', () => {
  for (const [name, data, raw] of CIRCUITS) {
    it(`${name}: the reference line's footprint touches no breakable object`, () => {
      const track = Track.fromJSON(data);
      const line = decodeRacingLine(raw);
      const p = createVec3();
      const ahead = createVec3();
      const at = (s: number, out: typeof p): void => {
        const w = ((s % track.length) + track.length) % track.length;
        const i = Math.round(w / line.step) % line.count;
        track.lap.pointAt(w, line.offsetTenthMm[i]! / 10000, out);
      };
      const hits: string[] = [];
      const objects = tracksideObjects(track);
      expect(objects.length).toBeGreaterThan(0);
      for (const o of objects) {
        const grown = { ...o, halfWidth: o.halfWidth + MARGIN, halfDepth: o.halfDepth + MARGIN };
        for (let ds = -8; ds <= 8; ds += 0.25) {
          at(o.s + ds, p);
          at(o.s + ds + 1, ahead);
          const car = { x: p.x, z: p.z, yaw: Math.atan2(-(ahead.z - p.z), ahead.x - p.x) };
          if (touchesBreakable(grown, car, AXLE_FRONT + BODY_NOSE, AXLE_REAR + BODY_TAIL)) {
            hits.push(`${o.kind} id ${o.id} at s ${o.s.toFixed(0)}`);
            break;
          }
        }
      }
      expect(hits).toEqual([]);
    });
  }
});
