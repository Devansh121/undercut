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

  // Seeds 3, 7 and 11 each spin once with the stability assist off (measured). Seed 3 laps clean
  // on the default keyboard assists.
  it('seed 3: laps on the default keyboard assists without a spin, spins with stability off', () => {
    const on = clumsyLap(3, 1);
    expect(on.lap).not.toBeNull();
    expect(on.spins).toBe(0);
    expect(clumsyLap(3, 0).spins).toBeGreaterThan(0);
  }, 60_000);

  // Known gap: seeds 7 and 11 lapped clean on the default assists before the brake and downforce
  // identification (docs/physics-validation.md section 7.9) and spin once each since, as the
  // clumsy keyboard tally does (DRIVABILITY_GAPS.clumsyKeyboard). Pinned so it fails if it
  // widens or closes without the record being updated.
  it('known gap, seed 7: spins once on the default keyboard assists (0 before 7.9)', () => {
    const on = clumsyLap(7, 1);
    expect(on.lap).not.toBeNull();
    expect(on.spins).toBe(1);
  }, 60_000);
});
