import { expect, it } from 'vitest';
import { aiSession, runSession, RACE_CIRCUITS, type RaceCircuit } from './runner';
import { RaceWeekend, raceStartFuel, circuitInfo } from '../../src';
export function weekendProof(circuit: RaceCircuit): void {
  it(`${circuit}: qualifying and five-lap race, nineteen rivals, mandatory stop, no stuck cars`, () => {
    const fullLaps = circuitInfo(RACE_CIRCUITS[circuit].track()).raceLaps;
    const weekend = new RaceWeekend({ circuit, practice: null, qualifying: 1080, raceLaps: 5 }, 20);
    for (let spec = weekend.next(); spec; spec = weekend.next()) {
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
      const run = runSession(s, { pitLap: null, maxTime: 1800 });
      console.warn(
        JSON.stringify({
          circuit,
          seed: 1,
          kind: spec.kind,
          simTime: run.simTime,
          classified: run.result.entries.filter((e) => e.status === 'finished').length,
          timed: run.result.entries.filter((e) => e.bestLap !== null).length,
          stops: run.result.entries.map((e) => e.pitStops),
          compounds: run.result.entries.map((e) => e.compounds),
          anomalies: run.result.anomalies,
        }),
      );
      expect(s.ended).toBe(true);
      expect(run.result.anomalies).toEqual([]);
      expect(run.result.entries.every((e) => e.status === 'finished')).toBe(true);
      if (spec.kind === 'race')
        expect(run.result.entries.every((e) => e.pitStops >= 1 && e.compounds.length >= 2)).toBe(
          true,
        );
      else expect(run.result.entries.every((e) => e.bestLap !== null)).toBe(true);
      weekend.complete(run.result);
    }
    expect(weekend.done).toBe(true);
  }, 600_000);
}
