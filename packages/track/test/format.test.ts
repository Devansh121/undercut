/**
 * Format 3: the timing line and the environment, and the migration of format 2 files. Format 2
 * files carry neither; the migration puts the timing line at the start line with an unknown
 * uncertainty and leaves the environment empty, so nothing is invented.
 */
import { describe, expect, it } from 'vitest';
import { TRACK_FORMAT_VERSION, TrackDataError, validateTrackData } from '../src/data';
import { CORNER_RULE, detectCorners } from '../src/corners';
import { Track } from '../src/track';
import { syntheticTrackData } from './fixtures';

type Json = Record<string, unknown>;
const copy = (): Json => JSON.parse(JSON.stringify(syntheticTrackData())) as Json;
const problemsOf = (d: unknown): string => {
  try {
    validateTrackData(d);
  } catch (e) {
    expect(e).toBeInstanceOf(TrackDataError);
    return (e as TrackDataError).problems.join('\n');
  }
  return '';
};

describe('track format 3', () => {
  it('is version 3 and carries the timing line and the environment', () => {
    expect(TRACK_FORMAT_VERSION).toBe(3);
    const data = validateTrackData(copy());
    expect(data.timingLine).toEqual({ s: 1100, uncertainty: 5, source: 'test' });
    expect(data.environment?.lighting).toBe('daylight');
    const track = new Track(data);
    expect(track.timingLine).toBe(1100);
    expect(track.environment).toBe(data.environment);
  });

  it('migrates a format 2 file: timing line at the start line, uncertainty unknown, no environment', () => {
    const d = copy();
    d.version = 2;
    delete d.timingLine;
    delete d.environment;
    const before = JSON.stringify(d);
    const data = validateTrackData(d);
    expect(JSON.stringify(d)).toBe(before);
    expect(data.version).toBe(3);
    expect(data.timingLine.s).toBe(0);
    expect(data.timingLine.uncertainty).toBeNull();
    expect(data.timingLine.source).toMatch(/format 2/);
    expect(data.environment).toBeNull();
    expect(new Track(data).timingLine).toBe(0);
  });

  it('rejects a format 2 file that already has format 3 keys, and unknown versions', () => {
    const d = copy();
    d.version = 2;
    expect(problemsOf(d)).toContain('track.timingLine: not part of format 2');
    const e = copy();
    e.version = 1;
    expect(problemsOf(e)).toContain('track.version: expected 3, found 1');
  });

  it('checks the timing line', () => {
    const d = copy();
    (d.timingLine as Json).s = 5000;
    (d.timingLine as Json).uncertainty = -1;
    (d.timingLine as Json).source = '';
    const p = problemsOf(d);
    expect(p).toContain('track.timingLine.s');
    expect(p).toContain('track.timingLine.uncertainty');
    expect(p).toContain('track.timingLine.source');
  });

  it('checks the environment', () => {
    const d = copy();
    const env = d.environment as Json;
    env.raceDate = '7 September';
    env.airTemperature = 25;
    env.sessions = { race: 90000, qualifying: 3600 };
    env.lighting = 'floodlit';
    env.extra = 1;
    const p = problemsOf(d);
    expect(p).toContain('track.environment.raceDate');
    expect(p).toContain('track.environment.airTemperature');
    expect(p).toContain('track.environment.sessions.race');
    expect(p).toContain('track.environment.floodlights: a floodlit circuit needs floodlights');
    expect(p).toContain('track.environment.extra: unknown key');
  });

  it('checks floodlights: mapped masts on the lap, or a placement rule', () => {
    const d = copy();
    const env = d.environment as Json;
    env.lighting = 'floodlit';
    env.floodlights = { mapped: false, masts: [], rule: null };
    expect(problemsOf(d)).toContain('track.environment.floodlights.rule');
    env.floodlights = { mapped: true, masts: [{ s: 9999, d: 12 }], rule: null };
    expect(problemsOf(d)).toContain('track.environment.floodlights.masts[0].s');
    env.floodlights = {
      mapped: false,
      masts: [],
      rule: { spacing: 40, stagger: 20, setback: 1, height: 10 },
    };
    expect(problemsOf(d)).toBe('');
  });
});

describe('corner rule settings', () => {
  it('uses the default rule unless a circuit overrides it', () => {
    // Two 30-degree right bends 60 m apart on a 2 km loop's straight: one corner by default
    // (merged), two with a short merge gap.
    const n = 1000;
    const step = 2;
    const k = new Float64Array(n);
    const bend = (from: number): void => {
      for (let i = from; i < from + 20; i++) k[i] = -(Math.PI / 6) / (20 * step);
    };
    bend(100);
    bend(150);
    // Close the loop with one long left.
    for (let i = 500; i < 900; i++) k[i] = (2 * Math.PI + Math.PI / 3) / (400 * step);
    const rights = (rule?: Partial<typeof CORNER_RULE>): number =>
      detectCorners(k, step, rule ? { ...CORNER_RULE, ...rule } : undefined).filter(
        (c) => c.sign < 0,
      ).length;
    expect(rights()).toBe(1);
    expect(rights({ mergeGap: 30 })).toBe(2);
  });
});

describe('DRS zones that run through the start line', () => {
  it('are found on both sides of s = 0, and nowhere else', () => {
    const d = copy();
    const L = d.length as number;
    // Activation 60 m before the line, end 200 m after it.
    (d.timing as Json).drs = [{ detection: L - 400, activation: L - 60, end: 200 }];
    const track = new Track(validateTrackData(d));
    for (const s of [L - 59, L - 1, 0, 1, 199]) expect(track.drsZoneAt(s), `s ${s}`).toBe(0);
    for (const s of [L - 61, 201, L / 2]) expect(track.drsZoneAt(s), `s ${s}`).toBe(-1);
    expect(track.drsZoneAt(-30)).toBe(0);
    expect(track.drsZoneAt(L + 30)).toBe(0);
  });
});
