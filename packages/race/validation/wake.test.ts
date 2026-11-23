import { expect, it } from 'vitest';
import { NEUTRAL_INPUT } from '@undercut/sim';
import { MONZA } from '../../ai/validation/lib/index';
import { InputController } from '../src/session/controllers';
import { RaceSession } from '../src/session/session';
import { entrantsFor } from './lib/runner';

it('a player receives the tow, and a retired car leaves no wake', () => {
  const session = new RaceSession({
    track: MONZA.track(),
    session: { kind: 'race', laps: 1 },
    seed: 1,
    cars: entrantsFor(2).map((entrant) => ({
      entrant,
      controller: new InputController((_ctx, out) => Object.assign(out, NEUTRAL_INPUT)),
    })),
  });
  while (session.control.lightsOutAt === null && session.time < 15) session.tick();
  for (let i = 0; i < 2; i++) {
    const p = session.lapPose(150 + i * 20, 0);
    session.placeCar(i, p.x, p.z, p.yaw, 70);
  }
  session.tick();
  expect(session.worldCar(0).state.dragScale).toBeLessThan(1);
  expect(session.worldCar(1).state.dragScale).toBe(1);
  expect(session.worldCar(0).state.downforceScale).toBeLessThan(1);
  session.control.retire(1, 'stuck');
  session.tick();
  expect(session.worldCar(0).state.dragScale).toBe(1);
  expect(session.worldCar(0).state.downforceScale).toBe(1);
});
