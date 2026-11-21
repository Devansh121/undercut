# Asset survey

Where every class of visual asset comes from, under which licence, and what it costs to ship. Checked on 2026-11-21. Every URL below was fetched without an account; the "Check" column is the HTTP status of a real request for a sample file (206 means a ranged request for the first kilobyte succeeded, which proves the file is served; 200 is a full download). Nothing here has been committed except the two font families (see "Fonts").

## Licences read

| Source | Licence | What the licence page says | Attribution |
|---|---|---|---|
| Poly Haven, <https://polyhaven.com/license> | CC0 1.0 | All HDRIs, textures and models are CC0: use for any purpose including commercial, redistribution allowed, credit not required. | Not required. We credit anyway: "<asset name> by Poly Haven (polyhaven.com), CC0." |
| ambientCG, <https://docs.ambientcg.com/license/> | CC0 1.0 | All downloadable asset files and preview renders are CC0; may be included raw in a video game. | Not required. Suggested text: "Created using <asset name> from ambientCG.com, licensed under the Creative Commons CC0 1.0 Universal License." |
| Archivo, <https://github.com/Omnibus-Type/Archivo/blob/master/OFL.txt> | SIL OFL 1.1 | Use, bundle, embed and redistribute with software; no sale of the fonts alone; licence text must accompany the font. No Reserved Font Name is declared. | Keep `OFL.txt` with the font files and list the copyright line in CREDITS. |
| Barlow, <https://github.com/jpt/barlow/blob/main/OFL.txt> | SIL OFL 1.1 | As above. No Reserved Font Name is declared. | As above. |

## HDRI skies (lighting and sky dome)

Shipped as 1k Radiance `.hdr` for image-based lighting (prefiltered at load), with the visible sky dome drawn from the same image; the 2k file is the authoring source.

| Use | Asset | 1k / 2k `.hdr` | Sample URL | Check |
|---|---|---|---|---|
| Monza afternoon | `kloofendal_48d_partly_cloudy_puresky` (Poly Haven) | 1.4 MB / 5.5 MB | https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/2k/kloofendal_48d_partly_cloudy_puresky_2k.hdr | 206 |
| Spa overcast | `kloofendal_overcast_puresky` (Poly Haven) | 1.2 MB / 4.3 MB | https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/2k/kloofendal_overcast_puresky_2k.hdr | 206 |
| Singapore night | `kloppenheim_07_puresky` (Poly Haven; overcast night sky lit by city glow) | 1.3 MB / 5.0 MB | https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/2k/kloppenheim_07_puresky_2k.hdr | 206 |
| Night reflections (option) | `shanghai_bund` (Poly Haven; urban night, for reflection probes only, never shown as background because the skyline is recognisable) | 1.6 MB / 6.5 MB | https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/2k/shanghai_bund_2k.hdr | 206 |
| Studio (car renders, menus) | `studio_small_09` (Poly Haven) | 6.3 MB at 2k | https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/2k/studio_small_09_2k.hdr | 200 |

"Puresky" HDRIs have the ground removed, so our own terrain and skyline sit under a clean sky. Singapore's skyline and floodlights are authored in the scene; the HDRI only supplies sky colour and soft fill.

## PBR texture sets

Each set provides colour, OpenGL normal and a packed ARM map (ambient occlusion, roughness, metalness), which is what glTF wants. Sizes are the JPG sources from the upstream API (colour + normal + ARM). In the build they are transcoded to KTX2 (ETC1S for colour and ARM, UASTC for normals), which typically ships at 15–30% of the JPG size; that ratio is to be measured in M2 when the transcoder joins the pipeline.

