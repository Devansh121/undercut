import {
  NEUTRAL_INPUT,
  addCar,
  createCarParams,
  createCarTelemetry,
  createWorld,
  readCarTelemetry,
  stepWorld,
} from '@undercut/sim';
import { describe, expect, it } from 'vitest';
import { PathFollower, type FollowPoint } from '../src/driver/path-follower';

const params = createCarParams('low');

/** Drive the follower on flat ground from rest at the origin facing +X. */
function follow(points: FollowPoint[], stop: boolean, seconds: number, speed = 0) {
  const world = createWorld({ step: 1 / 240, seed: 1 });
  const car = addCar(world, params, { speed, fuel: 10 });
  const f = new PathFollower(params);
  f.setPath(points, stop);
  const tel = createCarTelemetry();
  let maxSpeed = 0;
  let maxMiss = 0;
  for (let k = 0; k < seconds * 240; k++) {
    readCarTelemetry(car.state, tel);
    f.drive(tel, world.step, car.input);
    stepWorld(world);
    maxSpeed = Math.max(maxSpeed, car.state.vx);
    // Off the end of an open path the follower carries straight on: judge it on the path only.
    if (f.remaining() > 5) maxMiss = Math.max(maxMiss, missOf(points, car.state.x, car.state.z));
  }
  return { car, f, maxSpeed, maxMiss };
}

function missOf(points: FollowPoint[], x: number, z: number): number {
  let best = Infinity;
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    const bx = b.x - a.x;
    const bz = b.z - a.z;
    const l2 = bx * bx + bz * bz;
    if (l2 === 0) continue;
    const t = Math.max(0, Math.min(1, ((x - a.x) * bx + (z - a.z) * bz) / l2));
    best = Math.min(best, Math.hypot(a.x + bx * t - x, a.z + bz * t - z));
  }
  return best;
}

describe('PathFollower', () => {
  it('pulls away from rest, holds a speed cap and stops at the end of the path', () => {
    const pts: FollowPoint[] = [];
    for (let x = 0; x <= 300; x += 2) pts.push({ x, z: 0, v: 22 });
    const { car, f, maxSpeed, maxMiss } = follow(pts, true, 25);
    expect(maxSpeed).toBeLessThan(22.5);
    expect(maxSpeed).toBeGreaterThan(20);
    expect(Math.abs(car.state.vx)).toBeLessThan(0.3);
    expect(Math.abs(car.state.x - 300)).toBeLessThan(1);
    expect(f.remaining()).toBeLessThan(1);
    expect(maxMiss).toBeLessThan(0.5);
  });

  it('follows a lane change and a gentle curve within a metre at pit-lane speed', () => {
    const pts: FollowPoint[] = [];
    for (let x = 0; x <= 100; x += 2) pts.push({ x, z: 0, v: Infinity });
    // A 6 m lane change to the right (+z is south, right of travel facing +X), then a curve.
    for (let x = 102; x <= 160; x += 2)
      pts.push({ x, z: (6 * (1 - Math.cos((Math.PI * (x - 100)) / 60))) / 2, v: Infinity });
    for (let a = 0; a <= Math.PI / 2; a += 0.02) {
      pts.push({ x: 160 + 150 * Math.sin(a), z: 6 + 150 * (1 - Math.cos(a)), v: Infinity });
    }
    const capped = pts.map((p) => ({ ...p, v: 22 }));
    const { maxMiss } = follow(capped, false, 18, 20);
    expect(maxMiss).toBeLessThan(1);
  });

  it('caps speed through tight curvature', () => {
    const pts: FollowPoint[] = [];
    for (let x = 0; x <= 50; x += 2) pts.push({ x, z: 0, v: Infinity });
    for (let a = 0; a <= Math.PI; a += 0.05)
      pts.push({ x: 50 + 30 * Math.sin(a), z: 30 * (1 - Math.cos(a)), v: Infinity });
    const { maxMiss, car } = follow(pts, false, 8, 25);
    // 30 m radius at 18 m/s² lateral: about 23 m/s at most in the curve.
    expect(maxMiss).toBeLessThan(2);
    expect(car.state.vx).toBeLessThan(25);
  });

  it('cuts sustained wheelspin at lane speed to 5 percent throttle', () => {
    const f = new PathFollower(params);
    f.setPath(
      [
        { x: 0, z: 0, v: 40 },
        { x: 1000, z: 0, v: 40 },
      ],
      false,
    );
    const tel = createCarTelemetry();
    tel.speed = 20;
    tel.gear = 3;
    tel.slipRatio[2] = 0.5;
    const out = { ...NEUTRAL_INPUT };
    for (let k = 0; k < 60; k++) f.drive(tel, 1 / 240, out);
    expect(out.throttle).toBe(0.05);
    expect(out.brake).toBe(0);
  });

  it('restores throttle at 2/s after wheelspin clears, without a step back to full demand', () => {
    const f = new PathFollower(params);
    f.setPath(
      [
        { x: 0, z: 0, v: 40 },
        { x: 1000, z: 0, v: 40 },
      ],
      false,
    );
    const tel = createCarTelemetry();
    tel.speed = 20;
    tel.gear = 3;
    tel.slipRatio[2] = 0.5;
    const out = { ...NEUTRAL_INPUT };
    for (let k = 0; k < 60; k++) f.drive(tel, 1 / 240, out);
    tel.slipRatio[2] = 0;
    for (let k = 0; k < 24; k++) f.drive(tel, 1 / 240, out);
    expect(out.throttle).toBeCloseTo(0.25, 12);
    expect(out.brake).toBe(0);
  });

  it('refuses a path with fewer than two points', () => {
    expect(() => new PathFollower(params).setPath([{ x: 0, z: 0, v: 1 }], true)).toThrow();
  });
});
