/// <reference types="node" />
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeEnvelope, type EnvelopeArtefact } from '../../src/envelope/envelope';
import { measureEnvelope, type MeasureReport } from '../../src/envelope/measure';
import { REFERENCE_SKILL } from '../../src/driver/reference';
import { buildRacingLine, type LineBuildResult } from '../../src/line/build';
import { buildPlan } from '../../src/profile/plan';
import {
  decodeRacingLine,
  encodeRacingLine,
  type RacingLineData,
} from '../../src/export/racing-line';
import { referenceLineConfig } from '../../src/reference-setup';
import { carFor, envelopeFile, lineFile, type CircuitSetup } from './circuits';

/**
 * The two committed artefacts per circuit and trim, and the hashes that tell CI when they are
 * stale without recomputing them:
 *
 * - envelope: the car's measured performance envelope. Its inputs are the car's parameters,
 *   the event air and fuel, and the source of the vehicle model and of the measurement code.
 * - racing line: the line and speed profile. Its inputs are the track file, the envelope's
 *   hash, the line configuration and skill, and the source of the line and profile code.
 *
 * Change any input and the stored hash no longer matches; `npm run ai:build` remakes both.
 */
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

/** Bumped when the meaning of the artefacts changes without the hashed source changing. */
const PROCEDURE = 1;

const ENVELOPE_SOURCES = [
  'packages/sim/src',
  'packages/ai/src/envelope',
  'packages/ai/src/driver/feel.ts',
];
const LINE_SOURCES = [
  'packages/ai/src/line',
  'packages/ai/src/profile',
  'packages/ai/src/envelope/envelope.ts',
  'packages/ai/src/export',
  'packages/ai/src/reference-setup.ts',
];

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function listFiles(rel: string): string[] {
  const abs = path.join(ROOT, rel);
  const st = fs.statSync(abs);
  if (st.isFile()) return [rel];
  const out: string[] = [];
  for (const name of fs.readdirSync(abs).sort()) {
    const child = `${rel}/${name}`;
    const cs = fs.statSync(path.join(ROOT, child));
    if (cs.isDirectory()) out.push(...listFiles(child));
    else if (name.endsWith('.ts') || name.endsWith('.json')) out.push(child);
  }
  return out;
}

/** Digest of source files: path and content of each, line endings normalised. */
export function sourcesDigest(roots: readonly string[]): string {
  const h = createHash('sha256');
  for (const root of roots) {
    for (const file of listFiles(root)) {
      h.update(file + '\0');
      h.update(fs.readFileSync(path.join(ROOT, file), 'utf8').replace(/\r\n/g, '\n'));
      h.update('\0');
    }
  }
  return h.digest('hex');
}

export function envelopeInputsHash(setup: CircuitSetup): string {
  return sha256(
    JSON.stringify({
      procedure: PROCEDURE,
      params: carFor(setup),
      airDensity: setup.airDensity,
      fuel: setup.fuel,
      sources: sourcesDigest(ENVELOPE_SOURCES),
    }),
  );
}

export function lineInputsHash(setup: CircuitSetup, envelopeHash: string): string {
  return sha256(
    JSON.stringify({
      procedure: PROCEDURE,
      track: sha256(fs.readFileSync(path.join(ROOT, setup.trackFile), 'utf8')),
      envelope: envelopeHash,
      config: referenceLineConfig(carFor(setup)),
      skill: REFERENCE_SKILL,
      sources: sourcesDigest(LINE_SOURCES),
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

/** Compare the committed artefacts' hashes with the current inputs. Cheap (hashing only). */
export function checkArtefacts(setup: CircuitSetup): Staleness {
  const env = loadEnvelope(setup);
  const line = loadLine(setup);
  const envNow = envelopeInputsHash(setup);
  const lineNow = lineInputsHash(setup, envNow);
  return {
    envelope: { stored: env.inputsHash, current: envNow, stale: env.inputsHash !== envNow },
    line: { stored: line.inputsHash, current: lineNow, stale: line.inputsHash !== lineNow },
  };
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
  const measured = measureEnvelope({ params, airDensity: setup.airDensity, fuel: setup.fuel });
  const envelopeHash = envelopeInputsHash(setup);
  const envArtefact: EnvelopeArtefact = { ...measured.envelope, inputsHash: envelopeHash };
  // Build the line from the envelope exactly as it will be read back (rounded in the file).
  const envText = JSON.stringify(envArtefact);
  const envRead = decodeEnvelope(JSON.parse(envText));
  const t1 = clock();
  const track = setup.track();
  const config = referenceLineConfig(params);
  const line = buildRacingLine(track, envRead, config);
  const plan = buildPlan(track, line.d, envRead, { scale: config.scale });
  const t2 = clock();
  const data = encodeRacingLine(plan, {
    circuit: setup.id,
    trim: setup.trim,
    inputsHash: lineInputsHash(setup, envelopeHash),
    envelopeHash,
  });
  const files = [envelopeFile(setup), lineFile(setup)];
  fs.writeFileSync(path.join(ROOT, files[0]!), formatEnvelope(envArtefact));
  fs.writeFileSync(path.join(ROOT, files[1]!), formatLine(data));
  return { envelope: measured, line, envelopeMs: t1 - t0, lineMs: t2 - t1, files };
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
