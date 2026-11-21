import { describe, expect, it } from 'vitest';
import { buildResult } from '../src/results';
import { ManualRace, RailRace, ofType } from './rails';

// Regression tests for the adversarial review of PR #15: each scenario is the reviewer's,
// written before its fix. Rail loop: 1000 m, timing line at s = 950, grid slot 0 at +40 m,
// slot 1 at +32 m (race distance from the timing line).

const entrants = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: `d${i}`,
    name: `Driver ${i}`,
    code: `D${i}`,
    team: i,
  }));

describe('watchdog (review 10, 1, 12)', () => {
  const kinds = (
    r: { control: { anomalies(): readonly { car: number; kind: string }[] } },
    car: number,
  ) => [
    ...new Set(
      r.control
        .anomalies()
        .filter((a) => a.car === car)
        .map((a) => a.kind),
    ),
  ];

  it('a car crawling 8 s at 1.1 m/s then stopping 2 s, over and over, makes no progress', () => {
    const r = new ManualRace({ kind: 'race', laps: 5 }, 1, { rules: { retireStuckAfter: null } });
    r.toGreen();
    const cycle = (u: number) => {
      const k = Math.floor(u / 10);
      const f = u - 10 * k;
      return k * 8.8 + 1.1 * Math.min(f, 8);
    };
    r.dist[0] = (u) => 40 + cycle(u);
    r.run(60);
    expect(kinds(r, 0)).toContain('noProgress');
    const a = r.control.anomalies().find((x) => x.kind === 'noProgress')!;
    expect(a.end).toBeNull();
  });

  it('flags a car creeping at 0.5 m/s, and one rocking back and forth, but not one crawling at 1.2 m/s', () => {
    const r = new ManualRace({ kind: 'race', laps: 5 }, 3, { rules: { retireStuckAfter: null } });
    r.toGreen();
    r.dist[0] = (u) => 40 + 0.5 * u;
    r.dist[1] = (u) => 32 + 3 * Math.sin(u);
    r.dist[2] = (u) => 24 + 1.2 * u;
    r.run(40);
    expect(kinds(r, 0)).toEqual(expect.arrayContaining(['stationary', 'noProgress']));
    expect(kinds(r, 1)).toContain('noProgress');
    expect(kinds(r, 2)).toEqual([]);
  });

  it('flags a car circling off track', () => {
    const r = new ManualRace({ kind: 'race', laps: 5 }, 1, { rules: { retireStuckAfter: null } });
    r.toGreen();
    r.dist[0] = (u) => (u < 10 ? 40 + 40 * u : 440 + 15 * Math.sin((u - 10) / 2));
    r.wheelsOff[0] = (u) => (u < 10 ? 0 : 4);
    r.run(40);
    expect(kinds(r, 0)).toEqual(expect.arrayContaining(['offTrack', 'noProgress']));
  });

  it('never flags cars that are meant to stand still: grid before lights, garage, box, penalty, retired', () => {
    // Grid before the lights: twenty seconds on the grid with a long hold.
    const g = new ManualRace({ kind: 'race', laps: 3 }, 2, { rules: { gridTime: 15 } });
    g.run(18);
    expect(g.control.lightsOutAt).toBeNull();
    expect(g.control.anomalies()).toEqual([]);
    // Garage at a practice start, a long penalty hold and service, then a retired car.
    const r = new RailRace({ kind: 'race', laps: 8 }, [{ speed: 50 }, { speed: 50, stopAt: 30 }], {
      rules: { serviceSpread: 0, retireStuckAfter: 20 },
    });
    r.run(12, () => r.control.lightsOutAt !== null);
    r.control.penalise(0, 'trackLimits', 25);
    r.request(0);
    r.runToEnd();
    expect(r.control.anomalies().filter((a) => a.car === 0)).toEqual([]);
    expect(r.control.cars[1]!.status).toBe('dnf');
    // Parked after retiring: no further findings after the retirement.
    const retiredAt = ofType(r.log, 'retired')[0]!.t;
    expect(r.control.anomalies().filter((a) => a.car === 1 && a.start > retiredAt)).toEqual([]);
    const p = new RailRace({ kind: 'practice', duration: 120, releaseInterval: 60 }, [
      { speed: 50 },
      { speed: 50 },
    ]);
    p.run(100);
    expect(p.control.anomalies()).toEqual([]);
  });

  it('does not retire a human driver in time trial or practice; it does in a race', () => {
    for (const kind of ['timeTrial', 'practice'] as const) {
      const r = new ManualRace(
        kind === 'practice' ? { kind, duration: 600, releaseInterval: 0 } : { kind },
        1,
        {
          human: [true],
        },
      );
      r.dist[0] = (u) => (u < 5 ? -100 + 40 * u : 100);
      r.run(90);
      expect(r.control.cars[0]!.status).toBe('running');
      expect(kinds(r, 0)).toContain('stationary');
    }
    const race = new ManualRace({ kind: 'race', laps: 3 }, 1, { human: [true] });
    race.toGreen();
    race.dist[0] = (u) => (u < 2 ? 40 + 20 * u : 80);
    race.run(80);
    expect(race.control.cars[0]!.status).toBe('dnf');
  });

  it('ends the session when every car has retired before the flag (review 12)', () => {
    const r = new RailRace({ kind: 'race', laps: 20 }, [
      { speed: 50, stopAt: 20 },
      { speed: 50, stopAt: 25 },
    ]);
    r.run(400, () => r.control.ended);
    expect(r.control.ended).toBe(true);
    expect(ofType(r.log, 'sessionEnd')).toHaveLength(1);
    const res = buildResult(r.control, entrants(2), 1);
    expect(res.entries.map((e) => e.status)).toEqual(['dnf', 'dnf']);
    expect(res.entries[0]!.car).toBe(1);
  });
});

describe('blue flags past the first lapping (review 11)', () => {
  it('shows blue every time the leader comes up to lap the same car', () => {
    const race = new RailRace({ kind: 'race', laps: 12 }, [{ speed: 60 }, { speed: 30 }]);
    race.runToEnd();
    const on = ofType(race.log, 'flag').filter((e) => e.flag === 'blue' && e.on && e.car === 1);
    // Car 0 laps car 1 at about 1000 m, 2000 m, 3000 m ... of gain: five times in twelve laps.
    expect(on.length).toBeGreaterThanOrEqual(5);
  });
});
