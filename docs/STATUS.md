# Status

## Start it

```sh
./start.sh
```

Open the `Wi-Fi:` address it prints on a phone on the same network. The HTTPS address shows a certificate warning once.

## What changed

- M3 race core: a pure `packages/race` runs the race rules for every session type (time trial, practice, qualifying, race, race weekend, championship): five-light start with a seeded hold and jump starts, timing from the circuit's control line with mini-sector gaps, track limits with strikes and penalties, yellow, blue, chequered and black-and-white flags, race DRS, ERS laps, pit stops with the limiter, boxes, service time and penalties served, results and points, JSON snapshots, and a stuck-car watchdog. AI cars launch, race (as ghosts to each other: no contact yet), make their pit stops and finish. Rules and values: `docs/race-rules.md`.
- Headless races: `npm run telemetry -- race --circuit monza --cars 20 --laps 5 --seed 1` (and `weekend`) prints the classification, the event log and the watchdog's findings and writes JSON to `artifacts/telemetry/`. Twenty cars run about 22× faster than real time.
- Time trial now runs on the race engine. Laps are timed from Monza's control line (320.5 m before the start line), so the rolling start sits 160 m before it. Records kept before this change were timed from the start line and are dropped once.
- M1 drive: Time Trial at Monza is playable. From the launch screen, Start puts the car on the back of the grid rolling at 150 km/h; the lap clock starts at the line. Keyboard, gamepad and touch all drive it, with assists from the device presets (changeable in the pause menu).
- Session rules: lap and three-sector timing to the millisecond (crossings interpolated inside the 4.2 ms tick), purple/green/yellow sector and lap colours, lap invalidated when all four wheels are past the white line, DRS only inside the two DRS zones, ERS lap counters and fuel reset at the line. The best lap (with its own splits and ghost) and the best time in each sector are saved per circuit (Web Storage; in memory when storage is blocked or full, and the HUD and pause menu say so) and the ghost drives the next laps as a translucent car with a live delta.
- Rendering (`packages/render`): sRGB output with ACES filmic tone mapping, a physically based sun with a fitted soft shadow map, a procedural sky with clouds that also lights the scene (prefiltered environment map), haze, MSAA, a pixel-ratio cap and High/Mobile presets. The circuit is built from the track package's meshes with procedural materials per surface (asphalt with a rubbered racing line, painted lines, kerb stripes, grass with mowing bands, gravel, run-off, Armco, concrete, tyre walls, fences).
- An interim car built in code from lofted sections (M2 replaces it): monocoque and nose, sidepods, floor and diffuser, four-element front wing, rear wing with a DRS flap that opens, halo, wheel covers and tyres that spin at road speed, steering front wheels, a turning steering wheel, suspension arms that follow the wheels, and body heave, pitch and roll from the sim. Kestrel Grand Prix colours.
- Cameras, switchable live with C or the camera button: near chase, far chase (both spring-damped with look-ahead into corners), T-cam, cockpit (head moves with g-load) and look-back (B). Field of view widens and a small shake grows with speed.
- HUD on the design tokens: speed, gear, rev lights, lap time with live delta, sector times, last and best, ERS store and lap allowance, DRS state, minimap with the car and ghost, lap-invalid flag and message slot; results strip at each lap; pause menu with resume, restart lap, reset to track, camera, assists and volume. The steering wheel's display shows gear, speed and rev lights in the cockpit view; on a phone the chase cameras frame the car above the driver cluster. Lays out at 1440×900 and 844×390 with safe-area insets.
- Engine and road sound from `packages/audio`: the engine is created on the first gesture (the Start click or a first key or touch), follows the car every frame and suspends on pause, tab hide and quit; master, engine and effects volume sliders in the pause menu are saved with the settings.
- `window.__undercut` debug API with `?debug=1` (see `apps/web/src/debug.ts`), a keyboard-only autopilot used to prove a full lap, and `npm run shots -- monza` (screenshot stations on the real GPU, `tools/screenshots/`).
- M0 foundation: npm workspaces, TypeScript strict, Vite client, rooms service on the local Workers runtime, CI with eight required checks, the one-command run.
- The launch screen shows the name, a Drive button (not live until M1) and the build hash over a placeholder 3D view.

## Try this

Keys: arrows or WASD drive, Q/E shift (gears are automatic by default), F asks for DRS, Space overtake, C camera, B look back, Esc pause, Backspace reset to track.

