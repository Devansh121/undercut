import { addCar, createCarParams, createWallSample, createWorld, stepWorld } from '@undercut/sim';
import { describe, expect, it } from 'vitest';
import spa from '../data/spa.json';
import { createVec3 } from '../src/path';
import { TrackSurface } from '../src/surface';
import { Track } from '../src/track';

describe('a car whose centre is inside a pit wall', () => {
  it('is pushed out by the nearest face, as without a reference point (Spa s 400, d −14.07)', () => {
    const track = Track.fromJSON(spa);
    const surface = new TrackSurface(track, { breakables: false });
    const p = createVec3();
    const t = createVec3();
    track.lap.pointAt(400, -14.07, p);
    track.lap.tangent(400, t);
    const w = createWallSample();
    surface.wall(p.x, p.z, { index: -1 }, w);
    expect(w.depth).toBeGreaterThan(0);
    const world = createWorld({ step: 1 / 240, seed: 1, surface });
    const car = addCar(world, createCarParams('low'), {
      x: p.x,
      z: p.z,
      yaw: Math.atan2(-t.z, t.x),
      speed: 0,
    });
    let contact = 0;
    for (let k = 0; k < 240; k++) {
      stepWorld(world);
      contact += car.state.wallContact;
    }
    expect(contact).toBeGreaterThan(0);
    surface.wall(car.state.x, car.state.z, { index: -1 }, w);
    expect(w.depth).toBeLessThanOrEqual(0);
  });
});
