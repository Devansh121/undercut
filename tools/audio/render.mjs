// Entry for `npm run audio:render`. The renderer and the audio core are TypeScript, so this
// loads them through Vite's module runner (already a dev dependency) instead of a compile step.
import { fileURLToPath } from 'node:url';
import { runnerImport } from 'vite';

const entry = fileURLToPath(new URL('./cli.ts', import.meta.url));
const { module } = await runnerImport(entry, { configFile: false, logLevel: 'error' });
await module.main(process.argv.slice(2));
