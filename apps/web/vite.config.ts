import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
// Relative import on purpose: the config is loaded by Node, which cannot import the
// workspace package's TypeScript entry directly.
import { GAME_NAME } from '../../packages/core/src/name.ts';

function buildHash(): string {
  if (process.env.BUILD_HASH) return process.env.BUILD_HASH;
  try {
    const hash = execSync('git rev-parse --short=7 HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
    const dirty = execSync('git status --porcelain --untracked-files=no', {
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();
    return dirty ? `${hash}+dirty` : hash;
  } catch {
    return 'unversioned';
  }
}

/** Puts the game name from the one constant into index.html. */
function gameName(): Plugin {
  return {
    name: 'game-name',
    transformIndexHtml: (html) => html.replaceAll('%GAME_NAME%', GAME_NAME),
  };
}

const roomsPort = Number(process.env.ROOMS_PORT ?? 8787);

export default defineConfig({
  base: './',
  plugins: [gameName()],
  define: {
    __BUILD_HASH__: JSON.stringify(buildHash()),
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
    // The real gate is tools/budget; this only silences Vite's generic warning.
    chunkSizeWarningLimit: 1500,
    rolldownOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        // Diagnostic page for the input layer; linked from nowhere in the game.
        inputLab: fileURLToPath(new URL('./input-lab.html', import.meta.url)),
      },
    },
  },
  server: {
    // Same-origin /rooms, as in production; the rooms service runs on the Workers runtime.
    proxy: {
      '/rooms': { target: `http://127.0.0.1:${roomsPort}`, ws: true },
    },
  },
});
