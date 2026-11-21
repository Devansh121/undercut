/// <reference types="node" />
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CarParams } from '@undercut/sim';
import type { Track } from '@undercut/track';
import type { DriverSkill } from '../../src/driver/driver';
import {
  EnvelopeModel,
  decodeEnvelope,
  type Envelope,
  type EnvelopeArtefact,
} from '../../src/envelope/envelope';
import { measureEnvelope, type MeasureReport } from '../../src/envelope/measure';
import { REFERENCE_SKILL } from '../../src/driver/reference';
import { buildRacingLine, type LineBuildResult, type LineConfig } from '../../src/line/build';
import { buildCorridor, corridorHalfTrack } from '../../src/line/corridor';
import { computeLineGeometry } from '../../src/line/geometry';
import { minimumCurvatureLine } from '../../src/line/min-curvature';
import { refineLine } from '../../src/line/refine';
import { buildPlan, drsZoneFlags } from '../../src/profile/plan';
import { SpeedProfiler } from '../../src/profile/speed-profile';
import {
  decodeRacingLine,
  encodeRacingLine,
  type RacingLineData,
} from '../../src/export/racing-line';
import { referenceLineConfig } from '../../src/reference-setup';
import { carFor, envelopeFile, lineFile, type CircuitSetup } from './circuits';

/**
 * The two committed artefacts per circuit and trim, and how CI tells they are stale.
 *
 * The staleness hashes are behavioural fingerprints, not hashes of source text: they hash what
 * the code computes, rounded to six significant digits, so a comment, a rename or reformatting
 * changes nothing, while any change in behaviour that reaches an artefact changes the hash,
 * wherever the code lives (sim, track, AI).
 *
 * - envelope: the envelope is remeasured (about 1 s of driving the sim) and the measurement
 *   itself, with the car's parameters, the air and the fuel, is the fingerprint. Any change in
 *   the vehicle model, the car or the measurement code that moves a number moves it.
 * - racing line: a probe run of the line pipeline on the real track with the envelope: the
 *   corridor (track widths, kerbs, frame limits), the minimum-curvature line, the line's
 *   geometry (positions, elevation from `Track.ground`, grade, vertical curvature, banking,
 *   surface grip under the wheels), its speed profile with the DRS zones, and a short
 *   refinement pass, plus the line configuration, the skill and the envelope's fingerprint.
 *   About 2 s.
 *
 * Stale: run `npm run ai:build` and commit packages/ai/data/.
 */
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

/** Bumped when the meaning of the artefacts changes in a way the probes cannot see. */
const PROCEDURE = 2;

/** Canonical JSON with every number to six significant digits; typed arrays as arrays. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_k, v: unknown) => {
    if (typeof v === 'number') return Number.isFinite(v) ? Number(v.toPrecision(6)) : String(v);
    if (ArrayBuffer.isView(v) && !(v instanceof DataView)) {
      return Array.from(v as unknown as ArrayLike<number>, (x) => Number(x.toPrecision(6)));
    }
    return v;
  });
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/** The envelope without its stored hash, as measured. */
function envelopeData(e: Envelope): Omit<Envelope, never> {
  const { inputsHash: _h, ...rest } = e as EnvelopeArtefact;
  return rest;
}

export interface EnvelopeFingerprint {
  hash: string;
  /** The envelope as measured now, rounded as the file stores it. */
  envelope: Envelope;
  report: MeasureReport;
}

/** Remeasure the envelope and fingerprint it (the car's behaviour is the fingerprint). */
export function envelopeFingerprint(
  setup: CircuitSetup,
  params: CarParams = carFor(setup),
): EnvelopeFingerprint {
  const report = measureEnvelope({ params, airDensity: setup.airDensity, fuel: setup.fuel });
  // Round-trip through the file format so the fingerprint is of what the file holds.
  const envelope = JSON.parse(JSON.stringify(report.envelope)) as Envelope;
  const hash = sha256(
    canonical({
      procedure: PROCEDURE,
      params,
      airDensity: setup.airDensity,
      fuel: setup.fuel,
      envelope: envelopeData(envelope),
    }),
  );
  return { hash, envelope, report };
}

/**
 * Probe the line pipeline on `track` with `envelope` and fingerprint the results. Everything
 * the racing-line artefact depends on is exercised: track geometry and surface, corridor,
 * minimum-curvature solver, line geometry, speed profile, refinement.
 */
export function lineFingerprint(
  track: Track,
  envelope: Envelope,
  config: LineConfig,
  skill: DriverSkill,
  envelopeHash = '',
): string {
  const model = new EnvelopeModel(envelope);
  const corridor = buildCorridor(track, config.corridor);
  const mc = minimumCurvatureLine(track, corridor).d;
  const halfTrack = corridorHalfTrack(config.corridor);
  const geo = computeLineGeometry(track, mc, { halfTrack });
  const drs = drsZoneFlags(track);
  const lapTimeOf = (d: Float64Array): number =>
    new SpeedProfiler(computeLineGeometry(track, d, { halfTrack }), model).compute({
      scale: config.scale,
      drs,
    }).lapTime;
  const profile = new SpeedProfiler(geo, model).compute({ scale: config.scale, drs });
  const step = track.lap.step;
  const probe = refineLine(corridor, mc, {
    evaluate: lapTimeOf,
    focus: new Uint8Array(track.lap.count).fill(1),
    widths: [20 / step],
    amplitudes: [0.6],
    spacing: Math.round(300 / step),
  });
  return sha256(
    canonical({
      procedure: PROCEDURE,
      config,
      skill,
      envelope: envelopeHash || canonical(envelopeData(envelope)),
      track: { length: track.length, count: track.lap.count, drsZones: track.drsZones },
      corridor,
      mc,
      geometry: {
        x: geo.x,
        y: geo.y,
        z: geo.z,
        curvature: geo.curvature,
        grade: geo.grade,
        verticalCurvature: geo.verticalCurvature,
        tanBank: geo.tanBank,
        grip: geo.grip,
      },
      profile: { v: profile.v, lapTime: profile.lapTime, deploy: profile.deployEnergy },
      refine: { d: probe.d, lapTime: probe.lapTime, accepted: probe.accepted },
    }),
  );
}

