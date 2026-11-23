import { expect } from 'vitest';
import { decodeRacingLine, racingLineOffsets } from '@undercut/ai';
import { NEUTRAL_INPUT } from '@undercut/sim';
import { Track } from '@undercut/track';
import spaTrack from '@undercut/track/data/spa.json';
import spaLine from '../../../packages/ai/data/spa-medium.line.json';
import spaEnvelope from '../../../packages/ai/data/spa-medium.envelope.json';
import { DriveSession } from '../src/game/session';

// Shared by parked-player-spa-*.test.ts (a test file each, so they run side by side).
// The player stops on the racing line at Spa a minute into a Quick Race, as the field arrives,
// and holds the brake (the review of PR 52, as `parked-player.test.ts` at Monza). The queue
// forming behind it rear-ended: at the Bus Stop nine cars touched, 12.5 m/s at the worst, over
// 37 car-seconds; into Raidillon cars ran off the road swinging round on full lock. Now a queue
// behind a stopped car stops with the brakes the cars have at walking pace and a wider gap,
// cars arrive at it no faster than slows them to a crawl beside it, and at walking pace there
// the lane moves on the road and the steering turns the car back toward it.

const track = Track.fromJSON(spaTrack);
const raceArtefacts = { line: spaLine, envelope: spaEnvelope };
const offsets = racingLineOffsets(decodeRacingLine(spaLine));
const L = track.length;

function ahead(a: number, b: number): number {
  let x = (b - a) % L;
  if (x > L / 2) x -= L;
  else if (x <= -L / 2) x += L;
  return x;
}

function lineAt(s: number): number {
  const u = track.wrap(s) / track.lap.step;
  const n = offsets.length;
  const i = Math.floor(u) % n;
  return offsets[i]! + (offsets[(i + 1) % n]! - offsets[i]!) * (u - Math.floor(u));
}

export interface Parked {
  /** Fastest closing speed at any contact between two cars once the player stopped, m/s. */
  peakContact: number;
  /** Car-ticks with all four wheels off within 150 m of the stopped car. */
  offNear: number;
  past: number;
  finished: number;
}

export function parkAt(spot: number, seed: number): Parked {
  const s = new DriveSession({
    track,
    seed,
    quickRace: { laps: 3, gridPosition: 1 },
    raceArtefacts,
  });
  s.start();
  s.scriptedRaceDriver = true;
  let parked = false;
  let peakContact = 0;
  let offNear = 0;
  const past = new Array<boolean>(20).fill(false);
  while (s.race.control.phase !== 'finished' && !s.race.ended && s.world.time < 600) {
    if (!parked && s.world.time > 60 && s.race.control.phase === 'green') {
      // As the first of the others comes within 400 to 600 m, none closer than 350 m.
      let coming = false;
      let closest = Number.POSITIVE_INFINITY;
      for (let i = 1; i < 20; i++) {
        const g = ahead(s.race.carFacts(i).s, spot);
        if (g > 400 && g < 600) coming = true;
        if (g > -30) closest = Math.min(closest, g);
      }
      if (coming && closest > 350) {
        s.scriptedRaceDriver = false;
        s.teleport(spot, lineAt(spot), 0);
        parked = true;
      }
    }
    s.tick({ ...NEUTRAL_INPUT, brake: parked ? 1 : 0 }, 'keyboard');
    if (!parked) continue;
    const s0 = s.race.carFacts(0).s;
    for (let i = 0; i < 20; i++) {
      const f = s.race.carFacts(i);
      const ds = ahead(s0, f.s);
      peakContact = Math.max(peakContact, s.race.worldCar(i).state.carContactSpeed);
      if (i > 0 && ds > 10 && ds < 200) past[i] = true;
      if (i > 0 && Math.abs(ds) < 150 && f.wheelsOff >= 4 && f.speed > 5) offNear++;
    }
  }
  expect(parked).toBe(true);
  return {
    peakContact,
    offNear,
    past: past.filter(Boolean).length,
    finished: s.race.control.cars.slice(1).filter((c) => c.status === 'finished').length,
  };
}
