import { circuitLimits } from '@undercut/protocol';
import { TIMES_OF_DAY } from '@undercut/render';
import { Track } from '@undercut/track';
import monza from '@undercut/track/data/monza.json';
import spa from '@undercut/track/data/spa.json';
import singapore from '@undercut/track/data/singapore.json';
import { describe, expect, it } from 'vitest';
import { ONLINE_CIRCUITS, findOnlineCircuit, onlineCircuit } from '../../src/online/circuits';

const TRACKS: Record<string, Track> = {
  monza: Track.fromJSON(monza),
  spa: Track.fromJSON(spa),
  singapore: Track.fromJSON(singapore),
};

describe('online circuits', () => {
  it('lists Monza, Spa and Singapore with valid lengths, sectors, limits and skies', () => {
    expect(ONLINE_CIRCUITS.map((c) => c.id)).toEqual(['monza', 'spa', 'singapore']);
    for (const c of ONLINE_CIRCUITS) {
      const track = TRACKS[c.id];
      expect(track).toBeDefined();
      expect(Math.abs(c.info.lengthM - track!.length)).toBeLessThan(1);
      const expected = circuitLimits(c.id, Math.round(track!.length), Array.from(track!.sectors));
      expect(c.info.minLapMs).toBe(expected.minLapMs);
      expect(c.info.minSectorMs).toEqual(expected.minSectorMs);
      expect(TIMES_OF_DAY[c.timeOfDay]).toBeDefined();
    }
  });

  it('finds circuits by id and falls back to Monza for unknown ids', () => {
    expect(findOnlineCircuit('spa')?.name).toBe('Spa-Francorchamps');
    expect(findOnlineCircuit('singapore')?.timeOfDay).toBe('night-floodlit');
    expect(findOnlineCircuit('unknown')).toBeNull();
    expect(onlineCircuit('unknown').id).toBe('monza');
  });
});
