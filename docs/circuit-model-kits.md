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
| forest-spruce | 7062 / 3254 / 3254 | 255412 / 117228 / 117220 |
| forest-fir | 5540 / 2564 / 2564 | 206648 / 97712 / 97708 |

New kit: 1,287,292 bytes across all LODs. Complete catalogue: 3,709,812 bytes, below the existing 4,000,000 byte cap.

The production build reports 8.89 MiB for the existing High first race and 3.72 MiB on Mobile. `kit-budget.json` reserves every new LOD plus both circuits’ skies at both tiers on top of that baseline: High 10.23 MiB, Mobile 5.06 MiB, against 25 MB. This is a conservative model-asset allowance, not measured integrated Spa/Singapore traffic. Terrain, placement, light layout and circuit request telemetry remain with dressing.

Monza loads none of these props, but it does pay for their catalogue entries: `props.catalog.json` is bundled into the client, and the twelve new entries add metadata only. With master's ten kit entries already shipped (#40: +938 bytes of first-race transfer against the earlier catalogue), the two forest entries add 204 bytes on both High and Mobile, with identical prop inventories and prop bytes. If Monza ever has to add zero bytes, split the catalogue per circuit; at this size it is not worth a second fetch.

## Evidence and reproduction

- `docs/evidence/m2-models/<id>-sheet.jpg`: High above Far, four views spaced 90 degrees apart, overcast game Environment.
- `<id>-scale.jpg`: the unscaled 5.6 m car alongside every prop.
- `kit-forest.jpg`: overcast inspection assembly; `kit-marina.jpg`: night inspection assembly. These are preview placements, using the game Environment, rather than circuit dressing.
- `*-night.jpg`: floodlight/truss and marina sheets and car-scale frames under the night environment with a track-light preview key.
- `forest-swap.json`, `forest-<id>-<light>-swap.png`: the forest's LOD gate, measured where Far is actually drawn. Mobile against Far at 250 m and 300 m from a 1.5 m eye aimed at mid-crown, in the full scene (game sky, fog, ground, shadows), under overcast, afternoon and the night preview key, at twelve azimuths: 72 samples per species. Each sample must keep interior tone (mean luma over pixels solid in both levels: by day under 40% of the sky behind them, at night 6 levels above it), region tone (mean luma over the union of both silhouettes) and the solid-pixel count within 15%, and Mobile/Far coverage within 0.85–1.2. The camera is 35° on a 1000 px viewport, which samples the tree as the 60° chase camera does on a 1700 px tall display. The record hashes the Mobile and Far files; `forest-swap.test.mjs` rejects a stale or failing record. The crops are Mobile | Far at the worst azimuth, 250 m, enlarged 4× (nearest). Run `flock ~/.cache/undercut/gpu.lock node tools/props/swap.mjs` (`--probe` prints without writing; `SWAP_DETAIL=1` lists samples).
- `forest-luma.json`: the earlier isolated material check (each tree against black, fog/ground/shadows off, High against Far at twelve azimuths under overcast); worst 6.9%.
- `forest-transition.json` and `forest-<id>-transition.jpg`: High, Mobile and Far from the same camera at 0°, 30° and 60° (High | Mobile | Far | Mobile against Far: red Mobile only, blue Far only, white both), with mean luma, silhouette coverage and silhouette IoU. The capture fails if Mobile/Far coverage leaves 0.85–1.2 or either IoU drops below 0.6 (measured: coverage 0.96–1.02, IoU 0.66–0.81, lowest at 30° between card planes). Far is now the Mobile tree, so both read 1.00.
- `kit-budget.json`: per-LOD counts/sizes and conservative transfer reservation. Run `node tools/props/kit-budget.mjs` after `npm run build`.

Build with `npm run props:build -- --kits-only`. A full `npm run props:build` from an empty props folder (a clean export of this branch) succeeds and reproduces all 36 kit files and every slice 1 file byte for byte, except 23 crew and crowd files, which differ only in vertex order (same vertices, materials and AO, decoded; the documented export nondeterminism of the people). This branch leaves those people files as master has them. Kit meshes are named `<id>-<level>-<material>`, so a kits-only and a full build name them alike. Capture under the shared GPU lock using the commands in `tools/props/README.md`. All captures are inspected before handoff. The preview closes its server and browser in `finally`.

