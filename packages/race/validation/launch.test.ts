import { describe, expect, it } from 'vitest';
import { NEUTRAL_INPUT } from '@undercut/sim';
import { MONZA } from '../../ai/validation/lib/index';
import { InputController } from '../src/session/controllers';
import { RaceSession } from '../src/session/session';
import { entrantsFor } from './lib/runner';

function launch(delay: number): { ghostAt: number | null; moved: boolean } {
  const entrants = entrantsFor(3);
  const session = new RaceSession({
    track: MONZA.track(),
    session: { kind: 'race', laps: 1 },
    seed: 1,
    cars: entrants.map((entrant, i) => ({
      entrant,
      controller: new InputController((ctx, out) => {
        Object.assign(out, NEUTRAL_INPUT);
        const green = ctx.control.lightsOutAt;
        const go = i === 0 && green !== null && ctx.time >= green + delay;
        out.throttle = go ? 0.3 : 0;
        out.brake = go ? 0 : 1;
        out.gearShift = go && ctx.telemetry.gear < 1 && !ctx.telemetry.shifting ? 1 : 0;
      }),
    })),
  });
  let ghostAt: number | null = null;
  let moved = false;
  while (session.time < 20) {
    session.tick();
    const green = session.control.lightsOutAt;
    if (green === null) continue;
    if (session.blockingGhost(0) && ghostAt === null) ghostAt = session.time - green;
    moved ||= session.carFacts(0).speed > 5;
    if (session.time > green + 9) break;
  }
  return { ghostAt, moved };
}

describe('a player slow to launch', () => {
  it('stays solid when taking three seconds to pull away', () => {
    const result = launch(3);
    expect(result.moved).toBe(true);
    expect(result.ghostAt).toBeNull();
  });

  it('still releases a queue behind a player who never launches', () => {
    const result = launch(Infinity);
    expect(result.ghostAt).toBeGreaterThanOrEqual(6);
    expect(result.ghostAt).toBeLessThan(8);
  });
});
