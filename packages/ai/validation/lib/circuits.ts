import { createCarParams, type AeroTrim, type CarParams } from '@undercut/sim';
import { Track } from '@undercut/track';
import monza from '@undercut/track/data/monza.json';
import { CIRCUITS } from '../../../sim/validation/lib/harness';

/**
 * The reference-lap conditions of doc 2.1: qualifying fuel (about 10 kg), the circuit's trim,
 * 25 °C at the circuit's altitude (the physics suite's event air, one source of truth), DRS in
 * the zones, full ERS. The car is the game's car for that trim, unchanged.
 */
export interface CircuitSetup {
  id: string;
  trim: AeroTrim;
  airDensity: number;
  fuel: number;
  /** Track file, relative to the repository root (for the artefact hash). */
  trackFile: string;
  track: () => Track;
}

export const QUALIFYING_FUEL = 10;

export const MONZA: CircuitSetup = {
  id: 'monza',
  trim: CIRCUITS.monza.trim,
  airDensity: CIRCUITS.monza.airDensity,
  fuel: QUALIFYING_FUEL,
  trackFile: 'packages/track/data/monza.json',
  track: () => Track.fromJSON(monza),
};

export function carFor(setup: CircuitSetup): CarParams {
  return createCarParams(setup.trim);
}

/** Artefact file names, relative to the repository root. */
export function envelopeFile(setup: CircuitSetup): string {
  return `packages/ai/data/${setup.id}-${setup.trim}.envelope.json`;
}

export function lineFile(setup: CircuitSetup): string {
  return `packages/ai/data/${setup.id}-${setup.trim}.line.json`;
}
