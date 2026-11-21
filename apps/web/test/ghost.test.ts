import { createCarPose } from '@undercut/sim';
import { describe, expect, it } from 'vitest';
import type { Ghost} from '../src/game/ghost';
import { GHOST_RATE, GhostRecorder, decodeGhost, encodeGhost } from '../src/game/ghost';

/** A pose moving east at 50 m/s with a gentle yaw drift, at lap time t. */
function poseAt(t: number) {
  const p = createCarPose();
  p.x = 50 * t;
  p.y = 0.1;
  p.z = -2;
  p.yaw = 0.01 * t;
  p.pitch = 0.002;
  p.roll = -0.001;
  p.steerAngle = 0.05;
  return p;
}

function record(seconds: number, dt = 1 / 240): Ghost {
  const rec = new GhostRecorder();
  rec.begin();
  const steps = Math.floor(seconds / dt);
  for (let i = 0; i < steps; i++) rec.sample(i * dt, 50 * i * dt, poseAt(i * dt));
  rec.sample(seconds, 50 * seconds, poseAt(seconds), true);
  return rec.finish(seconds);
}

describe('GhostRecorder', () => {
  it('samples at the ghost rate, not every tick', () => {
    const ghost = record(10);
    expect(ghost.count).toBeGreaterThanOrEqual(10 * GHOST_RATE);
    expect(ghost.count).toBeLessThanOrEqual(10 * GHOST_RATE + 2);
    expect(ghost.lapTime).toBe(10);
  });

  it('drops a recording that was abandoned', () => {
    const rec = new GhostRecorder();
    rec.begin();
    rec.sample(0, 0, poseAt(0));
    rec.cancel();
    expect(rec.recording).toBe(false);
    expect(() => rec.finish(1)).toThrow();
  });
});

describe('Ghost playback', () => {
  const ghost = record(10);

  it('replays the pose at any lap time by interpolating between samples', () => {
    const out = createCarPose();
    for (const t of [0, 0.013, 1.234, 5.5, 9.99]) {
      expect(ghost.poseAt(t, out)).toBe(true);
      expect(out.x).toBeCloseTo(50 * t, 3);
      expect(out.yaw).toBeCloseTo(0.01 * t, 5);
      expect(out.y).toBeCloseTo(0.1, 6);
      expect(out.steerAngle).toBeCloseTo(0.05, 6);
    }
  });

  it('spins the wheels with the distance covered', () => {
    const a = createCarPose();
    ghost.poseAt(1, a);
    const b = createCarPose();
    ghost.poseAt(1.01, b);
    // 0.5 m at a 0.355 m rolling radius: 1.408 rad, wrapped into (-pi, pi].
    let d = (b.wheelAngle[0] as number) - (a.wheelAngle[0] as number);
    if (d < -Math.PI) d += 2 * Math.PI;
    if (d > Math.PI) d -= 2 * Math.PI;
    expect(d).toBeCloseTo(0.5 / 0.355, 2);
  });

  it('reports nothing outside the lap', () => {
    const out = createCarPose();
    expect(ghost.poseAt(-0.1, out)).toBe(false);
    expect(ghost.poseAt(10.5, out)).toBe(false);
  });

  it('gives the lap time at a distance into the lap, for a live delta', () => {
    expect(ghost.timeAtDistance(0)).toBeCloseTo(0, 6);
    expect(ghost.timeAtDistance(250)).toBeCloseTo(5, 3);
    expect(ghost.timeAtDistance(123.4)).toBeCloseTo(123.4 / 50, 3);
    expect(ghost.timeAtDistance(10_000)).toBeNull();
  });
});

describe('Ghost encoding', () => {
  it('round-trips through a compact string', () => {
    const ghost = record(4);
    const text = encodeGhost(ghost);
    expect(typeof text).toBe('string');
    const back = decodeGhost(text);
    expect(back).not.toBeNull();
    expect(back?.count).toBe(ghost.count);
    expect(back?.lapTime).toBe(ghost.lapTime);
    const a = createCarPose();
    const b = createCarPose();
    ghost.poseAt(2.2, a);
    back?.poseAt(2.2, b);
    expect(b.x).toBeCloseTo(a.x, 2);
    expect(b.yaw).toBeCloseTo(a.yaw, 5);
  });

  it('rejects damaged data instead of throwing', () => {
    expect(decodeGhost('')).toBeNull();
    expect(decodeGhost('not base64 at all ***')).toBeNull();
    expect(decodeGhost(encodeGhost(record(1)).slice(0, 40))).toBeNull();
  });
});
