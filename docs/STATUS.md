# Status

## Start it

```sh
./start.sh
```

Open the `Wi-Fi:` address it prints on a phone on the same network. The HTTPS address shows a certificate warning once.

## What changed

- M2 rendering: the game now draws with the real car and real surfaces under a photographed sky. HDR pipeline (MSAA, half-resolution ground-truth AO, bloom on what is actually bright, Khronos PBR Neutral tone map, SMAA, edge speed blur), a CC0 HDRI that lights the scene with its measured sun at Monza's bearing, three cascades of sun shadow to 300 m, height haze. Track surfaces from CC0 texture sets with a rubbered racing line, marbles, worn kerbs and paint, oil and launch marks on the grid. The car asset with liveries, numbers, every moving part driven by the sim and glowing brake discs; other cars instanced (a full grid of twenty holds 60 fps at 1080p High). Ultra, High, Medium and Mobile presets with a first-run benchmark, dynamic resolution and a Graphics setting in the pause menu; a loading screen with progress and Try again. Hooks for the trackside dressing (prop registry, board material, time of day, floodlights). Details in `docs/render.md`, evidence in `docs/evidence/m2-render/`.
- M1 drive: Time Trial at Monza is playable. From the launch screen, Start puts the car on the back of the grid rolling at 150 km/h; the lap clock starts at the line. Keyboard, gamepad and touch all drive it, with assists from the device presets (changeable in the pause menu).
- Session rules: lap and three-sector timing to the millisecond (crossings interpolated inside the 4.2 ms tick), purple/green/yellow sector and lap colours, lap invalidated when all four wheels are past the white line, DRS only inside the two DRS zones, ERS lap counters and fuel reset at the line. The best lap (with its own splits and ghost) and the best time in each sector are saved per circuit (Web Storage; in memory when storage is blocked or full, and the HUD and pause menu say so) and the ghost drives the next laps as a translucent car with a live delta.
- Rendering (`packages/render`): sRGB output with ACES filmic tone mapping, a physically based sun with a fitted soft shadow map, a procedural sky with clouds that also lights the scene (prefiltered environment map), haze, MSAA, a pixel-ratio cap and High/Mobile presets. The circuit is built from the track package's meshes with procedural materials per surface (asphalt with a rubbered racing line, painted lines, kerb stripes, grass with mowing bands, gravel, run-off, Armco, concrete, tyre walls, fences).
- M1: an interim car built in code from lofted sections (replaced in M2 by the car asset): monocoque and nose, sidepods, floor and diffuser, four-element front wing, rear wing with a DRS flap that opens, halo, wheel covers and tyres that spin at road speed, steering front wheels, a turning steering wheel, suspension arms that follow the wheels, and body heave, pitch and roll from the sim. Kestrel Grand Prix colours.
- Cameras, switchable live with C or the camera button: near chase, far chase (both spring-damped with look-ahead into corners), T-cam, cockpit (head moves with g-load) and look-back (B). Field of view widens and a small shake grows with speed.
- HUD on the design tokens: speed, gear, rev lights, lap time with live delta, sector times, last and best, ERS store and lap allowance, DRS state, minimap with the car and ghost, lap-invalid flag and message slot; results strip at each lap; pause menu with resume, restart lap, reset to track, camera, assists and volume. The steering wheel's display shows gear, speed and rev lights in the cockpit view; on a phone the chase cameras frame the car above the driver cluster. Lays out at 1440×900 and 844×390 with safe-area insets.
- Engine and road sound from `packages/audio`: the engine is created on the first gesture (the Start click or a first key or touch), follows the car every frame and suspends on pause, tab hide and quit; master, engine and effects volume sliders in the pause menu are saved with the settings.
- `window.__undercut` debug API with `?debug=1` (see `apps/web/src/debug.ts`), a keyboard-only autopilot used to prove a full lap, and `npm run shots -- monza` (screenshot stations on the real GPU, `tools/screenshots/`).
- M0 foundation: npm workspaces, TypeScript strict, Vite client, rooms service on the local Workers runtime, CI with eight required checks, the one-command run.
- The launch screen shows the name, a Drive button (not live until M1) and the build hash over a placeholder 3D view.

## Try this

M2 rendering, three things to look at:

