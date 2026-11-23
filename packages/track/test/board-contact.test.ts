import { describe, expect, it } from 'vitest';
import {
  createWallSample,
  createCarState,
  createCarParams,
  createEnvironment,
  stepCar,
  NEUTRAL_INPUT,
} from '@undercut/sim';
import monza from '../data/monza.json';
import { Track, TrackSurface, createVec3, tracksideObjects } from '../src/index';

const track = Track.fromJSON(monza);
describe('dressing and contact agree', () => {
  it('has no invisible wall across the offset jumps omitted from the drawn barrier', () => {
    const surface = new TrackSurface(track);
    const p = createVec3(),
      w = createWallSample();
    let gaps = 0;
    for (const side of [0, 1] as const) {
      for (let i = 0; i < track.lap.count; i++) {
        const j = track.lap.next(i);
        const a = track.barrier[side][i]!,
          b = track.barrier[side][j]!;
        if (Math.abs(a - b) <= 2) continue;
        const s = (i + 0.5) * track.lap.step;
        track.lap.pointAt(s, (side === 0 ? 1 : -1) * ((a + b) / 2 + 0.1), p);
        surface.wall(p.x, p.z, { index: -1 }, w);
        expect(w.depth, `side ${side}, s ${s}`).toBeLessThanOrEqual(0);
        gaps++;
      }
    }
    expect(gaps).toBeGreaterThan(0);
  });
  it('places reachable breakable verge boards inside solid walls', () => {
    const surface = new TrackSurface(track);
    const w = createWallSample();
    const boards = tracksideObjects(track).filter((o) => o.kind === 'verge-board');
    expect(boards.length).toBeGreaterThan(50);
    for (const b of boards) {
      surface.wall(b.x, b.z, { index: -1 }, w);
      expect(w.depth, `board ${b.id} at ${b.s}`).toBeLessThan(-3.5);
    }
  });
  it('continues through a left verge board beside the screen and catch fence at the screenshot station without a reset', () => {
    const surface = new TrackSurface(track);
    const b = tracksideObjects(track).find((o) => o.kind === 'verge-board' && o.s === 1800)!;
    expect(b).toBeDefined();
    const p = createVec3(),
      t = createVec3();
    track.lap.tangent(b.s, t);
    p.x = b.x - t.x * 8;
    p.z = b.z - t.z * 8;
    const car = createCarState(createCarParams('low'), {
      x: p.x,
      z: p.z,
      yaw: Math.atan2(-t.z, t.x),
      speed: 25,
      surface,
    });
    const env = createEnvironment();
    for (let i = 0; i < 120; i++) stepCar(car, NEUTRAL_INPUT, surface, 1 / 240, env);
    expect(car.brokenObjects[b.id >>> 5]! & (1 << (b.id & 31))).not.toBe(0);
    expect(Math.hypot(car.vx, car.vy)).toBeGreaterThan(20);
    expect(car.wallContact).toBe(0);
  });
});
