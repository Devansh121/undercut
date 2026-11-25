import { beforeAll, describe, expect, it } from 'vitest';
import { BrakingCurve } from '../src/driver/braking-curve';
import { EnvelopeModel } from '../src/envelope/envelope';
import { MONZA, SPA, SINGAPORE, loadEnvelope } from '../validation/lib/index';

describe.each([MONZA, SPA, SINGAPORE])('braking distance in $trim trim', (setup) => {
  let capacity: (v: number) => number;
  let curve: BrakingCurve;
  beforeAll(() => {
    const model = new EnvelopeModel(loadEnvelope(setup));
    capacity = (v) => model.brake(v, 1) + model.drag(v, false);
    curve = new BrakingCurve(capacity);
  });

  // Independent time integration: the leader brakes at full capacity immediately, while the
  // follower reacts after 60 fixed ticks, then brakes at its available share. The distance
  // solver must preserve the two metres between bodies, including on reduced tyre grip.
  const cases = [0.8, 1].flatMap((grip) =>
    [0, 20, 40, 60, 80].flatMap((lead) =>
      [10, 30, 60, 100, 200].map((room) => ({ grip, lead, room })),
    ),
  );
  it.each(cases)(
    'keeps stopping clearance at grip $grip, leader $lead m/s, room $room m',
    ({ grip, lead, room }) => {
      const scale = 0.9 * grip;
      let v = curve.safeSpeed(room, lead, 0.25, scale, 1);
      let vl = lead;
      let x = 0;
      let xl = room + 2;
      let closest = xl;
      const dt = 1 / 240;
      for (let tick = 0; tick < 30 * 240 && (v > 0 || vl > 0); tick++) {
        const next = Math.max(0, v - (tick >= 60 ? scale * capacity(v) : 0) * dt);
        const nextLead = Math.max(0, vl - capacity(vl) * dt);
        x += 0.5 * (v + next) * dt;
        xl += 0.5 * (vl + nextLead) * dt;
        closest = Math.min(closest, xl - x);
        v = next;
        vl = nextLead;
      }
      expect(v).toBe(0);
      expect(vl).toBe(0);
      expect(closest).toBeGreaterThanOrEqual(2);
    },
  );

  it('uses high-speed braking capacity while retaining the full reaction delay', () => {
    const b = 0.9 * capacity(20);
    const constantBrake = -b * 0.25 + Math.sqrt(b * b * 0.25 * 0.25 + 20 * 20 + 2 * b * 100);
    expect(curve.safeSpeed(100, 20, 0.25, 0.9, 1)).toBeGreaterThan(constantBrake + 5);
  });
});
