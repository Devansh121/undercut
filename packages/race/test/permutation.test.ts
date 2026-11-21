import { createRng } from '@undercut/core';
import { describe, expect, it } from 'vitest';
import type { RaceEvent } from '../src/events';
import { buildResult, type SessionResult } from '../src/results';
import { ManualRace, RAIL_CIRCUIT, RailRace, STEP, type RailScript } from './rails';

// Several review findings on #15 were order-dependence: a rule outcome that changed with the
// cars' index in the array. Property: the same seeded race on rails with the car array
// permuted (each car keeps its own grid slot, team, script and pit request) gives the same
// classification, penalties and event sequence, up to car identity.

interface Field {
  scripts: RailScript[];
  teams: number[];
  /** Pit requests: car, time after lights out. */
  stops: { car: number; at: number }[];
}

/**
 * A seeded field with excursions (car 2 goes off twice a lap: strikes up to a time penalty),
 * team-mates 0 and 1 running nose to tail and called in together (the second stacks behind
 * the first in their shared box), and a jump start by the last car.
 */
function field(seed: number, n: number): Field {
  const rng = createRng(seed);
  const scripts: RailScript[] = [];
  for (let i = 0; i < n; i++) {
    const base = rng.range(44, 60);
    const wobble = rng.range(0, 5);
    const phase = rng.range(0, 6);
    const offAt = rng.range(250, 900);
    const script: RailScript = {
      speed: (t: number) => base + wobble * Math.sin(t / 6 + phase),
      wheelsOff: (t: number, s: number) =>
        Math.sin(t * 0.21 + phase) > 0.9 && s > offAt && s < offAt + 15 ? 4 : 0,
      reaction: rng.range(0, 0.3),
    };
    if (i === n - 1) script.creepFrom = 5.5;
    if (i === 1) {
      // Car 0's team-mate: the same pace, a car length behind.
      script.speed = scripts[0]!.speed;
      script.reaction = (scripts[0]!.reaction ?? 0) + 0.05;
    }
    if (i === 2) {
      script.wheelsOff = (_t: number, s: number) =>
        (s > 300 && s < 310) || (s > 600 && s < 610) ? 4 : 0;
    }
    scripts.push(script);
  }
  const teams = Array.from({ length: n }, (_, i) => i >> 1);
  // Asked in during lap 1 (team-mates together) and lap 2: stops long before the flag.
  const together = rng.range(4, 10);
  const stops = [
    { car: 0, at: together },
    { car: 1, at: together },
    { car: n - 2, at: rng.range(22, 30) },
  ];
  return { scripts, teams, stops };
}

/** Run the field with car k of this race being car perm[k] of the original. */
function run(f: Field, perm: number[], seed: number): { log: RaceEvent[]; result: SessionResult } {
  const circuit = { ...RAIL_CIRCUIT, grid: perm.map((o) => RAIL_CIRCUIT.grid[o]!) };
  const race = new RailRace(
    { kind: 'race', laps: 3 },
    perm.map((o) => f.scripts[o]!),
    { seed, circuit, teams: perm.map((o) => f.teams[o]!), rules: { blueWindow: 8 } },
  );
  const index = new Map(perm.map((o, k) => [o, k]));
  race.run(12, () => race.control.lightsOutAt !== null);
  const out = race.control.lightsOutAt!;
  const pending = f.stops
    .map((s) => ({ car: index.get(s.car)!, at: out + s.at }))
    .sort((a, b) => a.at - b.at || a.car - b.car);
  race.run(1200, () => {
    while (pending.length > 0 && race.time >= pending[0]!.at) race.request(pending.shift()!.car);
    return race.control.ended;
  });
  const entrants = perm.map((o) => ({
    id: `d${o}`,
    name: `Driver ${o}`,
    code: `D${o}`,
    team: f.teams[o]!,
  }));
  return { log: race.log, result: buildResult(race.control, entrants, seed) };
}

/** Events with car numbers mapped back to the original cars. */
function canonical(log: readonly RaceEvent[], perm: number[]): unknown[] {
  return log.map((e) => {
    const c: Record<string, unknown> = { ...e };
    if (typeof c.car === 'number') c.car = perm[c.car];
    if (typeof c.by === 'number') c.by = perm[c.by];
    return c;
  });
}

/** Stops made while the team-mate was still being serviced in the shared box. */
function stacked(log: readonly RaceEvent[], teams: readonly number[]): number {
  const pits = log.filter((e): e is Extract<RaceEvent, { type: 'pit' }> => e.type === 'pit');
  let count = 0;
  for (const a of pits) {
    if (a.stage !== 'stop') continue;
    for (const b of pits) {
      if (b.stage !== 'serviceEnd' || b.car === a.car || teams[b.car] !== teams[a.car]) continue;
      const bStop = pits.find((x) => x.car === b.car && x.stage === 'stop' && x.t <= b.t);
      if (bStop && bStop.t <= a.t && a.t < b.t) count++;
    }
  }
  return count;
}

