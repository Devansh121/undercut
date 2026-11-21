import { describe, expect, it } from 'vitest';
import {
  BRAKING_EVENTS,
  KMH,
  TRAIL_OFF,
  braking,
  measureBrakingCurve,
  measureBrakingEvent,
  trailOffCap,
} from './lib/index';
import { expectTarget, targetName } from './expect-target';

// Doc 2.4 test 1, modelled as the published stop: from v1 to v2 in the circuit's trim, race fuel
// 50 kg, the best bias in the adjustable range, no lock-up (driver modulation,
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

describe('the published-event pedal profile', () => {
  it('is full pedal until the last quarter of the speed drop, then eases to 30 % at v2', () => {
    expect(TRAIL_OFF).toEqual({ fromFraction: 0.25, endPedal: 0.3 });
    const v1 = 300;
    const v2 = 100;
    expect(trailOffCap(v1, v1, v2)).toBe(1);
    expect(trailOffCap(150, v1, v2)).toBe(1);
    expect(trailOffCap(125, v1, v2)).toBeCloseTo(0.65, 12);
    expect(trailOffCap(100, v1, v2)).toBeCloseTo(0.3, 12);
  });

  it('never presses harder than the cap in a recorded event stop', () => {
    const e = BRAKING_EVENTS[0]!;
    const r = braking({
      circuit: e.circuit,
      v1: e.v1 * KMH,
      v2: e.v2 * KMH,
      bias: 0.57,
      record: true,
    });
    const cols = r.trace!.columns;
    const speed = cols.indexOf('speed_kmh');
    const brake = cols.indexOf('brake');
    // A row's pedal was set from the speed one step earlier, which lies between this row's
    // speed and the previous row's, so the previous row's speed bounds it.
    let trailing = 0;
    let previous = Infinity;
    for (const row of r.trace!.rows) {
      const cap = trailOffCap(previous, e.v1, e.v2);
      expect(row[brake]!).toBeLessThanOrEqual(cap + 1e-9);
      if (cap < 1 && row[brake]! > 0) trailing++;
      previous = row[speed]!;
    }
    expect(trailing).toBeGreaterThan(3);
  });
});

describe('braking runs start and end where the event says', () => {
  for (const e of BRAKING_EVENTS) {
    it(`${e.label}: brakes from ${e.v1} km/h and stops the clock at ${e.v2} km/h`, () => {
      const r = braking({ circuit: e.circuit, v1: e.v1 * KMH, v2: e.v2 * KMH, bias: 0.57 });
      expect(Math.abs(r.v1 / KMH - e.v1)).toBeLessThan(0.05);
      expect(r.v2 / KMH).toBeCloseTo(e.v2, 9);
      expect(r.distance).toBeGreaterThan(0);
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
