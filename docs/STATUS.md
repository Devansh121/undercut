# Status

## Start it

```sh
./start.sh
```

Open the `Wi-Fi:` address it prints on a phone on the same network. The HTTPS address shows a certificate warning once.

## What changed

- M0 foundation: npm workspaces, TypeScript strict, Vite client, rooms service on the local Workers runtime, CI with eight required checks, the one-command run.
- The launch screen shows the name, a Drive button (not live until M1) and the build hash over a placeholder 3D view.
- M5 rooms service and protocol: private rooms by invite code on the local Workers runtime, with the server owning the clock, grid, start lights, phases, timing checks and results; protocol v2 with binary car snapshots; a client library with clock sync, reconnect and remote-car interpolation; host migration with AI handover. Headless and soak-tested; the lobby and in-race UI come next. See `docs/netcode.md`.

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
- Online rooms (M5): a disconnected or silent player's car becomes a ghost (others drive through it) instead of being handed to the host's AI, until the player resumes within 60 s or the car retires.
- Online rooms: a player who leaves before lights out is replaced by an AI car so the grid stays full; after the start their car retires.
- Online rooms: the lights-out time, including the random hold, is sent to every client before the first light, as the brief asks; a modified client could know the hold, and jump starts are still caught from snapshots.
- Online rooms: the host role passes to the longest-connected human as soon as the host disconnects or goes silent for 6 s; a host who comes back is a guest.
- Online rooms: penalties are time penalties (jump start 5 s; track limits 5 s per report after three warnings), not drive-throughs.
- Online rooms: room creation is limited to 30 per 10 minutes per client address; codes are six characters with no vowels or look-alikes.
- The soak runs in real time (the Durable Object clock cannot be accelerated): 3 laps in the `rooms` CI job, 12 laps nightly.

## Optional, needs you

- A Cloudflare account to deploy the rooms Worker, and a static host for the client. Neither blocks a milestone; everything runs locally.
  Deploying the rooms service would take: a Cloudflare account on the Workers plan that includes Durable Objects with SQLite storage; `npx wrangler login`, then `npx wrangler deploy --config services/rooms/wrangler.jsonc` (the migrations `v1` and `v2` create the `Room` and `CreateLimiter` classes); optionally a route so the Worker answers `/rooms/*` on the game's own domain. If the client is served from a different origin, set the rooms URL setting (`settings.roomsUrl`, or `VITE_ROOMS_URL` at build time) to `https://<worker host>/rooms`. Nothing has been deployed.
