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
- Car geometry compressed with Draco, not meshopt (Blender writes Draco natively); car textures are WebP, not KTX2, until the client has a Basis transcoder path (ADR 0005).
- Livery by texture masks in a shared atlas (R secondary, G accent, B bare carbon), not vertex colours, so thin pin lines stay sharp (ADR 0005).
- Two livery patterns were reshaped after a lookalike check: the diagonal split now has the primary colour forward, and the sidepod block is a flank panel only.
- The far car LOD is 14.3k triangles against the 12k budget; it was kept rather than lose the wheel and wing silhouettes.

## Optional, needs you

- A Cloudflare account to deploy the rooms Worker, and a static host for the client. Neither blocks a milestone; everything runs locally.
