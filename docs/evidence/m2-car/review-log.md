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

## 6. Second pass, after the PR review

Each claim was checked before fixing it.

- **Tyre topology** (confirmed: 5 duplicate profile points, the tread crossed twice). The profile is now one bead-to-bead pass: the sidewall and shoulder are mirrored, the tread is not. Every part meant to be closed is now checked before export, and so is every edge: an edge with more than two faces, or an open edge on a closed part, fails the build. The check caught three more faults on its first run, all fixed: two centreline caps doubled by mirroring (diffuser exit lip, DRS gurney), and thin triangles being dropped as "degenerate", which opened holes in the Mobile rear endplates.
- **Intersecting body panels** (confirmed in the cockpit close-up). The airbox is no longer a separate loft: the engine-cover ridge is joined to the tub's sections by a smooth maximum in polar form, so the shoulder is one filleted surface. The intake is a lipped ring on the roll hoop's face. The sidepods are open profiles that leave and rejoin the chassis surface with a fillet, and they relax onto the chassis at the rear instead of ending in an open tube.
- **Tail caps** (confirmed: fan centres off the symmetry plane at the crash structure and the spine tail). All half-ring caps now put their centre on the plane; the crash-structure tip carries a bezel round the rain light.
- **Livery UVs on plates and caps** (confirmed on Calder, Aldermoor, Brevik, Norrland and Terraluce). Plates now use planar UVs over the face and the outer half of the edge; caps get their own small planar patch; masks are rasterised from each patch's own triangles, split exactly as the export splits them.
- **Tyre markings read as the real supplier's**. Replaced with an invented scheme in `design/compounds.json`: the maker's mark once per sidewall, and four groups of short radial ticks lit one, two or three at a time (hard, medium, soft) in steel blue, orange or magenta. The HUD mock now shows the code letter over the same tick count; its screenshots were re-captured.
- **Published triangle counts** (confirmed: they came from the generator, before cleanup). `stats.json` is now measured on the exported GLBs. The far LOD dropped its suspension links (thinner than a pixel at that size), its uprights and its small fittings: 10,584 triangles, under the 12,000 budget.
- **Draw calls**: minor materials merged per motion group, the decals made one mesh, and the sixteen suspension links and two driveshafts made one mesh with morph targets. 82 → 36 on High, 67 → 23 on Mobile, 21 → 11 on Far.
- **LOD switching**: switch sizes defined by projected radius in `docs/car-asset.md`, with a transition strip at each switch (`threejs/lod_strip_*.jpg`). The Mobile tyre went from 32 to 40 segments so its outline matches High more closely.
- **Draco decoder**: one per batch of loads, disposed in `finally`.

The look, in the reviewer's order:

- **A. Rear assembly.** The main plane rolls down into the endplate at each tip (radius 100 mm). A static fairing carries the flap's section through the roll, so the DRS flap opens inside it. The endplate hangs below the roll with a concave leading edge and a cut-away lower front, edges are 12 mm thick, and the swan necks have foot blocks. The beam wing sits on a centre mount with rolled tips. The diffuser has a shaped throat, an arched roof in each tunnel, side walls down to the reference plane, a curved strake and an exit lip. The crash structure has a flat underside, and the lamp sits in a bezel; the exhaust has a rolled lip. Checked straight from behind and from the chase position (6 m back, 2 m up), now standard stations.
- **B. Bodywork.** One filleted shoulder (above). Panel gaps, fasteners, sidepod-top louvres and engine-cover gills are a normal map drawn in the livery atlas. The floor edge tapers to 5 mm and the edge wing is slimmer.
- **C. Liveries.** Ten designs, one mask each, built from a shared vocabulary of nose tips, spine stripes, sidepod slashes and panels, number panels and wing graphics. No two teams share a design. Quillon's code was dark on navy and is now on lime.
- **D. Front end and wheels.** The two upper front flaps curl up into the endplate. The wheel cover has a rolled rim, a dished face with a step ring and a hub boss, and the tyre texture has a restrained rubber grain.
- **E. Cockpit and materials.** The driver's shoulders sit in the cockpit under the halo, the forearms reach for the wheel, the gloves are on the grips and turn with them, and harness straps run over the shoulders. The halo mounts have fairings and the visor has a dark seal. Carbon is rougher with a softer clear coat and a stronger weave, so broad highlights break up instead of reading as metal.

## Remaining giveaways (honest list)

At thumbnail size the captures, rear and chase included, pass for a current single-seater. At full size:

1. Mirrors are simple rounded housings on blade stalks; real ones are sharper and mounted lower on the sidepod.
2. Panel gaps, fasteners and louvres are a normal map only: they catch light but cast no shadow and do not change the silhouette.
3. The rear-wing endplate is one flat plate below the roll; real ones have slots, strakes and a footplate.
4. The cockpit is sparse: the shoulders and gloves show, but there is no seat shape, pedal box or visible harness buckle, and the forearms do not follow the wheel when it turns.
5. The diffuser has one strake per side; real ones have several, with curved fences at the outer edge.
6. Wheel covers hide a rim with no spokes; that only shows from very low angles.
7. Ambient occlusion is per vertex, so it is soft on long, sparsely tessellated panels.
8. The far LOD has no suspension links; at its switch size they are thinner than a pixel, but a magnified capture shows the gap.
9. The livery atlas runs at about 5 mm per texel along the spine, so a diagonal edge can show slight stepping in a close-up.
