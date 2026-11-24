import { SurfaceKind } from '@undercut/sim';
import { describe, expect, it } from 'vitest';
import { carStopped } from '../src/game/stopped';

const base = { playing: true, time: 10, speed: 0, surface: SurfaceKind.Grass };

describe('the stopped-car prompt', () => {
  it('shows for a car at rest off the road', () => {
    expect(carStopped(base)).toBe(true);
  });

  it('goes away while the car reverses, as when it drives forward', () => {
    expect(carStopped({ ...base, speed: -4 })).toBe(false);
    expect(carStopped({ ...base, speed: 4 })).toBe(false);
    expect(carStopped({ ...base, speed: -1 })).toBe(true);
  });

  it('stays off on the road, before 2 s and outside play', () => {
    expect(carStopped({ ...base, surface: SurfaceKind.Asphalt })).toBe(false);
    expect(carStopped({ ...base, time: 1 })).toBe(false);
    expect(carStopped({ ...base, playing: false })).toBe(false);
  });

  it('stays off in the pit lane and while the crew holds the car', () => {
    // The pit box is not lap asphalt: a car stopped for service is not stopped off the road.
    expect(carStopped({ ...base, surface: SurfaceKind.PitLane, inPit: true })).toBe(false);
    expect(carStopped({ ...base, inPit: true })).toBe(false);
    expect(carStopped({ ...base, inPit: false })).toBe(true);
  });
});
