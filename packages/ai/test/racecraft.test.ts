import { describe, expect, it } from 'vitest';
import {
  brakingTraffic,
  carNear,
  mirrorLane,
  mirrorOffset,
  roomLane,
} from '../src/driver/racecraft';
import { createTrafficView } from '../src/driver/traffic';

function traffic(s = 100) {
  const view = createTrafficView(1);
  Object.assign(view.self, { id: 0, s, d: -3, speed: 60 });
  Object.assign(view.cars[0]!, { id: 1, s: s - 14, d: 0, speed: 75 });
  view.count = 1;
  return view;
}

describe('lane changes with closing traffic', () => {
  it('leaves the approaching car its lane before pulling out or returning', () => {
    expect(mirrorLane(traffic(), 3, 1000, 0.15)).toBeLessThanOrEqual(-2.8);
  });
  it('checks the swept path when the destination is beyond the other lane', () => {
    expect(mirrorLane(traffic(), 5, 1000, 0.15)).toBeLessThanOrEqual(-2.8);
  });
  it('does not move toward a car already too close to the side', () => {
    const view = traffic();
    view.self.d = -2;
    expect(mirrorLane(view, 3, 1000, 0.15)).toBe(-2);
  });
  it('allows a move away, or with time to complete before the rear car arrives', () => {
    const view = traffic();
    expect(mirrorLane(view, -5, 1000, 0.15)).toBe(-5);
    view.cars[0]!.speed = 61;
    view.cars[0]!.s = 65;
    expect(mirrorLane(view, 3, 1000, 0.15)).toBe(3);
  });
  it('looks across the start line too', () => {
    const view = traffic(5);
    view.cars[0]!.s = 991;
    expect(mirrorLane(view, 3, 1000, 0.15)).toBeLessThanOrEqual(-2.8);
  });
});

describe('one defensive move per straight', () => {
  it('holds its chosen side when the attacker changes sides or falls back', async () => {
    const { defensiveLane } = await import('../src/driver/racecraft');
    const view = traffic();
    view.cars[0]!.s = 70;
    const state = { lane: 0, used: false };
    const lane = defensiveLane(view, state, 1, false, false, -4, 4);
    expect(lane).toBeGreaterThan(0);
    view.cars[0]!.d = -5;
    expect(defensiveLane(view, state, -1, false, false, -4, 4)).toBe(lane);
    view.count = 0;
    expect(defensiveLane(view, state, -1, false, false, -4, 4)).toBe(lane);
  });
  it('starts no move under braking and resets only after the corner', async () => {
    const { defensiveLane } = await import('../src/driver/racecraft');
    const state = { lane: 0, used: false };
    expect(defensiveLane(traffic(), state, 1, true, false, -4, 4)).toBe(0);
    const view = traffic();
    view.cars[0]!.s = 70;
    defensiveLane(view, state, 1, false, false, -4, 4);
    expect(state.used).toBe(true);
    defensiveLane(traffic(), state, 1, true, true, -4, 4);
    expect(state.used).toBe(false);
  });
});

describe('racing room for an overlapping car', () => {
  // Self at d = 3 on the outside of a left-hand sweep; the other car on the inside at d = -1.
  function pair(ds: number, d = -1) {
    const view = createTrafficView(1);
    Object.assign(view.self, { id: 0, s: 500, d: 3, speed: 30 });
    Object.assign(view.cars[0]!, { id: 1, s: 500 + ds, d, speed: 31, halfWidth: 1 });
    view.count = 1;
    return view;
  }
  it("leaves a car's width to a car overlapping from behind, front wheels level with the rear wheels", () => {
    const lane = roomLane(pair(-3.5), -4, 1000);
    expect(lane).toBeGreaterThanOrEqual(-1 + 2.6);
    expect(lane).toBeLessThanOrEqual(3);
  });
  it('does not cut back across a car it has overlapped from behind, on giving up a move', () => {
    expect(roomLane(pair(3), -4, 1000)).toBeGreaterThanOrEqual(-1 + 2.6);
  });
  it('holds its lane rather than move toward a car already closer than the room', () => {
    expect(roomLane(pair(-2, 1.5), -4, 1000)).toBe(3);
  });
  it('takes its line once the other car has no overlap', () => {
    expect(roomLane(pair(-3.7), -4, 1000)).toBe(-4);
    expect(roomLane(pair(3.7), -4, 1000)).toBe(-4);
  });
  it('lets a car move away from the overlapping car', () => {
    expect(roomLane(pair(-2), 6, 1000)).toBe(6);
  });
  it('looks across the start line too', () => {
    const view = pair(0);
    view.self.s = 1;
    view.cars[0]!.s = 998.5;
    expect(roomLane(view, -4, 1000)).toBeGreaterThanOrEqual(1.6);
  });
});

