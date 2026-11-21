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
  /**
   * Centreline s of the timing (control) line, which the published lap and sector times run
   * from. It is not always the track file's s = 0 (the start line); see `MONZA`.
   */
  controlLine: number;
  /** Track file, relative to the repository root. */
  trackFile: string;
  track: () => Track;
}

export const QUALIFYING_FUEL = 10;

export const MONZA: CircuitSetup = {
  id: 'monza',
  trim: CIRCUITS.monza.trim,
  airDensity: CIRCUITS.monza.airDensity,
  fuel: QUALIFYING_FUEL,
  // The FIA circuit map (doc 2.2 [4]) draws the start line and the control line apart on the
  // main straight; the timing runs from the control line, before the start line. Fitting the
  // map's drawn track to this centreline (median miss 3.4 m) puts the control line at
  // s = 5472.5 m, 320.5 m before the file's s = 0, within about ±13 m (the S1, S2 and speed-trap
  // ticks land −8.0, −6.6 and +12.6 m from their stored positions). The track file anchors
  // s = 0 at the OpenStreetMap start node; carrying the control line as track metadata is a
  // track-pipeline task (docs/physics-validation.md section 7.6).
  controlLine: 5472.5,
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

/**
 * The track with one DRS zone's activation point moved, for measurements only: the track file
 * is the source of truth and is not edited here. The Monza file anchors zone 2's activation at
 * s = 12 m, 12 m after its start line; the FIA map anchors it 12 m after the finish (control)
 * line, which is at s = 5472.5 m, so the corrected activation is s = 5484.5 m
 * (docs/physics-validation.md section 7.6). Clearly labelled wherever it is used.
 */
export function withDrsActivation(track: Track, zone: number, activation: number): Track {
  const zones = track.drsZones.map((z, k) => (k === zone ? { ...z, activation } : z));
  const moved = Object.create(track) as Track & { drsZones: typeof zones };
  Object.defineProperty(moved, 'drsZones', { value: zones });
  return moved;
}

/** Monza's corrected zone 2 activation (index 1): 12 m after the control line. */
export const MONZA_DRS2_ACTIVATION = 5484.5;
