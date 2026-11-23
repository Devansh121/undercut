import { describe, expect, it } from 'vitest';
import { NEUTRAL_INPUT } from '@undercut/sim';
import { Track } from '@undercut/track';
import spaTrack from '@undercut/track/data/spa.json';
import singaporeTrack from '@undercut/track/data/singapore.json';
import spaLine from '../../../packages/ai/data/spa-medium.line.json';
import spaEnvelope from '../../../packages/ai/data/spa-medium.envelope.json';
import singaporeLine from '../../../packages/ai/data/singapore-high.line.json';
import singaporeEnvelope from '../../../packages/ai/data/singapore-high.envelope.json';
import { RaceAudioScene } from '../src/game/audio-scene';
import { DriveSession } from '../src/game/session';
import { loadMonza } from './fixtures';

// Quick Race at every circuit with a racing line: the field on that circuit's grid, every car
// (the player's too) in the trim its line was built for, held until lights out.

const CIRCUITS = [
  {
    id: 'spa',
    track: () => Track.fromJSON(spaTrack),
    raceArtefacts: { line: spaLine, envelope: spaEnvelope },
    trim: 'medium',
    ambience: 'forest',
    dayAmbience: 'forest',
  },
  {
    id: 'singapore',
    track: () => Track.fromJSON(singaporeTrack),
    raceArtefacts: { line: singaporeLine, envelope: singaporeEnvelope },
    trim: 'high',
    ambience: 'city-night',
    dayAmbience: 'city-day',
  },
] as const;

describe.each(CIRCUITS)(
  'Quick Race at $id',
  ({ track: load, raceArtefacts, trim, ambience, dayAmbience }) => {
    it(`puts twenty cars in ${trim} trim on the grid and starts them`, () => {
      const track = load();
      const s = new DriveSession({ track, seed: 1, quickRace: { laps: 1 }, raceArtefacts });
      expect(s.trim).toBe(trim);
      expect(s.race.cars).toHaveLength(20);
      expect(s.car.pose.x).toBeCloseTo(track.gridSlots[9]!.x, 4);
      expect(s.car.pose.z).toBeCloseTo(track.gridSlots[9]!.z, 4);
      // The sound follows: the circuit's own ambience, and the start lights as they come on.
      const scene = new RaceAudioScene();
      expect(scene.update(s).ambience).toBe(ambience);
      expect(new RaceAudioScene('overcast-day').update(s).ambience).toBe(dayAmbience);
      expect(scene.update(s).lights).toBe(-1);
      s.start();
      s.scriptedRaceDriver = true;
      const lit = new Set<number>();
      for (let i = 0; i < 240 * 14; i++) {
        s.tick(NEUTRAL_INPUT, 'keyboard');
        lit.add(scene.update(s).lights);
      }
      expect([...lit].filter((n) => n > 0).sort()).toEqual([1, 2, 3, 4, 5, 6]);
      expect(s.race.control.phase).toBe('green');
      expect(s.car.state.vx).toBeGreaterThan(10);
    }, 30_000);

    it('needs its own racing line: none, or another circuit’s, is refused', () => {
      const track = load();
      expect(() => new DriveSession({ track, seed: 1, quickRace: { laps: 1 } })).toThrow(
        /needs its racing line/,
      );
      const other = CIRCUITS.find((c) => c.raceArtefacts !== raceArtefacts)!.raceArtefacts;
      expect(
        () => new DriveSession({ track, seed: 1, quickRace: { laps: 1 }, raceArtefacts: other }),
      ).toThrow(/does not fit/);
    });
  },
);

it('time trial keeps the low-drag car at every circuit', () => {
  for (const track of [loadMonza(), ...CIRCUITS.map((c) => c.track())]) {
    expect(new DriveSession({ track, seed: 1 }).trim).toBe('low');
  }
});

it('names the cars after the drivers in them', () => {
  const drivers = Array.from({ length: 20 }, (_, i) => ({ name: `Name ${i}`, code: `C${i}` }));
  const s = new DriveSession({ track: loadMonza(), seed: 1, quickRace: { laps: 1 }, drivers });
  expect(s.race.entrants.map((e) => e.code)).toEqual(drivers.map((d) => d.code));
  expect(s.race.entrants[0]!.name).toBe('Name 0');
  expect(s.race.entrants[19]!.name).toBe('Name 19');
});
