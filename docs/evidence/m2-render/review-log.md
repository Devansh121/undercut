# M2 render review log

Each round: capture the stations on the RTX 4050 under the GPU lock (`npm run shots -- monza`, plus probes with `tools/screenshots/probe.mjs`), open the frames, answer two questions (would it pass for a current racing sim at thumbnail size; at full size, what gives it away), fix the biggest giveaway, repeat. Contact sheets of the rounds are in `rounds/`; the final stations in `stations/`, before and after pairs against `docs/evidence/m1-drive/` in `before-after/`.

## Round 0: first light (`rounds/r0-grid-1440x900.jpg`)

New pipeline, HDRI sky, CC0 surfaces and the real car in the game for the first time.

- Thumbnail: closer than M1. The sky is a photograph, the car is the real asset, the asphalt has grain at the right scale. But the car looks pasted on.
- Giveaways: (1) the car floats, no visible sun shadow; (2) the grass is brown and dry (the `sparse_grass` set is grass over dirt), nothing like Monza's parkland; (3) the "straight" station leaves the car on the grass (held throttle with no steering from s = 60 drifts off).
- Fixed next: the shadow. Pixel probes showed the sun dominates as intended (asphalt sRGB 52 lit, 20 with the sun off), so the shadow map was being washed out: in this three.js the PCF `radius` spreads very wide, and 2.4 blurred the car's shadow to nothing. Radius now 0.45 × softness: a crisp sun edge, soft at the far cascades. Grass swapped for ambientCG `Grass001` (mowed lawn, 1.4 m tile). The straight station now runs the autopilot from s = 5300.

## Round 1 (`rounds/r1-1440x900.jpg`)

- Thumbnail: yes for the pit-lane close-up; the chase views pass at a glance apart from the empty surroundings.
- Giveaways: (1) everything is low-contrast and grey: AgX flattens the image and washes the liveries; (2) carbon and black paint read like chrome; (3) the kerb TV station had its camera inside the barrier; the T-cam sat low behind the airbox.
- Fixed next: the tone map, by looking at the same grid frame through AgX, ACES and Khronos PBR Neutral (`tone-map-agx-aces-neutral.jpg`, top to bottom). AgX desaturates the paint and greys the grass; ACES shifts the blue livery toward purple; Neutral keeps the liveries' hues and gives the most photographic contrast. Neutral is the default now, exposure 0.74. The chrome: the asset bakes ambient occlusion into vertex colours, which three.js applies to diffuse light only, so the floor's underside, the sidepod inlets and every crevice reflected the full sky. The baked occlusion now also attenuates environment specular and clear-coat reflections (glass and screens excepted). Tyres on the other cars missed the compound shader; they get it now. TV-kerb camera moved out of the barrier; T-cam raised to the airbox top.

## Round 2 (`rounds/r2-1440x900.jpg`)

- Thumbnail: yes for grid, chicane, fast corner and pit lane; the sky, the light and the car hold up.
- Giveaways: (1) the asphalt is nearly black and uniform: the scanned set is fresh black tarmac (linear albedo 0.015), a used circuit surface is a light grey around 0.08; (2) block artefacts in the clouds (sky WebP at quality 88); (3) the cockpit interior is very dark.
- Fixed next: asphalt colour gain to an albedo of about 0.08, nudged from warm to neutral; worn asphalt for run-off and pit lane about 0.1; paint wear re-tuned to the brighter base. Sky WebP quality 95 (212 KB at 4k, from 104 KB).

## Round 3 (`moving-strip.jpg`, `moving-burst.jpg`)

- Thumbnail: yes. The grid launch marks, oil under the slots, the rubbered line and the dust off line now read; the kerbs are worn and rubbered.
- Moving capture: ten seconds of chase camera through the first chicane, cut into a one-per-second strip and eight consecutive frames of the lower half. No visible crawl on the white lines, kerb stripes or wing edges between consecutive frames (MSAA 4× on the HDR target plus SMAA after the tone map, texel-snapped cascades). Speed blur at the frame edge reads as speed without smearing the car.
- Giveaway found here: the full-grid performance run dipped below 60 fps (1 % low 47.8 fps with vsync) although the GPU had headroom (6.8 ms mean uncapped). The fleet rewrote and re-uploaded every instance every frame. It now skips frames where no car moved or changed level: 60 fps, 1 % low 59.5.

## Round 4 (`rounds/r4-1440x900.jpg`)

