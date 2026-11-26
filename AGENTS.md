# Agent conventions

Read this before changing anything. It is short on purpose; keep it that way.

## Code conventions

- **Units.** SI everywhere in code: m, s, kg, rad, N, W, K. Convert (km/h, degrees, °C, bar) only at the UI edge.
- **World frame.** three.js native, right-handed: +Y up, +X east, +Z south.
- **Car body frame.** +X forward, +Y up, +Z right. Yaw is about +Y; positive yaw turns left.
- **Track coordinates `(s, d)`.** `s` is metres along the centreline from the start/finish line; `d` is lateral offset in metres, positive to the left of the direction of travel.
- **The sim is pure.** `packages/sim` (and core, track, ai, race, protocol) has no DOM, no three.js, no `Date.now()`, `performance.now()` or `Math.random()`. Time and a seeded `Rng` are passed in. ESLint enforces this.
- **Fixed timestep.** The sim steps at a fixed `dt` through `FixedStepAccumulator`; rendering interpolates between the last two sim states with `alpha`. Elapsed time is clamped after a stall (default 0.25 s).
- **The game name** lives in one constant, `GAME_NAME` in `packages/core/src/name.ts`. Nothing else spells it in code or UI; `npm run lint` checks this.
- **No hard-coded hosts.** Nothing in the client says `localhost` or `127.0.0.1`. The rooms URL is a setting (`apps/web/src/settings.ts`) that defaults to same-origin `/rooms`.
- **No real-world names.** No real team, driver, sponsor or series names, logos or lookalike liveries. Never write the real series' name or abbreviation in product, UI, repo metadata or identifiers. Docs may cite real data sources by name where a citation needs it. `npm run lint` checks a list of real names (`tools/ci/trademarks.json`) everywhere except the two research docs (`docs/physics-validation.md`, `docs/track-data.md`); any other citation needs an `allow` entry with its reason.
- **Packages** are `@undercut/<name>`, consumed as TypeScript source through workspace `exports`; there is no per-package build. `tsc` only typechecks.

## Package dependency direction

Lower layers may not import higher ones, and siblings in a layer do not import each other (except ai may read track):

```
core → sim → track, ai → race → protocol → input, audio, render → apps/web
services/rooms depends on core and protocol only
```

Only `render` and `apps/web` may import three.js. `eslint.config.js` encodes this; change both together, with an ADR (race joined in ADR 0008).

## Testing

- Simulation, protocol and rules logic is written test-first.
- `npm test` (unit), `npm run test:physics` (validation suites in `packages/*/validation/` and `apps/web/validation/`; CI runs it in three shards balanced on `tools/ci/physics-weights.json`, so refresh that file when a suite's time changes a lot), `npm run test:rooms` (real Workers runtime), `npm run test:browser` (Playwright, desktop 1440×900 and landscape phone 844×390; run `npm run build` first).
- Tests that need the local Workers runtime are named `*.runtime.test.mjs` (tools) or live in `services/rooms/test/`; they run in the `rooms` project, not `unit`.
- Never loosen a test or tolerance to get green. A flaky test is fixed or removed, never retried into green.
- Browser CI balances desktop and phone independently across two shards using `tools/ci/browser-weights.json`; refresh it when spec durations change substantially. `BROWSER_SHARD=i/n` selects a shard; unset runs the full suite.
- Cap parallelism on the shared laptop: vitest uses at most 4 workers, Playwright 2. Browser tests use software WebGL, so they need no GPU. Anything that does use the GPU runs under `flock ~/.cache/undercut/gpu.lock`.

## Process rules

**Never**
- Ask a question or wait for a human. Take the conservative option, record it under "Decided for you" in `docs/STATUS.md`, carry on.
- Use `sudo`, install system packages, or run anything that prompts for a password.
- Touch other projects on the machine. The product brief may be read; the course material it mentions may be applied but never committed or quoted.
- Use plain `gh` or SSH remotes; use `dev-gh` and the HTTPS `origin`. Never change the repo-local git identity (`Devansh121`, noreply address); check `git log --format='%ae %ce' origin/master..HEAD` before pushing.
- Add AI attribution anywhere (commits, PR titles and bodies, comments, docs): no co-author lines, no "generated with", no model names. Grep for it before every push.
- Force-push, rewrite pushed history, merge a PR, delete someone else's branch or change repo settings.
- Use anything paid, behind a login or trial, or under a licence you have not read. Third-party assets must be CC0 or CC BY (or a read licence that allows redistribution in an MIT repo), recorded in `assets/MANIFEST.json` and `CREDITS.md`.

**Machine**
- Shared daily laptop: 16 threads, about 10 GB free RAM, one 6 GB GPU. Other agents run beside you; one build and one GPU job at a time.
- Playwright downloads its own Chromium (`npx playwright install chromium`, no `--with-deps`).
- Scratch files go in `~/.cache/undercut/scratch/<branch>/`, never in the repo. Stop every server you start, by PID.

**Work style**
- One task, one branch (`m<milestone>/<slug>`), one worktree. Small commits, plain imperative messages.
- Apply design patterns where behaviour varies (input devices, AI drivers, session rules, tyre compounds, net transport). Keep the physics inner loop plain and data-oriented.
- The bar is a commercial racing sim, not a tech demo: no default fonts or buttons, emoji, purple gradients or glass blur. Copy is plain, with no exclamation marks or marketing filler. Look at the frames yourself.

**Pull requests**
- `dev-gh pr create --base master` with the template sections: What and why / How it was tested / Evidence / Risk. Evidence is real output: test summaries, numbers, screenshot paths.
- Wait for CI with `dev-gh pr checks <n> --watch --interval 20` and fix until every check is green. Keep master playable.
