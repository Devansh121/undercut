// Racing-line build: `npm run ai:build [-- --check]`.
// Measures the car's performance envelope by driving the vehicle model, computes the racing
// line and speed profile from it, and writes both artefacts to packages/ai/data/ with a
// fingerprint of what produced them. With --check it recomputes the fingerprints (about 3 s) and
// compares them with the stored ones; see packages/ai/README.md.
// The work lives in packages/ai/validation/lib; this file loads that TypeScript through Vite's
// module runner and does the I/O and timing (the AI package never reads a clock).
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { runnerImport } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { module: lib } = await runnerImport(path.join(root, 'packages/ai/validation/lib/index.ts'), {
  root,
  configFile: false,
  logLevel: 'error',
});
const check = process.argv.includes('--check');
const setups = [lib.MONZA];
let stale = 0;
for (const setup of setups) {
  if (check) {
    const s = lib.checkArtefacts(setup);
    for (const [name, v] of Object.entries(s)) {
      console.log(
        `${setup.id}-${setup.trim} ${name}: ${v.stale ? 'STALE' : 'current'} (${v.stored.slice(0, 12)})`,
      );
      if (v.stale) {
        stale++;
        console.log(`  ${lib.staleMessage(setup, name)}`);
      }
    }
    continue;
  }
  const r = lib.buildArtefacts(setup, () => performance.now());
  console.log(
    `${setup.id}-${setup.trim}: envelope measured in ${(r.envelopeMs / 1000).toFixed(2)} s ` +
      `(${r.envelope.simSeconds.toFixed(0)} s of driving, combined exponent ${r.envelope.envelope.combinedExponent}); ` +
      `line in ${(r.lineMs / 1000).toFixed(2)} s (${r.line.evaluations} profiles, ${r.line.accepted} bumps kept): ` +
      `minimum curvature ${r.line.minCurvatureLapTime.toFixed(3)} s, refined ${r.line.lapTime.toFixed(3)} s`,
  );
  for (const f of r.files) console.log(`  wrote ${f}`);
}
if (stale > 0) {
  console.log(`${stale} artefact(s) stale: run \`npm run ai:build\` and commit packages/ai/data/.`);
  process.exit(1);
}
