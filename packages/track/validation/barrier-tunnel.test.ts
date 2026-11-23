import { addCar, createCarParams, createWallSample, createWorld, stepWorld } from '@undercut/sim';
import { describe, expect, it } from 'vitest';
import monza from '../data/monza.json';
import singapore from '../data/singapore.json';
import spa from '../data/spa.json';
import { createVec3 } from '../src/path';
import { TrackSurface } from '../src/surface';
import { Track } from '../src/track';

// Review of PR 58: at Singapore s 153 a car aimed 70° at the left barrier at 100 km/h came out
// in the pit lane behind it. Pit walls are the only barriers with a far side. Every 20 m along
// each circuit's pit wall, a car with its centre on the track, 1.5 m off the edge (or 1.2 m
// short of the face where the wall is closer), is aimed at it, and its centre's path must
// never cross wall: checked at tenths of each tick's travel.
const CIRCUITS = [
  ['monza', monza],
  ['spa', spa],
  ['singapore', singapore],
] as const;
const ANGLES = [30, 60, 90];
const SPEEDS = [100, 250];

describe('no car passes through a pit wall', () => {
  for (const [name, data] of CIRCUITS) {
    it(`${name}: every pit-wall station, ${ANGLES.join('/')}°, ${SPEEDS.join('/')} km/h`, () => {
      const track = Track.fromJSON(data);
      const surface = new TrackSurface(track, { breakables: false });
      const side = track.pitSide;
      const sign = side === 0 ? 1 : -1;
      const p = createVec3();
      const t = createVec3();
      const w = createWallSample();
      const through: string[] = [];
      let runs = 0;
      for (let s = 0; s < track.length; s += 20) {
        const i = track.lap.sampleIndex(s);
        if (track.pitNear[i]! < 0) continue;
        const face = track.barrierAt(s, side);
        const d = Math.min(track.halfWidth[side][i]! + 1.5, face - 1.2);
        if (d <= track.halfWidth[side][i]!) continue;
        track.lap.pointAt(s, sign * d, p);
        surface.wall(p.x, p.z, { index: -1 }, w);
        if (w.depth > -0.5) continue; // no track-side room in front of the wall here
        track.lap.tangent(s, t);
        for (const angle of ANGLES) {
          for (const kmh of SPEEDS) {
            const world = createWorld({ step: 1 / 240, seed: 1, surface });
            const car = addCar(world, createCarParams('low'), {
              x: p.x,
              z: p.z,
              yaw: Math.atan2(-t.z, t.x) + (sign * angle * Math.PI) / 180,
              speed: kmh / 3.6,
            });
            car.input.throttle = 0.6;
            let px = car.state.x;
            let pz = car.state.z;
            let worst = 0;
            for (let k = 0; k < 480; k++) {
              stepWorld(world);
              const st = car.state;
              for (let f = 1; f <= 10; f++) {
                surface.wall(
                  px + ((st.x - px) * f) / 10,
                  pz + ((st.z - pz) * f) / 10,
                  { index: -1 },
                  w,
                );
                worst = Math.max(worst, w.depth);
              }
              px = st.x;
              pz = st.z;
            }
            runs++;
            if (worst > 0.05)
              through.push(`s ${s} ${angle}° ${kmh} km/h: ${worst.toFixed(2)} m in`);
          }
        }
      }
      expect(runs).toBeGreaterThan(20);
      expect(through).toEqual([]);
    });
  }
});
