import { Track } from '@undercut/track';
import { describe, expect, it } from 'vitest';
import { syntheticTrackData } from '../../track/test/fixtures';
import { EnvelopeModel } from '../src/envelope/envelope';
import { computeLineGeometry } from '../src/line/geometry';
import { Phase, SpeedProfiler } from '../src/profile/speed-profile';
import { buildPlan } from '../src/profile/plan';
import { syntheticEnvelope } from './fixtures';

const G = 9.80665;
const model = new EnvelopeModel(syntheticEnvelope());

function profileOn(options: Parameters<typeof syntheticTrackData>[0] = {}) {
  const track = new Track(syntheticTrackData({ straight: 400, radius: 60, ...options }));
  const line = computeLineGeometry(track, new Float64Array(track.lap.count));
  const profiler = new SpeedProfiler(line, model);
  return { track, line, profiler, profile: profiler.compute() };
}

describe('speed profile', () => {
  const { track, line, profiler, profile } = profileOn();
  const mid = track.lap.sampleIndex(track.corners[0]!.s);

  it('takes the middle of a constant-radius bend at the lateral limit', () => {
    const v = profile.v[mid]!;
    const limit = model.lateral(v, 1);
    expect(Math.abs((v * v) / 60 - limit)).toBeLessThan(0.05 * limit);
    expect(profile.phase[mid]).toBe(Phase.Corner);
  });

  it('never asks for more than the envelope in any direction', () => {
    const n = line.count;
    for (let i = 0; i < n; i++) {
      const v = profile.v[i]!;
      const lat = Math.abs(profiler.lateralDemand(i, v)) / model.lateral(v, profiler.load(i, v));
      expect(lat).toBeLessThanOrEqual(1 + 1e-6);
      const ax = profile.ax[i]!;
      if (ax > 0) expect(ax).toBeLessThanOrEqual(model.drive(v, false, true) + 0.05);
      else expect(-ax).toBeLessThanOrEqual(model.brake(v, 1) + model.drag(v, false) + 0.2);
    }
  });

  it('accelerates on the straights and brakes before the bends', () => {
    const before = track.lap.sampleIndex(track.corners[0]!.start - 20);
    const after = track.lap.sampleIndex(track.corners[0]!.end + 60);
    expect(profile.phase[before]).toBe(Phase.Brake);
    expect(profile.phase[after]).toBe(Phase.Throttle);
  });

  it('adds up to its lap time', () => {
    let t = 0;
    for (let i = 0; i < line.count; i++) {
      const j = (i + 1) % line.count;
      t += (2 * line.ds[i]!) / (profile.v[i]! + profile.v[j]!);
    }
    expect(profile.lapTime).toBeCloseTo(t, 9);
    expect(profile.time[0]).toBe(0);
  });

  it('is slower round a track that climbs on its straights', () => {
    // The fixture's first straight runs from s = 0 to 400 m; make it climb 4 % and fall back.
    const hill = profileOn({
      height: (s) => (s < 400 ? 0.04 * s : s < 800 ? 16 - 0.04 * (s - 400) : 0),
    }).profile;
    const up = track.lap.sampleIndex(200);
    expect(hill.v[up]).toBeLessThan(profile.v[up]!);
  });

  it('corners faster on banking that leans into the bend and slower over a crest', () => {
    // The fixture turns right: banking with the left side higher helps.
    const banked = profileOn({ bank: 0.08 }).profile;
    expect(banked.v[mid]).toBeGreaterThan(profile.v[mid]! + 0.5);
    // A crest at the middle of the first bend: the ground falls away under the car.
    const s0 = track.corners[0]!.s;
    const crest = profileOn({
      height: (s) => 5 * Math.exp(-(((s - s0) / 40) ** 2)),
    });
    expect(crest.profile.v[mid]).toBeLessThan(profile.v[mid]! - 0.3);
    expect(crest.profiler.load(mid, crest.profile.v[mid]!)).toBeLessThan(1);
  });

  it('uses DRS only in the zones and gains speed there', () => {
    const plan = buildPlan(track, new Float64Array(track.lap.count), model, {
      scale: { lateral: 1, brake: 1, traction: 1 },
    });
    const zone = track.drsZones[0]!;
    for (let i = 0; i < line.count; i++) {
      if (plan.profile.drsOpen[i]) expect(plan.drsZone[i]).toBe(1);
    }
    const noDrs = buildPlan(track, new Float64Array(track.lap.count), model, {
      scale: { lateral: 1, brake: 1, traction: 1 },
      drs: false,
    });
    let top = 0;
    let topNoDrs = 0;
    for (let i = track.lap.sampleIndex(zone.activation); i < track.lap.sampleIndex(zone.end); i++) {
      top = Math.max(top, plan.profile.v[i]!);
      topNoDrs = Math.max(topNoDrs, noDrs.profile.v[i]!);
    }
    expect(top).toBeGreaterThan(topNoDrs);
    expect(plan.profile.lapTime).toBeLessThan(noDrs.profile.lapTime);
  });

  it('keeps MGU-K deployment within the per-lap budget by capping it at high speed', () => {
    const full = buildPlan(track, new Float64Array(track.lap.count), model, {
      scale: { lateral: 1, brake: 1, traction: 1 },
    });
    const budget = 0.5 * full.deployEnergy;
    const capped = buildPlan(track, new Float64Array(track.lap.count), model, {
      scale: { lateral: 1, brake: 1, traction: 1 },
      deployBudget: budget,
    });
    expect(capped.deployEnergy).toBeLessThanOrEqual(budget + 1);
    expect(capped.profile.lapTime).toBeGreaterThan(full.profile.lapTime);
  });

  it('slows down when it plans with less of the envelope', () => {
    const slower = profiler.compute({ scale: { lateral: 0.9, brake: 0.9, traction: 0.9 } });
    expect(slower.lapTime).toBeGreaterThan(profile.lapTime);
    expect(profile.v[mid]! / G).toBeGreaterThan(0);
  });
});
