# Status

## Start it

```sh
./start.sh
```

Open the `Wi-Fi:` address it prints on a phone on the same network. The HTTPS address shows a certificate warning once.

## What changed

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

## Known gaps

- Physics: the reference controller laps Monza in 1:24.969; the real pole lap is 1:18.8 and the M1 band is 1:14.9 to 1:22.7. The quasi-steady full-envelope profile on its line predicts 1:23.4, so the gap is mostly car, line and track model, not driving. It is recorded in `docs/physics-validation.md` section 7.6 and pinned by a test, not hidden.
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
- Reference lap (M1): 84.969 s at Monza (90.137 s before calibration, 85.539 s after it), still outside the M1 band (74.852–82.732 s), recorded as a gap and not forced. It is driven by an ideal, telemetry-driven reference controller: the car's built-in TC and ABS are off, but the controller reads exact slips, loads and sideslip every tick, regulates the pedals from slip and recovers from slides instantly. It is a measuring instrument, not a model of a human. On the footprint-checked legal corridor the quasi-steady full-envelope profile predicts 83.447 s, a prediction on one line and neither an optimum nor a bound; physics-validation 7.6 has the time budget (driving 0.83 s, planning margin 0.69 s, the rest 4.66 s, not attributed to one cause).
- Physics calibration: the tyre's longitudinal and lateral friction are set separately; both load slopes are −8.75e-5 per N from Perantoni and Limebeer's published single-seater tyre table, not fitted. The high-downforce braking peaks above the published ones are recorded as gaps with competing explanations, not absorbed by the tyre. Targets carry one of three roles (direct fit, selection check, withheld validation). Low-trim ClA stays at the table's 3.6 for want of evidence to raise it. Counting engine braking inside the brake-by-wire rear demand was tried and not adopted (it needs a brake-migration model with a source).
- Contact model: each tyre deflects against the ground averaged over its whole contact patch (a 5 × 2 grid over 0.32/0.40 m by 0.15 m), sampled once per 240 Hz step at the wheel's end-of-step position and interpolated over the substeps; its carcass damping grows in over the first 3 mm of deflection, so kerb strikes are about half as hard and an exit kerb no longer lifts a wheel. A three-probe shortcut was removed: it missed longitudinal and oblique steps. Cost on Monza: 0.38 ms per 20-car tick (0.17 ms with point contact, 0.75 ms sampling every substep), measured by `npm run telemetry -- bench`. The body damping (7 kN·s/m per wheel) is lumped, phenomenological damping at the tyre, not a physical tyre property; the open item is to revisit the wheel rates and add a heave element so it can move to the suspension (physics-validation 1.6).
- Track limits have one definition in `packages/ai/src/line/limits.ts`, the game's own rule (a wheel is off when its tyre is wholly past the white line; a lap is invalid when all four are). The reference line's corridor is built from the car's footprint: at every heading within ±10° and with 0.3 m of outward tracking error, one wheel must still touch the line and every corner of every tyre's patch must lie on track, a kerb inside its crest or asphalt run-off, 0.2 m clear of grass and gravel. The lap runner counts wheels off by the same rule and samples every tyre's centre and tread edges for grass and gravel; the reference lap and the soak assert none (the earlier centre-only corridor put tyres on grass on every lap).
- The reference driver countersteers and comes off the brake in a slide, shapes its lock threshold to each tyre's combined slip, and plans at 98 % of the lateral and traction limits and 95 % of braking (higher is slower). Brake bias stays fixed at 57 %: no source was found for how the real cars' brake migration is set.
- The timed lap follows one out-lap on which the MGU-K is saved (a full store at the line, as in qualifying). Shorter run-ups placed the car at full speed with a full store just before a braking zone, a state a flying lap never reaches, and it could spin there. Track limits are judged strictly: a wheel is off once its centre is past the white line.
- Monza laps and sectors are timed from the control line, measured on the FIA circuit map at s = 5472.5 m (320.5 m before the track file's s = 0, ±13 m). The track file is unchanged; the track pipeline should carry the control line as metadata, and its DRS zone 2 activation belongs at s = 5484.5 m (12 m after the control line on the map), not the stored 12 m, 320.5 m late. Measured with a labelled harness override (`npm run telemetry -- calibrate --drs2 5484.5`), it is worth 0.097 s; the committed lap and tests use the track file as it is.
- The nightly ten-lap soak starts with 34 kg of fuel (qualifying fuel cannot cover ten laps) and requires a lap-time spread of at most 0.5 s; measured 0.354 s with the lap-band controller (0.228 s on the first car).
- Low-trim ClA at the top of its range (4.2 m², drag and tyre refitted) was investigated and not adopted: it took the lap to 84.036 s and closed two targets but opened another, and at 300 km/h it puts the floor's leading edge at 19.3 mm, below the 20 mm stall height the aero map is built on. The table's 3.6 stays (physics-validation 7.3).
- Open item: re-measuring the ride heights the aero map is referenced to moves the Spa T5 2025 peak to 5.101 g, 0.001 g past its band; left as they are (physics-validation 7.3).
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
- One fitted sun shadow map (4096 on High, 1024 on Mobile) that follows the car, not cascades; distant barriers get no shadow in M1.
- Browser tests ask for the Mobile preset, because software WebGL is slow; logic is the same at every preset.
- Records and ghosts persist in Web Storage until IndexedDB lands in M6; when storage is blocked or full they last for the session and the HUD says so.
- Engine load sent to the audio engine is the throttle the car applies (after traction control), not a torque ratio; turbo demand is that load times an engine-speed ramp from 6000 to 10 500 rpm; kerb rumble assumes ridges 0.25 m apart; plank scrape starts below 2 mm of floor height. All estimates, to be tuned by ear.
- Default volumes: master 80 %, engine 100 %, effects 80 %.
- Car geometry compressed with Draco, not meshopt (Blender writes Draco natively); car textures are WebP, not KTX2, until the client has a Basis transcoder path (ADR 0005).
- Livery by texture masks in a shared atlas (R secondary, G accent, B bare carbon), not vertex colours, so thin pin lines stay sharp; one designed mask per team (ADR 0005).
- Two livery patterns were reshaped after a lookalike check: the diagonal split now has the primary colour forward, and the sidepod block is a flank panel only.
- Tyre compounds use an invented scheme (`design/compounds.json`): soft magenta with three ticks, medium orange with two, hard steel blue with one; the maker's mark appears once per sidewall. The HUD mock tokens follow it.
- Car suspension links are one mesh with morph targets (bump per corner, steer per front corner) rather than one rotating node per link, to keep draw calls near 40 on High.
- The far car LOD has no suspension links, uprights or decals; it is 10.6k triangles against the 12k budget.

## Optional, needs you

- A Cloudflare account to deploy the rooms Worker, and a static host for the client. Neither blocks a milestone; everything runs locally.
