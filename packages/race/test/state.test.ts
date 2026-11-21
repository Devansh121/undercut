import { createRng } from '@undercut/core';
import { describe, expect, it } from 'vitest';
import { RaceControl } from '../src/control';
import { buildResult } from '../src/results';
import { Championship, RaceWeekend } from '../src/weekend';
import { RAIL_CIRCUIT, RailRace, STEP, ofType, type RailScript } from './rails';

const entrants = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: `d${i}`,
    name: `Driver ${i}`,
    code: `D${i}`,
    team: i % 5,
  }));

function field(seed: number, n: number): RailScript[] {
  const rng = createRng(seed);
  return Array.from({ length: n }, () => {
    const base = rng.range(42, 60);
    const wobble = rng.range(0, 6);
    const phase = rng.range(0, 6);
    return {
      speed: (t: number) => base + wobble * Math.sin(t / 7 + phase),
      wheelsOff: (t: number, s: number) =>
        Math.sin(t * 0.37 + phase) > 0.995 && s > 400 && s < 420 ? 4 : 0,
    };
  });
}

describe('snapshot and restore', () => {
  it('a restored race continues exactly like the original, through pit stops and the finish', () => {
    const a = new RailRace({ kind: 'race', laps: 6 }, field(7, 6), { seed: 9 });
    a.run(12, () => a.control.lightsOutAt !== null);
    a.run(60);
    a.request(2);
    a.request(4, []);
    a.run(15);
    const snap = a.control.snapshot();
    // The snapshot is plain JSON.
    const text = JSON.stringify(snap);
    expect(JSON.parse(text)).toEqual(snap);
    // A fresh engine (same options) restored from it, fed the same facts from here on.
    const b = new RaceControl({
      circuit: RAIL_CIRCUIT,
      session: { kind: 'race', laps: 6 },
      entrants: a.rails.map((_, i) => ({ team: i })),
      seed: 9,
    });
    b.restore(JSON.parse(text));
    expect(b.snapshot()).toEqual(snap);
    const evA: unknown[] = [];
    const evB: unknown[] = [];
    for (let k = 0; k < 240 * 400 && !a.control.ended; k++) {
      evA.push(...a.step());
      evB.push(...b.tick(a.time, a.facts));
    }
    expect(a.control.ended).toBe(true);
    expect(evB).toEqual(evA);
    expect(b.snapshot()).toEqual(a.control.snapshot());
    expect(buildResult(b, entrants(6), 9)).toEqual(buildResult(a.control, entrants(6), 9));
  });

  it('round-trips mid-qualifying, with cars still in the garage', () => {
    const a = new RailRace({ kind: 'qualifying', duration: 120 }, field(3, 4), { seed: 2 });
    a.run(6);
    const snap = a.control.snapshot();
    const b = new RaceControl({
      circuit: RAIL_CIRCUIT,
      session: { kind: 'qualifying', duration: 120 },
      entrants: a.rails.map((_, i) => ({ team: i })),
      seed: 2,
    });
    b.restore(snap);
    for (let k = 0; k < 240 * 60; k++) {
      const ea = a.step();
      expect(b.tick(a.time, a.facts)).toEqual(ea);
    }
  });

  it('refuses a snapshot from another field size or version', () => {
    const a = new RailRace({ kind: 'race', laps: 3 }, field(1, 3));
    const snap = a.control.snapshot();
    const other = new RaceControl({
      circuit: RAIL_CIRCUIT,
      session: { kind: 'race', laps: 3 },
      entrants: [{ team: 0 }],
      seed: 1,
    });
    expect(() => other.restore(snap)).toThrow();
    expect(() => a.control.restore({ ...snap, version: 2 as 1 })).toThrow();
  });
});

describe('determinism', () => {
  it('the same seed and inputs give the same events and result', () => {
    const run = () => {
      const r = new RailRace({ kind: 'race', laps: 5 }, field(11, 8), { seed: 4 });
      r.run(12, () => r.control.lightsOutAt !== null);
      r.run(40);
      r.request(3);
      r.runToEnd();
      return { log: r.log, result: buildResult(r.control, entrants(8), 4) };
    };
    const a = run();
    const b = run();
    expect(b.log).toEqual(a.log);
    expect(b.result).toEqual(a.result);
  });
});

describe('positions', () => {
  it('are always a total order consistent with race distance (property, many seeded fields)', () => {
    // Checked in plain code every few ticks and asserted once per field (expect() in the loop
    // would dominate the run time).
    const failures: string[] = [];
    for (let seed = 1; seed <= 12; seed++) {
      const n = 3 + (seed % 6);
      const r = new RailRace({ kind: 'race', laps: 3 }, field(seed, n), { seed });
      for (let k = 0; k < 240 * 300 && !r.control.ended; k++) {
        r.step();
        if (k % 7 !== 0) continue;
        const c = r.control;
        const order = c.order;
        const sorted = [...order].sort((x, y) => x - y);
        if (sorted.length !== n || sorted.some((v, i) => v !== i))
          failures.push(`${seed}@${k}: not a permutation`);
        order.forEach((car, idx) => {
          if (c.cars[car]!.position !== idx + 1) failures.push(`${seed}@${k}: car ${car} position`);
        });
        // Running cars in order of race distance (finished ones by their frozen distance).
        const dist = order.map((car) => c.cars[car]!.finishDist ?? c.cars[car]!.dist);
        for (let i = 1; i < dist.length; i++) {
          if (dist[i]! > dist[i - 1]! + 1e-9)
            failures.push(`${seed}@${k}: ${order[i]} ahead of ${order[i - 1]}`);
        }
      }
      expect(r.control.ended).toBe(true);
    }
    expect(failures).toEqual([]);
  });

  it('gives gaps to the leader and intervals at mini-sectors, and laps down', () => {
    const r = new RailRace({ kind: 'race', laps: 8 }, [
      { speed: 60 },
      { speed: 55 },
      { speed: 30 },
    ]);
    r.run(12, () => r.control.lightsOutAt !== null);
    r.run(30);
    const rows = r.control.standings();
    expect(rows.map((x) => x.car)).toEqual([0, 1, 2]);
    expect(rows[0]!.gap).toBeNull();
    // Car 1 at 55 m/s against 60 m/s from 8 m back: the gap grows about 0.0909 s per 55 m.
    expect(rows[1]!.gap!).toBeGreaterThan(0);
    expect(rows[1]!.interval).toBeCloseTo(rows[1]!.gap!, 9);
    r.run(40);
    const later = r.control.standings();
    expect(later[2]!.lapsDown).toBeGreaterThanOrEqual(1);
    expect(later[2]!.gap).toBeNull();
  });
});

