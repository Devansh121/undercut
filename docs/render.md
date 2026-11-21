# Rendering

How a frame is made, what each quality preset does, where the assets come from, and the hooks the trackside dressing uses. Code: `packages/render/` (the only package besides `apps/web` that imports three.js). Visual targets: `docs/visual-direction.md`. Evidence and the review rounds: `docs/evidence/m2-render/`.

## A frame

1. **Scene** (`race-view.ts`): the circuit (`track-view.ts`), the player's car and ghost (`car/car-model.ts`), other cars instanced (`car/fleet.ts`), contact shadows, props, the sky dome and lights (`environment.ts`).
2. **Shadows**: three cascades of sun shadow (three.js CSM, texel-snapped so edges do not crawl as the car moves), out to 300 m on High. Every lit material is registered with the cascades (`Environment.register`); without it a material would be lit once per cascade.
3. **HDR pass** (`pipeline/post.ts`): the scene into a half-float target with 4× MSAA, linear light, no tone map.
4. **Ambient occlusion**: GTAO at half resolution from the resolved depth (normals reconstructed, so the scene is drawn once), Poisson-denoised. The car's own baked AO (vertex colours) applies everywhere and, through `car/car-shader.ts`, also occludes environment and clear-coat reflections.
5. **Bloom**: only above a threshold in scene-linear units (sun disc, hot brake discs, rain light), so exposure changes do not change what blooms.
6. **Final pass**: AO applied, exposure, the tone map, a radial blur at the frame edge that grows with speed, a mild vignette, film grain that doubles as dither, sRGB.
7. **SMAA** on the display-referred image, for specular and thin-edge crawl that MSAA on an HDR target misses.

Lite (software WebGL in CI) skips 2–7: the scene renders straight to the canvas through the renderer's own tone map, with a hemisphere light standing in for the environment and a blob contact shadow under the car. Every post effect has that as its fallback.

## Colour and tone map

Textures are authored in sRGB (colour maps tagged `SRGBColorSpace`; normal, ARM and masks `NoColorSpace`), lighting is linear, output is sRGB. **Tone map: Khronos PBR Neutral**, chosen by looking at the same grid frame through AgX, ACES and Neutral (`docs/evidence/m2-render/tone-map-agx-aces-neutral.jpg`): AgX desaturated the paint and greyed the grass, ACES shifted the blue livery toward purple, Neutral keeps base colours as authored (the point of a livery) and compresses only near white, so kerbs and clouds keep detail. `?tonemap=agx|aces|neutral` switches it for comparisons. This departs from the AgX line in the visual direction; the reason is recorded in `docs/STATUS.md`.

## Light

- **Sky and image-based light** (`environment.ts`, `lighting/time-of-day.ts`). Each time of day names a Poly Haven pure-sky HDRI. The asset build measures its sun (direction, irradiance, solid angle), paints the sun out, and stores the rest as sRGB WebP of radiance ÷ scale with a dither. At run time the dome is rotated so the photographed sun sits at the circuit's compass bearing (Monza: 235°, elevation 48° from the image), the sun is drawn back as an analytic disc and lit as a directional light with the measured irradiance, so sky and sun keep their photographed ratio. The same dome without the disc is prefiltered (PMREM) into the environment map: 256² on High, 64² on Mobile.
- **Haze**: the fog chunks are replaced once for the page with height fog (extinction decays with height above the camera, scale 60 m, integrated along the ray) in the sky's horizon colour; the dome melts into the same colour at the horizon.
- **Time of day** is data: `MONZA_AFTERNOON`, `OVERCAST_DAY` (no sun disc, a weak diffuse key with soft shadows) and `NIGHT_FLOODLIT` (dim sky, local lights). `?tod=overcast-day|night-floodlit` loads them at Monza for testing.
- **Many local lights at night** (`lighting/light-pool.ts`): a forward renderer pays per light per pixel, so the shaders have a fixed number of point-light slots (8 with post, 4 without) and each frame the slots take the lights nearest the camera, fading the last ones out before they lose their slot. The count in the shaders never changes, so there are no recompiles however many lamps a circuit places. Static surfaces far from the camera are expected to carry the rest as a baked track-lighting texture (a lookup in (s, d) like the racing-line texture); that is the next step for Singapore and does not need a different pipeline. `floodlightsAlong(track)` places a stand-in lighting plan.

## Quality presets

The numbers are in `packages/render/src/presets.json` (also read by the budget check).

