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

## Remaining giveaways, ranked

1. **Undressed surroundings.** A flat green plane to the horizon, a dark band of barrier tops, no trees, stands, boards, fences, marshal posts or skyline. Expected: the dressing slice uses the prop registry, board material and time-of-day hooks in `docs/render.md`.
2. **Cockpit interior.** Better with the gloves and wheel of the merged car, but still dark below the wheel; a small fill for the cockpit camera would lift it.
3. **Paint reads slightly plastic at distance.** Clear coat and base are right up close (pit-lane station), but from the chase camera large panels are uniform. A subtle flake or orange-peel normal and dirt build-up toward the rear would help.
4. **Grass is uniform at mid distance.** Macro variation breaks tiling, but there are no mowing stripes, verge wear, tyre tracks or patches of dry grass where real circuits have them.
5. **Far-field haze meets a flat horizon.** The height fog is tinted by the sky and works, but with no terrain or tree line the horizon is a straight edge.
6. **Night is a proof, not a look.** Eight pooled point lights near the camera light the track; further out it is dark. A circuit at night needs the baked track-lighting texture described in `docs/render.md` and emissive fixtures.
7. **No per-object motion blur on wheels.** The car has wheel covers, so spokes do not strobe; the edge speed blur carries the speed instead.
