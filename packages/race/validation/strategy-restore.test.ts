import { expect, it } from 'vitest';
import { aiSession } from './lib/runner';
it('restores the automatic pit wall, limiter setting and tyre state before a stop bit for bit', () => {
  const options = { cars: 2, seed: 2718, tyres: true, startFuel: 15 };
  const a = aiSession({ kind: 'race', laps: 5, twoCompoundRule: true }, options);
  a.pitStrategy = true;
  while (a.control.timer(0).lap < 2 && a.time < 200) a.tick();
  const snap = JSON.parse(JSON.stringify(a.snapshot())) as ReturnType<typeof a.snapshot>;
  const b = aiSession({ kind: 'race', laps: 5, twoCompoundRule: true }, options);
  b.restore(snap);
  expect(b.pitStrategy).toBe(true);
  let requested = false;
  for (let k = 0; k < 240 * 110; k++) {
    expect(b.tick()).toEqual(a.tick());
    if (a.control.pitRequested(0)) requested = true;
  }
  expect(requested || a.control.cars[0]!.pitStops > 0).toBe(true);
  expect(b.snapshot()).toEqual(a.snapshot());
});
