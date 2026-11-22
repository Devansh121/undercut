# Overcast forest and night circuit kits

Twelve original scripted props, each with High / Mobile / Far LODs. All sizes below count the shipped GLBs, including embedded textures. Ground-centre pivots, +Y up, +X front and metre units follow catalogue version 1. No changes to placement or world rendering.

| Prop | Triangles (High / Mobile / Far) | Bytes (High / Mobile / Far) |
| --- | --- | --- |
| street-block | 88 / 88 / 40 | 6168 / 6076 / 3624 |
| street-fence | 948 / 448 / 192 | 15864 / 9344 / 6364 |
| street-fence-end | 84 / 52 / 52 | 4916 / 4516 / 4512 |
| floodlight-mast | 568 / 172 / 172 | 15740 / 8804 / 8792 |
| lighting-truss | 884 / 412 / 412 | 16780 / 9572 / 9564 |
| temporary-grandstand | 2904 / 1912 / 1552 | 38940 / 28360 / 22188 |
| marina-office | 652 / 524 / 440 | 13956 / 10948 / 10372 |
| marina-hotel | 752 / 624 / 516 | 14620 / 11412 / 10724 |
| marina-pavilion | 336 / 208 / 208 | 12352 / 9480 / 9464 |
| hill-pit-garage | 1448 / 696 / 444 | 36808 / 19064 / 16040 |
| forest-spruce | 7062 / 3254 / 40 | 255412 / 117228 / 181136 |
| forest-fir | 5540 / 2564 / 40 | 206648 / 97712 / 177272 |

New kit: 1,430,772 bytes across all LODs. Complete catalogue: 3,853,292 bytes, below the existing 4,000,000 byte cap. The Far trees carry two lossless 1152 × 384 atlases each (see Integration notes); that is where the extra 282 kB over the earlier lossy cards goes.

The production build reports 8.89 MiB for the existing High first race and 3.71 MiB on Mobile. `kit-budget.json` reserves every new LOD plus both circuits’ skies at both tiers on top of that baseline: High 10.37 MiB, Mobile 5.20 MiB, against 25 MB. This is a conservative model-asset allowance, not measured integrated Spa/Singapore traffic. Terrain, placement, light layout and circuit request telemetry remain with dressing.

Monza loads none of these props, but it does pay for their catalogue entries: `props.catalog.json` is bundled into the client, and the twelve new entries add metadata only. Paired builds that swap only the catalogue measured +1,201 bytes of first-race transfer on both High (9,296,406 → 9,297,607) and Mobile (3,871,600 → 3,872,801), with identical prop inventories and prop bytes. Gzipped, the minified catalogue grows from 3,583 to 4,899 bytes. If Monza ever has to add zero bytes, split the catalogue per circuit; at this size it is not worth a second fetch.

## Evidence and reproduction

- `docs/evidence/m2-models/<id>-sheet.jpg`: High above Far, four views spaced 90 degrees apart, overcast game Environment.
- `<id>-scale.jpg`: the unscaled 5.6 m car alongside every prop.
- `kit-forest.jpg`: overcast inspection assembly; `kit-marina.jpg`: night inspection assembly. These are preview placements, using the game Environment, rather than circuit dressing.
- `*-night.jpg`: floodlight/truss and marina sheets and car-scale frames under the night environment with a track-light preview key.
- `forest-sweep.json`, `forest-<id>-<light>-worst-tone.jpg`: the High/Far tone gate. Each tree is isolated against black (fog, ground and shadow maps off, so only the material and normal response is measured) and turned through a full revolution in 30° steps under overcast, afternoon sun and the night preview key; mean silhouette luma of High and Far from the same camera must stay within 15% at every one of the 72 samples. Measured worst cases: spruce 5.8% / 8.9% / 10.2%, fir 10.8% / 10.4% / 11.2% (overcast / afternoon / night). The record hashes the shipped Far GLBs, and `forest-lighting.test.mjs` rejects it if they change. `forest-luma.json` repeats the overcast revolution from the preview capture.
- `forest-<id>-<light>-distances.jpg`: High | Mobile | Far in the full scene (sky, fog, shadows) from a 1.5 m eye at 50 m (top row) and 260 m (bottom row), at that light's worst azimuth.
- `forest-transition.json` and `forest-<id>-transition.jpg`: High, Mobile and Far from the same camera at 0°, 30° and 60° (High | Mobile | Far | Mobile against Far: red Mobile only, blue Far only, white both), with mean luma, silhouette coverage and silhouette IoU. The capture fails if Mobile/Far coverage leaves 0.85–1.2 or either IoU drops below 0.6 (measured: coverage 0.96–1.02, IoU 0.66–0.81, lowest at 30° between card planes). This 400 × 640 view is not tone-gated. Its luma has Far 4–27% above Mobile, because against the black isolation background the thin needle sprays' partly covered edge pixels pull the near trees' mean down while the cards' alpha-tested edges are hard. In the scene frames above, against sky, the swap is not visible at 260 m, where Far takes over; at 50 m the Far crown reads slightly fuller.
- `kit-budget.json`: per-LOD counts/sizes and conservative transfer reservation. Run `node tools/props/kit-budget.mjs` after `npm run build`.

Build with `npm run props:build -- --kits-only`. A full `npm run props:build` from an empty props folder (a clean export of this branch) succeeds and reproduces all 36 kit files and every slice 1 file byte for byte, except 23 crew and crowd files, which differ only in vertex order (same vertices, materials and AO, decoded; the documented export nondeterminism of the people). This branch leaves those people files as master has them. Kit meshes are named `<id>-<level>-<material>`, so a kits-only and a full build name them alike. Capture under the shared GPU lock using the commands in `tools/props/README.md`. All captures are inspected before handoff. The preview closes its server and browser in `finally`.

## Integration notes

Street modules tile in 4 m lengths; place block and fence at the same ground pivot. The terminal post closes the end. Stands tile at 8 m, with eight crowd row attachments. Pit modules retain 6 m spacing and board/crew anchors. Trees are drooping branch tiers of separate needle sprays with gaps, and their Far cards are projected from the exported High tree (needles with their baked AO, trunk and limbs). Each of the three crossed planes has a separate tile per face, and the card faces export signed tangents. Each tile is rasterised at twice its 192 × 384 resolution and box-filtered, so a texel carries the mean albedo and mean normal that a multisampled pixel of the near tree shows. Normals snap to a 128-direction codebook, and both atlases are lossless WebP; lossy WebP blurred the normals and darkened the cards' shadowed side by up to 43%. The cards therefore shade like the near tree under any light. Keep the cards' own normals and normal map when instancing. The temporary stand's Far LOD keeps its population bounded at 1,552 triangles per 8 m module; crowd rows are attachments, not geometry. Both forest species are conifers, intended for varied forest-edge placements.

Window occupancy is a geometric emissive mask through the named `window-emissive-mask` material. Floodlight anchors expose emitter material and local aim. These emitters need actual local light slots in the night renderer to light the road. Facades are generic backdrops; no real landmarks or brands are reproduced.

Actual Spa/Singapore dressing and the existing Monza tree system are outside this change. Crossed cards and low-poly boughs still need a moving-camera review once integrated. No third-party assets or textures were used.