| | Ultra | High | Medium | Mobile | Lite (tests) |
| --- | --- | --- | --- | --- | --- |
| Pixel ratio cap | 2 | 1.5 | 1.25 | 1.5 | 0.4 |
| MSAA / SMAA | 4× / yes | 4× / yes | 4× / no | 2× / no | none |
| Sun shadows | 3 × 4096, 320 m | 3 × 2048, 300 m | 2 × 2048, 160 m | 1 × 1024, 32 m, plus blob | blob only |
| GTAO | half res | half res | off | off | off |
| Bloom | yes | yes | yes | no | no |
| Environment map | 256 | 256 | 128 | 64 | none (hemisphere) |
| Sky / textures | 4k / hi | 4k / hi | 2k / hi | 2k / lo | 2k / lo |
| Car levels | high → mobile at 14 m → far at 60 m | high → mobile 10 m → far 45 m | mobile → far 35 m | mobile → far 25 m | mobile → far 25 m |
| Player's car | high | high | mobile | mobile | mobile |
| Grain, vignette, speed blur | yes | yes | yes | no | no |
| Dynamic resolution floor | 0.75 | 0.7 | 0.65 | 0.6 | off |

**Choosing.** A preset in the URL (`?quality=`) wins, then the player's saved choice (pause menu, Graphics), then a first-run benchmark: the first session starts on High (Mobile on touch or small screens), times five seconds of driving and settles on the best preset expected to fit 85 % of a 60 fps frame (`benchmarkPick`). With GPU timer queries it uses GPU time; with only the vsync-capped frame interval, a held 60 fps keeps the preset and anything slower steps down. Changing preset rebuilds the view behind a loading screen; the session waits, paused.

**Dynamic resolution** (`pipeline/dynamic-resolution.ts`) scales the canvas drawing buffer only, never the DOM HUD. It reacts to GPU time where `EXT_disjoint_timer_query_webgl2` exists, else to frame time: down fast (0.5 s over target, in proportion to the excess), up slowly (1.5 s under 75 % of target), in 1/40 steps, ignoring single stalls, so it does not hunt.

## Surfaces

Real PBR sets (`docs/asset-survey.md`, built by `npm run assets:build`, listed in `assets/MANIFEST.json`), each with colour, OpenGL normal and packed AO/roughness/metalness, UVs in metres from the track package so every set tiles at its real size:

| Surface | Set | Tile | hi / lo |
| --- | --- | --- | --- |
| Racing asphalt | Poly Haven `asphalt_track` | 2 m | 2048 / 1024 |
| Run-off asphalt, pit lane | Poly Haven `asphalt_pit_lane` | 2 m | 1024 / 512 |
| Kerbs, concrete walls | Poly Haven `concrete_floor_worn_001` | 3 m | 1024 / 512 |
| Grass, verges, terrain | ambientCG `Grass001` | 1.4 m | 1024 / 512 |
| Gravel | Poly Haven `gravel_stones` | 2 m | 1024 / 512 |
| Armco (galvanised colour over the plate) | Poly Haven `metal_plate` | 0.5 m | 512 / 256 |
| Tyre walls | ambientCG `Rubber004` | 1 m | 512 / 256 |

The shared surface shader (`materials/surface.ts`) adds: anti-tiling (a second, rotated and rescaled sample blended by low-frequency noise, for colour, normal and ARM), macro colour variation at two scales, and a wetness uniform (`uWet`, 0 today) that darkens albedo and lowers roughness, ready for wet weather. Per surface (`track-view.ts`):

- **Asphalt**: the scanned set is fresh black tarmac (albedo 0.015) and is lifted to a used circuit's grey (about 0.08). A rubbered line along the AI's racing line (`packages/ai/data/monza-low.line.json`, via an 8-bit lap lookup that filters on every GPU), wider where corners are tight; dust on the unused width; marbles off line through corners; oil under each grid slot and launch marks ahead of the rear wheels.
- **Kerbs**: painted concrete in red and white blocks along s, paint chipped through to the concrete, rubber streaks along the lap.
- **Paint lines**: over the asphalt's own grain, worn through where the grain is high.
- **Grass**: real lawn with lush-to-dry variation and a coarser sample of the same texture faded in with distance so the tile never repeats toward the horizon.

Sizes and compression: WebP (quality 76–86 for maps, 95 for the sky) with GPU mipmaps and anisotropy. KTX2/Basis was not adopted: the transcoder path could not be verified on a phone-class GPU here, and WebP keeps the first race at 7.4 MB on High.

## The car