describe('weekend and championship', () => {
  it('chains practice, qualifying and the race with the grid from qualifying', () => {
    const w = new RaceWeekend({ circuit: 'rails', practice: 60, qualifying: 120, raceLaps: 3 }, 3);
    const scripts: RailScript[] = [{ speed: 48 }, { speed: 55 }, { speed: 52 }];
    while (!w.done) {
      const spec = w.next()!;
      const grid = spec.kind === 'race' ? w.grid() : [0, 1, 2];
      const r = new RailRace(
        spec,
        grid.map((car) => scripts[car]!),
      );
      r.runToEnd();
      const res = buildResult(r.control, entrants(3), 1);
      // Map back from grid slot to car index for the race.
      res.entries = res.entries.map((e) => ({ ...e, car: grid[e.car]!, id: `d${grid[e.car]!}` }));
      w.complete(res);
    }
    expect(w.results.map((r) => r.kind)).toEqual(['practice', 'qualifying', 'race']);
    expect(w.grid()).toEqual([1, 2, 0]);
    expect(w.race()!.entries.map((e) => e.car)).toEqual([1, 2, 0]);
    const restored = RaceWeekend.fromJSON(JSON.parse(JSON.stringify(w.toJSON())), 3);
    expect(restored.grid()).toEqual(w.grid());
  });

  it('carries points and standings across circuits with count-back', () => {
    const champ = new Championship(['rails', 'rails']);
    const raceOf = (order: number[]) => {
      const r = new RailRace(
        { kind: 'race', laps: 2 },
        order.map((_, k) => ({ speed: 60 - 3 * k })),
      );
      r.runToEnd();
      const res = buildResult(r.control, entrants(3), 1);
      res.entries = res.entries.map((e) => ({ ...e, id: `d${order[e.car]!}` }));
      return res;
    };
    champ.record(raceOf([0, 1, 2]));
    champ.record(raceOf([1, 0, 2]));
    expect(champ.done).toBe(true);
    const d = champ.drivers();
    expect(d.map((x) => x.points)).toEqual([43, 43, 30]);
    // Tied on points and wins; count-back on seconds also ties, so by id.
    expect(d.map((x) => x.id)).toEqual(['d0', 'd1', 'd2']);
    const t = champ.teams(entrants(3));
    expect(t[0]!.points).toBe(43);
    expect(Championship.fromJSON(JSON.parse(JSON.stringify(champ.toJSON()))).drivers()).toEqual(d);
    expect(() => champ.record(raceOf([0, 1, 2]))).toThrow();
  });
});

describe('watchdog', () => {
  it('flags a car stopped on track, retires it after a minute, and leaves pit stops alone', () => {
    const r = new RailRace({ kind: 'race', laps: 6 }, [{ speed: 50 }, { speed: 50, stopAt: 40 }], {
      rules: { serviceSpread: 0 },
    });
    r.run(12, () => r.control.lightsOutAt !== null);
    r.request(0);
    r.runToEnd();
    const a = r.control.anomalies();
    expect(a.filter((x) => x.car === 0)).toEqual([]);
    const kinds = a.filter((x) => x.car === 1).map((x) => x.kind);
    expect(kinds).toContain('stationary');
    expect(kinds).toContain('noProgress');
    const retired = ofType(r.log, 'retired');
    expect(retired).toMatchObject([{ car: 1, reason: 'stuck' }]);
    // Sixty seconds from when it stopped (the onset of the stuck finding).
    expect(retired[0]!.t - 40).toBeCloseTo(60, 0);
    const res = buildResult(r.control, entrants(2), 1);
    expect(res.entries[1]).toMatchObject({ status: 'dnf', reason: 'stuck' });
  });

  it('flags a car driving the wrong way and one off the track for too long', () => {
    const r = new RailRace({ kind: 'qualifying', duration: 200 }, [
      { speed: (t) => (t > 40 && t < 46 ? -10 : 50) },
      { speed: 50, wheelsOff: (t) => (t > 40 && t < 55 ? 4 : 0) },
    ]);
    r.run(70);
    const kinds = r.control.anomalies().map((a) => `${a.car}:${a.kind}`);
    expect(kinds).toContain('0:wrongWay');
    expect(kinds).toContain('1:offTrack');
    expect(r.control.anomalies().every((a) => a.end !== null)).toBe(true);
    void STEP;
  });
});
