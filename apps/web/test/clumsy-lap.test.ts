import { InputSystem } from '@undercut/input';
import { describe, expect, it } from 'vitest';
import { AutopilotControlSource, CLUMSY_PILOT, KeyboardAutopilot } from '../src/game/autopilot';
import { GameLoop } from '../src/game/loop';
import { DriveSession } from '../src/game/session';
import type { LapResult } from '../src/game/timing';
import { loadMonza } from './fixtures';

const track = loadMonza();

/** One lap by the clumsy keyboard autopilot (the browser test's driver) on `session`. */
function clumsyLap(seed: number, stability: number): { lap: LapResult | null; spins: number } {
  const session = new DriveSession({ track, seed: 1 });
  session.setAssist('stability', stability);
  const pilot = new KeyboardAutopilot(track, session.params, { ...CLUMSY_PILOT, clumsy: { seed } });
  const loop = new GameLoop(
    session,
    new AutopilotControlSource(new InputSystem(), pilot, () => session.car.state),
  );
  loop.start();
  let lap: LapResult | null = null;
  for (let f = 0; f < 60 * 200 && !lap; f++) {
    for (const e of loop.frame(1 / 60).events) if (e.type === 'lap') lap = e.result;
  }
  return { lap, spins: session.spins };
}

describe('clumsy keyboard lap', () => {
  it('counts spins once each', () => {
    const session = new DriveSession({ track, seed: 1 });
    session.start();
    expect(session.spins).toBe(0);
  });

  // Seeds 3, 7 and 11 each spin once with the stability assist off (measured); on the default
  // keyboard assists they lap clean.
  for (const seed of [3, 7]) {
    it(`seed ${seed}: laps on the default keyboard assists without a spin, spins with stability off`, () => {
      const on = clumsyLap(seed, 1);
      expect(on.lap).not.toBeNull();
      expect(on.spins).toBe(0);
      expect(clumsyLap(seed, 0).spins).toBeGreaterThan(0);
    }, 60_000);
  }
});
