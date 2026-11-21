import { SurfaceKind, createCarParams } from '@undercut/sim';
import { LEFT, RIGHT, Track, createGround, createPathPoint, createVec3 } from '@undercut/track';
import monza from '@undercut/track/data/monza.json';
import { describe, expect, it } from 'vitest';
import {
  TYRE_HALF_TREAD,
  buildLegalCorridor,
  usableBeyondLine,
  wheelOff,
} from '../src/line/limits';
import { referenceCorridor } from '../src/reference-setup';

const track = Track.fromJSON(monza);
const n = track.lap.count;
const O = referenceCorridor(createCarParams('low'));

describe('track-limit rule', () => {
  it('calls a wheel off only when its tyre is wholly past the white line', () => {
    const s = 100;
    const hw = track.halfWidthAt(s, LEFT);
    expect(wheelOff(track, s, hw + TYRE_HALF_TREAD - 0.001)).toBe(false);
    expect(wheelOff(track, s, hw + TYRE_HALF_TREAD + 0.001)).toBe(true);
    const hr = track.halfWidthAt(s, RIGHT);
    expect(wheelOff(track, s, -(hr + TYRE_HALF_TREAD + 0.001))).toBe(true);
  });
});

/**
 * An independent check in world space: place the car at the corridor's bound, turn it through
 * the allowed heading error and move it by the tracking allowance, then project every wheel
 * centre and every tyre footprint corner back onto the track and read the ground there.
 */
describe('legal corridor, checked on the car footprint in world space', () => {
  const c = buildLegalCorridor(track, O);
  const q = createPathPoint();
  const g = createGround();
  const p = createVec3();
  const t = createVec3();
  const hint = { index: -1 };
  const usable = (x: number, z: number): { ok: boolean; kind: number } => {
    track.project(x, z, hint, q);
    track.ground(q.s, q.d, g);
    const side = q.d >= 0 ? LEFT : RIGHT;
    const i = g.sample;
    const beyond = Math.abs(q.d) - track.halfWidthAt(q.s, side);
    if (g.kind === SurfaceKind.Grass || g.kind === SurfaceKind.Gravel)
      return { ok: false, kind: g.kind };
    if (g.kind === SurfaceKind.OutOfBounds || g.highKerb) return { ok: false, kind: g.kind };
    return { ok: beyond <= usableBeyondLine(track, i, side), kind: g.kind };
  };

  it('keeps one wheel on the line and every tyre on usable ground at the bound', () => {
    let badRule = 0;
    let badGround = 0;
    let checked = 0;
    for (let i = 0; i < n; i += 1) {
      const s = i * track.lap.step;
      track.lap.tangent(s, t);
      const head0 = Math.atan2(-t.z, t.x);
      for (const [bound, sign] of [
        [c.hi[i]!, 1],
        [c.lo[i]!, -1],
      ] as const) {
        const d = bound + sign * O.allowance;
        track.lap.pointAt(s, d, p);
        for (const yaw of [-O.maxYaw, -O.maxYaw / 2, 0, O.maxYaw / 2, O.maxYaw]) {
          const h = head0 + yaw;
          const fx = Math.cos(h);
          const fz = -Math.sin(h);
          let on = 0;
          for (const w of O.wheels) {
            const wx = p.x + fx * w.x + fz * w.y;
            const wz = p.z + fz * w.x - fx * w.y;
            track.project(wx, wz, hint, q);
            if (!wheelOff(track, q.s, q.d, O.halfTread)) on++;
            for (const a of [-O.patchHalfLength, O.patchHalfLength]) {
              for (const b of [-w.halfWidth, w.halfWidth]) {
                checked++;
                const u = usable(wx + fx * a + fz * b, wz + fz * a - fx * b);
                if (!u.ok) badGround++;
              }
            }
          }
          if (on === 0) badRule++;
        }
      }
    }
    expect(checked).toBeGreaterThan(200000);
    expect(badRule).toBe(0);
    expect(badGround).toBe(0);
  });

  it('is wider than the whole car inside the lines wherever a kerb or run-off allows', () => {
    let wider = 0;
    for (let i = 0; i < n; i++) {
      if (c.hi[i]! > track.halfWidth[LEFT][i]! - 0.81 - 0.3 + 0.05) wider++;
    }
    expect(wider).toBeGreaterThan(n / 10);
  });
});
