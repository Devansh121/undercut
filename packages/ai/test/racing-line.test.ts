import { Track } from '@undercut/track';
import { describe, expect, it } from 'vitest';
import { syntheticTrackData } from '../../track/test/fixtures';
import {
  decodeRacingLine,
  encodeRacingLine,
  inZone,
  racingLineOffsets,
  racingLineSpeeds,
  zonesFromFlags,
} from '../src/export/racing-line';
import { buildPlan } from '../src/profile/plan';
import { syntheticEnvelope } from './fixtures';

describe('racing-line artefact', () => {
  const track = new Track(syntheticTrackData());
  const n = track.lap.count;
  const d = Float64Array.from({ length: n }, (_, i) => 2 * Math.sin((2 * Math.PI * i) / n));
  const plan = buildPlan(track, d, syntheticEnvelope(), {
    scale: { lateral: 1, brake: 1, traction: 1 },
  });
  const data = encodeRacingLine(plan, {
    circuit: 'stadium',
    trim: 'test',
    inputsHash: 'a',
    envelopeHash: 'b',
  });

  it('round-trips through JSON within its stored resolution', () => {
    const back = decodeRacingLine(JSON.parse(JSON.stringify(data)));
    const off = racingLineOffsets(back);
    const v = racingLineSpeeds(back);
    for (let i = 0; i < n; i++) {
      expect(Math.abs(off[i]! - d[i]!)).toBeLessThanOrEqual(0.5e-4 + 1e-12);
      expect(Math.abs(v[i]! - plan.profile.v[i]!)).toBeLessThanOrEqual(0.005 + 1e-12);
    }
    expect(back.lapTime).toBeCloseTo(plan.profile.lapTime, 2);
  });

  it('marks brake and throttle zones where the plan brakes and accelerates', () => {
    expect(data.brakeZones.length).toBeGreaterThan(0);
    expect(data.throttleZones.length).toBeGreaterThan(0);
    const bend = track.corners[0]!;
    expect(inZone(data.brakeZones, bend.start - 10, track.length)).toBe(true);
    expect(inZone(data.throttleZones, bend.end + 80, track.length)).toBe(true);
  });

  it('turns flags into zones, joining a run across the start line', () => {
    const flags = [1, 1, 0, 0, 1, 0, 1, 1];
    expect(zonesFromFlags(flags, 2)).toEqual([
      [8, 10],
      [12, 20],
    ]);
    expect(inZone([[12, 20]], 1, 16)).toBe(true);
    expect(zonesFromFlags([0, 0, 0], 1)).toEqual([]);
    expect(zonesFromFlags([1, 1, 1], 1)).toEqual([[0, 3]]);
  });

  it('rejects files that are not racing lines', () => {
    expect(() => decodeRacingLine({ ...data, format: 'x' })).toThrow(/format/);
    expect(() => decodeRacingLine({ ...data, offsetTenthMm: [1, 2] })).toThrow(/entries/);
    expect(() => decodeRacingLine({ ...data, speedCms: data.speedCms.map(() => 0) })).toThrow();
  });
});
