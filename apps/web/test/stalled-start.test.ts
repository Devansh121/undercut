import { expect, it } from 'vitest';
import { NEUTRAL_INPUT } from '@undercut/sim';
import { DriveSession } from '../src/game/session';
import { loadMonza } from './fixtures';

// The player stalls on the grid (never touches the controls) in mid-grid. The audio review's
// renders: the cars behind in the same grid column idled for the whole 16 s, still "launching"
// behind a car that never left, so they never went round it. Now they stop launching once boxed
// in, and the stalled car soon becomes a ghost for the cars it holds up. Every car that started
// behind it gets away within seconds, and none touches another round it.

it('the player stalls on the grid: every car behind gets away within seconds, untouched', () => {
  const track = loadMonza();
  const s = new DriveSession({ track, seed: 1, quickRace: { laps: 5, gridPosition: 10 } });
  const L = track.length;
  const ahead = (a: number, b: number): number => {
    let x = (b - a) % L;
    if (x > L / 2) x -= L;
    else if (x <= -L / 2) x += L;
    return x;
  };
  s.start();
  const behind: boolean[] = [];
  const pastAt: (number | null)[] = new Array<number | null>(20).fill(null);
  let lightsOut: number | null = null;
  let contactNear = 0;
  while (s.world.time < 120) {
    s.tick(NEUTRAL_INPUT, 'keyboard');
    if (lightsOut === null) {
      if (s.race.control.phase !== 'green') continue;
      lightsOut = s.world.time;
      const p = s.race.carFacts(0).s;
      for (let i = 1; i < 20; i++) behind[i] = ahead(p, s.race.carFacts(i).s) < 0;
    }
    const t = s.world.time - lightsOut;
    if (t > 30) break;
    const p = s.race.carFacts(0).s;
    for (let i = 1; i < 20; i++) {
      const ds = ahead(p, s.race.carFacts(i).s);
      if (behind[i] && pastAt[i] === null && ds > 10) pastAt[i] = t;
    }
    for (let i = 0; i < 20; i++) {
      const near = Math.abs(ahead(p, s.race.carFacts(i).s)) < 50;
      if (near && s.race.worldCar(i).state.carContacts > 0) contactNear++;
    }
  }
  expect(lightsOut).not.toBeNull();
  const starters = behind.map((b, i) => (b ? i : -1)).filter((i) => i > 0);
  expect(starters.length).toBe(10);
  // Every one of them past the stalled car, the last within 12 s of the lights (the other grid
  // column takes some 5 s; this one launches one car behind another round the stalled car).
  for (const i of starters) {
    expect(pastAt[i]).not.toBeNull();
    expect(pastAt[i]!).toBeLessThan(12);
  }
  expect(contactNear).toBe(0);
}, 120_000);