| Class | Primary asset | 1k / 2k (3 maps, JPG) | Sample URL | Check | Alternative |
|---|---|---|---|---|---|
| Asphalt, racing surface | Poly Haven `asphalt_track` | 2.2 MB / 9.9 MB | https://dl.polyhaven.org/file/ph-assets/Textures/jpg/2k/asphalt_track/asphalt_track_diff_2k.jpg | 206 | ambientCG `Asphalt031` (1k zip 8.7 MB), https://ambientcg.com/get?file=Asphalt031_1K-JPG.zip, 206 |
| Asphalt, pit lane and run-off | Poly Haven `asphalt_pit_lane` | 2.7 MB / 11.2 MB | https://dl.polyhaven.org/file/ph-assets/Textures/jpg/2k/asphalt_pit_lane/asphalt_pit_lane_diff_2k.jpg | 206 | Poly Haven `asphalt_02` |
| Concrete (walls, kerb base, pit) | Poly Haven `concrete_floor_worn_001` | 0.4 MB / 2.0 MB | https://dl.polyhaven.org/file/ph-assets/Textures/jpg/2k/concrete_floor_worn_001/concrete_floor_worn_001_diff_2k.jpg | 206 | ambientCG `Concrete034`, https://ambientcg.com/get?file=Concrete034_1K-JPG.zip, 206 |
| Kerb paint | Procedural: kerb colour mask in the shader over the concrete set's normal and roughness, plus a painted-surface roughness layer | 0 | — | — | ambientCG `PaintedMetal004` as a wear reference |
| Grass | Poly Haven `sparse_grass` (verges), `leafy_grass` (parkland) | 3.4 MB / 13.5 MB each | https://dl.polyhaven.org/file/ph-assets/Textures/jpg/2k/sparse_grass/sparse_grass_diff_2k.jpg | 206 | ambientCG `Grass004`, https://ambientcg.com/get?file=Grass004_1K-JPG.zip, 206 |
| Gravel traps | Poly Haven `gravel_stones` | 3.3 MB / 12.5 MB | https://dl.polyhaven.org/file/ph-assets/Textures/jpg/2k/gravel_stones/gravel_stones_diff_2k.jpg | 206 | Poly Haven `sandy_gravel_02`; ambientCG `Gravel022`, https://ambientcg.com/get?file=Gravel022_1K-JPG.zip, 206 |
| Armco and metal | Poly Haven `metal_plate` (posts, plates); galvanised rail colour is procedural over its normal and roughness | 2.5 MB / 9.1 MB | https://dl.polyhaven.org/file/ph-assets/Textures/jpg/2k/metal_plate/metal_plate_diff_2k.jpg | 206 | ambientCG `Metal032`, https://ambientcg.com/get?file=Metal032_1K-JPG.zip, 206; Poly Haven `corrugated_iron` for sheds (2.0 MB at 1k) |
| Catch fencing | Poly Haven model `modular_chainlink_fence` (alpha-tested mesh texture reused on a scripted fence) | 7.3 MB glTF set at 1k | https://dl.polyhaven.org/file/ph-assets/Models/gltf/1k/modular_chainlink_fence/modular_chainlink_fence_1k.gltf | 206 | Procedural diamond-mesh alpha in shader |
| Tyre rubber | ambientCG `Rubber004` for the tread and sidewall micro-normal; sidewall lettering and compound bands authored as SVG and baked | 8.4 MB zip at 1k (source only; shipped map is a 512 px detail tile) | https://ambientcg.com/get?file=Rubber004_1K-JPG.zip | 206 | Procedural noise normal |
| Carbon fibre | Procedural twill in the shader (as in the car proof), UVs in metres, clearcoat on top | 0 | — | — | ambientCG `Fabric004` (the only carbon-like weave there), https://ambientcg.com/get?file=Fabric004_1K-JPG.zip, 206 |
| Fabric (banners, seat belts, suits) | Poly Haven `fabric_pattern_07` | 1.8 MB at 1k | https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/fabric_pattern_07/fabric_pattern_07_col_1_1k.jpg | 206 | ambientCG `Fabric081C`, 1k zip 5.0 MB |
| Concrete barrier blocks | Poly Haven model `concrete_road_barrier` (street circuit) | 3.8 MB at 1k | https://dl.polyhaven.org/file/ph-assets/Models/gltf/1k/concrete_road_barrier/concrete_road_barrier_1k.gltf | 206 | Scripted extrusion with the concrete set |
| Street lights | Poly Haven model `street_lamp_01` (Singapore surroundings) | 2.2 MB at 1k | https://dl.polyhaven.org/file/ph-assets/Models/gltf/1k/street_lamp_01/street_lamp_01_1k.gltf | 206 | Scripted |

## Vegetation and crowd

- **Trees.** Poly Haven's CC0 trees are film-grade and far too heavy to ship (`pine_tree_01` is 958 MB as a 1k glTF set, `jacaranda_tree` 215 MB, `island_tree_02` 46 MB; all served, status 206). We use them only as sources: a Blender script renders each into an octahedral impostor atlas (colour, normal, depth) of 2048² per species, three to four species per circuit, plus a low-poly trunk for the nearest row. Shipped cost about 1.5–2 MB per circuit in KTX2.
- **Shrubs and verges.** Poly Haven `shrub_01` (6.9 MB source) baked the same way; grass verges use the grass texture plus alpha-cards scattered by script near the track edge.
- **Crowd.** No suitable CC0 human set downloads cleanly at game cost, so the crowd is authored by script: a Blender script poses a simple sculpted mannequin in 16 poses with varied clothing colours, renders a sprite atlas (1024², with normal map), and the game instances camera-facing cards on grandstand rows with per-instance colour and a small idle animation. Cost about 0.5 MB.

