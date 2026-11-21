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

describe('penalties served in the pits (review 5)', () => {
  it('a penalty awarded during the hold is not wiped by it', () => {
    const r = new RailRace({ kind: 'race', laps: 6 }, [{ speed: 50 }], {
      rules: { serviceSpread: 0 },
    });
    r.run(12, () => r.control.lightsOutAt !== null);
    r.control.penalise(0, 'trackLimits', 5);
    r.request(0);
    r.run(200, () => r.control.pitPhase(0) === 'penalty');
    r.run(2);
    r.control.penalise(0, 'pitSpeeding', 5);
    r.run(30, () => r.control.pitPhase(0) === 'service');
    expect(r.control.unservedPenalty(0)).toBe(5);
    const served = ofType(r.log, 'penaltyServed');
    expect(served).toMatchObject([{ seconds: 5 }]);
    r.runToEnd();
    const res = buildResult(r.control, entrants(1), 1).entries[0]!;
    expect(res.penaltyTime).toBe(5);
    expect(res.penalties).toEqual([
      { reason: 'trackLimits', seconds: 5, served: true },
      { reason: 'pitSpeeding', seconds: 5, served: false },
    ]);
  });
});

describe('places gained off track at the finish (review 6)', () => {
  it('a place kept to the line is penalised before classification', () => {
    const r = new ManualRace({ kind: 'race', laps: 1 }, 2);
    r.toGreen();
    // Car 1 passes car 0 at 900 m while all four wheels are off, and crosses the line first.
    r.dist[0] = (u) => 40 + 50 * u;
    r.dist[1] = (u) => (u < 17 ? 32 + 50 * u : 882 + 80 * (u - 17));
    r.wheelsOff[1] = (u) => (u > 17 && u < 18 ? 4 : 0);
    r.run(40, () => r.control.ended);
    expect(ofType(r.log, 'penalty')).toMatchObject([
      { car: 1, reason: 'leavingTrack', seconds: 5 },
    ]);
    const res = buildResult(r.control, entrants(2), 1);
    expect(res.entries.map((e) => e.car)).toEqual([0, 1]);
  });
});

describe('classification after the flag (review 8)', () => {
  it('a car that takes the flag with less than 90 % of the winner’s laps is not classified', () => {
    const race = new RailRace({ kind: 'race', laps: 10 }, [{ speed: 60 }, { speed: 5.7 }]);
    race.runToEnd();
    const res = buildResult(race.control, entrants(2), 1);
    const slow = res.entries.find((e) => e.car === 1)!;
    expect(slow.laps).toBeLessThan(9);
    expect(slow.status).toBe('notClassified');
    expect(slow.points).toBe(0);
  });
});
