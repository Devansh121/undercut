import { createRng } from '@undercut/core';
import { describe, expect, it } from 'vitest';
import type { RaceEvent } from '../src/events';
import { buildResult, type SessionResult } from '../src/results';
import { RAIL_CIRCUIT, RailRace, type RailScript } from './rails';

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

/** A seeded field with excursions (strikes, penalties), team-mates sharing boxes, a jump start. */
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
    scripts.push(script);
  }
  const teams = Array.from({ length: n }, (_, i) => i >> 1);
  const stops = [
    { car: 0, at: rng.range(30, 60) },
    { car: 1, at: rng.range(30, 60) },
    { car: n - 2, at: rng.range(40, 80) },
  ];
  return { scripts, teams, stops };
}

/** Run the field with car k of this race being car perm[k] of the original. */
function run(f: Field, perm: number[], seed: number): { log: RaceEvent[]; result: SessionResult } {
  const n = perm.length;
  const circuit = { ...RAIL_CIRCUIT, grid: perm.map((o) => RAIL_CIRCUIT.grid[o]!) };
  const race = new RailRace(
    { kind: 'race', laps: 4 },
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
  void n;
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
      // The scenario exercises what the property is about.
      const kinds = new Set(base.log.map((e) => e.type));
      expect(kinds.has('penalty') && kinds.has('pit') && kinds.has('finish')).toBe(true);
    }
  });
});
