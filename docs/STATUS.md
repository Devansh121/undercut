# Status

## Start it

```sh
./start.sh
```

Open the `Wi-Fi:` address it prints on a phone on the same network. The HTTPS address shows a certificate warning once.

## What changed

- M0 foundation: npm workspaces, TypeScript strict, Vite client, rooms service on the local Workers runtime, CI with eight required checks, the one-command run.
- The launch screen shows the name, a Drive button (not live until M1) and the build hash over a placeholder 3D view.

## Try this

1. Run `./start.sh`, then open the `Wi-Fi:` HTTPS address on your phone in landscape. The screen should fit with nothing cut off.
2. Press Ctrl-C and check nothing is left running (`ss -ltn | grep -E '5173|5174|8787'` prints nothing).
3. Run `PORT=5173 ./start.sh` while another copy runs: it should refuse with a clear message naming the port.

## Decided for you

- MIT copyright holder written as "Devansh121".
- npm workspaces instead of pnpm, because pnpm is not installed.
- Era: the 2022–2025 ground-effect regulations (ADR 0001).
- `./start.sh` is the single command (ADR 0006).
- Self-signed HTTPS on a second port; a phone shows a certificate warning once.
- Wrangler pinned to 4.86.0 and Vitest to 4.1, the newest releases that run on Node 20.19; later ones need Node 22.12. Moving to Node 22 would let both upgrade.
- TypeScript 5.9, because the lint toolchain (typescript-eslint) supports TypeScript up to 6.0 and not 7.
- Browser tests render with software WebGL, so they behave the same on CI and the laptop and do not compete for the GPU.
- All three default circuits (Monza, Spa, Singapore) kept: their open data passed the length and elevation checks in `docs/track-data.md`.
- Committed track files will be offered under ODbL 1.0 with the OpenStreetMap and Copernicus notices, separate from the MIT code.
- The TUMFTM track dataset is used only as a local cross-check, never shipped: it is OSM-derived but published under LGPL-3.0.
- Race start fuel 105 kg in the physics targets: the commonly quoted 110 kg cap was not found in the 2025 regulation text.
- Reference driver (M1): the reference lap at Monza is 90.137 s, outside the M1 band (74.852–82.732 s). It is recorded as a known gap (physics-validation section 5 and 7.6), not loosened. The residual is not yet split between the car's grip, the track geometry and widths, and the line; the test asserts the gap stays within 0.197 s of the recorded value.
- The reference driver keeps off the kerbs and 0.3 m inside the white lines: the kerb edges in the track model unsettle the car at the limit. Kerb use is a per-profile setting in the line configuration for when kerbs are smoother.
- The reference driver plans with 97 % of the lateral and traction limits and 95 % of braking: the fastest setting that stays clean (98–99 % is slower, 100 % leaves the track).
- The timed lap follows one out-lap on which the MGU-K is saved (a full store at the line, as in qualifying). Shorter run-ups placed the car at full speed with a full store just before a braking zone, a state a flying lap never reaches, and it could spin there. Track limits are judged strictly: a wheel is off once its centre is past the white line.
- Monza laps and sectors are timed from the control line, measured on the FIA circuit map at s = 5472.5 m (320.5 m before the track file's s = 0, ±13 m). The track file is unchanged; the track pipeline should carry the control line as metadata, and its DRS zone 2 activation (anchored on the map at the finish line) is about 320 m late.
- The nightly ten-lap soak starts with 34 kg of fuel (qualifying fuel cannot cover ten laps) and requires a lap-time spread of at most 0.5 s; measured 0.228 s.
- The racing-line and envelope artefacts are checked for staleness by behavioural fingerprints (what the sim, track and line code compute), not by hashing source text, so unrelated edits do not block other work. The check takes about 5 s in the physics job.

## Optional, needs you

- A Cloudflare account to deploy the rooms Worker, and a static host for the client. Neither blocks a milestone; everything runs locally.
