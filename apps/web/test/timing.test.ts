import { describe, expect, it } from 'vitest';
import { LapTimer, crossingFraction, type TimingEvent } from '../src/game/timing';

// A 1000 m loop with sector lines at 0, 300 and 650 m.
const LINES = { length: 1000, sectors: [0, 300, 650] };

/** Drive the timer at constant speed from s0 for `seconds`, ticking at `dt`. */
function drive(
  timer: LapTimer,
  from: { s: number; t: number },
  speed: number,
  seconds: number,
  dt = 1 / 240,
): { s: number; t: number; events: TimingEvent[] } {
  const events: TimingEvent[] = [];
  let s = from.s;
  let t = from.t;
  const steps = Math.round(seconds / dt);
  for (let i = 0; i < steps; i++) {
    const ns = (s + speed * dt) % LINES.length;
    const nt = t + dt;
    events.push(...timer.update(s, ns, t, nt));
    s = ns;
    t = nt;
  }
  return { s, t, events };
}

describe('crossingFraction', () => {
  it('finds where inside the tick the line was crossed', () => {
    expect(crossingFraction(1000, 290, 310, 300)).toBeCloseTo(0.5, 12);
    expect(crossingFraction(1000, 299, 304, 300)).toBeCloseTo(0.2, 12);
  });

  it('handles the start/finish wrap', () => {
    expect(crossingFraction(1000, 995, 5, 0)).toBeCloseTo(0.5, 12);
    expect(crossingFraction(1000, 999, 1, 0)).toBeCloseTo(0.5, 12);
  });

  it('counts landing exactly on the line as crossing it, and starting on it as not', () => {
    expect(crossingFraction(1000, 290, 300, 300)).toBe(1);
    expect(crossingFraction(1000, 300, 310, 300)).toBeNull();
  });

  it('ignores lines not crossed, and backwards motion', () => {
    expect(crossingFraction(1000, 100, 200, 300)).toBeNull();
    expect(crossingFraction(1000, 310, 290, 300)).toBeNull();
    expect(crossingFraction(1000, 5, 995, 0)).toBeNull();
  });
});

