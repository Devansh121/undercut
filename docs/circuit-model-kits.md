# Overcast forest and night circuit kits

Twelve original scripted props, each with High / Mobile / Far LODs. All sizes below count the shipped GLBs, including embedded textures. Ground-centre pivots, +Y up, +X front and metre units follow catalogue version 1. No changes to placement or world rendering.

| Prop | Triangles (High / Mobile / Far) | Bytes (High / Mobile / Far) |
| --- | --- | --- |
| street-block | 88 / 88 / 40 | 6112 / 6016 / 3592 |
| street-fence | 948 / 448 / 192 | 15828 / 9304 / 6332 |
| street-fence-end | 84 / 52 / 52 | 4872 / 4468 / 4468 |
| floodlight-mast | 568 / 172 / 172 | 15640 / 8696 / 8696 |
| lighting-truss | 884 / 412 / 412 | 16712 / 9496 / 9496 |
| temporary-grandstand | 2904 / 1912 / 1552 | 38880 / 28220 / 22092 |
| marina-office | 652 / 524 / 440 | 13852 / 10836 / 10276 |
| marina-hotel | 752 / 624 / 516 | 14524 / 11304 / 10636 |
| marina-pavilion | 336 / 208 / 208 | 12244 / 9364 / 9364 |
| hill-pit-garage | 1448 / 696 / 444 | 36680 / 18920 / 15916 |
| forest-spruce | 316 / 124 / 36 | 9728 / 5596 / 4496 |
| forest-fir | 316 / 124 / 36 | 9772 / 5524 / 4520 |

New kit: 432,472 bytes across all LODs. Complete catalogue: 2,854,992 bytes, below the existing 4,000,000 byte cap.

The production build reports 8.87 MiB for the existing High first race and 3.69 MiB on Mobile. `kit-budget.json` reserves every new LOD plus both circuits’ skies at both tiers on top of that baseline: High 9.40 MiB, Mobile 4.22 MiB. This is a conservative model-asset allowance, not measured integrated Spa/Singapore traffic. Terrain, placement, light layout and circuit request telemetry remain with dressing.

## Evidence and reproduction

- `docs/evidence/m2-models/<id>-sheet.jpg`: High above Far, four views spaced 90 degrees apart, overcast game Environment.
- `<id>-scale.jpg`: the unscaled 5.6 m car alongside every prop.
- `kit-forest.jpg`: overcast inspection assembly; `kit-marina.jpg`: night inspection assembly. These are preview placements, using the game Environment, rather than circuit dressing.
- `*-night.jpg`: floodlight/truss and marina sheets and car-scale frames under the night environment with a track-light preview key.
- `forest-luma.json`: isolated swap-on/off material response at three azimuths. Fog, background and shadows are disabled only for this diagnostic. The capture fails above a 25% High/Far mean luma delta (measured maximum 15.41%, with four of six samples below 5%); normal evidence retains shadows.
- `kit-budget.json`: per-LOD counts/sizes and conservative transfer reservation. Run `node tools/props/kit-budget.mjs` after `npm run build`.

Build with `npm run props:build -- --kits-only`. Capture under the shared GPU lock using the commands in `tools/props/README.md`. All captures are inspected before handoff. The preview closes its server and browser in `finally`.

## Integration notes

Street modules tile in 4 m lengths; place block and fence at the same ground pivot. The terminal post closes the end. Stands tile at 8 m, with eight crowd row attachments. Pit modules retain 6 m spacing and board/crew anchors. Tree cards use opposing faces with upward-tilted crown normals; retain these when instancing. Both forest species are conifers, intended for varied forest-edge placements.

Window occupancy is a geometric emissive mask through the named `window-emissive-mask` material. Floodlight anchors expose emitter material and local aim. These emitters need actual local light slots in the night renderer to light the road. Facades are generic backdrops; no real landmarks or brands are reproduced.

Actual Spa/Singapore dressing and the existing Monza tree system are outside this change. Crossed cards and low-poly boughs still need a moving-camera review once integrated. No third-party assets or textures were used.