## Forest: why Far is the Mobile tree

Far is drawn only beyond 250 m, so the gate above measures it there, against Mobile. No cheaper Far passed. Worst case over the 72 samples per species, as interior / region / solid-pixel deltas (limits 15% / 15% / 15%):

| Far | Overcast | Afternoon | Night |
| --- | --- | --- | --- |
| Crossed cards, coverage alpha, alpha-to-coverage at cutoff 0.5 | 7 / 16 / 58% | 32 / 24 / 42% | 55 / 31 / 64% |
| Crossed cards, coverage alpha, alpha-to-coverage at cutoff 0, atlas from the Mobile tree | 5 / 9 / 39% | 21 / 16 / 34% | 29 / 37 / 71% |
| Geometry with half the sprays (1,388 / 2,074 triangles) | 3 / 10 / 35% | 16 / 16 / 24% | 23 / 30 / 156% |
| Mobile tree (shipped) | 0 / 0 / 0% | 0 / 0 / 0% | 0 / 0 / 0% |

The cards as first reviewed (0/1 alpha, plain alpha test) measured worse still: up to 66% interior, 49% region and 4.1× the solid pixels, at the 60° chase field of view.

The cards fail for structural reasons. At 250–300 m the atlas is read from mip levels where the GPU has averaged the needle normals and the shader renormalises them, so the card shades like one plane facing the camera: strongly lit or unlit by azimuth, while the Mobile tree's many small facets, each shaded on its own, keep the crown's tone nearly the same from every side (night, 250 m: Mobile 13.1–13.3 at 30° and 210°, card 18.2 and 10.4). Averaged alpha removes the sky between the tiers or, with alpha-to-coverage, thins the core; neither reproduces the dense tiers and open gaps the near sprays resolve to. Variants tried and measured (alpha cutoff 0–0.5, nearest mip sampling, no mipmaps on the normals, normals flipped toward the sky, a 1.5 m capture eye, lower opacity) moved one metric at the cost of another. Halving the sprays changes how much sky shows through the crown.

Calibration: High against Mobile, two full-geometry levels of the same tree, passes every daytime metric (worst 5 / 8 / 12%) but not night (9 / 19 / 43%). Under the preview's single floodlight key only a few facets are lit, so any Far that differs from Mobile at all is likely to fail the night criteria.

Cost: 2,564 (fir) and 3,254 (spruce) triangles per tree beyond 250 m instead of 40, about 0.1 MB more per species on disk. A thousand instanced trees are 2.6–3.3 million triangles; the dressing pass sets counts, and a placed forest still needs a frame-time measurement. A cheaper Far would need a different representation than the stock material allows here, for example per-pixel two-sided foliage shading or prebuilt mip chains, which belong to the render pipeline.

## Integration notes

Street modules tile in 4 m lengths; place block and fence at the same ground pivot. The terminal post closes the end. Stands tile at 8 m, with eight crowd row attachments. Pit modules retain 6 m spacing and board/crew anchors. Trees are drooping branch tiers of separate needle sprays with gaps: High adds a raised spray per twig and woody limbs; Mobile and Far are the same tree (see the forest section below). The temporary stand's Far LOD keeps its population bounded at 1,552 triangles per 8 m module; crowd rows are attachments, not geometry. Both forest species are conifers, intended for varied forest-edge placements.

Window occupancy is a geometric emissive mask through the named `window-emissive-mask` material. Floodlight anchors expose emitter material and local aim. These emitters need actual local light slots in the night renderer to light the road. Facades are generic backdrops; no real landmarks or brands are reproduced.

Actual Spa/Singapore dressing and the existing Monza tree system are outside this change. Low-poly boughs still need a moving-camera review once integrated. No third-party assets or textures were used.
