import { describe, expect, it } from 'vitest';
import { BRAKING_EVENTS, measureBrakingCurve, measureBrakingEvent } from './lib/index';
import { expectTarget, targetName } from './expect-target';

// Doc 2.4 test 1: straight-line braking from v1 to v2 in the circuit's trim, race fuel 50 kg,
// full brake with the best bias in the adjustable range and no lock-up (driver modulation,
// ABS off). Peak = 50 ms moving average.
describe('validation: published braking events (doc 2.4)', () => {
  for (const e of BRAKING_EVENTS) {
    describe(e.label, () => {
      const { values } = measureBrakingEvent(e);
      for (const what of ['distance', 'time', 'peak']) {
        const id = `${e.id}-${what}`;
        it(targetName(id), () => expectTarget(id, values[id]!));
      }
    });
  }
});

// Doc 2.4 test 2: the peak deceleration falls monotonically with speed (Monza trim).
describe('validation: braking against speed (doc 2.4 test 2)', () => {
  const { speeds, peaks } = measureBrakingCurve();
  it('falls monotonically from 300 to 100 km/h', () => {
    for (let i = 1; i < peaks.length; i++) {
      expect(peaks[i]!, `${speeds[i]} km/h vs ${speeds[i - 1]} km/h`).toBeLessThan(peaks[i - 1]!);
    }
  });
  it(targetName('brake-peak-300'), () => expectTarget('brake-peak-300', peaks[0]!));
  it(targetName('brake-peak-100'), () => expectTarget('brake-peak-100', peaks[peaks.length - 1]!));
});
