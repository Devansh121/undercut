import { describe, expect, it } from 'vitest';
import monza from '@undercut/track/data/monza.json';
import singapore from '@undercut/track/data/singapore.json';
import spa from '@undercut/track/data/spa.json';
import { CIRCUIT_DATA } from '@undercut/race';
import { summarizeTrack, timesOfDayFor, type TrackFileLike } from '../src/ui/data/circuit-summary';

describe('circuit summary', () => {
  const data = CIRCUIT_DATA.monza as { timingLine: number; raceLaps: number };
  const s = summarizeTrack(
    monza as unknown as TrackFileLike,
    data.raceLaps,
    data.timingLine,
    true,
    true,
  );

  it('reads the facts the circuit card shows from the track file', () => {
    expect(s).toMatchObject({
      id: 'monza',
      name: 'Monza',
      country: 'Italy',
      direction: 'clockwise',
      length: 5793,
      corners: 11,
      drsZones: 2,
      raceLaps: 53,
      airTemperature: 299.15,
      timesOfDay: ['monza-afternoon', 'overcast-day'],
      raceReady: true,
      brakingHelp: true,
    });
  });

  it('reads Spa and Singapore (track format 3): direction, corners, the day preset, no braking help line', () => {
    const at = (t: unknown) => {
      const f = t as TrackFileLike & { timingLine: { s: number } };
      // Both have AI racing lines (medium and high downforce), none at the player's low trim.
      return summarizeTrack(f, 44, f.timingLine.s, true, false);
    };
    expect(at(spa)).toMatchObject({
      id: 'spa',
      direction: 'clockwise',
      length: 7004,
      timesOfDay: ['overcast-day'],
      raceReady: true,
      brakingHelp: false,
    });
    expect(at(singapore)).toMatchObject({
      id: 'singapore',
      direction: 'anticlockwise',
      length: 4927,
      timesOfDay: ['overcast-day'],
      raceReady: true,
      brakingHelp: false,
    });
    expect(at(spa).corners).toBeGreaterThan(10);
    expect(at(singapore).plan.sectorPaths).toHaveLength(3);
  });

  it('fits the plan inside its box with three sectors and a start line', () => {
    const { plan } = s;
    const nums = [...plan.path.matchAll(/-?\d+(\.\d+)?/g)].map((m) => Number(m[0]));
    const xs = nums.filter((_, i) => i % 2 === 0);
    const ys = nums.filter((_, i) => i % 2 === 1);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(13.9);
    expect(Math.max(...xs)).toBeLessThanOrEqual(plan.width - 13.9);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(13.9);
    expect(Math.max(...ys)).toBeLessThanOrEqual(plan.height - 13.9);
    expect(plan.path.endsWith('Z')).toBe(true);
    expect(plan.sectorPaths).toHaveLength(3);
    // Chicanes (1-2, 4-5, 8-9-10) show their first corner's number only.
    const numbers = plan.labels.map((l) => l.n);
    expect(numbers[0]).toBe(1);
    expect(numbers).toContain(11);
    expect(new Set(numbers).size).toBe(numbers.length);
    for (const a of plan.labels)
      for (const b of plan.labels)
        if (a !== b) expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(10);
    // The sector paths join end to start: sector 1 ends where sector 2 begins.
    const end = (p: string): string => p.slice(p.lastIndexOf('L') + 1);
    const start = (p: string): string => p.slice(1, p.indexOf('L'));
    expect(end(plan.sectorPaths[0] as string)).toBe(start(plan.sectorPaths[1] as string));
  });

  it('picks sky presets by circuit, else the day preset', () => {
    // The floodlit night preset is not built yet: the day preset stands in.
    expect(timesOfDayFor('singapore', 'floodlit')).toEqual(['overcast-day']);
    expect(timesOfDayFor('elsewhere', 'floodlit')).toEqual(['overcast-day']);
    expect(timesOfDayFor('elsewhere', 'daylight')).toEqual(['overcast-day']);
  });
});