## Fonts (committed)

| File | Source URL | Author | Licence | Changes | sha256 |
|---|---|---|---|---|---|
| `design/mock/fonts/Archivo-Variable.woff2` | https://raw.githubusercontent.com/Omnibus-Type/Archivo/master/fonts/variable/Archivo%5Bwdth,wght%5D.ttf (200) | The Archivo Project Authors (Omnibus-Type) | OFL 1.1 | TTF repackaged as WOFF2 with fontTools 4.59.2; no glyph, metric or name changes | `53103f355e93d34385857b8cb0bb635f6fc8a1960c867ef86db45658e739e624` |
| `design/mock/fonts/BarlowSemiCondensed-Medium.woff2` | https://raw.githubusercontent.com/jpt/barlow/main/fonts/woff2/BarlowSemiCondensed-Medium.woff2 (200) | The Barlow Project Authors (Jeremy Tribby) | OFL 1.1 | None | `d09441548a8efae963180034f92259d0f051c7b6e895b1fcda2ac933f1a38895` |
| `design/mock/fonts/BarlowSemiCondensed-SemiBold.woff2` | https://raw.githubusercontent.com/jpt/barlow/main/fonts/woff2/BarlowSemiCondensed-SemiBold.woff2 (200) | as above | OFL 1.1 | None | `bae9a20f1461da5276b405097cfd4ad72a888632b65780ca3a0b996cb4aab3ad` |
| `design/mock/fonts/BarlowSemiCondensed-Bold.woff2` | https://raw.githubusercontent.com/jpt/barlow/main/fonts/woff2/BarlowSemiCondensed-Bold.woff2 (200) | as above | OFL 1.1 | None | `1a1e9ef592eec2e8c0886c0577cc8cfb8cc1f0c1eebf8a252e0341248b6bbbfa` |
| `design/mock/fonts/Archivo-OFL.txt`, `Barlow-OFL.txt` | upstream `OFL.txt` of each repository (200) | — | — | None | — |

Both families expose a `tnum` feature (checked with fontTools). Total 380 KB; the game build subsets them to Latin, which should halve it.

## Audio

Audio is synthesised in code by default (engine, tyres, wind, UI clicks). Gaps where a recording would clearly beat synthesis: crowd ambience, PA announcements, and marshal whistles. Kenney "UI Audio" (<https://kenney.nl/assets/ui-audio>, page states CC0) is a possible UI fallback, but its download button runs through JavaScript and the zip URL could not be verified without a browser, so it is not listed as a source yet. Poly Haven and ambientCG have no audio.

## Authored in code or by script instead of sourced

- The car: every part built by Blender script (see `docs/adr/0005-car-model.md`), liveries as masks plus team colours from `design/teams.json`.
- Kerbs, painted lines, track-limit lines, DRS and braking boards, light panels, marshal posts, Armco rails, foam barrier blocks, catch-fence poles and cables, gantries, grandstands, pit building: modelled by script from parameters, textured with the sets above.
- Advertising for invented brands: SVG artwork in the repo, rasterised to one atlas per circuit.
- Carbon fibre, kerb paint, galvanising, tyre sidewall graphics, number plates on the cars: procedural or SVG.
- Crowd and tree impostor atlases: rendered by script from the sources above.
- Skyline (Singapore) and distant ridge lines: generated silhouettes with emissive window masks.
- Terrain and track meshes come from geodata (covered by the track research slice, not here).

## First-race budget (target about 25 MB transferred, Monza)

| Item | Estimate |
|---|---|
| Code (three.js and game, compressed) | 1.5 MB |
| Car geometry, one model shared by the grid (Draco) | 0.8 MB |
| Car textures (livery mask atlas 2k, carbon and tyre detail tiles, decals) | 2.0 MB |
| Track and terrain geometry | 4.0 MB |
| Track textures (asphalt x2, concrete, grass x2, gravel, metal, fence) at 1–2k KTX2 | 7.5 MB |
| Tree and shrub impostors | 2.0 MB |
| Crowd atlas | 0.5 MB |
| Advertising and signage atlas | 1.0 MB |
| HDRI (1k) | 1.4 MB |
| Fonts (subset) | 0.2 MB |
| Audio (synthesised) | 0 |
| **Total** | **about 21 MB**, leaving headroom for a 2k asphalt detail map |