1. Graphics in the pause menu: switch between Ultra, High, Medium and Mobile and watch the loading screen, then the shadows' reach and the ambient occlusion under the car change. A first run on a new browser picks a preset by itself after five seconds of driving.
2. Brake hard into the first chicane from 300 km/h in the near chase camera and look at the front brake discs (they glow), the rubbered line and marbles off line, and the kerbs as you clip them.
3. Add `?tod=night-floodlit` or `?tod=overcast-day` to the address: the same circuit at night under floodlights and on an overcast day.

Keys: arrows or WASD drive, Q/E shift (gears are automatic by default), F asks for DRS, Space overtake, C camera, B look back, Esc pause, Backspace reset to track.

1. Trail-brake into the first chicane (Variante del Rettifilo): brake hard and straight from about the 150 m board, then ease off the brake as you turn in. With ABS on you can stand on it; switch ABS off in the pause menu and feel the fronts lock if you turn while braking hard.
2. Traction out of the second chicane (Variante della Roggia) with traction control off: set TC to Off in the pause menu, use manual gears, and feed the throttle in second gear. Too much too early and the rear steps out.
3. DRS on the main straight: after Parabolica press F once the DRS box on the HUD turns white (zone open), watch it go green and the rear flap open, and note the extra top speed; the first brake press closes it.
4. On a phone in landscape, open the `Wi-Fi:` HTTPS address: steer with the left pad, pedals on the right. Everything should fit around the controls.

## Known gaps