export function loadEnvelope(setup: CircuitSetup): EnvelopeArtefact {
  const raw = JSON.parse(fs.readFileSync(path.join(ROOT, envelopeFile(setup)), 'utf8'));
  return decodeEnvelope(raw);
}

export function loadLine(setup: CircuitSetup): RacingLineData {
  const raw = JSON.parse(fs.readFileSync(path.join(ROOT, lineFile(setup)), 'utf8'));
  return decodeRacingLine(raw);
}

export interface Staleness {
  envelope: { stored: string; current: string; stale: boolean };
  line: { stored: string; current: string; stale: boolean };
}

/**
 * Compare the committed artefacts with what the current code, car and track produce, by
 * fingerprint (about 3 s: one envelope measurement and one line probe).
 */
export function checkArtefacts(setup: CircuitSetup): Staleness {
  const env = loadEnvelope(setup);
  const line = loadLine(setup);
  const fresh = envelopeFingerprint(setup);
  const lineNow = lineFingerprint(
    setup.track(),
    fresh.envelope,
    referenceLineConfig(carFor(setup)),
    REFERENCE_SKILL,
    fresh.hash,
  );
  return {
    envelope: { stored: env.inputsHash, current: fresh.hash, stale: env.inputsHash !== fresh.hash },
    line: { stored: line.inputsHash, current: lineNow, stale: line.inputsHash !== lineNow },
  };
}

/** What to tell a developer whose change made an artefact stale. */
export function staleMessage(setup: CircuitSetup, which: 'envelope' | 'line'): string {
  const file = which === 'envelope' ? envelopeFile(setup) : lineFile(setup);
  return (
    `${file} is stale: the car, the track or the code that makes it now computes something ` +
    `different. Run \`npm run ai:build\`, then commit ${envelopeFile(setup)} and ` +
    `${lineFile(setup)}.`
  );
}

export interface BuildReport {
  envelope: MeasureReport;
  line: LineBuildResult;
  /** Wall time of each stage, ms (measured by the caller's clock). */
  envelopeMs: number;
  lineMs: number;
  files: string[];
}

/** Remeasure the envelope, recompute the line, write both artefacts. */
export function buildArtefacts(setup: CircuitSetup, clock: () => number): BuildReport {
  const params = carFor(setup);
  const t0 = clock();
  const fresh = envelopeFingerprint(setup, params);
  const envArtefact: EnvelopeArtefact = { ...fresh.envelope, inputsHash: fresh.hash };
  const envRead = decodeEnvelope(JSON.parse(JSON.stringify(envArtefact)));
  const t1 = clock();
  const track = setup.track();
  const config = referenceLineConfig(params);
  const line = buildRacingLine(track, envRead, config);
  // Plan on the offsets as the file stores them (0.1 mm), so the shipped speeds are the ones a
  // driver re-plans from the file: near a tight apex the rounding moves the curvature enough to
  // change the planned speed by more than the file's cm/s.
  const stored = Float64Array.from(line.d, (d) => Math.round(d * 1e4) / 1e4);
  const plan = buildPlan(track, stored, envRead, { scale: config.scale });
  const t2 = clock();
  const data = encodeRacingLine(plan, {
    circuit: setup.id,
    trim: setup.trim,
    inputsHash: lineFingerprint(track, envRead, config, REFERENCE_SKILL, fresh.hash),
    envelopeHash: fresh.hash,
  });
  const files = [envelopeFile(setup), lineFile(setup)];
  fs.writeFileSync(path.join(ROOT, files[0]!), formatEnvelope(envArtefact));
  fs.writeFileSync(path.join(ROOT, files[1]!), formatLine(data));
  return { envelope: fresh.report, line, envelopeMs: t1 - t0, lineMs: t2 - t1, files };
}

/** One table row per line keeps the files small and their diffs readable. */
function formatEnvelope(e: EnvelopeArtefact): string {
  return formatJson(e as unknown as Record<string, unknown>);
}

function formatLine(d: RacingLineData): string {
  return formatJson(d as unknown as Record<string, unknown>);
}

function formatJson(obj: Record<string, unknown>, indent = ''): string {
  const inner = indent + '  ';
  const parts = Object.entries(obj).map(([k, v]) => {
    let text: string;
    if (Array.isArray(v) && v.every((x) => typeof x === 'number')) text = JSON.stringify(v);
    else if (Array.isArray(v) && v.every((x) => Array.isArray(x))) {
      text = `[\n${v.map((row) => inner + '  ' + JSON.stringify(row)).join(',\n')}\n${inner}]`;
    } else if (v && typeof v === 'object' && !Array.isArray(v)) {
      text = formatJson(v as Record<string, unknown>, inner);
    } else text = JSON.stringify(v);
    return `${inner}${JSON.stringify(k)}: ${text}`;
  });
  return `{\n${parts.join(',\n')}\n${indent}}` + (indent === '' ? '\n' : '');
}
