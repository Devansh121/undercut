import { describe, expect, it } from 'vitest';
import { REFERENCE_SKILL, type ReferenceDriver } from '../src/driver/reference';
import { Phase } from '../src/profile/speed-profile';
import { createReferenceDriver, planFromRacingLine } from '../src/reference-setup';
import { MONZA, loadEnvelope, loadLine } from './lib/index';
import { runLaps } from './lib/lap';

// Physics job. A racing move asks for speed over the plan on the straight (`speedAllowance`);
// the braking zone must still begin at the plan's speed, or the car brakes from a speed the
// plan never stopped from and arrives at the turn-in too fast. The speed the car actually
// carries is measured here, on a flying lap of Monza, against the same car without the
// allowance, at each braking onset and at each turn-in (the end of the braking zone).

interface Zone {
  onset: number;
  turnIn: number;
}

function lap(allowance: number) {
  const setup = MONZA;
  const track = setup.track();
  const envelope = loadEnvelope(setup);
  const line = loadLine(setup);
  const plan = planFromRacingLine(track, line, envelope, REFERENCE_SKILL);
  const zones: Zone[] = [];
  let inZone = false;
  let lastV = 0;
  let timed = false;
  runLaps({
    track,
    plan,
    trim: setup.trim,
    airDensity: setup.airDensity,
    fuel: setup.fuel,
    laps: 1,
    timingLine: setup.controlLine,
    onSample: () => {
      timed = true;
    },
    driver: (params) => {
      const d = createReferenceDriver({ track, line, envelope, params, deployBeforeLine: false });
      const wrapped = Object.create(d) as ReferenceDriver;
      wrapped.drive = (tel, dt, out) => {
        d.speedAllowance = allowance;
        d.drive(tel, dt, out);
        const braking = d.last.phase === Phase.Brake;
        if (timed && braking && !inZone) zones.push({ onset: tel.speed, turnIn: 0 });
        if (timed && !braking && inZone && zones.length > 0) zones.at(-1)!.turnIn = lastV;
        inZone = braking;
        lastV = tel.speed;
        return out;
      };
      return wrapped;
    },
  });
  return zones;
}

describe('passing speed headroom', () => {
  it('reaches every braking zone and turn-in no faster than the car without it', () => {
    const solo = lap(0);
    const attack = lap(4);
    expect(solo.length).toBeGreaterThanOrEqual(6);
    expect(attack).toHaveLength(solo.length);
    for (let k = 0; k < solo.length; k++) {
      expect(attack[k]!.onset).toBeLessThanOrEqual(solo[k]!.onset + 0.5);
      expect(attack[k]!.turnIn).toBeLessThanOrEqual(solo[k]!.turnIn + 0.5);
    }
  });
});
