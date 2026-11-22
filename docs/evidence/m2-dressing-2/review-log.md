# M2 circuit dressing, slice 2: review log

Goal: room in the frame budget first, then the worst look giveaways from the #31 review. Frames are from the RTX 4050 under the GPU lock (`node tools/screenshots/shots.mjs monza`); `before-after/` pairs current master (left) against this branch (right) at 1440×900 High, `stations/` holds this branch at 1440×900 and 844×390. Performance reports: `perf-master.json`, `perf-step1.json` (Step 1 alone), `perf-look.json` (Step 1 plus the look changes), each `--perf` run in the same session as the one before it.

## Step 1: performance

Buildings, stands, the pit building, terrain, bridges, the old banking and decals were single merged meshes outside the prop registry: no chunk culling, no levels of detail, every shadow cascade. They are now chunked (per stand, per bridge, spatial cells for buildings and terrain) with frustum culling and shadow casting limited by distance; the prop kit's materials collapse into one shared material per prop (one draw call each); prop shadow casting is gated by distance in the registry; the world builds in slices between frames (`CircuitWorld.buildAsync`).

| 1080p High, vsync | master | Step 1 | Step 1 and look |
| --- | --- | --- | --- |
| Drive: avg / 1 % low | 58.8 / 34.6 fps | 60 / 48.8 fps | 60 / 47.5 fps |
| Drive: GPU, draw calls, triangles | 7.3 ms, 738, 3.12 M | 6.3 ms, 547, 2.48 M | 7.1 ms, 562, 2.65 M |
| Twenty-car grid: avg / 1 % low | 58.5 / 30.7 fps | 60 / 47.6 fps | 60 / 57.5 fps |
| Twenty-car grid: GPU, draw calls, triangles | 11.8 ms, 789, 4.46 M | 7.7 ms, 613, 3.93 M | 7.6 ms, 640, 4.74 M |
| Texture and target memory | 435 MiB | 429 MiB | 439 MiB |

Mobile 844×390 holds 60 fps in all three (1 % lows 41 to 58 fps; 251 to 277 draw calls, 0.72 to 1.33 M triangles). Machine load average 6 to 12 during the runs; other agents share the laptop.

Session start (`loadTimes`, one probe each): High 3.2 s on master, 3.7 s on this branch; Mobile 2.5 s and 2.1 s. The world no longer blocks the page for its whole build: the longest slice is 534 ms on High (one 1.14 s block on master), 231 ms on Mobile. The High total did not improve.

Found and fixed in review of Step 1: an upfront `renderer.compile` leaked 74 shaders per session (three.js deletes a program's shaders on its first use; programs compiled for objects never drawn kept them), so it is gone; a world whose async build failed or outlived its view is now released; the bridge test checks each bridge's structure and banner exactly instead of a lowered threshold.

## Step 2: look

- Trees, the worst giveaway (`before-after/tv-kerb.jpg`, `lesmo-trees.jpg`): within 95 m of the eye on High (110 m on Ultra) trees are real geometry: a tapered trunk and four limbs in bark and seventy leaf-cluster cards around the crown, normals bent out from the crown so the sun shades it as a volume, wind on High. They swap with the cards per tree, dithered over 20 m, by distance from the view camera (also in the shadow pass), on 120 m chunks so only the trees around the camera draw. The cluster and bark tiles are painted into a third row of the tree atlas at load.
- Haze: Monza's afternoon haze moves from a near-neutral grey to a warm tone (`#dad0bd`); a first, stronger try read sandy from the helicopter and was toned down.
- Absorber blocks at the chicane exits: blue shells with a band alternating red and white (`chicane-outside.jpg`).
- Mapped buildings: Lombardy plaster, ochre and brick below white, and distant facades keep an average window density instead of fading to blank walls (`sector1-heli.jpg`).
- Stand backs and sides: a painted band in the stand's colour and a pale stripe along the back wall, bands along the side walls, and brand boards on the backs of the bigger stands.
- SOVERA recoloured from black and gold (a well-known cigarette-era livery) to navy on ivory.
- The magenta band reported along the top of the pit building is not visible in this branch's frames (the garage boards now share one atlas).

## Remaining giveaways, ranked

1. The crowd is still the blocky stand-in. The kit's crowd figures (368 to 732 triangles each) need the same per-instance near swap as the trees, limited to the closest rows, to fit the triangle budget.
2. Mid-distance trees are still cards with the painterly speckled texture; a baked multi-view impostor would replace them.
3. Car parks are flat grey from above.
4. On Mobile and Medium the near trees are off (cards everywhere).
5. The High lifecycle check on the GPU (`--lifecycle`) fails on master (7 programs left after quitting) and on this branch (5), with no growth between sessions in either; programs held by page-level objects, to be traced.
