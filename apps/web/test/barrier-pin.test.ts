import { NEUTRAL_INPUT } from '@undercut/sim';
import { describe, expect, it } from 'vitest';
import { DriveSession } from '../src/game/session';
import { loadMonza } from './fixtures';

const track = loadMonza();

/**
 * Hard barrier stops at the screenshot's place (review of PR 58), keyboard assists as shipped
 * (traction control on). Each run aims the car `angle` degrees toward Monza's left barrier from
 * 1.5 m off the edge at the second chicane's approach and holds `throttle` for 6 s. These runs
 * bounce off and stop nose-in against the right-hand barrier, 60° or more into it, where no
 * steering takes the wheels off the face: the car reverses out. Traction control used to hold
 * the throttle at the engine's drag at standstill (a stopped tyre's deflection reads as slip),
 * so the car could not move off in either gear.
 */
const CASES: readonly (readonly [s: number, angle: number, kmh: number, throttle: number])[] = [
  [1770, 5, 80, 0.6],
  [1790, 20, 150, 0],
  [1810, 20, 80, 0],
];

describe('a car stopped nose-in against a hard barrier reverses out', () => {
  for (const [s, angle, kmh, throttle] of CASES) {
    it(`s ${s}, ${angle}°, ${kmh} km/h, throttle ${throttle}: reverses more than 2 m in 4 s`, () => {
      const session = new DriveSession({ track, seed: 77123 });
      session.start();
      const i = track.lap.sampleIndex(s);
      session.teleport(s, track.halfWidth[0][i]! + 1.5, kmh / 3.6);
      const st = session.car.state;
      st.yaw += (angle * Math.PI) / 180;
      let touched = false;
      for (let k = 0; k < 240 * 6; k++) {
        session.tick({ ...NEUTRAL_INPUT, throttle }, 'keyboard');
        if (st.wallContact) touched = true;
      }
      expect(touched).toBe(true);
      expect(Math.hypot(st.vx, st.vy)).toBeLessThan(1.5);
      // First, neutral, reverse: the keyboard's shift-down key twice, below 1 m/s.
      for (let shift = 0; shift < 2; shift++) {
        session.tick({ ...NEUTRAL_INPUT, gearShift: -1 }, 'keyboard');
        for (let k = 0; k < 60; k++) session.tick(NEUTRAL_INPUT, 'keyboard');
      }
      expect(st.gear).toBe(-1);
      const x0 = st.x;
      const z0 = st.z;
      for (let k = 0; k < 240 * 4; k++) session.tick({ ...NEUTRAL_INPUT, throttle: 1 }, 'keyboard');
      expect(Math.hypot(st.x - x0, st.z - z0)).toBeGreaterThan(2);
      expect(session.safetyResets).toBe(0);
    });
  }
});

/**
 * The screenshot's shape: a slow, shallow run into the left barrier, braked to a stop alongside
 * it (s 1810 is where the barrier steps 1.45 m toward the track), then full throttle with full
 * lock away from it.
 */
const SHALLOW: readonly (readonly [s: number, angle: number, kmh: number])[] = [
  [1810, 2, 15],
  [1790, 5, 40],
  [1810, 20, 40],
  [1810, 30, 15],
];

describe('a car stopped alongside a hard barrier drives away', () => {
  for (const [s, angle, kmh] of SHALLOW) {
    it(`s ${s}, ${angle}°, ${kmh} km/h, braked to a stop: more than 2 m in 4 s`, () => {
      const session = new DriveSession({ track, seed: 77123 });
      session.start();
      session.teleport(s, track.barrierAt(s, 0) - 2.2, kmh / 3.6);
      const st = session.car.state;
      st.yaw += (angle * Math.PI) / 180;
      let touched = false;
      for (let k = 0; k < 240 * 5; k++) {
        session.tick({ ...NEUTRAL_INPUT, brake: touched ? 1 : 0 }, 'keyboard');
        if (st.wallContact) touched = true;
      }
      expect(touched).toBe(true);
      expect(Math.hypot(st.vx, st.vy)).toBeLessThan(0.5);
      const x0 = st.x;
      const z0 = st.z;
      for (let k = 0; k < 240 * 4; k++)
        session.tick({ ...NEUTRAL_INPUT, throttle: 1, steer: -1 }, 'keyboard');
      expect(Math.hypot(st.x - x0, st.z - z0)).toBeGreaterThan(2);
      expect(session.safetyResets).toBe(0);
    });
  }
});
