import { describe, expect, it } from 'vitest';
import { ManualRace, ofType } from './rails';

// Regression tests for the adversarial review of PR #15: each scenario is the reviewer's,
// written before its fix. Rail loop: 1000 m, timing line at s = 950, grid slot 0 at +40 m,
// slot 1 at +32 m (race distance from the timing line).

describe('repositioning a car (review 9)', () => {
  it('a move from just before the timing line to just after it crosses nothing', () => {
    const r = new ManualRace({ kind: 'practice', duration: 600, releaseInterval: 0 }, 1);
    // Out of the garage on the rails: drive a first lap past the line, then sit before the line.
    r.inPit[0] = () => null;
    // Drive the lap and stop 10 m before the line (race distance 990).
    r.dist[0] = (u) => Math.min(-60 + 50 * u, 990);
    r.run(23);
    expect(r.control.timer(0).lap).toBe(1);
    expect(r.control.timer(0).valid).toBe(true);
    const facts = { ...r.facts[0]!, s: (950 + 5) % 1000 };
    r.control.reposition(0, facts);
    r.dist[0] = (u) => 1005 + 0 * u;
    const before = r.log.length;
    r.run(0.5);
    const after = r.log.slice(before);
    expect(ofType(after, 'lap')).toEqual([]);
    expect(ofType(after, 'lapStart')).toEqual([]);
    expect(ofType(after, 'sector')).toEqual([]);
    // Moved over the line: the next lap runs from there and does not count; timing carries on.
    const t = r.control.timer(0);
    expect(t.lap).toBe(2);
    expect(t.valid).toBe(false);
    expect(t.lapDistance).toBeCloseTo(5, 6);
  });

  it('a move backwards keeps the lap running and valid, and the lines ahead still count', () => {
    const r = new ManualRace({ kind: 'practice', duration: 600, releaseInterval: 0 }, 1);
    r.inPit[0] = () => null;
    r.dist[0] = (u) => -60 + 50 * u;
    r.run(4);
    const t0 = r.control.time;
    r.control.reposition(0, { ...r.facts[0]!, s: (950 + 20) % 1000 });
    r.dist[0] = (u) => 20 + 50 * (u - (t0 - (r.control.greenTime ?? 0)));
    const before = r.log.length;
    r.run(8);
    const sectors = ofType(r.log.slice(before), 'sector');
    expect(sectors.map((e) => e.index)).toEqual([0]);
    expect(r.control.timer(0).valid).toBe(true);
  });
});
