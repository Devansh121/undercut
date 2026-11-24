/**
 * Circuits available in online rooms. Each entry pairs the track id and display name with its
 * default sky preset and protocol timing limits (`circuitLimits`), derived from the track data
 * in `packages/track/data/*.json` so the lobby never has to download a whole track to show or
 * select a circuit.
 */
import { DEFAULT_CIRCUIT, circuitLimits, type CircuitInfo } from '@undercut/protocol';

export type OnlineCircuitId = 'monza' | 'spa' | 'singapore';

export interface OnlineCircuit {
  readonly id: OnlineCircuitId;
  readonly name: string;
  readonly timeOfDay: string;
  readonly info: CircuitInfo;
}

export const ONLINE_CIRCUITS: readonly OnlineCircuit[] = [
  {
    id: 'monza',
    name: 'Monza',
    timeOfDay: 'monza-afternoon',
    info: DEFAULT_CIRCUIT,
  },
  {
    id: 'spa',
    name: 'Spa-Francorchamps',
    timeOfDay: 'overcast-day',
    info: circuitLimits('spa', 7004, [0, 2163, 4946]),
  },
  {
    id: 'singapore',
    name: 'Singapore Marina Bay',
    timeOfDay: 'night-floodlit',
    info: circuitLimits('singapore', 4927, [0, 1501.665, 3325.297]),
  },
];

/** Look up an online circuit by id, or null when the id is unknown. */
export function findOnlineCircuit(id: string): OnlineCircuit | null {
  return ONLINE_CIRCUITS.find((c) => c.id === id) ?? null;
}

/** Look up an online circuit by id, falling back to Monza. */
export function onlineCircuit(id: string): OnlineCircuit {
  return findOnlineCircuit(id) ?? ONLINE_CIRCUITS[0]!;
}