Loaded per `docs/car-asset.md`: glTF with Draco (three.js's decoder, served from our origin at `assets/draco/` by a Vite plugin, never a CDN), WebP textures, three levels of detail.

- **Placement** (`car/car-model.ts`): the yaw frame at the sim's (x, z), the sprung body pitched and rolled about the CoG, the asset inside it shifted from its wheelbase-centre origin to the CoG and down by its 40 mm floor plane, so the floor sits at the sim's ride height. Wheel centres go exactly to the sim's wheel heights, with the suspension nodes counter-rotated so wheels stay upright; links follow their joints (`car/car-rig.ts`).
- **Animated from the sim**: wheel spin, steering (road wheels and steering wheel at 6:1), suspension travel, DRS flap, the driver's head turning into corners (steer and yaw rate), brake-disc glow from a braking-power heat model (heats with brake × speed, cools exponentially, fronts more), rain light (hooked up, off in the dry), steering-wheel display (gear, speed, rev lights) on the `display` material.
- **Liveries**: any of the ten teams from `design/teams.json` through the mask contract; race numbers and driver codes drawn into canvas textures in the UI number family.
- **Other cars** (`car/fleet.ts`): instanced. Each mesh of a level of detail is one draw for every car at that level, whatever the livery: colours are per-instance attributes over an array texture of the seven masks, numbers and codes come from one atlas, compounds are per material. Levels cross-fade over 4 m by complementary ordered dithering (`car/lod.ts`): during a switch each pixel is drawn by exactly one level, so there is no pop and no doubled frame. Frames where no car moved or changed level upload nothing.
- **Cameras**: cockpit eye at the visor with the halo and live steering-wheel display in view; T-cam on the airbox top; chase cameras pull back on phone-landscape aspects so the road ahead stays below the timing panel; a trackside TV camera with a long lens (`setTvCamera`) for stations and replays.

## Loading and budget

`RaceView.load` fetches the asset index, the sky, every texture set and the car files for the preset, with progress by bytes (sizes from the index and the responses) on the loading screen (`apps/web/src/ui/loading.ts`). A failed file shows "Could not download … Check the connection and try again." with Try again (fetches only what is missing; downloads and decoded images are cached for the page) and Back. GPU objects are per session and released when it ends (the lifecycle browser test counts every GL object).

`npm run build` runs `tools/budget/check.mjs`, which counts what each preset's first race actually fetches (code, styles, fonts, asset index, sky and texture tier, car levels, livery masks, Draco decoder) rather than the whole build:

| Preset | First race at Monza |
| --- | --- |
| Ultra, High | 7.4 MB |
| Medium | 6.4 MB |
| Mobile | 2.9 MB |

## Performance (RTX 4050 laptop, `npm run shots -- monza --no-shots --perf`)

Measured on the final build (`docs/evidence/m2-render/perf.json`); "drive" is the autopilot from Ascari to the line, "grid" is twenty cars on the grid in view.

| Run | vsync avg / 1 % low | Uncapped mean frame | Draw calls | Triangles | Texture and target memory |
| --- | --- | --- | --- | --- | --- |
| High 1920×1080, drive | 60 / 59.5 fps | 3.1 ms | 366 | 0.76 M | ~370 MiB |
| High 1920×1080, grid | 60 / 59.5 fps | 4.3 ms | 1016 | 3.8 M | ~370 MiB |
| Mobile 844×390, drive | 60 / 59.5 fps | 0.9 ms | 147 | 0.15 M | ~95 MiB |
| Mobile 844×390, grid | 60 / 59.5 fps | 1.9 ms | 318 | 0.98 M | ~95 MiB |

Draw calls and triangles include every pass of a frame (three shadow cascades on High). Uncapped 1 % lows are dominated by the browser's frame pacing without vsync and are not a target. Nothing was cut to reach 60 fps on High with the full grid. A mid-range phone was not available to measure; the Mobile numbers are the laptop at phone resolution.

## Hooks for the dressing slice

- **Props** (`props/registry.ts`): define a kind once with its levels of detail, place instances, build, and the view culls and switches them per chunk:

  ```ts
  const props = view.props; // a PropRegistry, chunked by 200 m of lap
  props.define({ id: 'tree-a', lods: [{ geometry: near, material: leaf, maxDistance: 120 }, { geometry: card, material: impostor, maxDistance: 900 }] });
  props.place('tree-a', { s: 1240, x, y, z, yaw: 0.4, scale: 1.1 });
  props.build();
  view.environment.register(props.group); // lit materials join the cascaded shadows
  ```

  Each kind × chunk × level is one `InstancedMesh` with chunk bounds for frustum culling; `update` picks the level per chunk from the camera distance. Kinds' geometries and materials belong to the caller.
- **Boards and decals**: `boardMaterial(canvasOrTexture, { emissive?, decal? })` for advertising boards, signage and light panels from generated art (sRGB, anisotropic, printed-vinyl roughness, optional emission for night, optional polygon offset for decals on walls).
- **Time of day and lights**: add a `TimeOfDay` per circuit, place floodlights with `RaceViewOptions.localLights`, and lay static lamps into a baked lighting texture.

## Screenshot stations

`npm run build && npm run shots -- monza` (GPU, under `flock ~/.cache/undercut/gpu.lock`): grid from the front with twenty cars, first chicane braking, fast corner mid-turn, cockpit, T-cam, near chase on the straight at speed, low trackside TV angle of the car on a kerb, pit-lane close-up, plus launch and pause; at 1440×900 and 844×390. `--moving` records ten seconds and cuts a one-per-second strip and eight consecutive frames for shimmer. `--perf` runs the table above. `tools/screenshots/probe.mjs` runs a snippet in the page and captures one frame, for investigations.
