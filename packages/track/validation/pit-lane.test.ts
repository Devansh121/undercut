import {
  SurfaceKind,
  addCar,
  checkCarInvariants,
  createCarParams,
  createSurfaceSample,
  createWorld,
  invariantLimits,
  stepWorld,
} from '@undercut/sim';
import { describe, expect, it } from 'vitest';
import monza from '../data/monza.json';
import { createPathPoint, createVec3 } from '../src/path';
import { TrackSurface } from '../src/surface';
import { Track } from '../src/track';
import { STEP } from './drive-fuzz';

/**
 * A car must be able to drive into the pit lane, down it and back out onto the track with the
 * barriers in place. A pure-pursuit driver follows the lap's centreline to the pit entry, the
 * pit lane's centreline to its end, and the lap again after the exit.
 */
describe('pit lane at Monza with barriers', () => {
  const track = Track.fromJSON(monza);
  const pit = track.pit;

  it('drives in, along and out without touching a barrier', () => {
    const surface = new TrackSurface(track);
    const world = createWorld({ step: STEP, seed: 1, surface });
    const start = track.wrap(pit.entryS - 150);
    const p = createVec3();
    const t = createVec3();
    track.lap.pointAt(start, 0, p);
    track.lap.tangent(start, t);
    const car = addCar(world, createCarParams('low'), {
      x: p.x,
      z: p.z,
      yaw: Math.atan2(-t.z, t.x),
      speed: 20,
    });
    const limits = invariantLimits(car.state.model);
    const q = createPathPoint();
    const lapHint = { index: -1 };
    const pitHint = { index: -1 };
    // Phases: 0 on the lap before the entry, 1 in the pit lane, 2 on the lap after the exit.
    let phase = 0;
    let sPit = 0;
    let contact = 0;
    let broken: string | null = null;
    let onLaneAtMid = false;
    const sample = createSurfaceSample();
    for (let k = 0; k < 120 / STEP && phase < 3; k++) {
      const st = car.state;
      const lapS = track.project(st.x, st.z, lapHint, q).s;
      if (phase === 0 && track.forwardDistance(lapS, pit.entryS) < 1) phase = 1;
      if (phase === 1) {
        sPit = pit.path.project(st.x, st.z, pitHint, q).s;
        if (sPit >= pit.length - 1) phase = 2;
        if (Math.abs(sPit - pit.length / 2) < 1) {
          surface.sample(st.x, st.z, { index: -1 }, sample);
          onLaneAtMid = sample.kind === SurfaceKind.PitLane;
        }
      }
      if (
        phase === 2 &&
        track.forwardDistance(pit.exitS, lapS) > 150 &&
        track.forwardDistance(pit.exitS, lapS) < 1000
      )
        phase = 3;
      // Aim 8 m ahead on the path being followed.
      if (phase === 1) pit.path.pointAt(Math.min(sPit + 8, pit.length), 0, p);
      else track.lap.pointAt(lapS + 8, 0, p);
      const want = Math.atan2(-(p.z - st.z), p.x - st.x);
      let err = want - st.yaw;
      if (err > Math.PI) err -= 2 * Math.PI;
      else if (err < -Math.PI) err += 2 * Math.PI;
      const delta = Math.atan((2 * 3.6 * Math.sin(err)) / 8);
      car.input.steer = Math.max(-1, Math.min(1, delta / car.state.params.geometry.maxSteerAngle));
      const target = phase === 1 ? pit.speedLimit - 2 : 25;
      car.input.throttle = Math.max(0, Math.min(1, (target - st.vx) * 0.5));
      car.input.brake = Math.max(0, Math.min(1, (st.vx - target - 1) * 0.3));
      stepWorld(world);
      if (st.wallContact) contact++;
      broken ??= checkCarInvariants(st, limits);
    }
    expect(phase).toBe(3);
    expect(onLaneAtMid).toBe(true);
    expect(contact).toBe(0);
    expect(broken).toBeNull();
  });
});