- Thumbnail: yes for every chase, TV and pit station.
- Giveaways: (1) mirrors black in the cockpit (the specular-occlusion fix above caught the mirror glass in its dark housing); (2) on the phone the image lift that keeps the car above the driver cluster pushed the vanishing point under the lap-timing panel, so the road ahead was hidden (the playtester's "phone chase composition").
- Fixed next: glass, visor, display and rain light are exempt from the baked specular occlusion. Chase cameras sit 22 % further back and a little higher on aspects above 1.9 (phone landscape), so the car needs less lift and the road ahead stays visible below the panel.

## Round 5: final (`rounds/r5-1440x900.jpg`, `stations/`)

- Thumbnail: yes. At thumbnail size the chase, T-cam, TV and pit-lane frames pass for a current racing sim; the cockpit nearly does.
- Time of day: the same pipeline renders an overcast day (soft key, faint shadows, `time-of-day-overcast.jpg`) and a night lit by floodlights through the light pool (`time-of-day-night.jpg`).

## Round 6: the merged car (`rounds/r6-1440x900.jpg`)

PR #11 landed with a second modelling pass and a revised contract: 36 / 23 / 11 draw calls per level, one mask per team (ten designed liveries), one decal mesh, links on morph targets, discs on the uprights, an invented compound tick scheme (`design/compounds.json`) and level switches by projected size. The loader, rig, liveries, markings, compounds and fleet now follow it.

- Thumbnail: yes, and the cockpit now passes too: the driver's gloves on the wheel and the painted halo give the view its foreground.
- Compound ticks read on the sidewalls at the pit-lane station (two orange per group, Medium); numbers and codes sit on the nose and flanks.
- The full grid's draw calls fell from 1016 to 468 per frame at 1080p High (shadow passes included); every vsync run still holds 60 fps.

## Round 7: independent review and playtest (`rounds/r7-1440x900.jpg`, `shadow-side-before-after.jpg`)

An independent review and playtest of the PR confirmed the frame rates and the asset pipeline, and found nine blocking problems. Each was fixed with a regression test where one is possible:

1. No renderable float targets gave a black race on High: `effectiveQuality` now drops to the direct path (unit test on every preset, browser test with the extensions hidden).
2. A restored WebGL context left lighting and timer queries broken: the session pauses, the view releases everything while the context is lost, and a fresh view is built on restore (browser test with `WEBGL_lose_context`, no warnings through quit).
3. A failed load could leave Draco workers running: loads settle before release and late files are not decoded (browser test counts workers).
4. Dynamic resolution ignored sustained overload: three slow frames in a row now count (unit test). Measuring afterwards showed the rule also reacted to the stalls right after a teleport, stepping the scale down and back with 50 ms reallocation hitches (1 % low 34 fps on High); a 60-sample warm-up after each start or snap and GPU-time-only sampling fixed it (unit test; High drive back to 59.5).
5. GTAO leaked two programs per High session (three.js's `GTAOPass.dispose()` skips them): disposed explicitly; the High lifecycle check runs on the GPU (`--lifecycle`), Mobile's in CI.
6. The budget counted gzip that the server never sent: the build precompresses, the server negotiates Brotli and gzip, and the check measures what the server sends; a browser test matches its inventory to a real first race byte for byte (Mobile, 47 requests).
7. The bloom threshold moved with exposure: now scene-linear (unit test).
8. Shadow-side detail went black. Measured: the HDRI's lower half was not black (a blue 0.15–0.26, above a matched ground bounce); the causes were compounded occlusion (baked AO in the albedo, again on reflections, squared on the clear coat, plus GTAO) and the asset's 0.3 % `dark` and `carbon_matte` materials. Occlusion is applied once per term, near-black materials get a 2.5 % albedo floor, the ground below the horizon is a matched bounce, GTAO is lighter, and the cockpit camera exposes +0.4 EV. In the cockpit the share of near-black pixels fell from 56 % to 32 %; before and after on the cockpit, chase and trackside stations in `shadow-side-before-after.jpg`.
9. Cars floated at night on High: contact shadows now go under every car whenever no key light casts shadows (`time-of-day-night.jpg`).

Also done: cascade registration is enforced (prop registry hook, a development-mode check), no per-frame allocations in the view, fleet and light pool, preset-tied grain (0.3–0.5 %, was 1.2 %), fabric gloves, a run-time sky dither against banding, and restrained roughness variation and rear road dirt on the paint.

- Thumbnail: yes for every station; the cockpit reads now.
- At full size: the surroundings first, then the items below.

## Remaining giveaways, ranked

1. **Undressed surroundings.** A flat green plane to the horizon, a dark band of barrier tops, no trees, stands, boards, fences, marshal posts or skyline. Expected: the dressing slice uses the prop registry, board material and time-of-day hooks in `docs/render.md`.
2. **Cockpit interior.** Readable now (round 7), but plain: no belts or fabric texture, and the wheel's grips are simple shapes. A modelling pass on the car.
3. **Paint is still clean for a race car.** Roughness variation and rear road dirt are in (round 7); rubber pick-up on the sidepods and brake dust on the wheels are not.
4. **Grass is uniform at mid distance.** Macro variation breaks tiling, but there are no mowing stripes, verge wear, tyre tracks or patches of dry grass where real circuits have them.
5. **Far-field haze meets a flat horizon.** The height fog is tinted by the sky and works, but with no terrain or tree line the horizon is a straight edge.
6. **Night is a proof, not a look.** Eight pooled point lights near the camera light the track; further out it is dark. A circuit at night needs the baked track-lighting texture described in `docs/render.md` and emissive fixtures.
7. **No per-object motion blur on wheels.** The car has wheel covers, so spokes do not strobe; the edge speed blur carries the speed instead.
