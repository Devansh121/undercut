# Car review log (M2)

What each look at the renders showed and what was changed. Iterations 1–4 are EEVEE and Workbench in Blender; from 5 on, the check is the three.js viewer (`tools/car/preview`), which is what the game will show. Final files are in this folder: `ortho/` (proportion sheets, 500 mm grid, front and rear axle lines in orange), `blender/` (Cycles), `threejs/` (Playwright on the GPU), `stats.json`.

## 1. Block-out (Workbench orthographic sheets, EEVEE three-quarter)

- Reads right at a glance: wheels at the corners, cockpit well ahead of the rear axle, flat floor, airbox top at 0.95 m.
- Wrong: a 0.8 m tall engine-cover fin made the rear a box in side view. Removed (the fin is optional).
- Wrong: T-camera floated about 30 mm above the airbox. Now seated on the airbox surface.
- Wrong: front wing stack too tall: top flap trailing edge reached 0.47 m at the endplate, so the endplate became a tall slab. Outboard angles and chords cut; the trailing edge now ends near 0.31 m.
- Wrong: both endplates were flat rounded rectangles: "wings that look like planks". Front endplate now low at the front and rising rearwards along the flap tips; rear endplate has a raked lower leading edge and a 220 mm radius top corner.
- Wrong: airbox read as a separate tube laid on the engine cover. Its section is now a tent that flares into the cover, so the spine runs continuously from the hoop to the tail.
- Wrong: sidepods stayed bulky to the rear wheels. Top surfaces ramp down harder (downwash) and the outer line narrows to 0.215 m by x = −1.45 (coke bottle).

## 2. Materials and the first livery

- All parts in one primer colour hid every shape. Livery masks drawn per pattern; Calder (side band) first.
- Bug: the mask came out black. Changing a generated image's colour space after writing its pixels resets it in Blender. Fixed by setting the colour space first; the masks are now written by our own PNG writer so their bytes are deterministic.
- The floor and diffuser strakes looked like chrome under the white studio. Floor parts moved to a matte carbon without clearcoat.
- Thin wishbones read as wire. Chord 75 mm, thickness 22 mm.
- Over budget: 136k triangles against 120k. Wheel segments 72 → 64, wing profiles 40 → 32 points: 111k.

## 3. First three.js captures

- Tyres came out brown: the compound colour multiplied the whole tyre. Markings are now recoloured in the shader from the bright texels only; the rubber stays black.
- Carbon looked like brushed aluminium under the generated environment. Base darker, clearcoat 0.6 at roughness 0.22.
- A primary-colour dot at the centre of each endplate: cap faces had no atlas UVs. Caps now sample their patch.
- Upper wishbones ended in the air beside the nose. Inboard pick-ups are now projected onto the chassis surface at build time; the chassis at the front axle was raised 40 mm so the upper wishbones run level instead of climbing outwards.
- Driver codes rendered upside down: canvas textures default to `flipY = true`, glTF UVs need `false`.

## 4. Cockpit close-up

- Carbon weave showed through the paint. The paint no longer has the weave normal map.
- Visor edge stair-stepped (faces picked by centre height across a slanted grid). The helmet is now built in horizontal slices so the visor is a clean band of rows; the shell carries the team colours.
- Headrest pads looked like two black hoses. Rebuilt as rounded pads on the cockpit rim beside and behind the helmet.
- Dark smudges where panels overlap (sidepod into chassis, airbox into cover): vertices buried inside another part baked as fully occluded. Buried vertices are now detected (rays hitting back faces) and take their neighbours' value.
- Added per-vertex ambient occlusion for every part (ray cast against the car and the ground): wheel wells, undercut and cockpit now darken.

## 5. All ten liveries, angles, LODs

- Lookalike check: Aldermoor's diagonal split gave a cream nose and a dark red rear, close to a real 2022 car's look. The split is reversed (primary forward and high, cream low at the rear).
- Lookalike check: Meridian's block pattern made the whole sidepod dark grey on an amber car, close to a real orange-and-black car. The block is now a square panel on the sidepod flank only.
- Floor read as a rectangular tray from above. The plan now tapers to 0.30 m at the leading edge and curves in ahead of the rear tyres.
- Chase camera too far for the Mobile LOD check; moved to 5.6 m.
- Far LOD drew 29 draw calls and 17k triangles. Uprights dropped, links merged into the body, materials merged: 21 draw calls, 14.3k triangles.

## Remaining giveaways (honest list)

At thumbnail size the captures pass for a current single-seater. At full size:

1. Overlapping panels meet in visible creases instead of filleted blends: sidepod top into the chassis beside the cockpit, airbox flanks into the sidepods. Visible in the cockpit close-up.
2. Bodywork is too clean: no panel gaps, fasteners, louvres, cooling gills, sensor stalks or antennae. Surfaces are one smooth gloss.
3. Rear wing endplates are plain flat plates: no slots or louvres, and the wingtips do not roll into the endplate the way current cars' do.
4. The front wing elements end square inside the endplate; real elements curl up into it. There is one footplate strake and no other endplate detail.
5. Mirrors are simple rounded housings on blade stalks; real ones are sharper and mounted lower on the sidepod.
6. The cockpit interior is a dark tub with pads; there are no hands, harness, seat shape or visible pedal box (hands were optional and were not built).
7. Wheel covers are flat discs with a painted ring; the rim behind them has no spokes, which only shows at very low angles.
8. The diffuser roof is plain; strakes are flat plates.
9. Ambient occlusion is per vertex, so it is soft on long, sparsely tessellated panels.
10. The livery atlas runs at about 5 mm per texel along the spine, so a diagonal edge can show slight stepping in a close-up.
