# Overcast forest and night circuit kits

Twelve original scripted props, each with High / Mobile / Far LODs. All sizes below count the shipped GLBs, including embedded textures. Ground-centre pivots, +Y up, +X front and metre units follow catalogue version 1. No changes to placement or world rendering.

| Prop | Triangles (High / Mobile / Far) | Bytes (High / Mobile / Far) |
| --- | --- | --- |
| street-block | 88 / 88 / 40 | 6112 / 6016 / 3592 |
| street-fence | 948 / 448 / 192 | 15828 / 9304 / 6332 |
| street-fence-end | 84 / 52 / 52 | 4872 / 4468 / 4468 |
| floodlight-mast | 568 / 172 / 172 | 15640 / 8696 / 8696 |
| lighting-truss | 884 / 412 / 412 | 16712 / 9496 / 9496 |
| temporary-grandstand | 2904 / 1912 / 1552 | 38840 / 28252 / 22116 |
| marina-office | 652 / 524 / 440 | 13852 / 10836 / 10276 |
| marina-hotel | 752 / 624 / 516 | 14524 / 11304 / 10636 |
| marina-pavilion | 336 / 208 / 208 | 12244 / 9364 / 9364 |
| hill-pit-garage | 1448 / 696 / 444 | 36680 / 18920 / 15916 |
| forest-spruce | 7062 / 3254 / 40 | 255372 / 117188 / 39028 |
| forest-fir | 5540 / 2564 / 40 | 206620 / 97684 / 37324 |

New kit: 1,146,068 bytes across all LODs. Complete catalogue: 3,568,588 bytes, below the existing 4,000,000 byte cap.

The production build reports 8.87 MiB for the existing High first race and 3.69 MiB on Mobile. `kit-budget.json` reserves every new LOD plus both circuits’ skies at both tiers on top of that baseline: High 10.08 MiB, Mobile 4.90 MiB. This is a conservative model-asset allowance, not measured integrated Spa/Singapore traffic. Terrain, placement, light layout and circuit request telemetry remain with dressing.

## Evidence and reproduction

- `docs/evidence/m2-models/<id>-sheet.jpg`: High above Far, four views spaced 90 degrees apart, overcast game Environment.
- `<id>-scale.jpg`: the unscaled 5.6 m car alongside every prop.
- `kit-forest.jpg`: overcast inspection assembly; `kit-marina.jpg`: night inspection assembly. These are preview placements, using the game Environment, rather than circuit dressing.
- `*-night.jpg`: floodlight/truss and marina sheets and car-scale frames under the night environment with a track-light preview key.
- `forest-luma.json`: isolated swap-on/off material response at three azimuths. Fog, background and shadows are disabled only for this diagnostic. The capture fails above a 15% High/Far mean luma delta (measured 4.5–13.4%); normal evidence retains shadows.
- `forest-transition.json` and `forest-<id>-transition.jpg`: High, Mobile and Far from the same camera at 0°, 30° and 60° (High | Mobile | Far | Mobile against Far: red Mobile only, blue Far only, white both), with mean luma, silhouette coverage and silhouette IoU. The capture fails if Mobile/Far coverage leaves 0.85–1.2 or either IoU drops below 0.6 (measured: coverage 1.04–1.12, IoU 0.62–0.77, lowest at 30° between card planes).
- `kit-budget.json`: per-LOD counts/sizes and conservative transfer reservation. Run `node tools/props/kit-budget.mjs` after `npm run build`.

Build with `npm run props:build -- --kits-only`. Capture under the shared GPU lock using the commands in `tools/props/README.md`. All captures are inspected before handoff. The preview closes its server and browser in `finally`.

## Integration notes

Street modules tile in 4 m lengths; place block and fence at the same ground pivot. The terminal post closes the end. Stands tile at 8 m, with eight crowd row attachments. Pit modules retain 6 m spacing and board/crew anchors. Trees are drooping branch tiers of separate needle sprays with gaps, and their Far cards are rasterised from those same triangles: colour with the near foliage's mean baked AO, and a half-resolution tangent-space normal atlas of the covering triangles, so cards shade like the near tree under any light. Keep the cards' own normals and normal map when instancing. The temporary stand's Far LOD keeps its population bounded at 1,552 triangles per 8 m module; crowd rows are attachments, not geometry. Both forest species are conifers, intended for varied forest-edge placements.

Window occupancy is a geometric emissive mask through the named `window-emissive-mask` material. Floodlight anchors expose emitter material and local aim. These emitters need actual local light slots in the night renderer to light the road. Facades are generic backdrops; no real landmarks or brands are reproduced.

Actual Spa/Singapore dressing and the existing Monza tree system are outside this change. Crossed cards and low-poly boughs still need a moving-camera review once integrated. No third-party assets or textures were used.
