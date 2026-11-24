import { expect, it } from 'vitest';
import { NEUTRAL_INPUT } from '@undercut/sim';
import { DriveSession } from '../src/game/session';
import { MONZA } from '../../../packages/ai/validation/lib';

// "Simulate to end of session": in qualifying the player's car goes back to its box, held there
// while the session runs on to the flag, and its best lap stands in the classification.
it('qualifying: back to the box after a timed lap, the session runs to the flag without the car', () => {
  const session = new DriveSession({
    track: MONZA.track(),
    seed: 5,
    quickRace: { laps: 5, session: { kind: 'qualifying', duration: 240 } },
  });
  session.start();
  // The scripted racing driver takes the car out of the garage and sets a lap.
  session.scriptedRaceDriver = true;
  const input = { ...NEUTRAL_INPUT };
  while (session.timer.bestLap === null && session.world.time < 230)
    session.tick(input, 'keyboard');
  const best = session.timer.bestLap;
  expect(best).not.toBeNull();
  session.scriptedRaceDriver = false;
  // No garage in a race; here the car is placed in its box.
  expect(session.returnToGarage()).not.toBeNull();
  const c = session.race.control;
  expect(c.held(0)).toBe(true);
  expect(c.pitPhase(0)).toBe('garage');
  expect(session.inPit).toBe(true);
  let contact = 0;
  while (!session.result && session.world.time < 600) {
    session.tick(input, 'keyboard');
    expect(c.held(0)).toBe(true);
    contact = Math.max(contact, session.car.state.carContactSpeed);
  }
  const result = session.result!;
  expect(result).not.toBeNull();
  const player = result.entries.find((e) => e.car === 0)!;
  expect(player.status).toBe('finished');
  expect(player.bestLap).toBe(best);
  expect(contact).toBe(0);
  expect(result.anomalies.filter((a) => a.car === 0)).toEqual([]);
  // Once over, there is nothing to send back to the box.
  expect(session.returnToGarage()).toBeNull();
}, 300_000);
