import { describe, expect, it } from 'vitest';
import { createCarPose } from '@undercut/sim';
import type { RemoteCarView } from '@undercut/protocol';
import { STEER_LOCK, poseFromView, toSnapshot, type LocalCar } from '../../src/online/car-state';

function local(over: Partial<LocalCar> = {}): LocalCar {
  const prev = createCarPose();
  const pose = createCarPose();
  prev.x = 10;
  prev.z = 5;
  prev.yaw = 0.1;
  pose.x = 10 + 50 / 240;
  pose.z = 5 - 20 / 240;
  pose.y = 0.3;
  pose.yaw = 0.1 + 0.5 / 240;
  pose.steerAngle = STEER_LOCK / 2;
  return {
    seat: 3,
    tick: 1200,
    t: 1_700_000_000_000,
    pose,
    prevPose: prev,
    step: 1 / 240,
    speed: 53.85,
    rpm: 11000,
    gear: 6,
    throttle: 1,
    brake: 0,
    wheelSpin: [100, 101, 102, 103],
    drs: false,
    lap: 2,
    s: 1234.5,
    resets: 1,
    ...over,
  };
}

describe('toSnapshot', () => {
  it('sends the word of the broken set that its cursor names', () => {
    const pose = createCarPose();
    pose.brokenObjects![7] = 0xfffffffe;
    const snap = toSnapshot(local({ pose, brokenCursor: 71 }));
    expect(snap.brokenIndex).toBe(7);
    expect(snap.brokenWord).toBe(0xfffffffe);
  });

  it('takes world velocity and yaw rate from the last sim step', () => {
    const snap = toSnapshot(local());
    expect(snap.vx).toBeCloseTo(50, 6);
    expect(snap.vz).toBeCloseTo(-20, 6);
    expect(snap.vy).toBeCloseTo(0.3 * 240, 6);
    expect(snap.yawRate).toBeCloseTo(0.5, 6);
    expect(snap.steer).toBeCloseTo(0.5, 9);
    expect(snap.seat).toBe(3);
    expect(snap.lap).toBe(2);
    expect(snap.s).toBe(1234.5);
    expect(snap.resets).toBe(1);
    expect(snap.wheelSpin).toEqual([100, 101, 102, 103]);
  });

  it('wraps the yaw rate across the seam at pi', () => {
    const c = local();
    c.prevPose.yaw = Math.PI - 0.001;
    c.pose.yaw = -Math.PI + 0.001;
    expect(toSnapshot(c).yawRate).toBeCloseTo(0.002 * 240, 6);
  });

  it('does not turn a placement into a huge velocity', () => {
    const c = local();
    c.pose.x = c.prevPose.x + 400;
    const snap = toSnapshot(c);
    expect(Math.hypot(snap.vx, snap.vy, snap.vz)).toBe(0);
    expect(snap.yawRate).toBe(0);
  });

  it('marks DRS open in the flags', () => {
    expect(toSnapshot(local({ drs: true })).flags & 1).toBe(1);
    expect(toSnapshot(local({ drs: false })).flags & 1).toBe(0);
  });

  it('resets counter stays in 0..3', () => {
    expect(toSnapshot(local({ resets: 6 })).resets).toBe(2);
  });
});

describe('poseFromView', () => {
  it('places the car and spins its wheels by the time passed', () => {
    const snap = toSnapshot(local());
    const view: RemoteCarView = { ...snap, mode: 'interpolated', opacity: 1, aheadMs: 0 };
    const out = createCarPose();
    out.wheelAngle.fill(1);
    poseFromView(view, [0.35, 0.35, 0.36, 0.36], 0.1, out);
    expect(out.x).toBe(snap.x);
    expect(out.y).toBe(snap.y);
    expect(out.yaw).toBe(snap.yaw);
    expect(out.steerAngle).toBeCloseTo(STEER_LOCK / 2, 9);
    expect(out.wheelY[0]).toBeCloseTo(snap.y + 0.35, 9);
    expect(out.wheelY[3]).toBeCloseTo(snap.y + 0.36, 9);
    expect(out.wheelAngle[0]).toBeCloseTo((1 + 100 * 0.1) % (2 * Math.PI), 9);
  });
});
