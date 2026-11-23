import { expect, it } from 'vitest';
import { NEUTRAL_INPUT, createCarParams, type ControlInput } from '@undercut/sim';
import { KeyboardAutopilot, type DrivingKeys } from '../src/game/autopilot';
import { DriveSession } from '../src/game/session';
import { loadMonza } from './fixtures';

// A Quick Race with a slow player, as in the browser playtest: the player's car on its racing
// driver for two laps, then the keyboard autopilot well under the limit (laps some 30 s slower
// than the field) to the flag. Seed 4114380179 is the phone playtest's. Headless, an AI car went
// off at the first chicane's exit lapping the player and stood in the run-off for 12 s: the cars
// going by on the track counted as its leaders, so it never began to recover, and once it did,
// the wheelspin feel took the throttle away on the grass and it crawled for half a minute.
// No car may stand still or make no progress for long, and every car finishes.

it('a slow player in traffic: no AI car stands or crawls for long, and all finish', () => {
  const track = loadMonza();
  const s = new DriveSession({ track, seed: 4114380179, quickRace: { laps: 5, gridPosition: 10 } });
  const pilot = new KeyboardAutopilot(track, createCarParams('low'), { gripUse: 0.6 });
  const keys: DrivingKeys = { left: false, right: false, throttle: false, brake: false };
  const input: ControlInput = { ...NEUTRAL_INPUT };
  const dt = 1 / 240;
  let steer = 0;
  s.start();
  while (s.result === null && s.world.time < 800) {
    const lap = s.race.control.timer(0).lap;
    if (s.playerFinished || lap < 3) {
      s.scriptedRaceDriver = true;
      s.tick(input, 'keyboard');
      continue;
    }
    s.scriptedRaceDriver = false;
    pilot.decide(s.car.state, steer, keys);
    // The keyboard's own steering ramp: full lock in a third of a second.
    const goal = keys.left ? 1 : keys.right ? -1 : 0;
    steer += Math.max(-3 * dt, Math.min(3 * dt, goal - steer));
    input.steer = steer;
    input.throttle = keys.throttle ? 1 : 0;
    input.brake = keys.brake ? 1 : 0;
    s.tick(input, 'keyboard');
  }
  expect(s.result).not.toBeNull();
  const result = s.result!;
  // The watchdog's own findings, for the AI cars: stationary or no progress, and for how long.
  const long = result.anomalies.filter(
    (a) =>
      a.car !== 0 &&
      (a.kind === 'stationary' || a.kind === 'noProgress') &&
      (a.end ?? s.world.time) - a.start > 10,
  );
  expect(long).toEqual([]);
  expect(result.entries.filter((e) => e.status === 'finished')).toHaveLength(20);
}, 300_000);
