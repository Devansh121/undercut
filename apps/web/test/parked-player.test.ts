import { expect, it } from 'vitest';
import { decodeRacingLine, racingLineOffsets } from '@undercut/ai';
import { NEUTRAL_INPUT } from '@undercut/sim';
import raceLine from '../../../packages/ai/data/monza-low.line.json';
import { DriveSession } from '../src/game/session';
import { loadMonza } from './fixtures';

// The player stops on the racing line at Lesmo 2 (s = 2420 m) a minute into a Quick Race, as the
// field arrives, and holds the brake: the review's case. The cars going round on the right came
// alongside each other in that lane, and the inner one was squeezed into the stopped car (a
// 0.96 m/s touch and 180 ticks of cars with all four wheels off, seed 1). Now the cars already
// in the lane are followed in single file: no contact and every wheel on the road round the
// spot, every other car past, and all of them home.

it('the player stopped on the line at Lesmo 2: the field goes round in single file, untouched', () => {
  const track = loadMonza();
  const s = new DriveSession({ track, seed: 1, quickRace: { laps: 5, gridPosition: 1 } });
  const L = track.length;
  const ahead = (a: number, b: number): number => {
    let x = (b - a) % L;
    if (x > L / 2) x -= L;
    else if (x <= -L / 2) x += L;
    return x;
  };
  // The racing line's offset at the spot (the line the session's own drivers use).
  const spot = 2420;
  const offsets = racingLineOffsets(decodeRacingLine(raceLine));
  const u = track.wrap(spot) / track.lap.step;
  const n = offsets.length;
  const i0 = Math.floor(u) % n;
  const lineD = offsets[i0]! + (offsets[(i0 + 1) % n]! - offsets[i0]!) * (u - Math.floor(u));
  s.start();
  s.scriptedRaceDriver = true;
  let parked = false;
  let contactNear = 0;
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
        s.teleport(spot, lineD, 0);
        parked = true;
      }
    }
    s.tick({ ...NEUTRAL_INPUT, brake: parked ? 1 : 0 }, 'keyboard');
    if (!parked) continue;
    const s0 = s.race.carFacts(0).s;
    for (let i = 0; i < 20; i++) {
      const f = s.race.carFacts(i);
      const ds = ahead(s0, f.s);
      const near = Math.abs(ds) < 150;
      if (i > 0 && ds > 10 && ds < 200) past[i] = true;
      if (!near) continue;
      if (s.race.worldCar(i).state.carContacts > 0) contactNear++;
      if (i > 0 && f.wheelsOff >= 4 && f.speed > 5) offNear++;
    }
  }
  expect(parked).toBe(true);
  expect(contactNear).toBe(0);
  expect(offNear).toBe(0);
  expect(past.slice(1).every((p) => p)).toBe(true);
  expect(s.race.control.cars.slice(1).every((c) => c.status === 'finished')).toBe(true);
}, 300_000);
