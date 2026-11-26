import { beforeAll, describe, expect, it } from 'vitest';
import type { Track } from '@undercut/track';
import { DriverMistakes, MISTAKES_PER_LAP, PRESSURE, brakingCorners } from '../src/driver/mistakes';
import { REFERENCE_SKILL } from '../src/driver/reference';
import type { DrivingPlan } from '../src/profile/plan';
import { planFromRacingLine } from '../src/reference-setup';
import { MONZA, loadEnvelope, loadLine } from '../validation/lib/index';

let track: Track;
let plan: DrivingPlan;

beforeAll(() => {
  track = MONZA.track();
  plan = planFromRacingLine(track, loadLine(MONZA), loadEnvelope(MONZA), REFERENCE_SKILL);
});

function mistakes(consistency: number, seed = 7, perLap?: number) {
  return new DriverMistakes({
    profile: plan.profile,
    step: track.lap.step,
    consistency,
    seed,
    ...(perLap !== undefined ? { perLap } : {}),
  });
}

/** Drive `laps` laps on the plan's speeds; the samples where an error held the pedals. */
function laps(m: DriverMistakes, count: number, allowed = true, pressed = false) {
  const n = plan.profile.v.length;
  const v = plan.profile.v;
  const limited: number[] = [];
  for (let lap = 0; lap < count; lap++)
    for (let i = 0; i < n; i++) {
      const a = m.update(i, v[i]!, v[i]!, allowed, pressed);
      if (a !== Number.POSITIVE_INFINITY) limited.push(lap * n + i);
    }
  return limited;
}

describe('driver mistakes', () => {
  it('finds the braking corners of the lap, each slowing to an apex and out', () => {
    const corners = brakingCorners(plan.profile);
    const v = plan.profile.v;
    const n = v.length;
    expect(corners.length).toBeGreaterThanOrEqual(6);
    expect(corners.length).toBeLessThanOrEqual(12);
    for (const c of corners) {
      expect(c.start).toBeLessThan(c.apex);
      expect(c.apex).toBeLessThanOrEqual(c.end);
      expect(v[c.start % n]! - v[c.apex % n]!).toBeGreaterThanOrEqual(5);
    }
  });

  it('makes about its rate of errors a lap, none at full consistency, more for a rougher driver', () => {
    const count = (c: number, pressed = false) => {
      const m = mistakes(c);
      laps(m, 400, true, pressed);
      return m.count / 400;
    };
    expect(count(0.8)).toBeGreaterThan(0.8 * MISTAKES_PER_LAP);
    expect(count(0.8)).toBeLessThan(1.2 * MISTAKES_PER_LAP);
    expect(count(1)).toBe(0);
    expect(count(0.6)).toBeGreaterThan(1.6 * MISTAKES_PER_LAP);
    expect(count(0.8, true)).toBeGreaterThan(0.8 * PRESSURE * MISTAKES_PER_LAP);
  });

  it('makes none while it may not start one', () => {
    const m = mistakes(0.5);
    expect(laps(m, 50, false)).toHaveLength(0);
    expect(m.count).toBe(0);
  });

  it('is the same for the same seed and differs for another', () => {
    const a = laps(mistakes(0.7, 3), 30);
    const b = laps(mistakes(0.7, 3), 30);
    const c = laps(mistakes(0.7, 4), 30);
    expect(a.length).toBeGreaterThan(0);
    expect(b).toEqual(a);
    expect(c).not.toEqual(a);
  });

  it('slows the car below the plan only over its span, and lets go after it', () => {
    const m = mistakes(0.5, 11);
    const n = plan.profile.v.length;
    const v = plan.profile.v;
    let seen = 0;
    for (let lap = 0; lap < 40 && seen < 20; lap++)
      for (let i = 0; i < n; i++) {
        const a = m.update(i, v[i]!, v[i]!, true, false);
        const active = m.active;
        if (active === null) {
          expect(a).toBe(Number.POSITIVE_INFINITY);
          continue;
        }
        // Decided at the braking onset, it may start later in the corner (a missed apex).
        const since = (((i - active.from) % n) + n) % n;
        if (since > active.to - active.from) {
          expect(a).toBe(Number.POSITIVE_INFINITY);
          continue;
        }
        seen++;
        // At the plan's speed: a lock-up or missed apex slows the car, a wide exit caps the drive.
        if (active.kind === 'wide exit') expect(a).toBeLessThan(6);
        else expect(a).toBeLessThan(0);
      }
    expect(seen).toBeGreaterThan(0);
  });

  it('carries on the same after a snapshot and restore', () => {
    const a = mistakes(0.6, 5);
    laps(a, 7);
    const memory: Record<string, number | boolean | readonly number[]> = {};
    a.snapshot(memory);
    const b = mistakes(0.6, 5);
    b.restore(JSON.parse(JSON.stringify(memory)) as Record<string, unknown>);
    expect(laps(b, 10)).toEqual(laps(a, 10));
    // Memory from before errors existed starts them afresh.
    const c = mistakes(0.6, 5);
    c.restore({});
    expect(laps(c, 3)).toEqual(laps(mistakes(0.6, 5), 3));
  });
});