function canonicalResult(r: SessionResult, perm: number[]): unknown {
  return {
    ...r,
    entries: r.entries.map((e) => ({ ...e, car: perm[e.car] })),
    fastestLap: r.fastestLap ? { ...r.fastestLap, car: perm[r.fastestLap.car] } : null,
    anomalies: r.anomalies.map((a) => ({ ...a, car: perm[a.car] })),
  };
}

describe('order independence (property)', () => {
  it('a permuted field gives the same race up to car identity', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const n = 4 + (seed % 5);
      const f = field(seed, n);
      const identity = Array.from({ length: n }, (_, i) => i);
      const base = run(f, identity, seed);
      const rng = createRng(1000 + seed);
      for (let p = 0; p < 2; p++) {
        const perm = identity.slice();
        for (let i = n - 1; i > 0; i--) {
          const j = rng.int(0, i);
          [perm[i], perm[j]] = [perm[j]!, perm[i]!];
        }
        const other = run(f, perm, seed);
        expect(canonical(other.log, perm), `seed ${seed}, permutation ${perm.join(',')}`).toEqual(
          canonical(base.log, identity),
        );
        expect(canonicalResult(other.result, perm)).toEqual(canonicalResult(base.result, identity));
      }
      // The scenario exercises what the property is about: strikes up to a time penalty, a
      // stacked stop in a shared box, a jump start, finishes.
      const log = base.log;
      expect(
        log.filter((e) => e.type === 'trackLimits' && e.car === 2).length,
        `seed ${seed}: strikes`,
      ).toBeGreaterThanOrEqual(4);
      expect(
        log.some((e) => e.type === 'penalty' && e.reason === 'trackLimits'),
        `seed ${seed}: strike penalty`,
      ).toBe(true);
      expect(
        log.some((e) => e.type === 'penalty' && e.reason === 'jumpStart'),
        `seed ${seed}: jump start`,
      ).toBe(true);
      expect(stacked(log, f.teams), `seed ${seed}: stacked stop`).toBeGreaterThanOrEqual(1);
      expect(log.filter((e) => e.type === 'finish').length, `seed ${seed}: finishers`).toBe(n);
      const serviced = new Set(
        log
          .filter((e) => e.type === 'pit' && e.stage === 'serviceEnd')
          .map((e) => (e as { car: number }).car),
      );
      expect([...serviced].sort(), `seed ${seed}: stops made`).toEqual([0, 1, n - 2].sort());
      expect(
        log.some((e) => e.type === 'pit' && e.stage === 'missed'),
        `seed ${seed}: no missed box`,
      ).toBe(false);
    }
    // Thirty rail races: about 2 s here, more on a shared CI runner. A limit on run time only.
  }, 30_000);

  it('exact ties at the finish resolve the same way in every order of the field', () => {
    // Cars 0 and 1 cross the line at exactly the same interpolated time (car 1 ahead before the
    // tick); car 2 finishes later. Every order of the three must give the same race.
    const tieRun = (perm: number[]) => {
      const circuit = { ...RAIL_CIRCUIT, grid: perm.map((o) => RAIL_CIRCUIT.grid[o]!) };
      const r = new ManualRace({ kind: 'race', laps: 1 }, 3, { circuit });
      r.toGreen();
      const at = r.tickEndAfter(20);
      const start = at - STEP;
      const fns: ((u: number) => number)[] = [
        (u) => (u < start ? 40 + ((999 - 40) * u) / start : 999 + (u - start) / STEP),
        (u) => (u < start ? 32 + ((999.5 - 32) * u) / start : 999.5 + (0.5 * (u - start)) / STEP),
        (u) => 24 + 45 * u,
      ];
      perm.forEach((o, k) => (r.dist[k] = fns[o]!));
      r.run(40, () => r.control.ended);
      const entrants = perm.map((o) => ({
        id: `d${o}`,
        name: `Driver ${o}`,
        code: `D${o}`,
        team: o,
      }));
      return { log: r.log, result: buildResult(r.control, entrants, 1) };
    };
    const identity = [0, 1, 2];
    const base = tieRun(identity);
    expect(base.result.entries.slice(0, 2).map((e) => e.car)).toEqual([1, 0]);
    expect(base.result.entries[0]!.totalTime).toBe(base.result.entries[1]!.totalTime);
    for (const perm of [
      [0, 2, 1],
      [1, 0, 2],
      [1, 2, 0],
      [2, 0, 1],
      [2, 1, 0],
    ]) {
      const other = tieRun(perm);
      expect(canonical(other.log, perm), `permutation ${perm.join(',')}`).toEqual(
        canonical(base.log, identity),
      );
      expect(canonicalResult(other.result, perm)).toEqual(canonicalResult(base.result, identity));
    }
  });
});
