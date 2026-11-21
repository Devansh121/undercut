import { createCarParams, createCarState } from '@undercut/sim';
import { LEFT, RIGHT, TrackSurface, createVec3 } from '@undercut/track';
import { describe, expect, it } from 'vitest';
import { TrackLimits } from '../src/game/limits';
import { loadMonza } from './fixtures';

const track = loadMonza();
const surface = new TrackSurface(track);
const params = createCarParams('low');

/** A car at rest at (s, d), facing along the lap. */
function carAt(s: number, d: number) {
  const p = track.pointAt(s, d, createVec3());
  const t = track.tangentAt(s, createVec3());
  return createCarState(params, { x: p.x, z: p.z, yaw: Math.atan2(-t.z, t.x), surface });
}

describe('TrackLimits', () => {
  const limits = new TrackLimits(track);
  // The middle of the main straight: plain asphalt, straight edges.
  const s = 300;

  it('counts no wheels off on the centreline', () => {
    expect(limits.wheelsOff(carAt(s, 0))).toBe(0);
  });

  it('counts two wheels off with one side of the car over the line', () => {
    const hw = track.halfWidthAt(s, LEFT);
    // Car centre 0.6 m past the left edge: the left wheels (0.81 m out) are fully over it.
    expect(limits.wheelsOff(carAt(s, hw + 0.6))).toBe(2);
  });

  it('counts all four off once the inner tyres clear the line, and none while a tyre touches it', () => {
    const hw = track.halfWidthAt(s, RIGHT);
    // Inner (left) wheels at d = -(hw + 1.2 - 0.81) = -(hw + 0.39): tyre inner edge 0.19 m past.
    expect(limits.wheelsOff(carAt(s, -(hw + 1.2)))).toBe(4);
    // Inner wheels' centres just past the line but their tyres still on the paint.
    expect(limits.wheelsOff(carAt(s, -(hw + 0.9)))).toBe(2);
  });

  it('works on both sides of the start/finish line', () => {
    const hw = track.halfWidthAt(5792, LEFT);
    expect(limits.wheelsOff(carAt(5792, hw + 1.6))).toBe(4);
    expect(limits.wheelsOff(carAt(1, 0))).toBe(0);
  });
});