describe('a car near', () => {
  it('is within the range ahead or behind, moving, across the start line too', () => {
    const view = createTrafficView(1);
    Object.assign(view.self, { id: 0, s: 5, d: 0, speed: 50 });
    Object.assign(view.cars[0]!, { id: 1, s: 990, d: 4, speed: 50 });
    view.count = 1;
    expect(carNear(view, 1000, 20)).toBe(true);
    view.cars[0]!.s = 980;
    expect(carNear(view, 1000, 20)).toBe(false);
    view.cars[0]!.s = 15;
    view.cars[0]!.speed = 0;
    expect(carNear(view, 1000, 20)).toBe(false);
  });
});

describe('traffic that constrains a braking lane', () => {
  it('holds for a car behind or overlapping, but allows dropping behind a car already ahead', () => {
    const view = traffic();
    expect(brakingTraffic(view, 1000)).toBe(true);
    view.cars[0]!.s = 103;
    expect(brakingTraffic(view, 1000)).toBe(true);
    view.cars[0]!.s = 108;
    expect(brakingTraffic(view, 1000)).toBe(false);
  });
  it('ignores a stopped car and wraps at the timing line', () => {
    const view = traffic(5);
    view.cars[0]!.s = 991;
    expect(brakingTraffic(view, 1000)).toBe(true);
    view.cars[0]!.speed = 0;
    expect(brakingTraffic(view, 1000)).toBe(false);
  });
});

it('allows falling in behind the forward car when another car is also behind', () => {
  const view = createTrafficView(2);
  Object.assign(view.self, { id: 0, s: 100, d: -3, speed: 60 });
  Object.assign(view.cars[0]!, { id: 1, s: 86, d: 0, speed: 60 });
  Object.assign(view.cars[1]!, { id: 2, s: 108, d: 0, speed: 60 });
  view.count = 2;
  expect(brakingTraffic(view, 1000)).toBe(false);
});

describe('mirror clearance while the racing line sweeps', () => {
  it('constrains the current road lane as well as the half-second preview', () => {
    const view = traffic();
    Object.assign(view.self, { s: 50, d: 3.3, speed: 28 });
    Object.assign(view.cars[0]!, { s: 38, d: 5.4, speed: 46 });
    // Returning an offset against only the future line would move left into the rear car now.
    const offset = mirrorOffset(view, 6, 1000, 0.2, -0.3, -0.8);
    expect(offset - 0.3).toBeLessThanOrEqual(view.self.d);
  });
  it('retains the preview constraint when the present road lane alone is clear', () => {
    const view = traffic();
    Object.assign(view.self, { s: 50, d: -3, speed: 50 });
    Object.assign(view.cars[0]!, { s: 36, d: 0, speed: 65 });
    const offset = mirrorOffset(view, 0, 1000, 0.2, -3, 0);
    expect(offset).toBeLessThanOrEqual(-2.8);
  });
});

describe('clearance when returning behind a slower car', () => {
  it('does not cross the forward car corridor before the closing gap permits it', () => {
    const view = traffic();
    Object.assign(view.self, { s: 100, d: 4, speed: 34 });
    Object.assign(view.cars[0]!, { s: 115, d: 0, speed: 24 });
    expect(mirrorOffset(view, 0, 1000, 0.2, 0, 0)).toBeGreaterThanOrEqual(2.8);
  });
  it('allows falling in behind a car that is pulling away', () => {
    const view = traffic();
    Object.assign(view.self, { s: 100, d: 4, speed: 24 });
    Object.assign(view.cars[0]!, { s: 115, d: 0, speed: 34 });
    expect(mirrorOffset(view, 0, 1000, 0.2, 0, 0)).toBe(0);
  });
});
