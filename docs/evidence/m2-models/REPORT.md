# Circuit kit delivery — Slice 1

31 original props, 93 Draco GLBs, 2,385,804 bytes (2.28 MiB) including all three levels. No third-party assets were added. Rebuild with `npm run props:build`.

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
| crew-mechanic-standing | 5882 / 456 / 456 | 71416 / 13904 / 13940 |
| crew-mechanic-crouched | 5882 / 456 / 456 | 74384 / 13500 / 13532 |
| crew-engineer-standing | 5634 / 468 / 468 | 74568 / 15336 / 15344 |
| crew-engineer-seated | 5634 / 468 / 468 | 76768 / 15340 / 15340 |
| crowd-seated-0 | 732 / 368 / 368 | 19204 / 12992 / 12992 |
| crowd-seated-1 | 732 / 368 / 368 | 19160 / 13080 / 13080 |
| crowd-seated-2 | 732 / 368 / 368 | 19160 / 12780 / 12780 |
| crowd-standing-0 | 732 / 368 / 368 | 19164 / 13084 / 13112 |
| crowd-standing-1 | 732 / 368 / 368 | 19096 / 13044 / 13036 |
| crowd-standing-2 | 732 / 368 / 368 | 19072 / 12972 / 13012 |
| braking-board | 232 / 72 / 72 | 9588 / 5884 / 5884 |
| zone-board | 232 / 72 / 72 | 9132 / 5780 / 5780 |
| corner-board | 232 / 72 / 72 | 9188 / 5828 / 5828 |
| kilometre-board | 156 / 60 / 60 | 8108 / 5628 / 5628 |
| marshal-post | 620 / 300 / 300 | 17028 / 12356 / 12356 |
| hoarding | 288 / 128 / 128 | 10808 / 7480 / 7480 |
| bridge-banner | 2808 / 1528 / 1048 | 27924 / 19668 / 14260 |
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
- Production build passed: High first race 7.83 MiB. Complete-kit reserve plus first race 10.10 MiB against 25 MiB. The inventory excludes unloaded props so it remains equal to the browser's actual requests; the additional reserve check accounts conservatively for every prop LOD.
- Lint and all workspace typechecks passed. Browser transfer inventory passed (one desktop test, one intentional phone skip), one worker.
- A clean scripted rebuild retained all geometry counts and bounds; some smooth figure primitives have a few bytes of Draco encoding variation between exports. The manifest records the final shipped bytes; byte-identical figure exports are a known tooling gap.
- CI results are recorded in the PR once final.

## Review fixes (PR #27, first review)

- Board artwork was mirrored: U ran right to left seen from +X. The shared board UV now runs left to right; `tools/props/boards.test.mjs` decodes the shipped Draco geometry of every LOD of all ten board-carrying props and checks asymmetric test art (red left, blue right) from the front. It fails on the previous GLBs and passes now. `<id>-artwork.jpg` shows each face carrying "LEFT > 27" test art from the front.
- Close crew (High LOD) are rebuilt in `tools/props/crew.py`: lofted overalls with collar, zip, chest pockets, belt and bunched folds at knees and elbows, rounded deltoids, cuffs, gloves with fingers and thumb, shaped boots with soles, a helmet shell with chin bar, nape, wrapped visor, seals and pivots (mechanics, over a balaclava), and a sculpted head with hair, ears and headset (engineers). Mobile and Far keep the simple figure for distance. `review-before/` holds the previous sheets; `crew-before-after.jpg` puts them side by side, and `<crew id>-close.jpg` shows High at eye height, front and back.
- Engineer and crowd trousers use `dark-fabric` (metalness 0, weave grain) instead of the brushed steel material; the catalogue test asserts it.
- Seated figures (`crew-engineer-seated`, `crowd-seated-*`) carry a `seat` attachment measured at build time from the geometry under the pelvis, against the 0.50 m hip joint. Put the attachment on the row's seat surface. The first version measured High only: 0.398 m for the close engineer against 0.424 m on its Mobile and Far levels, a 2.6 cm pop at the switch (and this report said 0.387 m, from an earlier build). The crew polish (branch `m2/cockpit-and-crew-polish`) levelled the close engineer to 0.425 m; the build now fails if any LOD's seat differs from High by more than 6 mm, and `tools/props/seat.test.mjs` checks every shipped LOD against the catalogue.

## Contract and decisions

The inspected dressing branch remains at `08e87417758aa8e534985379874da996fad23ffa` and has no catalogue consumer. Version 1 uses the requested GLB and catalogue paths, metres, ground origin, +Y up, +X front and +Z tiling. Crowd rows match its 0.85 m depth, 0.42 m rise, 0.55 m seat spacing. Board UV carriers, individual lamp nodes and crew role anchors are explicit. Clothing tint belongs on the clothing material/instances while keeping vertex AO. No renderer placement files were changed. Trees stay with its impostor pipeline.

The next integration step is to load each material group into the prop registry, register lit materials with Environment, apply the dressing atlas, choose LODs/culling by projected size, then measure the full twenty-car race and moving-camera fence appearance. Slice 2 is the separate cockpit task.
