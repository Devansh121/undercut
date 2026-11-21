import { describe, expect, it } from 'vitest';
import type { RemoteCarView } from '@undercut/protocol';
import { RemoteCarSmoother, SMOOTHING } from '../../src/online/smoother';

function view(seat: number, x: number, vx = 0, opacity = 1): RemoteCarView {
  return {
    seat,
    flags: 0,
    resets: 0,
    tick: 0,
    t: 0,
    x,
    y: 0,
    z: 0,
    yaw: 0,
    pitch: 0,
    roll: 0,
    vx,
    vy: 0,
    vz: 0,
    yawRate: 0,
    steer: 0,
    throttle: 0,
    brake: 0,
    gear: 1,
    rpm: 0,
    wheelSpin: [0, 0, 0, 0],
    lap: 0,
    s: 0,
    mode: 'interpolated',
    opacity,
    aheadMs: 0,
  };
}

const DT = 1 / 60;

describe('RemoteCarSmoother', () => {
  it('draws continuous motion exactly where the buffer puts it', () => {
    const sm = new RemoteCarSmoother();
    for (let i = 0; i < 120; i++) {
      const out = sm.update([view(1, i * DT * 80, 80)], DT);
      expect(out).toHaveLength(1);
      expect(out[0]?.x).toBeCloseTo(i * DT * 80, 9);
      expect(out[0]?.opacity).toBe(1);
    }
    expect(sm.stats.snaps).toBe(0);
    expect(sm.stats.corrections).toBe(0);
  });

  it('fades out at the old place and in at the new one across a big jump, never sliding', () => {
    const sm = new RemoteCarSmoother();
    sm.update([view(1, 0)], DT);
    sm.update([view(1, 0)], DT);
    const seen: { x: number; opacity: number }[] = [];
    for (let i = 0; i < 60; i++) {
      const out = sm.update([view(1, 200)], DT)[0];
      if (out) seen.push({ x: out.x, opacity: out.opacity });
    }
    expect(sm.stats.snaps).toBe(1);
    for (const s of seen) expect(s.x === 0 || s.x === 200).toBe(true);
    const firstNew = seen.findIndex((s) => s.x === 200);
    expect(firstNew).toBeGreaterThan(0);
    // Out: opacity falls at the old place; in: rises at the new one; ends fully visible.
    expect(seen[firstNew - 1]?.opacity).toBeLessThan(0.5);
    expect(seen[firstNew]?.opacity).toBeLessThan(0.5);
    expect(seen.at(-1)?.opacity).toBe(1);
    expect(seen.at(-1)?.x).toBe(200);
  });

  it('eases a small correction in instead of jumping', () => {
    const sm = new RemoteCarSmoother();
    sm.update([view(1, 0)], DT);
    const first = sm.update([view(1, 1.5)], DT)[0];
    expect(sm.stats.corrections).toBe(1);
    expect(sm.stats.snaps).toBe(0);
    expect(first?.x).toBeLessThan(0.5);
    let last = first?.x ?? 0;
    for (let i = 0; i < Math.ceil(SMOOTHING.settleS / DT); i++) {
      const x = sm.update([view(1, 1.5)], DT)[0]?.x ?? 0;
      expect(x).toBeGreaterThanOrEqual(last - 1e-9);
      last = x;
    }
    expect(last).toBeCloseTo(1.5, 2);
  });

  it('passes the buffer fade through and forgets cars that are gone', () => {
    const sm = new RemoteCarSmoother();
    expect(sm.update([view(1, 0, 0, 0.4)], DT)[0]?.opacity).toBeCloseTo(0.4);
    expect(sm.update([], DT)).toEqual([]);
    // Back again far away: a fresh car, not a snap.
    sm.update([view(1, 500)], DT);
    expect(sm.stats.snaps).toBe(0);
  });

  it('drops cars that have faded out completely', () => {
    const sm = new RemoteCarSmoother();
    expect(sm.update([view(2, 0, 0, 0)], DT)).toEqual([]);
  });
});