- Physics: the reference driver laps Monza in 1:29.9; the real pole lap is 1:18.8 and the M1 band is 1:14.9 to 1:22.7. The car is short of cornering grip. Calibration is in progress; the gap is recorded in `docs/physics-validation.md` section 7 and pinned by a test, not hidden.
- Look: the car, the bare circuit and the procedural textures are interim. The real car model and the dressed circuit are M2.
- Sound: measured, never heard. The listening queue is in `docs/audio.md`.

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
- Reference driver (M1): after the physics calibration the reference lap at Monza is 85.539 s (from 90.137 s), still outside the M1 band (74.852–82.732 s). It is recorded as a known gap, not forced: with the tyre's lateral friction and the low-trim downforce both at the tops of their documented ranges and the line rebuilt it is 83.847 s. Physics-validation section 7.6 measures what is left: the driver's margin and driving (1.76 s), and a racing line that keeps the whole car 0.3 m inside the white lines and off the kerbs although the rule only needs one wheel inside (the legal corridor is worth 0.95 s in the plan; the driven lap spins on it, which is the next task).
- Physics calibration: the tyre's longitudinal and lateral friction are set separately; both load slopes are −8.75e-5 per N from Perantoni and Limebeer's published single-seater tyre table, not fitted. The high-downforce braking peaks above the published ones are recorded as gaps with competing explanations, not absorbed by the tyre. Targets carry one of three roles (direct fit, selection check, withheld validation); the Monza lap and the cross-trim braking peaks are selection checks. The floor stall acts on the floor's share of the downforce only and changes neither drag nor balance. Low-trim ClA stays at the table's 3.6 for want of evidence to raise it. Counting engine braking inside the brake-by-wire rear demand was tried and not adopted (it needs a brake-migration model with a source). The artefact build now plans on the racing-line offsets as stored, so the shipped speeds are what a driver re-plans from the file (the AI file was outside the calibration's scope; the alternative was loosening a test). The kerb disturbance (point-sampled ground rate into the tyre damping, no envelopment) is an open question.
- The reference driver keeps off the kerbs and 0.3 m inside the white lines: the kerb edges in the track model unsettle the car at the limit. Kerb use is a per-profile setting in the line configuration for when kerbs are smoother.
- The reference driver plans with 97 % of the lateral and traction limits and 95 % of braking: the fastest setting that stays clean (98–99 % is slower, 100 % leaves the track).
- The timed lap follows one out-lap on which the MGU-K is saved (a full store at the line, as in qualifying). Shorter run-ups placed the car at full speed with a full store just before a braking zone, a state a flying lap never reaches, and it could spin there. Track limits are judged strictly: a wheel is off once its centre is past the white line.
- Monza laps and sectors are timed from the control line, measured on the FIA circuit map at s = 5472.5 m (320.5 m before the track file's s = 0, ±13 m). The track file is unchanged; the track pipeline should carry the control line as metadata, and its DRS zone 2 activation (anchored on the map at the finish line) is about 320 m late.
- The nightly ten-lap soak starts with 34 kg of fuel (qualifying fuel cannot cover ten laps) and requires a lap-time spread of at most 0.5 s; measured 0.393 s with the calibrated car (0.228 s before).
- The racing-line and envelope artefacts are checked for staleness by behavioural fingerprints (what the sim, track and line code compute), not by hashing source text, so unrelated edits do not block other work. The check takes about 5 s in the physics job.

- Time trial starts rolling (150 km/h) from the last grid slot, so lap 1 is a near-flying lap.
- Timing colours in time trial: purple beats the record kept on this device, green is this session's best, yellow is slower, red is an invalid lap.
- Monza runs the sim's low-drag aero trim and a 20 kg fuel load, topped up at every line crossing so laps compare fairly.
- A lap is invalid when all four tyres are wholly past the white line (half tread 0.18 m); reset to track also invalidates the lap. No penalties until M3.
- Track limits are read at the end of each tick and resolved before the timing lines. When the timing line falls in the same tick as a four-wheels-off reading, which came first is unknown, so the reading counts against both laps: the outgoing lap is invalid (and can never be a record) and so is the lap that starts at the line.
- Records keep the best lap with its own splits and ghost, and separately the best time in each sector from any valid lap; a slower lap that improves a sector updates only the sector minima.
- A ghost records at most ten minutes of lap time (12 000 samples); recording also stops when the lap is invalidated. Lap timing carries on either way.
- One WebGL renderer for the page's lifetime, reused by every session; each session releases all its own GPU resources when it ends.
- DRS in time trial opens on request anywhere inside a DRS zone (there is no car to be within a second of); a request made before the zone opens the flap on entry.
- The overtake button is passed to the sim as is; the ERS mode shown is the sim's.
- Steering help applies to gamepad and touch (speed-sensitive lock); the keyboard's own axis shaping already narrows lock with speed, so keyboard steering is not scaled twice.
- ACES filmic tone mapping rather than AgX: AgX washed the saturated livery blue toward white under the sun. Revisit with the real car and HDRIs in M2.
- M2: Khronos PBR Neutral tone map rather than AgX (the visual direction's choice) or ACES. Compared on the same frames with the real car and HDRI: AgX desaturated liveries and grass, ACES shifted blue toward purple; Neutral keeps authored colours (`docs/render.md`).
- M2: WebP textures with GPU mipmaps, not KTX2/Basis: the transcoder could not be verified on a phone-class GPU here. The first race is 7.4 MB on High, 2.9 MB on Mobile, well inside 25 MB.
- M2: Monza's sun elevation is the HDRI's own (48°), not the 35° in the visual direction, so shadows match the sky; the bearing (235°, south-west) is the visual direction's.
- M2: the Poly Haven asphalt scan (fresh black tarmac, albedo 0.015) is lifted to about 0.08, the grey of a used circuit surface.
- M2: grass is ambientCG Grass001 (a mowed lawn) instead of the survey's Poly Haven sparse_grass, which is dry grass over dirt.
- M2: three cascades of shadow from three.js CSM with the cascade-blend fade, PCF; a blob contact shadow under the car on Mobile and Lite.
- M2: other cars are drawn instanced; they share one level-of-detail cross-fade (4 m, dithered) and are static in this milestone (AI cars driving come later).
- M2: the first-run benchmark keeps the starting preset when only a vsync-capped frame time is available and it holds 60 fps; it steps up only on measured GPU time.
- M2: a night circuit lights the track near the camera through eight pooled point lights; further lamps need a baked lighting texture (next for Singapore).
- One fitted sun shadow map (4096 on High, 1024 on Mobile) that follows the car, not cascades; distant barriers get no shadow in M1.
- Browser tests ask for the Mobile preset, because software WebGL is slow; logic is the same at every preset.
- Records and ghosts persist in Web Storage until IndexedDB lands in M6; when storage is blocked or full they last for the session and the HUD says so.
- Engine load sent to the audio engine is the throttle the car applies (after traction control), not a torque ratio; turbo demand is that load times an engine-speed ramp from 6000 to 10 500 rpm; kerb rumble assumes ridges 0.25 m apart; plank scrape starts below 2 mm of floor height. All estimates, to be tuned by ear.
- Default volumes: master 80 %, engine 100 %, effects 80 %.

## Optional, needs you

- A Cloudflare account to deploy the rooms Worker, and a static host for the client. Neither blocks a milestone; everything runs locally.
