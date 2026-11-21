import { airDensity, createCarParams } from '@undercut/sim';
import { Track } from '@undercut/track';
import { describe, expect, it } from 'vitest';
import { syntheticTrackData } from '../../track/test/fixtures';
import { REFERENCE_SKILL, ReferenceDriver } from '../src/driver/reference';
import type { DriverSkill } from '../src/driver/driver';
import { measureEnvelope } from '../src/envelope/measure';
import { buildCorridor } from '../src/line/corridor';
import { minimumCurvatureLine } from '../src/line/min-curvature';
import { buildPlan } from '../src/profile/plan';
import { runLaps } from './lib/lap';

// Physics job: these drive the sim for several laps, which is too heavy for the unit job.
// The reference driver on the stadium fixture, with the car's real envelope (measured from the
// sim, a second of work) and the same world the game builds.
const rho = airDensity(180, 25);
const params = createCarParams('low');
const envelope = measureEnvelope({ params, airDensity: rho, fuel: 10 }).envelope;
const track = new Track(syntheticTrackData({ straight: 500, radius: 70 }));
const corridor = buildCorridor(track, { halfTrack: 0.81, margin: 0.3, kerbUse: {} });
const offsets = minimumCurvatureLine(track, corridor).d;

function drive(
  skill: DriverSkill,
  laps = 2,
  extra: { timingLine?: number; recordEvery?: number } = {},
) {
  const plan = buildPlan(track, offsets, envelope, { scale: skill.envelope });
  const inputs: number[][] = [];
  const result = runLaps({
    track,
    plan,
    trim: 'low',
    airDensity: rho,
    fuel: 20,
    laps,
    ...extra,
    driver: (p) => {
      const d = new ReferenceDriver({ plan, params: p, skill, deployBeforeLine: true });
      const wrapped = Object.create(d) as ReferenceDriver;
      wrapped.drive = (tel, dt, out) => {
        d.drive(tel, dt, out);
        inputs.push([out.steer, out.throttle, out.brake]);
        return out;
      };
      return wrapped;
    },
  });
  return { result, plan, inputs };
}

describe('reference driver', () => {
  const run = drive(REFERENCE_SKILL);

  it('laps without spinning or leaving the track', () => {
    expect(run.result.spun).toBe(false);
    expect(run.result.laps).toHaveLength(2);
    for (const lap of run.result.laps) expect(lap.allOffTicks).toBe(0);
  });

  it('drives close to its plan', () => {
    for (const lap of run.result.laps) {
      expect(Math.abs(lap.time - run.plan.profile.lapTime) / run.plan.profile.lapTime).toBeLessThan(
        0.03,
      );
    }
  });

  it('only ever asks for inputs inside their ranges', () => {
    for (const [steer, throttle, brake] of run.inputs) {
      expect(Math.abs(steer!)).toBeLessThanOrEqual(1);
      expect(throttle).toBeGreaterThanOrEqual(0);
      expect(throttle).toBeLessThanOrEqual(1);
      expect(brake).toBeGreaterThanOrEqual(0);
      expect(brake).toBeLessThanOrEqual(1);
    }
  });

  it('is deterministic', () => {
    const again = drive(REFERENCE_SKILL, 1).result.laps[0]!.time;
    expect(again).toBe(run.result.laps[0]!.time);
  });

  it('is slower with less skill, and its errors are reproducible from the seed', () => {
    const club: DriverSkill = {
      envelope: { lateral: 0.85, brake: 0.8, traction: 0.85 },
      reaction: 0.08,
      steerNoise: 0.004,
      pedalNoise: 0.03,
      lineWander: 0.3,
      seed: 7,
    };
    const a = drive(club, 1).result;
    const b = drive(club, 1).result;
    expect(a.spun).toBe(false);
    expect(a.laps[0]!.time).toBeGreaterThan(run.result.laps[0]!.time);
    expect(b.laps[0]!.time).toBe(a.laps[0]!.time);
  });
});

describe('lap timing', () => {
  // Speed at the n-th crossing of `line`, interpolated in s between trace rows like the runner.
  function crossingSpeeds(rows: number[][], length: number, line: number): number[] {
    const out: number[] = [];
    for (let k = 1; k < rows.length; k++) {
      const s0 = rows[k - 1]![2]!;
      const s1 = rows[k]![2]!;
      const moved = (((s1 - s0) % length) + length) % length;
      const to = (((line - s0) % length) + length) % length;
      if (moved > 0 && moved < length / 2 && to > 0 && to <= moved) {
        const f = to / moved;
        out.push(rows[k - 1]![6]! + (rows[k]![6]! - rows[k - 1]![6]!) * f);
      }
    }
    return out;
  }

  it('publishes each lap’s own finishing speed, not the speed it started with', () => {
    // A driver with seeded errors, so consecutive line crossings differ in speed.
    const noisy: DriverSkill = { ...REFERENCE_SKILL, pedalNoise: 0.05, steerNoise: 0.002, seed: 6 };
    const { result } = drive(noisy, 3, { recordEvery: 1 });
    const crossings = crossingSpeeds(result.trace!.rows, track.length, 0);
    expect(crossings.length).toBeGreaterThanOrEqual(4);
    const laps = result.laps;
    for (let k = 0; k < laps.length; k++) {
      expect(laps[k]!.start).toBeCloseTo(crossings[k]!, 6);
      expect(laps[k]!.finish).toBeCloseTo(crossings[k + 1]!, 6);
      if (k + 1 < laps.length) expect(laps[k]!.finish).toBe(laps[k + 1]!.start);
    }
    // The crossings differ, so publishing the start speed as the finish would fail above.
    for (const lap of laps) expect(Math.abs(lap.finish - lap.start)).toBeGreaterThan(0.01);
  });

  it('times laps and sectors from a timing line away from s = 0', () => {
    const line = 0.25 * track.length;
    const { result } = drive(REFERENCE_SKILL, 2, { timingLine: line, recordEvery: 1 });
    const crossings = crossingSpeeds(result.trace!.rows, track.length, line);
    const lap = result.laps[1]!;
    expect(lap.finish).toBeCloseTo(crossings[2]!, 6);
    // Sectors run from the timing line through the sector lines back to it.
    expect(lap.sectors).toHaveLength(track.sectors.length);
    expect(lap.sectors.reduce((a, b) => a + b, 0)).toBeCloseTo(lap.time, 6);
    // Same car, same lap, different line: the lap times agree closely.
    const zero = drive(REFERENCE_SKILL, 2).result.laps[1]!;
    expect(Math.abs(lap.time - zero.time)).toBeLessThan(0.3);
  });
});
