import { expect, it } from 'vitest';
import { Track } from '@undercut/track';
import monza from '@undercut/track/data/monza.json';
import { DriveSession } from '../src/game/session';
it('enables the pit wall when Quick Race requires two compounds at full distance', () => {
  const s = new DriveSession({ track: Track.fromJSON(monza), seed: 1, quickRace: { laps: 53 } });
  expect(s.race.control.strategy.twoCompoundRule).toBe(true);
  expect(s.race.pitStrategy).toBe(true);
});