describe('LapTimer', () => {
  it('starts the first lap when the line is crossed and interpolates the start time', () => {
    const timer = new LapTimer(LINES);
    // 100 m/s, 240 Hz: 0.4167 m per tick. Start 10.1 m before the line.
    const out = drive(timer, { s: 989.9, t: 0 }, 100, 0.2);
    const start = out.events.find((e) => e.type === 'lapStart');
    expect(start).toBeDefined();
    // Exactly 0.101 s after t = 0, to well under a millisecond despite 4.2 ms ticks.
    expect(start?.time).toBeCloseTo(0.101, 9);
    expect(timer.running).toBe(true);
    expect(timer.lap).toBe(1);
  });

  it('times sectors and laps to the millisecond from tick-interpolated crossings', () => {
    const timer = new LapTimer(LINES);
    const out = drive(timer, { s: 950, t: 0 }, 100, 0.5 + 10 + 0.1);
    const sectors = out.events.filter((e) => e.type === 'sector');
    const laps = out.events.filter((e) => e.type === 'lap');
    expect(sectors.map((e) => (e.type === 'sector' ? e.index : -1))).toEqual([0, 1, 2]);
    const times = sectors.map((e) => (e.type === 'sector' ? e.time : 0));
    expect(times[0]).toBeCloseTo(3.0, 9);
    expect(times[1]).toBeCloseTo(3.5, 9);
    expect(times[2]).toBeCloseTo(3.5, 9);
    expect(laps).toHaveLength(1);
    const lap = laps[0];
    if (lap?.type !== 'lap') throw new Error('no lap');
    expect(lap.result.time).toBeCloseTo(10, 9);
    expect(lap.result.sectors.reduce((a, b) => a + b, 0)).toBeCloseTo(lap.result.time, 9);
    expect(lap.result.valid).toBe(true);
    expect(timer.lap).toBe(2);
  });

  it('reports the running lap time and sector', () => {
    const timer = new LapTimer(LINES);
    const out = drive(timer, { s: 990, t: 0 }, 100, 1);
    expect(timer.currentLapTime(out.t)).toBeCloseTo(0.9, 6);
    expect(timer.sector).toBe(0);
    const later = drive(timer, out, 100, 3);
    expect(timer.sector).toBe(1);
    expect(timer.currentLapTime(later.t)).toBeCloseTo(3.9, 6);
  });

  it('classes a first valid lap as the overall best, then compares later laps', () => {
    const timer = new LapTimer(LINES);
    let state = drive(timer, { s: 990, t: 0 }, 100, 0.2);
    // Lap 1 at 100 m/s: 10 s.
    let r = drive(timer, state, 100, 10);
    const lap1 = r.events.find((e) => e.type === 'lap');
    expect(lap1?.type === 'lap' && lap1.result.class).toBe('overall');
    expect(timer.bestLap).toBeCloseTo(10, 9);
    // Lap 2 slower at 80 m/s: 12.5 s, all sectors slower.
    state = r;
    r = drive(timer, state, 80, 12.5);
    const lap2 = r.events.find((e) => e.type === 'lap');
    if (lap2?.type !== 'lap') throw new Error('no lap 2');
    expect(lap2.result.class).toBe('slower');
    expect(lap2.result.sectorClasses).toEqual(['slower', 'slower', 'slower']);
    // Lap 2 began 0.1 s before the switch to 80 m/s: 0.1 + 990 / 80 = 12.475 s.
    expect(lap2.result.time).toBeCloseTo(12.475, 9);
    expect(lap2.result.deltaToBest).toBeCloseTo(2.475, 9);
    expect(timer.bestLap).toBeCloseTo(10, 9);
    expect(timer.lastLap).toBeCloseTo(12.475, 9);
  });

  it('marks a session best green when an all-time record from storage is faster', () => {
    const timer = new LapTimer(LINES, { lap: 9, sectors: [2.7, 3.2, 3.1] });
    let r = drive(timer, { s: 990, t: 0 }, 100, 0.2);
    r = drive(timer, r, 100, 10);
    const lap = r.events.find((e) => e.type === 'lap');
    if (lap?.type !== 'lap') throw new Error('no lap');
    // 10 s is this session's best but slower than the stored 9 s record.
    expect(lap.result.class).toBe('personal');
    expect(lap.result.sectorClasses).toEqual(['personal', 'personal', 'personal']);
    expect(lap.result.record).toBe(false);
    expect(lap.result.personalBest).toBe(true);
  });

  it('beats the stored record with purple and reports it', () => {
    const timer = new LapTimer(LINES, { lap: 11, sectors: [3.3, 3.9, 3.8] });
    let r = drive(timer, { s: 990, t: 0 }, 100, 0.2);
    r = drive(timer, r, 100, 10);
    const lap = r.events.find((e) => e.type === 'lap');
    if (lap?.type !== 'lap') throw new Error('no lap');
    expect(lap.result.class).toBe('overall');
    expect(lap.result.record).toBe(true);
    expect(timer.record.lap).toBeCloseTo(10, 9);
    expect(timer.record.sectors[0]).toBeCloseTo(3, 9);
  });

  it('keeps invalid laps out of the bests and classes them invalid', () => {
    const timer = new LapTimer(LINES);
    let r = drive(timer, { s: 990, t: 0 }, 100, 0.2);
    r = drive(timer, r, 100, 1);
    timer.invalidate();
    expect(timer.valid).toBe(false);
    r = drive(timer, r, 100, 9);
    const lap = r.events.find((e) => e.type === 'lap');
    if (lap?.type !== 'lap') throw new Error('no lap');
    expect(lap.result.valid).toBe(false);
    expect(lap.result.class).toBe('invalid');
    expect(lap.result.sectorClasses).toEqual(['invalid', 'invalid', 'invalid']);
    expect(timer.bestLap).toBeNull();
    expect(timer.record.lap).toBeNull();
    // The next lap starts valid again.
    expect(timer.valid).toBe(true);
  });

  it('does nothing before the line and forgets everything on reset', () => {
    const timer = new LapTimer(LINES);
    expect(drive(timer, { s: 100, t: 0 }, 100, 1).events).toEqual([]);
    expect(timer.running).toBe(false);
    expect(timer.currentLapTime(5)).toBe(0);
    drive(timer, { s: 990, t: 0 }, 100, 0.5);
    expect(timer.running).toBe(true);
    timer.restart();
    expect(timer.running).toBe(false);
    expect(timer.lap).toBe(0);
  });

  it('gives sector deltas against the best lap', () => {
    const timer = new LapTimer(LINES);
    let r = drive(timer, { s: 990, t: 0 }, 100, 0.2);
    r = drive(timer, r, 100, 10);
    // Lap 2 is 0.1 s old at 10 m; the rest of sector 1 at 125 m/s: 0.1 + 290 / 125 = 2.42 s.
    r = drive(timer, r, 125, 2.5);
    const sector = r.events.find((e) => e.type === 'sector');
    if (sector?.type !== 'sector') throw new Error('no sector');
    expect(sector.time).toBeCloseTo(2.42, 9);
    expect(sector.delta).toBeCloseTo(-0.58, 9);
    expect(sector.class).toBe('overall');
  });
});
