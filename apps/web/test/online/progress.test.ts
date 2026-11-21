import { describe, expect, it } from 'vitest';
import { LineCounter } from '../../src/online/progress';

const L = 1000;

describe('LineCounter', () => {
  it('measures s from the timing line', () => {
    const c = new LineCounter({ length: L, timingLine: 900, startS: 950 });
    expect(c.lineS(950)).toBeCloseTo(50);
    expect(c.lineS(100)).toBeCloseTo(200);
    expect(c.lineS(900)).toBeCloseTo(0);
  });

  it('counts a forward crossing as a lap, with the crossing time interpolated', () => {
    // Grid just after the line: the first crossing completes lap 1.
    const c = new LineCounter({ length: L, timingLine: 0, startS: 20 });
    expect(c.update(20, 0)).toBeNull();
    expect(c.update(500, 10)).toBeNull();
    expect(c.update(990, 20)).toBeNull();
    const lap = c.update(10, 21);
    expect(lap).not.toBeNull();
    expect(lap?.lap).toBe(1);
    // 10 m before the line, 10 m after: half way through the step.
    expect(lap?.time).toBeCloseTo(20.5, 9);
    expect(c.laps).toBe(1);
  });

  it('does not count the start-line pass when the grid is behind the timing line', () => {
    const c = new LineCounter({ length: L, timingLine: 0, startS: 960 });
    c.update(960, 0);
    expect(c.update(5, 1)).toBeNull();
    expect(c.laps).toBe(0);
    c.update(600, 10);
    c.update(995, 20);
    expect(c.update(3, 20.2)?.lap).toBe(1);
  });

  it('owes a lap for every backward crossing before counting again', () => {
    const c = new LineCounter({ length: L, timingLine: 0, startS: 20 });
    c.update(20, 0);
    expect(c.update(990, 1)).toBeNull(); // reversed over the line
    expect(c.update(10, 2)).toBeNull(); // forward again: pays the debt
    c.update(600, 10);
    c.update(995, 20);
    expect(c.update(5, 21)?.lap).toBe(1);
  });

  it('never counts across a placement', () => {
    const c = new LineCounter({ length: L, timingLine: 0, startS: 20 });
    c.update(20, 0);
    c.update(400, 5);
    c.placed(990, 6);
    expect(c.update(995, 6.1)).toBeNull();
    expect(c.update(4, 6.2)?.lap).toBe(1);
    // A placement straight over the line is not a lap either.
    c.update(990, 30);
    c.placed(5, 31);
    expect(c.update(10, 31.1)).toBeNull();
    expect(c.laps).toBe(1);
  });

  it('ignores jumps too large to be a step of driving', () => {
    const c = new LineCounter({ length: L, timingLine: 0, startS: 20 });
    c.update(20, 0);
    c.update(700, 1);
    expect(c.update(100, 2)).toBeNull();
    expect(c.laps).toBe(0);
  });

  it('can resume with laps already counted', () => {
    const c = new LineCounter({ length: L, timingLine: 0, startS: 20 });
    c.setLaps(3);
    c.update(990, 0);
    expect(c.update(2, 0.1)?.lap).toBe(4);
  });
});
