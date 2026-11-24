import { describe, expect, it } from 'vitest';
import { aiSession, runSession, RACE_CIRCUITS, type RaceCircuit, type RaceRun } from './runner';
import { RaceWeekend, raceStartFuel, circuitInfo, type SessionSpec } from '../../src';

/**
 * The scripted Race Weekend on one circuit: practice skipped, the 18-minute qualifying, then the
 * five-lap race from the qualifying grid with the two-compound rule, nineteen AI rivals and the
 * playable weekend's pit wall. Qualifying and the race are separate tests (run in order, the
 * race on the qualifying grid) so each has the soak's whole time limit on a shared machine.
 */
export function weekendProof(circuit: RaceCircuit): void {
  describe(`${circuit}: scripted Race Weekend, nineteen rivals`, () => {
    const fullLaps = circuitInfo(RACE_CIRCUITS[circuit].track()).raceLaps;
    const weekend = new RaceWeekend({ circuit, practice: null, qualifying: 1080, raceLaps: 5 }, 20);

    function run(spec: SessionSpec): RaceRun {
      const s = aiSession(spec, {
        circuit,
        cars: 20,
        seed: 1,
        tyres: true,
        ...(spec.kind === 'race'
          ? { grid: weekend.grid(), startFuel: raceStartFuel(5, fullLaps) }
          : {}),
      });
      // Same pit wall as the playable weekend; no external scripted stop schedule.
      s.pitStrategy = true;
      const r = runSession(s, { pitLap: null, maxTime: 1800 });
      console.warn(
        JSON.stringify({
          circuit,
          seed: 1,
          kind: spec.kind,
          simTime: r.simTime,
          classified: r.result.entries.filter((e) => e.status === 'finished').length,
          timed: r.result.entries.filter((e) => e.bestLap !== null).length,
          stops: r.result.entries.map((e) => e.pitStops),
          compounds: r.result.entries.map((e) => e.compounds),
          anomalies: r.result.anomalies,
        }),
      );
      expect(s.ended).toBe(true);
      expect(r.result.anomalies).toEqual([]);
      expect(r.result.entries.every((e) => e.status === 'finished')).toBe(true);
      return r;
    }

    it('qualifying: every car sets a time, none stuck', () => {
      const spec = weekend.next()!;
      expect(spec.kind).toBe('qualifying');
      const r = run(spec);
      expect(r.result.entries.every((e) => e.bestLap !== null)).toBe(true);
      weekend.complete(r.result);
    }, 600_000);

    it('race from the qualifying grid: every car classified with a compound change', () => {
      const spec = weekend.next()!;
      expect(spec.kind).toBe('race');
      const r = run(spec);
      expect(r.result.entries.every((e) => e.pitStops >= 1 && e.compounds.length >= 2)).toBe(true);
      weekend.complete(r.result);
      expect(weekend.done).toBe(true);
    }, 600_000);
  });
}
