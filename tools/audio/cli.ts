/**
 * Offline audio renderer: `npm run audio:render -- [scenario ...|all] [--out <dir>] [--evidence <dir>]`.
 * Writes <name>.wav (48 kHz, 16-bit stereo), <name>.json (measurements) and <name>.png
 * (spectrogram) per scenario, plus summary.json. With --evidence, also writes every JSON file
 * and the spectrograms in EVIDENCE_IMAGES (not the WAVs) to that folder for committing.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { measure, type Measurement } from './measure';
import { renderScenario, scenarioByName, SCENARIOS } from './scenarios';
import { spectrogramPng } from './spectrogram-image';
import { encodeWav } from './wav';

/** Spectrograms worth keeping in the repo: the ladder, load, downshifts and the road layer. */
const EVIDENCE_IMAGES = new Set([
  'full-throttle',
  'rev-sweep',
  'load-steps',
  'braking-downshifts',
  'slow-corner',
]);

function parse(argv: readonly string[]): {
  names: string[];
  out: string;
  evidence: string | undefined;
} {
  const names: string[] = [];
  let out = 'artifacts/audio';
  let evidence: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string;
    if (a === '--out') out = argv[++i] ?? out;
    else if (a === '--evidence') evidence = argv[++i] ?? 'docs/evidence/m1-audio';
    else names.push(a);
  }
  if (names.length === 0 || names.includes('all'))
    return { names: SCENARIOS.map((s) => s.name), out, evidence };
  return { names, out, evidence };
}

function write(line: string): void {
  process.stdout.write(`${line}\n`);
}

export async function main(argv: readonly string[]): Promise<void> {
  const { names, out, evidence } = parse(argv);
  const outDir = resolve(out);
  mkdirSync(outDir, { recursive: true });
  if (evidence) mkdirSync(resolve(evidence), { recursive: true });
  const summary: Record<string, Measurement & { title: string; listen: string }> = {};
  write('scenario              dur s   peak dBFS  TP dBTP  LUFS    track med/max %  x RT');
  for (const name of names) {
    const scenario = scenarioByName(name);
    const rendered = renderScenario(scenario, { now: () => performance.now() });
    const m = measure(rendered);
    const record = { title: scenario.title, listen: scenario.listen, ...m };
    summary[name] = record;
    const json = `${JSON.stringify(record, null, 2)}\n`;
    const png = spectrogramPng(rendered, `${name}: ${scenario.title}`);
    writeFileSync(
      join(outDir, `${name}.wav`),
      encodeWav([rendered.left, rendered.right], rendered.sampleRate),
    );
    writeFileSync(join(outDir, `${name}.json`), json);
    writeFileSync(join(outDir, `${name}.png`), png);
    if (evidence) {
      writeFileSync(join(resolve(evidence), `${name}.json`), json);
      if (EVIDENCE_IMAGES.has(name)) writeFileSync(join(resolve(evidence), `${name}.png`), png);
    }
    const t = m.tracking;
    write(
      `${name.padEnd(20)} ${m.durationS.toFixed(1).padStart(6)} ${m.samplePeakDbfs.toFixed(2).padStart(10)} ${m.truePeakDbtp
        .toFixed(2)
        .padStart(8)} ${m.loudnessLufs.toFixed(1).padStart(6)}   ${
        t.windows ? `${t.medianErrorPct.toFixed(3)}/${t.maxErrorPct.toFixed(3)}` : 'n/a'
      }`.padEnd(72) + `${m.realtimeRatio.toFixed(0).padStart(5)}`,
    );
  }
  const summaryJson = `${JSON.stringify(summary, null, 2)}\n`;
  writeFileSync(join(outDir, 'summary.json'), summaryJson);
  if (evidence) writeFileSync(join(resolve(evidence), 'summary.json'), summaryJson);
  write(
    `\nWrote ${names.length} scenarios to ${outDir}${evidence ? ` and evidence to ${resolve(evidence)}` : ''}`,
  );
}
