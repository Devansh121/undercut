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

/**
 * Starts that still fail with the game's tyres and fuel, held by the tests as expected failures
 * so a fix shows (docs/STATUS.md, open gaps). `start`: fails the Quick Race lap-one acceptance
 * (fewer than 18 clean through turn one). `contact`: passes that but has a hard contact (3 m/s
 * or more), which only the recorded-seed test checks. From the follow-up sweep at seeds 101-120
 * and the recorded starts.
 */
const START_GAPS: Partial<Record<RaceCircuit, readonly number[]>> = { monza: [101, 7307] };
const CONTACT_GAPS: Partial<Record<RaceCircuit, readonly number[]>> = { monza: [1022] };

export function followupGap(circuit: RaceCircuit, seed: number, contact = false): boolean {
  const gap = (gaps: typeof START_GAPS) => (gaps[circuit] ?? []).includes(seed);
  return gap(START_GAPS) || (contact && gap(CONTACT_GAPS));
}
