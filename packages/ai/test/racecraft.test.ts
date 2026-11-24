import { describe, expect, it } from 'vitest';
import { mirrorLane } from '../src/driver/racecraft';
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
