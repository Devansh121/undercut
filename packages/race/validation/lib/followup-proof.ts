import { circuitInfo } from '../../src/circuit';
import { raceStartFuel } from '../../src/rules';
import { RACE_CIRCUITS, runRace, type RaceCircuit, type RaceRun } from './runner';

const fuel = new Map<RaceCircuit, number>();

/**
 * Quick Race's first lap with the game's tyres and five-lap start load, or the full five laps.
 * Keep the starting load fixed when stopping the proof at lap one so its start is comparable.
 */
export function runFollowupRace(circuit: RaceCircuit, seed: number, laps = 1): RaceRun {
  let startFuel = fuel.get(circuit);
  if (startFuel === undefined) {
    startFuel = raceStartFuel(5, circuitInfo(RACE_CIRCUITS[circuit].track()).raceLaps);
    fuel.set(circuit, startFuel);
  }
  return runRace({ circuit, cars: 20, laps, seed, pitLap: null, tyres: true, startFuel });
}
