import { Track } from '@undercut/track';
import { describe, expect, it } from 'vitest';
import { syntheticTrackData } from '../../track/test/fixtures';
import {
  DRIVING_LINE_OPTIONS,
  DRIVING_LINE_SCALE,
  DrivingLine,
  LineCue,
} from '../src/advice/driving-line';
import { buildPlan } from '../src/profile/plan';
import { syntheticEnvelope } from './fixtures';

const track = new Track(syntheticTrackData({ straight: 600, radius: 60 }));
const plan = buildPlan(track, new Float64Array(track.lap.count), syntheticEnvelope(), {
  scale: DRIVING_LINE_SCALE,
});
const line = new DrivingLine(plan);
const corner = track.corners[0]!;
const vCorner = plan.profile.v[track.lap.sampleIndex(corner.s)]!;

/** Distance before the corner's apex where the braking zone for a car at `v` begins. */
function brakePoint(v: number): number {
  let back = 0;
  while (back < 600 && line.cueAt(track.wrap(corner.s - back - 1), v) === LineCue.Brake) back++;
  return back;
}

describe('driving line cues', () => {
  it('says throttle at or under the plan, brake well over it', () => {
    const i = track.lap.sampleIndex(corner.s);
    expect(line.cueAt(corner.s, plan.profile.v[i]! - 1)).toBe(LineCue.Throttle);
    expect(line.cueAt(corner.s, plan.profile.v[i]! + 20)).toBe(LineCue.Brake);
  });

  it('says lift, not brake, a little over the plan', () => {
    expect(line.cueAt(corner.s, vCorner + 1)).toBe(LineCue.Lift);
    expect(line.cueAt(corner.s, vCorner + 5)).toBe(LineCue.Brake);
  });

  it('moves the brake point earlier the faster the car arrives', () => {
    const slow = brakePoint(vCorner + 8);
    const fast = brakePoint(vCorner + 16);
    expect(slow).toBeGreaterThan(0);
    expect(fast).toBeGreaterThan(slow + 20);
  });

  it('puts the brake point where the car can slow for the corner with its own brakes', () => {
    // Where the plan reaches the corner speed, before the apex.
    let entry = 0;
    while (line.speedAt(corner.s - entry - 1) <= vCorner + 0.05) entry++;
    // Distance braking from v to the corner speed at the plan's deceleration (brake + drag).
    const v = vCorner + 16;
    const model = plan.model;
    let x = 0;
    for (let u = v; u > vCorner; u -= 0.01) {
      const a = model.brake(u, 1) * DRIVING_LINE_SCALE.brake + model.drag(u, false);
      x += (u * 0.01) / a;
    }
    const zone = brakePoint(v) - entry;
    // The zone is that distance plus the driver's lead time, and no more than a lift's worth.
    const lead = v * DRIVING_LINE_OPTIONS.lead;
    expect(zone).toBeGreaterThan(x + 0.8 * lead);
    expect(zone).toBeLessThan(x + lead + 0.5 * v);
  });

  it('fills a ribbon ahead of the car with the cue at each point', () => {
    const out = new Uint8Array(60);
    const v = vCorner + 16;
    const s = track.wrap(corner.s - 300);
    line.fill(s, v, 0, 5, out);
    expect(out[0]).toBe(line.cueAt(s, v));
    expect(out[59]).toBe(line.cueAt(track.wrap(s + 295), v));
    expect(out.includes(LineCue.Brake)).toBe(true);
    expect(out.includes(LineCue.Throttle)).toBe(true);
  });
});
