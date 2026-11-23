import { NEUTRAL_INPUT } from '@undercut/sim';
import { Track } from '@undercut/track';
import monza from '@undercut/track/data/monza.json';
import singapore from '@undercut/track/data/singapore.json';
import { describe, expect, it } from 'vitest';
import { DriveSession } from '../src/game/session';

// Review of PR 58, the two barrier traps every escape failed in: at Monza the car ended
// high-centred on the tip of the pit-entry wall; at Singapore it went through the pit wall
// into the lane. Keyboard assists as shipped. `side` 1 is the left of the track, -1 the right.
const TRAPS = [
  ['monza', monza, 5356, -1, 70, 140, 0],
  ['singapore', singapore, 153, 1, 70, 100, 0.6],
] as const;

describe('the barrier traps of the review of PR 58', () => {
  for (const [name, data, s, side, angle, kmh, throttle] of TRAPS) {
    it(`${name} s ${s}: stays on the track side and reverses out more than 3 m in 4 s`, () => {
      const track = Track.fromJSON(data);
      const session = new DriveSession({ track, seed: 77123 });
      session.start();
      const i = track.lap.sampleIndex(s);
      const edge = side > 0 ? 0 : 1;
      session.teleport(s, side * (track.halfWidth[edge][i]! + 1.5), kmh / 3.6);
      const st = session.car.state;
      st.yaw += (side * angle * Math.PI) / 180;
      for (let k = 0; k < 240 * 6; k++) session.tick({ ...NEUTRAL_INPUT, throttle }, 'keyboard');
      const q = { s: 0, d: 0, index: -1 };
      track.project(st.x, st.z, { index: -1 }, q);
      expect(Math.abs(q.d)).toBeLessThan(track.barrierAt(q.s, edge));
      const resets = session.safetyResets;
      for (let shift = 0; shift < 2; shift++) {
        session.tick({ ...NEUTRAL_INPUT, gearShift: -1 }, 'keyboard');
        for (let k = 0; k < 48; k++) session.tick(NEUTRAL_INPUT, 'keyboard');
      }
      expect(st.gear).toBe(-1);
      const x0 = st.x;
      const z0 = st.z;
      for (let k = 0; k < 240 * 4; k++)
        session.tick({ ...NEUTRAL_INPUT, throttle: 0.6 }, 'keyboard');
      expect(Math.hypot(st.x - x0, st.z - z0)).toBeGreaterThan(3);
      expect(session.safetyResets).toBe(resets);
    });
  }
});
