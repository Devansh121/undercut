import { execSync } from 'node:child_process';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
// Relative import on purpose: the config is loaded by Node, which cannot import the
// workspace package's TypeScript entry directly.
import { GAME_NAME } from '../../packages/core/src/name.ts';
import { CIRCUIT_DATA, fullRaceLaps } from '../../packages/race/src/circuit.ts';
import { summarizeTrack, type TrackFileLike } from './src/ui/data/circuit-summary.ts';

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

/**
 * The Draco decoder that ships with three.js (Apache-2.0, credited in CREDITS.md), served from the
 * game's own origin at assets/draco/ and never from a CDN. DRACOLoader loads it by fixed file
 * names, so it is copied as is rather than hashed into the bundle.
 */
function dracoDecoder(): Plugin {
  const dir = fileURLToPath(
    new URL('../../node_modules/three/examples/jsm/libs/draco/gltf/', import.meta.url),
  );
  const files = ['draco_decoder.wasm', 'draco_wasm_wrapper.js'];
  return {
    name: 'draco-decoder',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const m = /\/assets\/draco\/([\w.]+)$/.exec(req.url?.split('?')[0] ?? '');
        const name = m?.[1];
        if (!name || !files.includes(name)) return next();
        res.setHeader(
          'Content-Type',
          name.endsWith('.wasm') ? 'application/wasm' : 'text/javascript',
        );
        res.end(fs.readFileSync(dir + name));
      });
    },
    generateBundle() {
      for (const name of files) {
        this.emitFile({
          type: 'asset',
          fileName: `assets/draco/${name}`,
          source: fs.readFileSync(dir + name),
        });
      }
    },
  };
}

/**
 * `virtual:undercut/circuits`: the menus' summary of every circuit whose track file is in
 * packages/track/data (plan, length, corners, DRS zones, race laps), computed at build time so
 * the menus never download a track to draw a card, and a circuit appears once its data lands.
 */
function circuitCatalog(): Plugin {
  const id = 'virtual:undercut/circuits';
  const resolved = `\0${id}`;
  const dir = fileURLToPath(new URL('../../packages/track/data/', import.meta.url));
  return {
    name: 'circuit-catalog',
    resolveId: (source) => (source === id ? resolved : null),
    load(source) {
      if (source !== resolved) return null;
      const files = fs
        .readdirSync(dir)
        .filter((f) => f.endsWith('.json'))
        .sort();
      const circuits = files.map((f) => {
        this.addWatchFile(dir + f);
        const t = JSON.parse(fs.readFileSync(dir + f, 'utf8')) as TrackFileLike;
        const rules = CIRCUIT_DATA[t.id];
        const line =
          typeof t.timingLine === 'number'
            ? t.timingLine
            : (t.timingLine?.s ?? rules?.timingLine ?? 0);
        return summarizeTrack(t, rules?.raceLaps ?? fullRaceLaps(t.length), line);
      });
      // Monza first (the default and round 1), then by name.
      circuits.sort((a, b) =>
        a.id === 'monza' ? -1 : b.id === 'monza' ? 1 : a.name.localeCompare(b.name),
      );
      return `export const CIRCUITS = ${JSON.stringify(circuits)};`;
    },
  };
}

const roomsPort = Number(process.env.ROOMS_PORT ?? 8787);

export default defineConfig({
  base: './',
  plugins: [gameName(), dracoDecoder(), circuitCatalog()],
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
        // Diagnostic pages; linked from nowhere in the game.
        inputLab: fileURLToPath(new URL('./input-lab.html', import.meta.url)),
        uiGallery: fileURLToPath(new URL('./ui-gallery.html', import.meta.url)),
      },
    },
  },
  server: {
    // Same-origin /rooms, as in production; the rooms service runs on the Workers runtime.
    proxy: {
      '/rooms': {
        target: `http://127.0.0.1:${roomsPort}`,
        ws: true,
        // The rooms service limits rooms and sockets per client address, read from
        // cf-connecting-ip as the Cloudflare edge sets it. Set it from the socket here
        // too, replacing anything the client sent (as tools/serve/static.mjs does).
        configure: (proxy) => {
          const fromSocket = (
            proxyReq: { setHeader(name: string, value: string): void },
            req: { socket: { remoteAddress?: string | undefined } },
          ) => {
            const address = req.socket.remoteAddress ?? '';
            proxyReq.setHeader('cf-connecting-ip', address);
            proxyReq.setHeader('x-forwarded-for', address);
          };
          proxy.on('proxyReq', fromSocket);
          proxy.on('proxyReqWs', fromSocket);
        },
      },
    },
  },
});
