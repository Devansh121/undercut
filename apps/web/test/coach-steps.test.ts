import { describe, expect, it } from 'vitest';
import { CoachSteps, type CoachFrame } from '../src/ui/coach-steps';

const idle: CoachFrame = {
  dt: 0.1,
  running: true,
  driving: false,
  cue: false,
  braking: false,
  invalid: false,
  paused: false,
  laps: 0,
};
function run(c: CoachSteps, seconds: number, f: Partial<CoachFrame> = {}): void {
  for (let t = 0; t < seconds - 1e-9; t += 0.1) c.update({ ...idle, ...f });
}

describe('first-lap coach steps', () => {
  it('leaves the controls tip once the player has driven and had time to read it', () => {
    const c = new CoachSteps(false);
    run(c, 10);
    expect(c.step).toBe(0);
    run(c, 0.1, { driving: true });
    expect(c.step).toBe(1);

    const quick = new CoachSteps(false);
    run(quick, 1, { driving: true });
    expect(quick.step).toBe(0);
    run(quick, 2.1);
    expect(quick.step).toBe(1);
  });

  it('counts reading time only while the session runs', () => {
    const c = new CoachSteps(false);
    run(c, 10, { driving: true, running: false });
    expect(c.step).toBe(0);
    run(c, 3, { driving: true });
    expect(c.step).toBe(1);
  });

  it('leaves the braking tip on braking in the red zone, or once the zone has passed', () => {
    const braked = new CoachSteps(false);
    braked.advance();
    run(braked, 1, { cue: true });
    expect(braked.step).toBe(1);
    run(braked, 0.1, { cue: true, braking: true });
    expect(braked.step).toBe(2);

    const passed = new CoachSteps(false);
    passed.advance();
    run(passed, 1, { cue: true });
    run(passed, 0.1);
    expect(passed.step).toBe(2);
  });

  it('keeps the track-limits tip up a while, longer when the lap has just gone invalid', () => {
    const c = new CoachSteps(false);
    c.advance();
    c.advance();
    run(c, 9);
    expect(c.step).toBe(2);
    run(c, 0.5, { invalid: true });
    run(c, 2, { invalid: true });
    expect(c.step).toBe(2);
    run(c, 2, { invalid: true });
    expect(c.step).toBe(3);
  });

  it('finishes when the player pauses on the last tip', () => {
    const c = new CoachSteps(false);
    for (let i = 0; i < 3; i++) c.advance();
    run(c, 0.1, { paused: true });
    expect(c.done).toBe(true);
  });

  it('finishes when a lap is completed after it started', () => {
    const c = new CoachSteps(false);
    run(c, 1);
    run(c, 0.1, { laps: 1 });
    expect(c.done).toBe(true);
  });

  it('replays after laps already completed, and finishes only on the next lap', () => {
    const c = new CoachSteps(true);
    expect(c.done).toBe(true);
    c.restart();
    run(c, 1, { laps: 3 });
    expect(c.done).toBe(false);
    expect(c.step).toBe(0);
    run(c, 0.1, { laps: 4 });
    expect(c.done).toBe(true);
  });

  it('does nothing once finished', () => {
    const c = new CoachSteps(false);
    c.finish();
    expect(c.update({ ...idle, driving: true })).toBe(false);
    expect(c.step).toBe(0);
  });
});
