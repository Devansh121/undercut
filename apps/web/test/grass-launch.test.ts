import { NEUTRAL_INPUT, SurfaceKind } from '@undercut/sim';
import { describe, expect, it } from 'vitest';
import { DriveSession } from '../src/game/session';
import { loadMonza } from './fixtures';

const track = loadMonza();

// Review of PR 58: driving away from a stop on grass, traction control cut the throttle to the
// engine's drag after each burst of wheelspin and the car crawled. Keyboard assists as shipped.
describe('a car pulls away on grass under traction control', () => {
  it('reaches more than 28 km/h in 3.6 s from rest on Monza grass, full throttle', () => {
    const session = new DriveSession({ track, seed: 77123 });
    session.start();
    const i = track.lap.sampleIndex(300);
    session.teleport(300, -(track.halfWidth[1][i]! + 4), 0);
    for (let k = 0; k < 120; k++) session.tick(NEUTRAL_INPUT, 'keyboard');
    expect(session.surfaceUnderCar()).toBe(SurfaceKind.Grass);
    for (let k = 0; k < 864; k++) session.tick({ ...NEUTRAL_INPUT, throttle: 1 }, 'keyboard');
    const st = session.car.state;
    expect(Math.hypot(st.vx, st.vy) * 3.6).toBeGreaterThan(28);
  });
});
