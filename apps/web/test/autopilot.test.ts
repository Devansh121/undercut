import { InputSystem } from '@undercut/input';
import { describe, expect, it } from 'vitest';
import { AutopilotControlSource, KeyboardAutopilot } from '../src/game/autopilot';
import { GameLoop } from '../src/game/loop';
import { DriveSession, type SessionEvent } from '../src/game/session';
import type { LapResult } from '../src/game/timing';
import { loadMonza } from './fixtures';

const track = loadMonza();

describe('KeyboardAutopilot', () => {
  it('slows for the chicanes and runs flat on the straights', () => {
    const pilot = new KeyboardAutopilot(track, new DriveSession({ track, seed: 1 }).params);
    // Variante del Rettifilo apex (turn 1) against the middle of the main straight.
    expect(pilot.targetSpeed(624) * 3.6).toBeLessThan(100);
    expect(pilot.targetSpeed(5500) * 3.6).toBeGreaterThan(300);
  });

  it('drives a full valid lap of Monza on four digital keys with the default keyboard assists', () => {
    const session = new DriveSession({ track, seed: 1 });
    const input = new InputSystem();
    const pilot = new KeyboardAutopilot(track, session.params);
    const loop = new GameLoop(
      session,
      new AutopilotControlSource(input, pilot, () => session.car.state),
    );
    loop.start();
    let lap: LapResult | null = null;
    let invalidated = false;
    const events: SessionEvent[] = [];
    for (let f = 0; f < 60 * 150 && !lap; f++) {
      for (const e of loop.frame(1 / 60).events) {
        events.push(e);
        if (e.type === 'lap') lap = e.result;
        if (e.type === 'invalidated') invalidated = true;
      }
    }
    expect(session.assists).toMatchObject({ tractionControl: 2, abs: 2, autoGears: true });
    expect(invalidated).toBe(false);
    expect(lap).not.toBeNull();
    expect(lap?.valid).toBe(true);
    expect(lap?.time).toBeGreaterThan(80);
    expect(lap?.time).toBeLessThan(120);
    // The record event carries the ghost of the lap.
    expect(events.some((e) => e.type === 'record')).toBe(true);
    expect(session.ghost?.lapTime).toBeCloseTo(lap?.time ?? 0, 9);
  }, 60_000);
});
