import { describe, expect, it } from 'vitest';
import {
  proofCases,
  proofReport,
  PROOF_CIRCUITS,
  PROOF_GROUPS,
  summarizeRace,
} from './racecraft-proof-lib.mjs';

describe('racecraft proof cases and metrics', () => {
  it('covers twenty starts and ten five-lap races per circuit, with both recorded starts', () => {
    for (const circuit of ['monza', 'spa', 'singapore']) {
      const cases = [
        'start-a',
        'start-b',
        'race-a',
        'race-b',
        'race-c',
        'race-d',
        'race-e',
      ].flatMap((group) => proofCases(circuit, group));
      expect(cases.filter((c) => c.laps === 5).map((c) => c.seed)).toEqual([
        1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
      ]);
      expect(
        cases.filter((c) => c.laps === 1 && c.seed >= 101 && c.seed <= 120).map((c) => c.seed),
      ).toEqual(Array.from({ length: 20 }, (_, i) => 101 + i));
      expect(cases).toHaveLength(circuit === 'monza' ? 32 : 30);
      expect(proofCases(circuit, 'default')).toEqual(
        [1, 4, 7, 42].map((seed) => ({ circuit, seed, laps: 5, settings: 'default' })),
      );
      if (circuit === 'monza')
        expect(cases.filter((c) => c.seed > 120).map((c) => c.seed)).toEqual([1022, 7307]);
    }
  });
  it('counts contacts, peaks, classification and findings without discarding an unsuccessful car', () => {
    const r = summarizeRace(
      { circuit: 'monza', seed: 1, laps: 5 },
      {
        racing: { overtakes: 4, overtakesByLap: [1, 1, 2, 1] },
        cars: [
          {
            turnOne: 'clean',
            spins: 0,
            contactTicks: 2,
            maxContactSpeed: 1.5,
            beyondBarrier: -1,
            longestContact: 0.1,
            allOffTicks: 7,
            maxOffset: 6.5,
            wallHits: 0,
            maxWallSpeed: 0,
          },
          {
            turnOne: 'contact',
            spins: 1,
            contactTicks: 3,
            maxContactSpeed: 4,
            beyondBarrier: 0.2,
            longestContact: 0.3,
            allOffTicks: 3,
            maxOffset: 9,
            wallHits: 2,
            maxWallSpeed: 6,
          },
        ],
        result: {
          entries: [
            { status: 'finished', laps: 5 },
            { status: 'dnf', laps: 2 },
          ],
          anomalies: [{ car: 1, kind: 'stationary' }],
        },
      },
    );
    expect(r).toMatchObject({
      passes: 4,
      byLap: [1, 1, 2, 1],
      laterPasses: 4,
      allOffTicks: 10,
      maxOffset: 9,
      wallHits: 2,
      wallPeak: 6,
      clean: 1,
      spins: 1,
      contactTicks: 5,
      peak: 4,
      classified: 1,
      cars: 2,
      findings: [{ car: 1, kind: 'stationary' }],
      beyondBarrier: 0.2,
      longestContact: 0.3,
    });
  });
});

describe('racecraft proof rejects later-lap passing regressions', () => {
  const baseline = () =>
    PROOF_CIRCUITS.flatMap((c) => PROOF_GROUPS.flatMap((g) => proofCases(c, g))).map((spec) => ({
      ...spec,
      cars: 20,
      passes: 3,
      byLap: spec.laps === 1 ? [3] : [0, 3],
      laterPasses: spec.laps === 1 ? 0 : 3,
      clean: 20,
      spins: 0,
      contactTicks: 0,
      peak: 0,
      classified: 20,
      findings: [],
      beyondBarrier: -1,
      longestContact: 0,
      allOffTicks: 0,
      wallHits: 0,
    }));
  it('rejects fewer later-lap passes with the default settings at every circuit', () => {
    const a = baseline();
    const b = a.map((r) => (r.settings ? { ...r, passes: 2, byLap: [0, 2], laterPasses: 2 } : r));
    expect(proofReport(a, b).failures).toEqual(
      PROOF_CIRCUITS.map((c) => `${c}: default later-lap passes fell below baseline`),
    );
  });
  it('rejects fewer later-lap passes in the tyre/no-stop races even when total passes do not fall', () => {
    const a = baseline();
    const b = a.map((r) =>
      r.laps === 5 && !r.settings ? { ...r, byLap: [1, 2], laterPasses: 2 } : r,
    );
    expect(proofReport(a, b).failures).toEqual(
      PROOF_CIRCUITS.map((c) => `${c}: five-lap later-lap passes fell below baseline`),
    );
  });
});
