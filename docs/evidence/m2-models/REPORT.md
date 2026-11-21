# Circuit kit delivery — Slice 1

31 original props, 93 Draco GLBs, 2,183,484 bytes (2.08 MiB) including all three levels. No third-party assets were added. Rebuild with `npm run props:build`.

## Measurements

| Prop | Triangles High / Mobile / Far | Bytes High / Mobile / Far |
| --- | --- | --- |
| armco-two | 280 / 72 / 72 | 9836 / 6024 / 6024 |
| armco-three | 332 / 84 / 84 | 11596 / 6540 / 6540 |
| concrete-wall | 96 / 40 / 40 | 6736 / 3864 / 3864 |
| tyre-wall | 7232 / 2928 / 60 | 72036 / 29492 / 4368 |
| absorber-block | 440 / 96 / 96 | 14400 / 6156 / 6156 |
| catch-fence | 1060 / 480 / 192 | 18456 / 9932 / 6144 |
| grandstand | 18720 / 4880 / 1080 | 302764 / 51660 / 18952 |
| grandstand-roof | 19152 / 5088 / 1288 | 313192 / 56468 / 23812 |
| pit-garage | 1240 / 584 / 380 | 34032 / 18160 / 15804 |
| pit-wall | 1556 / 720 / 404 | 34952 / 20440 / 13084 |
| start-gantry | 3904 / 2000 / 1500 | 52220 / 31996 / 27132 |
| crew-mechanic-standing | 1016 / 456 / 456 | 23676 / 13916 / 13908 |
| crew-mechanic-crouched | 1016 / 456 / 456 | 23832 / 13532 / 13512 |
| crew-engineer-standing | 896 / 468 / 468 | 23312 / 15392 / 15380 |
| crew-engineer-seated | 896 / 468 / 468 | 23392 / 15360 / 15368 |
| crowd-seated-0 | 732 / 368 / 368 | 19252 / 13016 / 13012 |
| crowd-seated-1 | 732 / 368 / 368 | 19180 / 13104 / 13104 |
| crowd-seated-2 | 732 / 368 / 368 | 19172 / 12800 / 12804 |
| crowd-standing-0 | 732 / 368 / 368 | 19172 / 13140 / 13116 |
| crowd-standing-1 | 732 / 368 / 368 | 19120 / 13068 / 13128 |
| crowd-standing-2 | 732 / 368 / 368 | 19108 / 13000 / 12992 |
| braking-board | 232 / 72 / 72 | 9588 / 5884 / 5884 |
| zone-board | 232 / 72 / 72 | 9132 / 5780 / 5780 |
| corner-board | 232 / 72 / 72 | 9188 / 5828 / 5828 |
| kilometre-board | 156 / 60 / 60 | 8108 / 5628 / 5628 |
| marshal-post | 620 / 300 / 300 | 17028 / 12356 / 12356 |
| hoarding | 288 / 128 / 128 | 10808 / 7480 / 7480 |
| bridge-banner | 2808 / 1528 / 1048 | 27924 / 19672 / 14260 |
| pedestrian-bridge | 2556 / 1324 / 924 | 36576 / 23584 / 18288 |
| screen-tower | 2364 / 924 / 604 | 39444 / 20268 / 15276 |
| camera-tower | 3024 / 1248 / 928 | 49496 / 24728 / 19504 |

## Evidence and scale

Every prop has `<id>-sheet.jpg` (High top, Far bottom, four rotations) and `<id>-scale.jpg` (unscaled car alongside) in this directory. Captured on the RTX 4050 with the game's Environment, High preset cascades, Monza sky and afternoon exposure under the shared GPU lock. `capture.json` records the renderer. The car is about 5.6 m long: the 4 m barriers are shorter than it, the 3.5 m upright fence is several car heights, the 18–20 m gantries clear the road, 10 m stand bays and 6 m garage bays have plausible human and car scale.

`corridor.jpg` assembles 200 m of roofed stands, 2,960 individually tinted spectators, continuous walls and fences, garage modules, pit crew, angled hoardings, gantries and towers. It is a geometry/tiling inspection assembly, not a measured game performance run or a surveyed circuit placement. `corridor.json` reports its draws including shadow passes; the clone-based structural assembly deliberately does not represent the production registry's instancing/culling. No frame-rate claim is made from this still.

Inspected all 62 individual images through contact sheets, with the pit garage also opened at full resolution. The assembled view confirms the fence corridor, overhead spans, tiered crowd rows and human scale. Remaining giveaways: blank atlas carriers awaiting the dressing art; plain garage end walls (normally internal when tiled); deliberately simplified faces/hands at crowd distance; fence wire still needs moving-camera shimmer review after integration. Far tyre walls use a belted silhouette and far stands use seating bands.

## Validation

- Catalogue: 33 checks passed; shipped file sizes and triangle counts, Draco, AO vertex attributes, ids, bounds, LOD budgets and five lamp node names.
- Full unit suite: 89 files, 1,230 tests passed, two workers.
- Asset licence and hash check passed.
- Production build passed: High first race 7.83 MiB. Complete-kit reserve plus first race 9.91 MiB against 25 MiB. The inventory excludes unloaded props so it remains equal to the browser's actual requests; the additional reserve check accounts conservatively for every prop LOD.
- Lint/typecheck and CI results are recorded in the PR once final.

## Contract and decisions

The inspected dressing branch remains at `08e87417758aa8e534985379874da996fad23ffa` and has no catalogue consumer. Version 1 uses the requested GLB and catalogue paths, metres, ground origin, +Y up, +X front and +Z tiling. Crowd rows match its 0.85 m depth, 0.42 m rise, 0.55 m seat spacing. Board UV carriers, individual lamp nodes and crew role anchors are explicit. Clothing tint belongs on the clothing material/instances while keeping vertex AO. No renderer placement files were changed. Trees stay with its impostor pipeline.

The next integration step is to load each material group into the prop registry, register lit materials with Environment, apply the dressing atlas, choose LODs/culling by projected size, then measure the full twenty-car race and moving-camera fence appearance. Slice 2 is the separate cockpit task.
