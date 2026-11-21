import {
  addCar,
  bodyCorners,
  checkCarInvariants,
  createCarParams,
  createWallSample,
  createWorld,
  invariantLimits,
  stepWorld,
  type SurfaceSampler,
  type WorldCar,
} from '@undercut/sim';
import { describe, expect, it } from 'vitest';
import monza from '../data/monza.json';
import { createPathPoint, createVec3 } from '../src/path';
import { TrackSurface } from '../src/surface';
import { LEFT, RIGHT, Track } from '../src/track';

const track = Track.fromJSON(monza);
const STEP = 1 / 240;

/** Deepest body corner behind a barrier, m (negative: all corners on the drivable side). */
function deepestCorner(surface: TrackSurface, car: WorldCar): number {
  const corners = bodyCorners(car.state, new Float64Array(8));
  const w = createWallSample();
  let worst = -Infinity;
  for (let k = 0; k < 4; k++) {
    surface.wall(corners[2 * k]!, corners[2 * k + 1]!, { index: -1 }, w);
    worst = Math.max(worst, w.depth);
  }
  return worst;
}

/**
 * The owner's run on master 670438a: last grid slot, 30 m/s, wheel straight, full throttle,
 * 240 Hz. The car leaves the track left of the run to the first chicane; on master it crossed
 * the barrier line, met a 2 m step in the ground and was thrown hundreds of metres up.
 */
function ownersRun(surface: SurfaceSampler, seconds: number, each: (car: WorldCar) => void): void {
  const slot = track.gridSlots[track.gridSlots.length - 1]!;
  const world = createWorld({ step: STEP, seed: 1, surface });
  const car = addCar(world, createCarParams('low'), {
    x: slot.x,
    z: slot.z,
    yaw: slot.yaw,
    speed: 30,
    fuel: 30,
  });
  car.input.steer = 0;
  car.input.throttle = 1;
  for (let t = 0; t < seconds / STEP; t++) {
    stepWorld(world);
    each(car);
  }
}

describe('the owner’s off-track run at Monza', () => {
  it('stops at the barrier and keeps a bounded pose for the whole 40 s', () => {
    const surface = new TrackSurface(track);
    let broken: string | null = null;
    let deepest = -Infinity;
    let impact = 0;
    let limits: ReturnType<typeof invariantLimits> | undefined;
    ownersRun(surface, 40, (car) => {
      limits ??= invariantLimits(car.state.model);
      broken ??= checkCarInvariants(car.state, limits);
      deepest = Math.max(deepest, deepestCorner(surface, car));
      impact = Math.max(impact, car.state.wallImpactSpeed);
    });
    expect(broken).toBeNull();
    // Contact runs every substep: a corner ends a step at most one substep's travel past the
    // face (under 0.1 m at 90 m/s) before it is pushed back.
    expect(deepest).toBeLessThan(0.1);
    expect(impact).toBeGreaterThan(5);
  });

  it('never meets a step in the ground or needs the contact’s last line of defence', () => {
    const surface = new TrackSurface(track);
    let steps = 0;
    let lifts = 0;
    ownersRun(surface, 40, (car) => {
      steps = car.state.groundSteps;
      lifts = car.state.contactLifts;
    });
    expect(steps).toBe(0);
    expect(lifts).toBe(0);
  });

  it('survives the ground beyond the barrier even with the barrier taken away', () => {
    // The vehicle model's own defence, without the walls: out there the ground is not
    // continuous (two legs of a chicane meet), and the pose must still stay bounded.
    const surface = new TrackSurface(track);
    const open: SurfaceSampler = { sample: (x, z, h, o) => surface.sample(x, z, h, o) };
    let broken: string | null = null;
    let limits: ReturnType<typeof invariantLimits> | undefined;
    ownersRun(open, 40, (car) => {
      limits ??= invariantLimits(car.state.model, { surfaceStep: 3 });
      broken ??= checkCarInvariants(car.state, limits);
    });
    expect(broken).toBeNull();
  });
});

describe('barriers at Monza', () => {
  const surface = new TrackSurface(track);
  const w = createWallSample();
  const p = createVec3();

  it('puts every point of the track and run-off on the drivable side', () => {
    for (let s = 0; s < track.length; s += 1) {
      const i = track.lap.sampleIndex(s);
      for (const side of [LEFT, RIGHT] as const) {
        const sign = side === LEFT ? 1 : -1;
        const b = track.barrierAt(s, side);
        for (const u of [0, track.halfWidth[side][i]!, b - 0.3]) {
          track.lap.pointAt(s, sign * u, p);
          surface.wall(p.x, p.z, { index: -1 }, w);
          expect(w.depth, `s ${s} d ${sign * u}`).toBeLessThanOrEqual(0);
        }
      }
    }
  });

  it('puts the barrier line where the data says, facing the track', () => {
    const t = createVec3();
    let checked = 0;
    for (let s = 1; s < track.length; s += 50) {
      for (const side of [LEFT, RIGHT] as const) {
        // Where the barrier runs parallel to the centreline (its face is not slanted).
        const b = track.barrierAt(s, side);
        if (
          Math.abs(track.barrierAt(s + 3, side) - b) + Math.abs(track.barrierAt(s - 3, side) - b) >
          0.01
        )
          continue;
        const sign = side === LEFT ? 1 : -1;
        track.lap.pointAt(s, sign * (b + 1), p);
        surface.wall(p.x, p.z, { index: -1 }, w);
        expect(w.depth).toBeGreaterThan(0.8);
        expect(w.depth).toBeLessThan(1.25);
        // The normal points straight back toward the centreline.
        track.lap.normal(s, t);
        expect(-sign * (w.normalX * t.x + w.normalZ * t.z)).toBeGreaterThan(0.999);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(40);
  });

  it('keeps the whole pit lane drivable, with the pit wall between it and the track', () => {
    const pit = track.pit;
    const q = createPathPoint();
    const gs = pit.side === 'left' ? 1 : -1;
    let walled = 0;
    for (let sp = 0; sp <= pit.length; sp += 0.5) {
      const hwG = pit.halfWidth(sp, gs > 0 ? LEFT : RIGHT);
      const hwT = pit.halfWidth(sp, gs > 0 ? RIGHT : LEFT);
      // Across the lane, from the track side to the garage side: every point a body corner
      // can be at.
      for (let d = -hwT; d <= hwG + 1e-9; d += 0.25) {
        pit.path.pointAt(sp, gs * d, p);
        surface.wall(p.x, p.z, { index: -1 }, w);
        expect(w.depth, `s_pit ${sp} d ${gs * d}`).toBeLessThanOrEqual(1e-9);
      }
      // Between the lane and the lap, along the pit wall: a point 1 m off the lane's track side
      // is behind the wall wherever the lap's barrier runs between them.
      pit.path.pointAt(sp, -gs * (hwT + 1), p);
      track.project(p.x, p.z, { index: -1 }, q);
      const side = q.d >= 0 ? LEFT : RIGHT;
      if (Math.abs(q.d) > track.barrierAt(q.s, side) + 0.5) {
        surface.wall(p.x, p.z, { index: -1 }, w);
        expect(w.depth, `pit wall at s_pit ${sp}`).toBeGreaterThan(0);
        walled++;
      }
    }
    // The pit wall runs along most of the lane.
    expect(walled * 0.5).toBeGreaterThan(300);
  });
});
