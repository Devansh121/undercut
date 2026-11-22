# Rendering

How a frame is made, what each quality preset does, where the assets come from, and the hooks the trackside dressing uses. Code: `packages/render/` (the only package besides `apps/web` that imports three.js). Visual targets: `docs/visual-direction.md`. Evidence and the review rounds: `docs/evidence/m2-render/`.

## A frame

1. **Scene** (`race-view.ts`): the circuit (`track-view.ts`), the player's car and ghost (`car/car-model.ts`), other cars instanced (`car/fleet.ts`), contact shadows, props, the sky dome and lights (`environment.ts`).
2. **Shadows**: three cascades of sun shadow (three.js CSM, texel-snapped so edges do not crawl as the car moves), out to 300 m on High. Every lit material is registered with the cascades (`Environment.register`); without it a material would be lit once per cascade.
3. **HDR pass** (`pipeline/post.ts`): the scene into a half-float target with 4× MSAA, linear light, no tone map.
4. **Ambient occlusion**: GTAO at half resolution from the resolved depth (normals reconstructed, so the scene is drawn once), Poisson-denoised, at 65 % strength on High. The car's own baked AO (vertex colours) is applied once per term (`car/car-shader.ts`): it darkens the albedo by three quarters of its depth, environment reflections take only the roughness-aware specular-occlusion curve, the clear coat the baked AO once. The asset's near-black materials are lifted on load to a 2.5 % albedo floor (its `dark` and `carbon_matte` were 0.3 %, darker than any real surface), bare carbon and rubber to realistic albedos, so shadow-side detail reads.
5. **Bloom**: only above a scene-linear threshold (8, the sky's units; sun disc, hot brake discs, rain light). Bloom runs before exposure, so the threshold does not move with it (`pipeline/bloom.ts`, tested).
6. **Final pass**: AO applied, exposure (+0.4 EV for the cockpit camera, which exposes for its interior like an onboard camera), the tone map, a radial blur at the frame edge that grows with speed, a mild vignette, film grain (a per-preset 0.3–0.5 %) that doubles as dither, sRGB.
7. **SMAA** on the display-referred image, for specular and thin-edge crawl that MSAA on an HDR target misses.

Lite (software WebGL in CI) skips 2–7: the scene renders straight to the canvas through the renderer's own tone map, with a hemisphere light standing in for the environment and a blob contact shadow under the car. Every post effect has that as its fallback.

**What the GPU can do.** Without renderable half-float targets (neither `EXT_color_buffer_float` nor `EXT_color_buffer_half_float`), any preset takes that same direct path automatically (`effectiveQuality`): no HDR target, post passes or PMREM, shadows, textures and cars kept; `renderStats().renderPath` says `direct`. A browser test hides both extensions and checks the race is drawn.

**Losing the context.** When the WebGL context is lost the session pauses and the view releases everything at once (GL calls are silent no-ops then, so three.js's per-object hooks for the dead context detach without deleting stale handles later) and forgets its timer queries. When the context is restored the drive screen builds a fresh view from the page's cached downloads, which rebakes the environment; the player resumes from the pause menu. Tested with `WEBGL_lose_context`.

**Development check.** With `?debug=1` or in development, the view checks the scene every 120 frames for lit materials not registered with the cascaded shadows (they would be lit once per cascade) and reports each once.

## Colour and tone map

Textures are authored in sRGB (colour maps tagged `SRGBColorSpace`; normal, ARM and masks `NoColorSpace`), lighting is linear, output is sRGB. **Tone map: Khronos PBR Neutral**, chosen by looking at the same grid frame through AgX, ACES and Neutral (`docs/evidence/m2-render/tone-map-agx-aces-neutral.jpg`): AgX desaturated the paint and greyed the grass, ACES shifted the blue livery toward purple, Neutral keeps base colours as authored (the point of a livery) and compresses only near white, so kerbs and clouds keep detail. `?tonemap=agx|aces|neutral` switches it for comparisons. This departs from the AgX line in the visual direction; the reason is recorded in `docs/STATUS.md`.

## Light

- **Sky and image-based light** (`environment.ts`, `lighting/time-of-day.ts`). Each time of day names a Poly Haven pure-sky HDRI. The asset build measures its sun (direction, irradiance, solid angle), paints the sun out, and stores the rest as sRGB WebP of radiance ÷ scale with a dither; the dome dithers again by about one stored step at run time so cloud gradients do not band after exposure. At run time the dome is rotated so the photographed sun sits at the circuit's compass bearing (Monza: 235°, elevation 48° from the image), the sun is drawn back as an analytic disc and lit as a directional light with the measured irradiance, so sky and sun keep their photographed ratio. The same dome without the disc is prefiltered (PMREM) into the environment map: 256² on High, 64² on Mobile.
- **Ground bounce**: below the horizon the dome (and so the environment map) is the circuit's ground, the light falling on it times a ground albedo over pi (`groundBounce`), instead of the pure-sky image's blue lower half: undersides and shadow sides get a grey-green bounce of the right strength, and none at night beyond what the sky gives.
- **Haze**: the fog chunks are replaced once for the page with height fog (extinction decays with height above the camera, scale 60 m, integrated along the ray) in the sky's horizon colour; the dome melts into the same colour at the horizon.
- **Time of day** is data: `MONZA_AFTERNOON`, `OVERCAST_DAY` (no sun disc, a weak diffuse key with soft shadows) and `NIGHT_FLOODLIT` (dim sky, local lights). `?tod=overcast-day|night-floodlit` loads them at Monza for testing.
- **Many local lights at night** (`lighting/light-pool.ts`): a forward renderer pays per light per pixel, so the shaders have a fixed number of point-light slots (8 with post, 4 without) and each frame the slots take the lights nearest the camera (a partial selection into reused arrays, no sorting or garbage), fading the last ones out before they lose their slot. The count in the shaders never changes, so there are no recompiles however many lamps a circuit places. Beyond them a circuit's lamp banks are baked (`lighting/lamp-map.ts`): at load, every bank's light on level ground on a 2 m world grid (half-float, three.js's point-light falloff), added by every standard material of the static scenery (track, ground, buildings, trees, props) beyond the pool's current reach, so the road ahead stays lit and nothing is lit twice near the camera. A circuit whose world places its own banks (Singapore's masts and trusses, `world/street.ts`) lights the night from them; elsewhere `floodlightsAlong(track)` places a stand-in plan for the night test scene.

## Quality presets

The numbers are in `packages/render/src/presets.json` (also read by the budget check).

| | Ultra | High | Medium | Mobile | Lite (tests) |
| --- | --- | --- | --- | --- | --- |
| Pixel ratio cap | 2 | 1.5 | 1.25 | 1.25 | 0.4 |
| MSAA / SMAA | 4× / yes | 4× / yes | 4× / no | 2× / no | none |
| Sun shadows | 3 × 4096, 320 m | 3 × 2048, 300 m | 2 × 2048, 160 m | 1 × 1024, 32 m, plus blob | blob only |
| GTAO | half res | half res | off | off | off |
| Bloom | yes | yes | yes | no | no |
| Environment map | 256 | 256 | 128 | 64 | none (hemisphere) |
| Sky / textures | 4k / hi | 4k / hi | 2k / hi | 2k / lo | 2k / lo |
| Car levels (projected radius where the next takes over) | high → mobile 110 px → far 40 px | high → mobile 160 px → far 50 px | mobile → far 50 px | mobile → far 50 px | mobile → far 50 px |
| Player's car | high | high | mobile | mobile | mobile |
| Grain, vignette, speed blur | yes | yes | yes | no | no |
| Dynamic resolution floor | 0.75 | 0.7 | 0.65 | 0.6 | off |
| Dynamic resolution ceiling | 1 | 1 | 1 | 1.6 (up to 2.0x, never past the screen's ratio) | off |

**Choosing.** A preset in the URL (`?quality=`) wins, then the player's saved choice (pause menu, Graphics). Auto (the default, and the choice after Reset settings) benchmarks once: the first session starts on High (Mobile on touch or small screens), times five seconds of driving and settles on the best preset expected to fit 85 % of a 60 fps frame (`benchmarkPick`). The pick is saved (`settings.quality.auto`) and later sessions start on it without measuring again; choosing Auto in the pause menu measures again. With GPU timer queries it uses GPU time; with only the vsync-capped frame interval, a held 60 fps keeps the preset and anything slower steps down. Changing preset rebuilds the view behind a loading screen; the session waits, paused. Auto never fails a session over a preset change: offline it only moves to Mobile (the preset the offline cache holds), a pick that fails to load leaves the current preset in place and is not saved, and a saved pick that cannot load at launch falls back to Mobile.

**Dynamic resolution** (`pipeline/dynamic-resolution.ts`) scales the canvas drawing buffer only, never the DOM HUD. It reacts to GPU time where `EXT_disjoint_timer_query_webgl2` exists, else to frame time: down fast (0.5 s over target, in proportion to the excess), up slowly (1.5 s under 75 % of target), in 1/40 steps, so it does not hunt. An isolated frame over four targets is a stall and ignored; three in a row are overload and count (300 frames of 100 ms reach the floor). The first 60 samples after a start or a teleport are ignored, so loading stalls never step the resolution (each step reallocates the render targets). Mobile may go above its pixel-ratio cap on a sharper screen (ceiling 1.6, so 2.0x on a DPR 2 or 3 phone, never past the screen's own ratio): with GPU time it climbs on measured headroom and predicts the next size's cost, never probing one that would miss. With only a vsync-capped frame interval (no iOS browser has a GPU timer) headroom does not show, so after 3 s held at the target it probes 0.1 up, from any scale below the top: above the cap, and back up after a heavy moment dropped it below the cap. A missed probe steps straight back to the size that held, which stays the ceiling for 30 s, doubling after each miss. Decided: the target is 60 fps. A 120 Hz phone without a GPU timer (most Android Chrome) reads 8.3 ms frames as headroom and climbs until its frames reach 16.7 ms, so it settles at 60 fps at a higher scale (up to 2.0x) instead of 120 fps at the cap. On the emulated DPR 3 phone at 844x390 it reached 1.53x within 14 s with the frame median at 16.7 ms and p95 at 16.8 ms.

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

Sizes and compression: WebP (quality 76–86 for maps, 95 for the sky) with GPU mipmaps and anisotropy. KTX2/Basis was not adopted: the transcoder path could not be verified on a phone-class GPU here, and WebP keeps the first race at 8.0 MB on High.

## The car

Loaded per `docs/car-asset.md`: glTF with Draco (three.js's decoder, served from our origin at `assets/draco/` by a Vite plugin, never a CDN; one decoder per load, disposed when it finishes or fails), WebP textures, three levels of detail.

- **Placement** (`car/car-model.ts`): the yaw frame at the sim's (x, z), the sprung body pitched and rolled about the CoG, the asset inside it shifted from its wheelbase-centre origin to the CoG and down by its 40 mm floor plane, so the floor sits at the sim's ride height. Wheel centres go exactly to the sim's wheel heights, with the suspension nodes counter-rotated so wheels stay upright; the suspension links follow through their morph targets (bump per corner, steer on the fronts; `car/car-rig.ts`). The links do not cast shadows: thin and under the floor, their shadow does not read, and a morph-target caster needs its own shadow-depth shaders.
- **Animated from the sim**: wheel spin, steering (road wheels and steering wheel at 6:1), suspension travel, DRS flap, the driver's head turning into corners (steer and yaw rate), brake-disc glow on the uprights from a braking-power heat model (heats with brake × speed, cools exponentially, fronts more), rain light (hooked up, off in the dry), steering-wheel display (gear, speed, rev lights) on the `display` material.
- **Liveries**: each of the ten teams' own mask (`livery/<team>.png`) and colours; race number and driver code drawn into one canvas for the `decals` mesh (number left, code right) in the UI number family.
- **Tyre compounds** from `design/compounds.json` (invented scheme: hard one steel-blue tick per group, medium two orange, soft three magenta): the listed tick slots on the sidewall are lit in the compound's colour, the maker's mark stays grey. The HUD has no compound display yet; when it gets one it should read the same file.
- **Contact shadows**: a soft footprint under the player's car and every other car wherever the shadow map does not ground them: always on Mobile and Lite, and on any preset with no shadow-casting key light (night under floodlights).
- **Paint**: restrained roughness variation (±10 %) and road dirt low on the rear of the car; the driver's gloves are rough fabric, not clear-coated paint.
- **Other cars** (`car/fleet.ts`): instanced. Each mesh of a level of detail is one draw for every car at that level, whatever the livery: colours are per-instance attributes over an array texture of the ten team masks, numbers and codes come from one atlas laid out like the decal canvas, compounds are per material. Levels switch by the car's projected size as the contract defines it (radius 3 m, High at 160 px and Mobile at 50 px on the High preset, back up only at 1.15 × the threshold) and cross-fade over 0.3 s by complementary ordered dithering (`car/lod.ts`): during a switch each pixel is drawn by exactly one level, so there is no pop and no doubled frame. Frames where no car moved, switched or faded upload nothing. The links stay at rest on these static cars.
- **Cameras**: cockpit eye at the visor with the halo and live steering-wheel display in view; T-cam on the airbox top; chase cameras pull back on phone-landscape aspects so the road ahead stays below the timing panel; a trackside TV camera with a long lens (`setTvCamera`) for stations and replays.

## Loading and budget

`RaceView.load` fetches the asset index, the sky, every texture set and the car files for the preset, with progress by bytes (sizes from the index and the responses) on the loading screen (`apps/web/src/ui/loading.ts`). A failed file shows "Could not download … Check the connection and try again." with Try again (fetches only what is missing; downloads and decoded images are cached for the page) and Back. Sibling loads settle before anything is released, files arriving after a failure are not decoded, and the Draco decoder is disposed after each load, so a failed load leaves no workers running (browser-tested). GPU objects are per session and released when it ends (the lifecycle browser test counts every GL object on Mobile; `npm run shots -- monza --lifecycle` runs the same check on High on the GPU, where GTAO, bloom and SMAA are in play).

**Compression.** `npm run build` precompresses text, JSON and WASM (`tools/serve/precompress.mjs`: Brotli quality 11 and gzip beside each file), and the game's server (`tools/serve/static.mjs`, both the HTTP and HTTPS listeners) sends the best encoding a client accepts, with the original type, `Vary: Accept-Encoding` and the encoded length; it has no range support, so responses are always whole.

`npm run build` then runs `tools/budget/check.mjs`, which starts that server on a free port and requests every file a preset's first race fetches (page, code, styles, fonts, asset index, sky and texture tier, car levels, livery masks, Draco decoder) with a browser's `Accept-Encoding`, counting the body bytes it actually sends. The per-preset inventory goes to `apps/web/dist/first-race.json`; a browser test checks it against a real first race's request log byte for byte.

| Preset | First race at Monza |
| --- | --- |
| Ultra, High | 7.8 MiB |
| Medium | 6.4 MiB |
| Mobile | 2.9 MiB |

## Performance (RTX 4050 laptop, `npm run shots -- monza --no-shots --perf`)

Measured on the final build (`docs/evidence/m2-render/perf.json`); "drive" is the autopilot from Ascari to the line, "grid" is twenty cars on the grid in view.

| Run | vsync avg / 1 % low | Uncapped mean frame | Draw calls | Triangles | Texture and target memory |
| --- | --- | --- | --- | --- | --- |
| High 1920×1080, drive | 60 / 59.5 fps | 3.1 ms | 191 | 0.79 M | ~380 MiB |
| High 1920×1080, grid | 60 / 59.5 fps | 5.2 ms | 459 | 4.2 M | ~380 MiB |
| Mobile 844×390, drive | 60 / 59.5 fps | 3.0 ms | 62 | 0.16 M | ~97 MiB |
| Mobile 844×390, grid | 60 / 59.5 fps | 2.1 ms | 128 | 0.84 M | ~97 MiB |

Draw calls and triangles include every pass of a frame (three shadow cascades on High). Uncapped 1 % lows are dominated by the browser's frame pacing without vsync and are not a target. Nothing was cut to reach 60 fps on High with the full grid. A mid-range phone was not available to measure; the Mobile numbers are the laptop at phone resolution.

## Hooks for the dressing slice

- **Props** (`props/registry.ts`): define a kind once with its levels of detail, place instances, build, and the view culls and switches them per chunk:

  ```ts
  const props = view.props; // a PropRegistry, chunked by 200 m of lap
  props.define({ id: 'tree-a', lods: [{ geometry: near, material: leaf, maxDistance: 120 }, { geometry: card, material: impostor, maxDistance: 900 }] });
  props.place('tree-a', { s: 1240, x, y, z, yaw: 0.4, scale: 1.1 });
  props.build(); // the view's registry hooks every prop material into the cascaded shadows here
  ```

  Each kind × chunk × level is one `InstancedMesh` with chunk bounds for frustum culling; `update` picks the level per chunk from the camera distance. Kinds' geometries and materials belong to the caller.
- **Boards and decals**: `boardMaterial(canvasOrTexture, { emissive?, decal? })` for advertising boards, signage and light panels from generated art (sRGB, anisotropic, printed-vinyl roughness, optional emission for night, optional polygon offset for decals on walls).
- **Time of day and lights**: add a `TimeOfDay` per circuit and place floodlights in the world (`CircuitWorld.localLights`, from the theme's street kit) or with `RaceViewOptions.localLights`; the view bakes the world's banks into the lamp map.

## The world around the circuit

`packages/render/src/world/`, built at load from the circuit's dressing file and the track; nothing in it names a circuit except the theme table (`world/theme.ts`): per circuit id, the tree species mix and the region's form of a species, conifers by mapped leaf type with kit models up close, building colours and facades, which kit modules stand in for the pit building, a street circuit's kit (walls, debris fencing, floodlight masts, temporary stands, backdrops; `world/street.ts`) and whether mapped water is drawn. Kit ids a circuit loads beyond the common ones are in `data/world-props.json` (`circuits.<id>`).

- **Dressing file** (`packages/render/data/<id>.dressing.json`, ODbL, notices in `LICENSE-DATA.md`): `python3 tools/dressing/build.py <id> [--offline]` fetches one Overpass query for everything OpenStreetMap maps within the config's radius of the centreline (600 m at Monza; raw response cached in `~/.cache/undercut/osm/` with a provenance sidecar), projects it into the track frame and adds a bare-ground terrain grid from the cached Copernicus tile (2-D opening wider than any wood or roof, then an average; 50 m cells to 6 km). Authored placements live in `tools/dressing/circuits/<id>.json`. The web app passes the file's URL (`RaceViewOptions.dressingUrl`); without one the circuit keeps the track package's own ground.
- **Ground**: one tensor grid, 10 m cells near the circuit (24 m on Mobile) growing to the horizon, so no seams. Near the track it follows the track's own elevation, further out the filtered surface model, and every corner under a drivable triangle is lowered below it as the track package does. Ground cover is a raster of the map's classes (woodland floor, unpaved paths, roads and car parks) read by the grass shader.
- **Trees**: woods, scrub, tree rows and single trees from the map, as crossed impostor cards over an atlas painted at load from eight procedural species; per-instance species, tint and size; alpha-tested shadows; wind on High. Kept clear of the circuit (barrier plus 9 m), roads, buildings and water.
- **Buildings and stands**: mapped buildings extruded (height from tags or footprint size), the pit building built from the pit lane (garages, team boards from `design/teams.json`, glazed upper floor), grandstands fitted to their footprints with rows, roofs and an instanced crowd (fuller near the start line).
- **Furniture** (`world/furniture.ts`): hoardings and bridge banners with invented brands (`design/brands.json`, atlas painted at load), catch fencing in continuous runs of at least 24 m, verge boards, braking and DRS boards, marshal posts, Tecpro blocks, big screens, camera and truss towers, bridges, the start gantry with five addressable lights, the old oval's concrete away from the circuit, surface decals.
- **Prop kit**: when the build has `packages/render/data/props.catalog.json` (the modelled props, branch `m2/3d-models`), `apps/web` globs it in and the view loads its models (`props/catalog.ts`); each kind the kit has replaces its procedural stand-in at the same placements (ground-centre pivot, +Y up, +X front, modules along Z). No catalogue: stand-ins.
- **Presets** (`world` in `presets.json`): whether the dressing loads at all, whether its structures are built, tree density, atlas size, terrain detail, wind, crowd fill, cover resolution, tree card distances. Lite (CI) loads no dressing: the track package's own ground, as before the world. `?world=lite` gives any preset Lite's world (none); the software-WebGL tests use it, and the full Mobile world is tested once, in `tests/browser/world-dressing.spec.ts`.

## Screenshot stations

`npm run build && npm run shots -- monza` (GPU, under `flock ~/.cache/undercut/gpu.lock`): grid from the front with twenty cars, first chicane braking, fast corner mid-turn, cockpit, T-cam, near chase on the straight at speed, low trackside TV angle of the car on a kerb, pit-lane close-up, plus launch and pause; at 1440×900 and 844×390. `--moving` records ten seconds and cuts a one-per-second strip and eight consecutive frames for shimmer. `--perf` runs the table above. `--lifecycle` starts and quits five High sessions on one page and checks that no GL object or program leaks. `--sky-check` compares the full-frame High sky band between the HDR pipeline and the direct fallback (float targets hidden). `tools/screenshots/probe.mjs` runs a snippet in the page and captures one frame, for investigations.
