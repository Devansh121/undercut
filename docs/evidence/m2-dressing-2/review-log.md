# M2 circuit dressing, slice 2: review log

Goal: room in the frame budget first, then the worst look giveaways from the #31 review. Frames are from the RTX 4050 under the GPU lock (`node tools/screenshots/shots.mjs monza`); `before-after/` pairs current master (left) against this branch (right) at 1440×900 High, `stations/` holds this branch at 1440×900 and 844×390. Performance reports: `perf-master.json`, `perf-step1.json` (Step 1 alone), `perf-look.json` (Step 1 plus the look changes), each `--perf` run in the same session as the one before it.

## Step 1: performance

Buildings, stands, the pit building, terrain, bridges, the old banking and decals were single merged meshes outside the prop registry: no chunk culling, no levels of detail, every shadow cascade. They are now chunked (per stand, per bridge, spatial cells for buildings and terrain) with frustum culling and shadow casting limited by distance; the prop kit's materials collapse into one shared material per prop; the world builds in slices between frames (`CircuitWorld.buildAsync`). Near-track terrain heights now blend from every 8th centreline sample instead of every 5th (the drivable-surface clamp still keeps the ground under the track).

Final numbers, master (2c1c13d) and this branch back to back (`perf-master.json`, `perf-branch.json`, load average about 3):

| 1080p High | master | branch |
| --- | --- | --- |
| Drive, vsync: avg / 1 % low, GPU | 60 / 56.7 fps, 6.4 ms | 60 / 56.0 fps, 6.9 ms |
| Grid, vsync: avg / 1 % low, GPU | 60 / 57.5 fps, 6.6 ms | 60 / 56.6 fps, 7.1 ms |
| Drive, uncapped: mean frame, GPU | 8.03 ms (125 fps), 6.6 ms | 8.66 ms (115 fps), 8.3 ms |
| Grid, uncapped: mean frame, GPU | 9.04 ms (111 fps), 7.8 ms | 9.01 ms (111 fps), 8.3 ms |
| Draw calls drive / grid | 741 / 789 | 731 / 820 |
| Triangles drive / grid | 3.13 M / 4.46 M | 3.13 M / 4.46 M |
| Texture and target memory | 430 to 435 MiB | 434 to 439 MiB |

| Mobile 844×390 | master | branch |
| --- | --- | --- |
| vsync avg / 1 % low | 60 / 56 fps | 60 / 56 fps |
| Uncapped mean frame drive / grid | 1.79 / 1.92 ms | 1.85 / 1.73 ms |
| Draw calls drive / grid | 265 / 277 | 300 / 329 |

So High is not faster than master: the structures' savings pay for the near trees, the back-wall boards and the props now drawn at their top level beside the car; uncapped, drive is 0.6 ms slower and the grid level. The first version of this PR claimed room on High; that did not hold. Where the GPU time goes at the grid pose (median GPU time with one kind hidden at a time, noise about ±0.5 ms): trees 2.1 ms on master and 2.1 ms here (cards 1.8, near trees 0.3), crowd 0.5 to 0.6 ms on both.

Session start (`loadTimes`): High 3.20 s on master, 3.28 s here; Mobile 2.07 s and 1.75 s. The longest single world slice is 583 ms on High (one 1.09 s block on master) and 273 ms on Mobile.

Level choice: by the chunk's near edge instead of its centre, with 50 m chunks for the props along the barriers on High, and no caps below the catalogue's distances. Share of fence, hoarding and absorber instances within 25 m of a cockpit eye not at their top level, every 20 m round the lap: master 15.6 %, 19.5 %, 0 %; this branch 0 %, 0 %, 0 %. Mobile's last level reaches 660 m again. Chunk culling spheres now hold every instance whole (towers, screens and boards reach above their origin).

Fixed in review of Step 1: an upfront `renderer.compile` leaked 74 shaders per session; a world whose async build failed or outlived its view is released, and the load fails (so the retry path runs) when the view is released mid-build; the bridge test checks each bridge part exactly.

## Step 2: look

- Trees, the worst giveaway (`before-after/tv-kerb.jpg`, `lesmo-trees.jpg`): within 95 m of the eye on High (110 m on Ultra) trees are real geometry: a tapered trunk and four limbs in bark and 48 leaf-cluster cards around the crown, normals bent out from the crown, a baked crown occlusion, wind on High. They swap with the cards per tree, dithered over 20 m, by distance from the view camera, on 120 m chunks so only the trees around the camera draw; the cards cast every tree's shadow. The cluster and bark tiles are painted into a third row of the tree atlas at load, and the clusters are calibrated to the mean colour of the species cards.
- Near trees against the cards (review blocker): the first version's near crowns were much lighter (Lesmo +37 % by day, ×1.6 at night), a pale band travelling with the camera. `npm run shots -- monza --tree-swap-check` now measures it: same frozen poses, near trees on and off, mean luma over the pixels that change, within 10 % by day and under floodlights. Before / after (`tree-swap-before.json`, `tree-swap-after.json`, `tree-swap-lesmo.jpg`: cards and near trees, before then after, day above night):

  | | before | after |
  | --- | --- | --- |
  | Lesmo, day | ×1.375 | ×0.92 |
  | Park, day | ×1.041 | ×0.953 |
  | Lesmo, night | ×1.615 | ×0.918 |
  | Park, night | ×1.618 | ×1.061 |
- Haze: Monza's afternoon haze moves from a near-neutral grey to a warm tone (`#dad0bd`); a first, stronger try read sandy from the helicopter and was toned down.
- Absorber blocks at the chicane exits: blue shells with a band alternating red and white (`chicane-outside.jpg`).
- Mapped buildings: Lombardy plaster, ochre and brick below white, and distant facades keep an average window density instead of fading to blank walls (`sector1-heli.jpg`).
- Stand backs and sides: a painted band in the stand's colour and a pale stripe along the back wall, bands along the side walls, and brand boards on the backs of the bigger stands.
- SOVERA recoloured from black and gold (a well-known cigarette-era livery) to navy on ivory.
- The magenta band reported along the top of the pit building is not visible in this branch's frames (the garage boards now share one atlas).

Distant world chunks now draw further (buildings 4 km, stands and pit 3.2 km, bridges 3 km, garage boards 1.2 km, decals 900 m); haze hides them first.

## Remaining giveaways, ranked

1. The crowd is still the blocky stand-in. The kit's crowd figures (368 to 732 triangles each) need the same per-instance near swap as the trees, limited to the closest rows, to fit the triangle budget.
2. Mid-distance trees are still cards with the painterly speckled texture; a baked multi-view impostor would replace them.
3. Car parks are flat grey from above.
4. On Mobile and Medium the near trees are off (cards everywhere).
5. The High lifecycle check on the GPU (`--lifecycle`) fails on master (7 programs left after quitting) and on this branch (5), with no growth between sessions in either; programs held by page-level objects, to be traced.
