import { describe, expect, it } from 'vitest';
import { COMPOUNDS, compoundIndex, fitTyres, wearGrip, type CompoundId } from '@undercut/sim';
import { planFromRacingLine } from '../src/reference-setup';
import { REFERENCE_SKILL } from '../src/driver/reference';
import { MONZA, loadEnvelope, loadLine, referenceLap } from './lib/index';

// Tyre temperature and wear on the reference driver's laps at Monza (docs/physics-validation.md
// 4.2, all estimates): three timed laps after the out-lap on each compound. The tread settles
// inside its working range, and the lap time wear alone costs each lap is inside section 4.2's
// band for the compound. Lap time per unit of grip is measured quasi-steady: the racing line
// re-planned on the envelope scaled down by 1 % (the reference driver follows one fixed plan, so
// its own laps barely show grip).

const K = 273.15;
const BANDS: Record<CompoundId, readonly [number, number]> = {
  soft: [0.08, 0.12],
  medium: [0.05, 0.08],
  hard: [0.03, 0.05],
};

/** Lap time per 1 % of grip at Monza, s (about 0.31). */
function secondsPerPercent(): number {
  const track = MONZA.track();
  const line = loadLine(MONZA);
  const envelope = loadEnvelope(MONZA);
  const e = REFERENCE_SKILL.envelope;
  const lap = (k: number) =>
    planFromRacingLine(track, line, envelope, {
      ...REFERENCE_SKILL,
      envelope: { lateral: e.lateral * k, brake: e.brake * k, traction: e.traction * k },
    }).profile.lapTime;
  return lap(0.99) - lap(1);
}

interface LapTyres {
  /** Mean of the four treads over the lap, K. */
  meanTemp: number;
  /** Grip lost to wear over the lap, share (mean of the four tyres). */
  wearLoss: number;
}

function run(compound: CompoundId, temperature?: number): { spun: boolean; laps: LapTyres[] } {
  const laps: { tSum: number; n: number; first: number; last: number }[] = [];
  let lastT = Infinity;
  const { result } = referenceLap(MONZA, {
    laps: 3,
    prepare: (car) =>
      fitTyres(car.state, compound, temperature !== undefined ? { temperature } : {}),
    onSample: (car, _tel, time) => {
      const s = car.state;
      if (time < lastT) laps.push({ tSum: 0, n: 0, first: NaN, last: NaN });
      lastT = time;
      const lap = laps[laps.length - 1]!;
      let t = 0;
      let g = 0;
      for (let i = 0; i < 4; i++) {
        t += s.tyreTemp[i]! / 4;
        g += wearGrip(s.tyreWear[i]!) / 4;
      }
      lap.tSum += t;
      lap.n++;
      if (Number.isNaN(lap.first)) lap.first = g;
      lap.last = g;
    },
  });
  return {
    spun: result.spun,
    laps: laps.map((l) => ({ meanTemp: l.tSum / l.n, wearLoss: l.first - l.last })),
  };
}

describe('tyres on the reference driver at Monza', () => {
  const perPercent = secondsPerPercent();

  it('a lap costs about 0.3 s per 1 % of grip there', () => {
    expect(perPercent).toBeGreaterThan(0.25);
    expect(perPercent).toBeLessThan(0.35);
  });

  // The hard set starts at 100 °C: from the blankets (70 °C, 30 K under its window) it has
  // 6 % less grip on the out-lap, and the reference driver, on a plan made for new softs in
  // their window, spins. Warming it up is the driver's job (the race AI's, later).
  for (const [compound, start] of [
    ['soft', undefined],
    ['medium', undefined],
    ['hard', K + 100],
  ] as const) {
    it(`${compound}: in its window at race pace, wear costing ${BANDS[compound].join('–')} s a lap`, () => {
      const c = COMPOUNDS[compoundIndex(compound)]!;
      const r = run(compound, start);
      expect(r.spun).toBe(false);
      expect(r.laps).toHaveLength(3);
      for (const lap of r.laps) {
        expect(lap.meanTemp).toBeGreaterThan(c.windowLow);
        expect(lap.meanTemp).toBeLessThan(c.windowHigh);
        const seconds = lap.wearLoss * 100 * perPercent;
        expect(seconds).toBeGreaterThanOrEqual(BANDS[compound][0]);
        expect(seconds).toBeLessThanOrEqual(BANDS[compound][1]);
      }
    }, 300_000);
  }
});
