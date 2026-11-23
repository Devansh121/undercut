import { describe, expect, it } from 'vitest';
import { menuCue } from '../src/audio';
import {
  ambienceFor,
  crowdAt,
  RaceAudioScene,
  voicesFor,
  type CrowdStand,
} from '../src/game/audio-scene';
import type { DriveSession } from '../src/game/session';

/** A full stand (60 m, 20 rows) whose front runs east along z = `z`, centred on x = 0. */
const stand = (z: number, rows = 20): CrowdStand => ({
  ox: -30,
  oz: z,
  ax: 1,
  az: 0,
  length: 60,
  rows,
});

describe('crowd from the grandstands', () => {
  it('hears a stand on its side, from that side', () => {
    // Facing east (yaw 0), north (−z) is on the left.
    const out = { left: 0, right: 0 };
    crowdAt({ x: 0, z: 0, yaw: 0 }, [stand(-20)], out);
    expect(out.left).toBeGreaterThan(4 * out.right);
    // Turned to face north, the same stand is straight ahead: level 1 in each ear at 20 m.
    crowdAt({ x: 0, z: 0, yaw: Math.PI / 2 }, [stand(-20)], out);
    expect(out.left).toBeCloseTo(1, 6);
    expect(out.right).toBeCloseTo(1, 6);
  });

  it('halves with doubled distance, scales with rows, and adds stands by power', () => {
    const at = (stands: CrowdStand[]) => {
      const out = { left: 0, right: 0 };
      crowdAt({ x: 0, z: 0, yaw: 0 }, stands, out);
      return Math.hypot(out.left, out.right);
    };
    expect(at([stand(-80)]) / at([stand(-40)])).toBeCloseTo(0.5, 6);
    expect(at([stand(-40, 10)]) / at([stand(-40)])).toBeCloseTo(0.5, 6);
    expect(at([stand(-40), stand(40)]) / at([stand(-40)])).toBeCloseTo(Math.SQRT2, 6);
    expect(at([])).toBe(0);
  });

  it('grows ever more slowly above a full stand at 20 m, never past 2', () => {
    const ahead = (stands: CrowdStand[]) => {
      const out = { left: 0, right: 0 };
      crowdAt({ x: 0, z: 0, yaw: Math.PI / 2 }, stands, out);
      return out.left;
    };
    expect(ahead([stand(-20), stand(-20)])).toBeCloseTo(2 - 1 / Math.SQRT2, 6);
    expect(ahead(Array.from({ length: 50 }, () => stand(-20)))).toBeLessThan(2);
  });

  it('keeps three voices on the Mobile and Lite presets and six elsewhere', () => {
    expect(voicesFor('mobile')).toBe(3);
    expect(voicesFor('lite')).toBe(3);
    expect(voicesFor('high')).toBe(6);
  });

  it('names the bed for each circuit', () => {
    expect(ambienceFor('spa')).toBe('forest');
    expect(ambienceFor('singapore')).toBe('city-night');
    expect(ambienceFor('singapore', 'night-floodlit')).toBe('city-night');
    // Singapore by day: the city without its floodlights.
    expect(ambienceFor('singapore', 'overcast-day')).toBe('city-day');
    expect(ambienceFor('monza')).toBe('park');
  });
});

describe('the race scene', () => {
  it('places opponents in the frame of the player car, with relative velocity', () => {
    const car = (x: number, z: number, yaw: number, vx: number, throttle = 1) => ({
      state: { x, z, yaw, vx, vy: 0, engineSpeed: 1000 },
      input: { throttle },
    });
    // Player at the origin facing north (yaw π/2) at 50 m/s; an opponent 10 m north and 5 m
    // east (ahead and to the right) facing north at 60 m/s.
    const cars = [car(0, 0, Math.PI / 2, 50), car(5, -10, Math.PI / 2, 60, 0.5)];
    const session = {
      car: cars[0],
      quickRace: true,
      track: { id: 'spa' },
      race: {
        cars,
        worldCar: (i: number) => cars[i],
        control: { phase: 'lights', lightsCount: 3 },
      },
    } as unknown as DriveSession;
    const scene = new RaceAudioScene().update(session);
    const o = scene.cars[0]!;
    expect(scene.cars).toHaveLength(1);
    expect(o.x).toBeCloseTo(10, 9);
    expect(o.z).toBeCloseTo(5, 9);
    expect(o.vx).toBeCloseTo(10, 9);
    expect(o.vz).toBeCloseTo(0, 9);
    expect(o.throttle).toBe(0.5);
    expect(scene.ambience).toBe('forest');
    expect(scene.lights).toBe(3);
  });
});

describe('menu sounds', () => {
  const target = (selectors: string[]) => ({
    matches: (s: string) => selectors.some((x) => s.includes(x)),
  });
  it('ticks on focus, accepts on press, goes back on Back, and ignores disabled controls', () => {
    expect(menuCue('focusin', target([]))).toBe('focus');
    expect(menuCue('click', target([]))).toBe('accept');
    expect(menuCue('click', target(['[data-action="back"]']))).toBe('back');
    expect(menuCue('click', target([':disabled']))).toBeNull();
    expect(menuCue('click', null)).toBeNull();
  });
});
