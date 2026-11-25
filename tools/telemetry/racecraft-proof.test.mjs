import { describe, expect, it } from 'vitest';
import { proofCases, summarizeRace } from './racecraft-proof-lib.mjs';

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
      if (circuit === 'monza')
        expect(cases.filter((c) => c.seed > 120).map((c) => c.seed)).toEqual([1022, 7307]);
    }
  });
  it('counts contacts, peaks, classification and findings without discarding an unsuccessful car', () => {
    const r = summarizeRace(
      { circuit: 'monza', seed: 1, laps: 5 },
      {
        racing: { overtakes: 4, overtakesByLap: [0, 1, 2, 1] },
        cars: [
          {
            turnOne: 'clean',
            spins: 0,
            contactTicks: 2,
            maxContactSpeed: 1.5,
            beyondBarrier: -1,
            longestContact: 0.1,
          },
          {
            turnOne: 'contact',
            spins: 1,
            contactTicks: 3,
            maxContactSpeed: 4,
            beyondBarrier: 0.2,
            longestContact: 0.3,
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
      byLap: [0, 1, 2, 1],
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