1. Trail-brake into the first chicane (Variante del Rettifilo): brake hard and straight from about the 150 m board, then ease off the brake as you turn in. With ABS on you can stand on it; switch ABS off in the pause menu and feel the fronts lock if you turn while braking hard.
2. Traction out of the second chicane (Variante della Roggia) with traction control off: set TC to Off in the pause menu, use manual gears, and feed the throttle in second gear. Too much too early and the rear steps out.
3. DRS on the main straight: after Parabolica press F once the DRS box on the HUD turns white (zone open), watch it go green and the rear flap open, and note the extra top speed; the first brake press closes it.
4. On a phone in landscape, open the `Wi-Fi:` HTTPS address: steer with the left pad, pedals on the right. Everything should fit around the controls.

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

- Time trial starts rolling (150 km/h) from the last grid slot, so lap 1 is a near-flying lap.
- Timing colours in time trial: purple beats the record kept on this device, green is this session's best, yellow is slower, red is an invalid lap.
- Monza runs the sim's low-drag aero trim and a 20 kg fuel load, topped up at every line crossing so laps compare fairly.
- A lap is invalid when all four tyres are wholly past the white line (half tread 0.18 m); reset to track also invalidates the lap. No penalties until M3.
- Track limits are read at the end of each tick and resolved before the timing lines. When the timing line falls in the same tick as a four-wheels-off reading, which came first is unknown, so the reading counts against both laps: the outgoing lap is invalid (and can never be a record) and so is the lap that starts at the line.
- Records keep the best lap with its own splits and ghost, and separately the best time in each sector from any valid lap; a slower lap that improves a sector updates only the sector minima.
- Race rules (M3) live in `packages/race`, a pure package between `ai` and `protocol` (ADR 0008). Every rule value and its source is in `docs/race-rules.md`; the ones without a published figure are marked as estimates.
- Time trial times laps from the circuit's control line, like every other session; records from before (timed from the start line) are dropped rather than mixed, because their sector times and ghost distances do not compare.
- DRS in a race is enabled from lap 3 as the brief says; the regulation as summarised in physics-validation 4.6 reads "one lap after the start". DRS closes on a lift (throttle under 0.3) as well as on the brake, in every session.
- Every car carries a constant light fuel load (10 kg; time trial 20 kg) topped up at each timing line until fuel arrives in M4, so the AI's plans (made at qualifying fuel) hold.
- Qualifying is one timed session with no knockout parts; practice and qualifying start every car from its pit box, one every 4 s, and two team-mates share a box.
- Penalties are time penalties only: jump start 5 s, track limits (4th strike) 5 s, keeping a place gained off track 5 s, ignoring blue flags for 15 s 5 s, pit-lane speeding 5 s in a race (a warning elsewhere). Served at the next stop or added at the finish.
- A finisher that runs one compound in a full-distance race is disqualified (two-compound rule).
- A car stuck for 60 s is retired; the stuck-car definition (5 s stationary, 10 s without 10 m of progress, 10 s off track, 3 s wrong way) is the watchdog's.
- The AI's pit-lane driving is a small path follower added to `packages/ai`; its pit loss at Monza is about 33.6 s against the published 24.3 s, mostly because the track file's speed-limit lines are 511 m apart. The limit lines should come from the circuit map (track pipeline).
- A ghost records at most ten minutes of lap time (12 000 samples); recording also stops when the lap is invalidated. Lap timing carries on either way.
- One WebGL renderer for the page's lifetime, reused by every session; each session releases all its own GPU resources when it ends.
- DRS in time trial opens on request anywhere inside a DRS zone (there is no car to be within a second of); a request made before the zone opens the flap on entry.
- The overtake button is passed to the sim as is; the ERS mode shown is the sim's.
- Steering help applies to gamepad and touch (speed-sensitive lock); the keyboard's own axis shaping already narrows lock with speed, so keyboard steering is not scaled twice.
- ACES filmic tone mapping rather than AgX: AgX washed the saturated livery blue toward white under the sun. Revisit with the real car and HDRIs in M2.
- One fitted sun shadow map (4096 on High, 1024 on Mobile) that follows the car, not cascades; distant barriers get no shadow in M1.
- Browser tests ask for the Mobile preset, because software WebGL is slow; logic is the same at every preset.
- Records and ghosts persist in Web Storage until IndexedDB lands in M6; when storage is blocked or full they last for the session and the HUD says so.
- Engine load sent to the audio engine is the throttle the car applies (after traction control), not a torque ratio; turbo demand is that load times an engine-speed ramp from 6000 to 10 500 rpm; kerb rumble assumes ridges 0.25 m apart; plank scrape starts below 2 mm of floor height. All estimates, to be tuned by ear.
- Default volumes: master 80 %, engine 100 %, effects 80 %.

## Optional, needs you

- A Cloudflare account to deploy the rooms Worker, and a static host for the client. Neither blocks a milestone; everything runs locally.
