# UNDERCUT

A realistic open-wheel racing game for the browser, on desktop and phone.
TypeScript and three.js, with a local rooms service for online races.

## Run

```sh
./start.sh
```

Open the printed address, press Start and drive: Time Trial at Monza. Arrows or WASD drive, C changes camera, Esc pauses; a gamepad or a phone in landscape work too (keys and tips in `docs/STATUS.md`).

Needs Node 20.19 or newer. It installs dependencies when needed, builds the client, starts the rooms service on the local Workers runtime and serves the game over HTTP and HTTPS. It prints the addresses to open, including the one a phone on the same Wi-Fi should use. Ports come from `PORT` (5173), `HTTPS_PORT` (5174) and `ROOMS_PORT` (8787). Ctrl-C stops everything.

## Develop

```sh
npm run dev
```

Vite dev server with hot reload, plus the rooms service behind the same `/rooms` proxy.

## Test

| Command | What it runs |
| --- | --- |
| `npm run lint` | ESLint, Prettier check, name checks (the game name, and no real series, team, driver or sponsor names) |
| `npm run typecheck` | `tsc` over every package |
| `npm test` | Unit tests (Vitest) |
| `npm run test:physics` | Physics validation suite (`packages/sim/validation/`) |
| `npm run test:rooms` | Protocol and room tests against the local Workers runtime, plus server start and stop checks |
| `npm run build` | Production build plus bundle and asset budget check |
| `npm run deploy:check` | Build, stage static assets, and verify the Cloudflare bundle (`wrangler deploy --dry-run`) |
| `npm run test:deploy` | Composed Cloudflare Worker (static client + `/rooms`) tests on the local Workers runtime |
| `npm run test:browser` | Playwright, desktop 1440×900 and landscape phone 844×390 (build first) |
| `npm run shots -- monza` | Screenshot stations on the real GPU into `artifacts/screenshots/<sha>/` (build first; `--lap`, `--perf`) |
| `npm run check:assets` | Asset licence check against `assets/MANIFEST.json` |
| `npm run check:credits` | `CREDITS.md` against the asset manifest and the lockfile, and every npm package's licence |
| `npm run check:secrets` | Secret scan with gitleaks (Linux x64) |

Run `npx playwright install chromium` once before the browser tests.

## Deploy

Deploys as one Cloudflare Worker (`wrangler.jsonc`) serving the built client and `/rooms` on the same origin, within the Workers Free plan:

```sh
npx wrangler login
npm run deploy
```

Full steps, rollback, takedown, Free plan limits and abuse guards are in `docs/DEPLOY.md`.

## Layout

| Path | Contents |
| --- | --- |
| `apps/web/` | The browser client: launch, drive screen, HUD and menus; `src/game/` holds the pure session logic (timing, limits, ghost, records, loop) |
| `packages/core/` | Game name, seeded RNG, small maths, fixed-timestep accumulator |
| `packages/sim/` | Vehicle and world simulation (pure, no DOM) |
| `packages/track/` | Track data model and loaders |
| `packages/ai/` | AI drivers |
| `packages/protocol/` | Room messages and validation, shared by client and service |
| `packages/render/` | three.js renderer, lighting, track materials, the interim car and cameras |
| `packages/audio/`, `input/` | Audio and input layers |
| `services/rooms/` | Cloudflare Worker with one Durable Object per room |
| `tools/` | Local server, budget and licence checks, telemetry and screenshot tooling |
| `tools/research/` | Standard-library Python scripts that fetch and measure circuit centrelines and elevation |
| `docs/` | Status, roadmap, quality scorecard, decisions (`docs/adr/`) |
| `docs/physics-validation.md` | Reference car parameters and the sourced validation targets with tolerances |
| `docs/track-data.md` | Open geodata sources, licences and the build pipeline for the three circuits |
| `assets/` | Third-party assets and `MANIFEST.json` |

Conventions for anyone changing the code are in `AGENTS.md`.

Code is MIT licensed. Assets keep their own licences; see `CREDITS.md`.
