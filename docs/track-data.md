# Track data: sources, checks and pipeline

How the three default circuits will be built from openly licensed geodata: **Monza**, **Spa-Francorchamps** and **Singapore Marina Bay**, named by place only. Every number below was measured by the scripts in `tools/research/` on 2026-11-21, or comes from a numbered source at the end.

Summary:
- OpenStreetMap gives a closed, correctly ordered racing centreline for all three circuits, within 1 % of the official lap length (Monza +0.02 %, Spa −0.13 %, Singapore +0.80 %).
- Copernicus GLO-30 elevation reproduces the published Spa elevation range exactly (102.2 m against 102.2 m [8]). Monza and Singapore need a canopy/building filter, after which they also match (12.9 m against 12.8 m, 5.7 m against 5.3 m).
- No circuit needs replacing.
- Track width, kerbs and camber are not in any open dataset at usable quality. They will be authored, constrained by the FIA reference width and the mapped barriers.

## 1. Centreline and surface: OpenStreetMap

### 1.1 Queries run

`tools/research/osm_circuit.py` sends two Overpass queries per circuit [1]:
- `relation(<id>);(._;>;);out body;` returns the circuit relation, its ways and their nodes.
- A bounding-box census of `highway=raceway`, `width`, `area:highway`, kerbs, barriers, gravel/sand, grandstands, buildings and grass.

The script chains the racing ways into one loop, orients it in race direction, starts it at the relation's `start` node and measures it on the WGS84 sphere. Raw responses are cached under `~/.cache/undercut/osm/`.

| | Monza | Spa | Singapore |
|---|---|---|---|
| Circuit relation [2] | 284565 (`type=circuit`, `highway=raceway`) | 284560 (`type=circuit`) | 421263 (`type=circuit`) |
| Racing ways in relation | 20 `highway=raceway` ways | 30 `highway=raceway` ways | 99 ways: public roads (`primary`/`trunk`/`tertiary`, 2–6 lanes) plus 5 `raceway` ways; roles `forward` (24) and `backward` (75) |
| Pit lane | way 38168747 (role `pit_lane`), 741.8 m | way 323851541 (`pit_lane`), 719.5 m | way 100484287 (`pitlane`, `raceway=pitlane`), 825.4 m |
| Start/finish | node 1828499259 (`start`) | node 258602622 (`start`) | node 4281759834 (`start` and `finish`) |
| Loop closes | yes, 0.0 m gap, no leftover ways | yes, 0.0 m, none | yes, 0.0 m, none |
| Centreline nodes | 294 | 330 | 226 |
| Node spacing median / p90 / max | 4.9 / 30.5 / 384 m | 10.4 / 44.8 / 338 m | 12.9 / 40.9 / 290 m |
| Heading from start line | 6° (north, toward T1) | 330° (north-west, toward La Source) | 351° (north, toward T1) |
| Pit way joins centreline at (s from start line) | exit 184 m, entry 5236 m | exit 434 m (before Eau Rouge), entry 6647 m (inside the final chicane) | exit 385 m, entry 4488 m |

The relation membership is what separates the current layout from the other raceways in the area. For example, the Monza bounding box holds 42 raceway ways, including the old banking, and the Spa box holds a "Moto layout" way that is not a relation member.

### 1.2 What else is mapped (census inside each circuit's bounding box)

| Feature (way count) | Monza | Spa | Singapore |
|---|---|---|---|
| `highway=raceway` | 42 | 35 | 6 |
| raceway ways with `width` | 0 | 0 | 0 |
| `area:highway=raceway` surface polygons | 0 | 0 | 0 |
| `barrier=kerb` | 1 | 0 | 1 |
| `barrier=wall` / `fence` / `guard_rail` | 53 / 20 / 8 | 72 / 106 / 5 | 8 / 3 / 0 |
| gravel / sand areas | 40 | 15 | 2 |
| grandstands | 44 | 8 | 0 |
| buildings | 2387 | 247 | 617 |
| grass areas | 79 | 71 | 29 |

The barrier and building counts include features away from the track, such as park walls at Monza and city blocks at Singapore. The pipeline must keep only features within about 40 m of the centreline.

Conclusions:
- **Width**: not mapped on any circuit. Singapore has `lanes` on its public-road members, which gives a carriageway estimate.
- **Kerbs**: effectively not mapped.
- **Run-off**: gravel traps are partly mapped at Monza and Spa; asphalt run-off is not distinguishable.
- **Barriers**: partly mapped at the permanent circuits; almost absent at Singapore, where the walls are temporary.
- **Grandstands and buildings**: well mapped at Monza, partly at Spa. Singapore's grandstands are temporary and unmapped, while the surrounding city blocks are mapped. That is enough for scenery placement.
- **Bridges and covered sections**: Singapore's Fullerton Road (way 29377119) and Esplanade Drive (way 35037538) are tagged `bridge=yes`, `layer=1`. One Monza layout way is tagged `covered`.

### 1.3 Alternative and cross-check: TUMFTM racetrack-database

- **Licence**: LGPL-3.0 [3][4].
- **Coverage**: 25 circuits, including Monza and Spa, but **not Singapore** [5].
- **Contents**: centreline x/y plus track width left and right. Its README says the centrelines were taken from OpenStreetMap and smoothed, and the widths extracted from satellite images [3].

| | Monza | Spa |
|---|---|---|
| TUMFTM centreline length | 5790.2 m (1159 points) | 7000.1 m (1401 points) |
| TUMFTM width (left + right): min / median / max | 7.5 / 9.0 / 12.4 m | 7.9 / 9.2 / 16.4 m |
| FIA reference width [6] | 10 m | 10 m |

The TUMFTM widths are about 10 % below the FIA reference width. That is consistent for a nominal figure, so they are usable as a width-profile reference.

Licence caution: TUMFTM data is OSM-derived but distributed under LGPL-3.0. OSM data must stay under ODbL when redistributed as a database [9], so shipping TUMFTM files in this repository has an unclear licence chain.

Recommendation: do not commit or ship TUMFTM data. Use it locally as a cross-check for length and as a reference when authoring width profiles.

| Circuit | Centreline source | Width source |
|---|---|---|
| Monza | OSM relation 284565 | Authored. FIA reference width 10 m as the floor; TUMFTM profile as a local reference; widened where OSM gravel/run-off polygons and the FIA map show it. |
| Spa | OSM relation 284560 | Same method; FIA reference width 10 m |
| Singapore | OSM relation 421263 | Authored from OSM `lanes` × about 3.3 m, clipped to at least the FIA reference width of 9 m. Barriers authored at the carriageway edge. |

## 2. Elevation

### 2.1 DEM choice

Recommended: **Copernicus DEM GLO-30**, read from the public AWS bucket `copernicus-dem-30m`.
- **Access**: no login and no AWS account; plain HTTPS [10][11]. Each tile is a 1°×1° float32 Cloud-Optimised GeoTIFF (25–45 MB).
- **Licence**: the GLO-30 licence grants reproduction, distribution, communication to the public and adaptation, free of charge, worldwide [13]. Obligations are listed in section 3.
- **Resolution and accuracy**: 1 arc-second (longitude spacing 1.5″ at 50° N); vertical datum EGM2008. Relative vertical accuracy is below 2 m for slopes up to 20 % [12].
- **Type**: it is a *surface* model, so it includes vegetation and buildings [10][12]. Monza and Singapore need filtering because of this (section 2.3).

Cross-check used: the AWS Terrain Tiles "skadi" 1-arc-second tile for Spa (N50E005). It is a mosaic whose attribution lists SRTM and EU-DEM sources among others [14]. It was used only to cross-check, not recommended for shipping, because its per-region attribution is more involved.

National LiDAR (Wallonia, Italy, Singapore) was not evaluated. Copernicus passed the Spa check, and the two flat circuits do not need sub-metre detail.

### 2.2 Spa check

`tools/research/dem_profile.py` resamples the OSM centreline every 10 m and samples the Copernicus tile bilinearly (tile N50 E005, 2400×3600 px, predictor 3). It reports the profile raw, after a 90 m moving average, and after the optional opening filter.

| Quantity | Copernicus, raw | Copernicus, 90 m smoothed | Skadi cross-check, smoothed | Published |
|---|---|---|---|---|
| Lowest point | 364.1 m at s = 5060 m | 364.6 m at s = 5070 m (inside the Courbe Paul Frère way) | 363.2 m | lowest point at Turn 15, Paul Frère [8] |
| Highest point | 467.0 m at s = 2550 m | 466.8 m at s = 2530 m (inside the Malmedy way) | 468.8 m | highest point at Turn 7, Malmedy [8] |
| Range | 102.8 m | **102.2 m** | 105.6 m | **102.2 m** [8] |
| Steepest climb | 26.8 % (noise) | **17.8 %** (Raidillon) | 14.8 % | 17 % [15] |
| Climb, Eau Rouge bottom (s ≈ 890) to Raidillon exit (s ≈ 1490) | | 388.6 → 432.4 m, **+43.8 m** | | about 40 m [15]; 391 → 446 m (+55 m) from the operator's altitude labels [7] |
| Climb, Eau Rouge bottom to Les Combes top | | 386.8 → 466.8 m, **+80 m** | | 391 → 470 m (+79 m) [7] |
| Cumulative climb per lap | 174 m | 145 m | 158 m | — |

Against the circuit operator's 18 altitude labels [7], the smoothed Copernicus profile has a mean error of −3.8 m and an RMS error of 5.4 m. The largest errors are −13.6 m at the 1490 m label and −8.8 m at the 1130 m label, both on Raidillon and the start of Kemmel, and −8.3 m at 5100 m. Shifting the label distances by ±60 m does not reduce the error below an RMS of 5.3 m, so the labels are not simply misplaced.

Two likely causes:
- A vertical datum offset: Copernicus uses EGM2008 [12], and the operator's datum is not stated.
- The 30 m grid softens the crest of Raidillon.

The total climb from Eau Rouge to Les Combes, the overall range and the maximum gradient all agree. **Conclusion: Spa's famous features are resolvable in GLO-30.**

Smoothing needed at Spa: a 90 m moving average (or a cubic smoothing spline of similar bandwidth) removes 30 m pixel stepping. Raw gradients reach 27 %, which is noise; after smoothing they are 17.8 %. Do **not** apply the opening filter at Spa: with a 150 m window it flattens Raidillon to 13.6 %.

### 2.3 Monza and Singapore

Both circuits are almost flat, and the surface model shows trees (Monza park) and buildings or elevated structures (Singapore) as bumps. A 1-D morphological opening along the lap (running minimum, then running maximum, then a 90 m average) removes positive bumps narrower than the window.

| Circuit | Raw range | 90 m smoothed range | Opened 150 m | Opened 300 m | Opened 500 m | Published |
|---|---|---|---|---|---|---|
| Monza (tile N45 E009) | 25.3 m | 23.3 m | 18.9 m | **12.9 m** | 12.8 m | 12.8 m [8] |
| Singapore (tile N01 E103) | 24.3 m | 22.8 m | 14.0 m | **5.7 m** | 3.5 m | 5.3 m [8] |

The published figures for Monza and Singapore come from a 2016 article [8]. Monza's layout has not changed since. Singapore's has (2023), but the circuit is flat throughout, so the comparison still holds.

- **Monza**, after a 300 m opening: the low point is 178.8 m at s = 5100 m (Curva Alboreto approach) and the high point 191.7 m at s = 2840 m. The main straight climbs about 5 m. This matches the published description: downhill run to the Parabolica, start-finish straight on a slight rise [8].
- **Singapore**: use a 300 m opening. The opening also removes the real humps of the two OSM-tagged bridges, because the DEM flattens water under them. Re-insert each bridge as a smooth deck between its abutment heights, with a crown of 1–2 m (**estimate**). This is the main elevation data-quality issue at Singapore.

Recommended filter per circuit: **Spa** 90 m average only; **Monza** 300 m opening + 90 m average; **Singapore** 300 m opening + 90 m average + bridge re-insertion. Pipeline tests must check the resulting ranges against the published figures: Spa 102.2 ± 3 m, Monza 12.8 ± 2 m, Singapore 5.3 ± 1.5 m.

## 3. Licences and attribution

| Source | Licence | Exact attribution text | Where it must appear |
|---|---|---|---|
| OpenStreetMap (centrelines, pit lanes, barriers, footprints) | Open Database License 1.0 [9] | "© OpenStreetMap contributors", with a link or the URL https://www.openstreetmap.org/copyright, and a statement that the data is available under the Open Database License [9]. For games, the credit may be on a splash screen, in the game view, on the credits page or in a menu; if the first credit is brief, details must be available in a suitable location [16]. | `CREDITS.md`; in-game credits page; a short credit in the circuit-select screen or loading screen for each real circuit. The committed track files are derivative databases, so they must be offered under ODbL 1.0 (share-alike) with this notice in the track data folder. The game itself is a produced work, which needs attribution only [9]. |
| Copernicus DEM GLO-30 (elevation) | Licence for the use of the Copernicus WorldDEM-30 (free, worldwide, reproduction, distribution and adaptation) [13] | For derived heights (Art. 6(b)): "produced using Copernicus WorldDEM-30 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved". Liability sentence, required in any licence or legal notice covering distribution (Art. 6(c)): "The organisations in charge of the Copernicus programme by law or by delegation do not incur any liability for any use of the Copernicus WorldDEM-30". The credit must not suggest endorsement (Art. 6(d)), and anyone we let redistribute must be bound by the same obligations (Art. 6(e)). | `CREDITS.md` and the in-game credits page (notice); the licence notice in the track data folder (notice and liability sentence) |
| TUMFTM racetrack-database | LGPL-3.0 [4] | not shipped | local cross-check only |
| AWS Terrain Tiles (skadi) | per-source; attribution list in [14] | not shipped | local cross-check only |
| FIA circuit maps, timing documents, operator map | copyright of the publishers | not shipped | used only as reference values (DRS, sector and speed-trap positions, lengths) in docs and tests |

## 4. Per-circuit facts and data quality

Official facts come from the FIA circuit maps [17][18][19], the FIA licence list [6] and the official event pages [20][21][22].

| | Monza | Spa | Singapore |
|---|---|---|---|
| Official lap length | 5.793 km [6][17] | 7.004 km [6][18] | 4.927 km (2025) [6][19][22]; 4.940 km in 2023–2024 [23] |
| OSM centreline length | 5794.1 m (+0.02 %) | 6994.7 m (−0.13 %) | 4966.5 m (+0.80 % against 4.927; +0.54 % against 4.940) |
| TUMFTM length | 5790.2 m (−0.05 %) | 7000.1 m (−0.06 %) | not available |
| Corners (official numbering) | 11 | 19 | 19 |
| Direction | clockwise | clockwise | anticlockwise |
| FIA reference width | 10 m | 10 m | 9 m |
| Sector lines | S1 233 m before T4; S2 215 m before T8 | S1 145 m before T5; S2 48 m before T15 | S1 150 m before T7; S2 140 m before T14 |
| Speed trap | 212 m before T1 | 30 m after T4 | 150 m before T1 |
| DRS zones (detection → activation) | (1) 95 m before T7 → 170 m after T7; (2) 20 m after T11 → 12 m after the finish line | (1) 240 m before T2 → 305 m after T4; (2) 160 m before T18 → 30 m after T19 | (1) T4 → 48 m after T5; (2) 102 m before T13 → 78 m after T13; (3) same detection → 100 m after T14; (4) 105 m after T17 apex → exit T19 |
| Pit entry / exit (OSM junctions) | entry s = 5236 m, exit s = 184 m | entry s = 6647 m (final chicane), exit s = 434 m | entry s = 4488 m, exit s = 385 m |
| Elevation range, filtered DEM | 12.9 m | 102.2 m | 5.7 m |
| Main data-quality issues | Covered section under the old banking (removed by the opening filter); sparse nodes on straights (fine for geometry) | No widths or kerbs in OSM; DEM 9–14 m low on Raidillon and early Kemmel against the operator labels | Members are public-road centrelines, so the racing line through corners is approximate and the lap comes out 0.8 % long. Widths only via `lanes`; barriers and grandstands temporary and unmapped; bridges need re-inserting into the elevation; layout re-measured to 4.927 km in 2025 |

Singapore's extra 0.8 % comes from following road centrelines, including lane-centre geometry on multi-lane roads, rather than the middle of the racing surface. It is within the 1 % limit. The pipeline scales s to the official length and records the factor.

Verdict: all three circuits have data good enough for a believable track. No replacement is recommended.

## 5. Pipeline

From raw fetch to the committed track file. The scripts named exist in `tools/research/` and use only the standard library.

1. **Fetch the layout.** `python3 tools/research/osm_circuit.py <monza|spa|singapore>`. It caches raw Overpass JSON in `~/.cache/undercut/osm/` (40–80 kB per layout, 70–250 kB per census) and writes `<circuit>_centreline.csv` (lat, lon, s), `<circuit>_segments.csv` (named ways with s ranges) and `<circuit>_census.json`. Raw JSON stays out of the repo; the script refetches it.
2. **Check the loop.** Closed with a 0 m gap, no leftover chains, heading from the start node toward T1, length within 1 % of the official length (section 4). Fail the build otherwise.
3. **Project to metres.** Use a local transverse-Mercator or ENU frame centred on the circuit. Store the origin lat/lon in the track file.
4. **Smooth and resample.** Fit a periodic smoothing spline (or centripetal Catmull-Rom on decimated nodes) and resample every 2 m. Keep the length change below 0.2 % and curvature continuous; peaks in |κ| must match the official corner count and order. Assign corner numbers to curvature peaks in order, using the segment names as anchors.
5. **Scale to the official length.** Scale s (not x/y) so the lap equals the official length; record the scale factor (must be within 1 %).
6. **Elevation.**
   - Fetch the tile: `python3 tools/research/dem_profile.py fetch <lat> <lon>`. Tiles are 25–45 MB in `~/.cache/undercut/dem/` and are never committed.
   - Sample with `dem_profile.py profile <centreline.csv> <tile> --step 2 [--open 300] --out ...`.
   - Apply the circuit filter from section 2.3, re-insert Singapore's bridges, fit a smoothing spline and derive grade and vertical curvature.
   - Test the range against the published figure.
7. **Width.** Author left/right half-widths per s: FIA reference width as the floor, widening at corner exits and pit exits from the FIA maps and the OSM run-off polygons, and the TUMFTM profile as a local reference for Monza and Spa. Singapore uses OSM `lanes` as above.
8. **Camber and banking.** Not in any open dataset. Author per corner (**estimate**, typically 0–3 % crossfall, more where known) and keep it in a separate table so it can be revised.
9. **Kerbs, run-off, barriers, pit lane.**
   - Kerbs: author from the corner list (inside apex and exit kerbs).
   - Run-off: from OSM gravel/sand polygons within 40 m, else asphalt.
   - Barriers: offsets from OSM walls, fences and guard rails within 40 m, else authored.
   - Pit lane: from the OSM pit way, with entry and exit blends at the junctions in section 1.1.
10. **Timing and rules metadata.** Sector lines, speed trap, DRS detection and activation points, start line and grid slots, as offsets from corners (section 4) converted to s.
11. **Write the committed track file**, for example `tracks/<circuit>.json` with arrays s, x, y, z, half-width left/right, camber, surface ids, plus metadata (sources, OSM relation id and fetch timestamp, DEM tile names and filter, scale factor). Put a `LICENSE-DATA.md` beside the files with the ODbL and Copernicus notices from section 3. At 2 m spacing a circuit is roughly 3000–3500 samples, so the files are well under 1 MB and can be committed.
12. **Validate in CI.** Closure, monotonic s, length within 1 %, elevation range within tolerance, curvature bounds, corner count, all metadata points inside the lap.

Nothing third-party was committed in this research slice. All raw data is fetched by the scripts.

### 5.1 As built for Monza (M1)

`tools/track-pipeline/` implements steps 1 to 11; step 12 runs in CI as `packages/track/validation/monza.test.ts`. Rebuild and compare with `npm run track:build -- monza --offline --check`.

- **Loop and frame.** Closed, no leftover ways, start heading 6.5°. Origin 45.6216° N, 9.2888° E (centre of the loop), heights relative to 178 m above EGM2008. Measured in the ellipsoidal local frame the OSM loop is 5797.9 m; the 5794.1 m in section 4 is the spherical great-circle sum.
- **Smoothing.** Nodes densified to 0.5 m, Gaussian sigma 4 m, resampled to 2896 samples. Length change −0.067 %, scale factor 0.99982 to the official 5793 m.
- **Corners.** The curvature rule (8 m smoothing, enter at 1/400 m, leave at 1/800 m, merge same-direction stretches less than 150 m apart, drop turns under 20°) finds the 11 official corners in order and nothing else; the Serraglio kink and the main-straight kink stay below it. The corner position used for timing offsets is its curvature apex.
- **Elevation.** 300 m opening, 90 m average, then a 20 m Gaussian for a continuous grade: 178.8 to 191.7 m, range 12.8 m (published 12.8 m).
- **Run-off and barriers.** OSM gravel and sand polygons within 45 m of the kerb give gravel along 1768 m of the lap on the left and 340 m on the right. OSM walls, fences and guard rails are used where mapped within 45 m (mostly the main straight, the back straight and the Serraglio); elsewhere barriers are placed by rule and typed from the authored table.
- **Kerbs.** Three authored profiles (flat, exit, chicane with a sausage). Each ramps in and out along the lap over an authored taper (3 m, 3 m and 4 m), so the ground has no step at a kerb end (track file format version 2).
- **Pit lane.** OSM way 38168747: entry at s = 5235.7 m, exit at s = 184.0 m, 741.5 m long, about 18 m right of the main straight.
- **Names.** Corners are named by place. Two corners are commonly called after people; the file uses the older place names instead: Vialone for turns 8 to 10, Parabolica for turn 11.
- **Licence.** `ODbL-1.0` was added to `tools/assets/licences.json` for track databases, as section 3 requires; the notices are in `packages/track/data/LICENSE-DATA.md` and `CREDITS.md`.

- **Format 3 (M4).** Rebuilt with the timing line and environment metadata (section 5.4). Geometry and every other field are byte-identical to the format 2 file except DRS zone 2's activation, which moved from s = 12 m to s = 5484.5 m (section 5.5).

### 5.2 As built for Spa-Francorchamps (M4)

`tools/track-pipeline/circuits/spa.json`; validation `packages/track/validation/spa.test.ts`; evidence `docs/evidence/m4-tracks/spa-*.png`. Rebuild and compare with `npm run track:build -- spa --offline --check`.

- **Loop and frame.** OSM relation 284560, closed, no leftover ways, start heading 330°. Origin 50.4370° N, 5.9686° E, heights relative to 364 m above EGM2008. Ellipsoidal OSM length 7004.0 m; smoothing (Gaussian sigma 6 m) changes it by −0.174 %; scale factor 1.001747 to the official 7004 m; 3502 samples.
- **Corners.** The default curvature rule finds 16 of the 19 official corners: it drops the Eau Rouge left (turn 2, 17° of turn) and merges Pouhon (turns 10 and 11) and Campus with Stavelot (turns 14 and 15). The circuit's rule (enter 1/300 m, leave 1/600 m, merge gap 30 m, minimum 15°) finds exactly the 19 in order; the file records it in `source.cornerRule` and the validation repeats it. Names by place: La Source, Eau Rouge, Raidillon (3, 4), Les Combes (5, 6), Malmedy, Bruxelles, Speaker's Corner, Pouhon (10, 11), Les Fagnes (12, 13), Campus, Stavelot (15, instead of the person's name it is often given), Blanchimont (16, 17), Bus Stop (18, 19).
- **Elevation.** 90 m average and 20 m Gaussian, no opening, as section 2.2 recommends, so Raidillon is not softened further, and three targeted corrections (`elevation.corrections`, recorded in `source.dem.corrections`), each replacing the filtered profile over a span with a cubic that matches height and grade at both ends, where the surface model disagrees with the circuit operator's altitude labels [7]:
  - **Kemmel, s 1325 to 2150 m**: a narrow bump of about 6 m at s 1400 to 1450 m followed by a flat (probably a structure or canopy over the track) and a smaller wiggle near s 2000 m put crests of about −1.5 g and −0.6 g at 300 km/h on the straight (review of PR #18: −0.87 g with an earlier filter, unloading a medium-trim car from about 23.9 kN to 14.2 kN of tyre load).
  - **Descent to Pouhon, s 3400 to 3640 m**: a 100 m ledge at about −4 % followed by −9.6 % (−0.70 g at 300 km/h), where the labels give a steady −7.3 % (438 m at 3110 m, 402 m at 3600 m). After the correction: 438.1 m and 404.0 m.
  - **After Blanchimont, s 5900 to 6600 m**: the climb to the Bus Stop squeezed into a 10 % step of 15 m over s 6050 to 6200 m with a dip after it (+1.33 g at s 6070, −1.20 g at s 6190 to 6205, +0.75 g at s 6295 at 300 km/h; review of PR #18). The stretch is lined with forest, and the labels give a steady 2 to 3 % (388 m at 5700 m, 398 m at 6000 m, 408 m at 6540 m, 418 m at the line). After the correction the span is within ±0.27 g; heights 391.6 m at 6000 m and 405.1 m at 6540 m (the surface model runs 2 to 7 m under the labels here, as section 2.2 found elsewhere on the lap).

  Results against the published figures:

| Quantity | Built | Published | Residual |
|---|---|---|---|
| Range | 102.1 m (364.7 m at s 5060, 466.7 m at s 2532) | 102.2 m [8] | −0.1 m |
| Lowest / highest point | turn 15 (Stavelot) / turn 7 (Malmedy) | turn 15 / turn 7 [8] | within 10 m of the apexes |
| Bottom of Eau Rouge to the top of Les Combes | +79.2 m | +79 m [7] | +0.2 m |
| Bottom of Eau Rouge to the top of the climb (s ≈ 1490 m) | +39.5 m | about 40 m [15]; +55 m from the operator's labels [7] | −0.5 m / −15.5 m |
| Steepest grade | 13.1 % on Raidillon (s ≈ 1054 m) | 17 % [15] | −3.9 points: the 30 m grid and the 90 m average soften it |
| Vertical acceleration at 300 km/h | +1.15 g at the bottom of Eau Rouge (s 968 m); −0.65 g over the top of Raidillon (s 1160 m); −0.03 to +0.18 g along Kemmel | — | `spa-vertical.png` |

Every straight stays within 0.5 g at 300 km/h outside Eau Rouge and Raidillon. "Straight" here means outside every corner's curvature region and 150 m either side of its apex, so the corrected spans are also checked whole, through any corner inside them: Kemmel and the climb after Blanchimont (through turn 17) each stay under 0.3 g (`packages/track/validation/spa.test.ts`). The largest undulations left: −0.42 g on the main straight before the line (s ≈ 6898 m), +0.35 g on the run down to Les Fagnes (s ≈ 4164 m) and −0.32 g just after the line (s ≈ 18 m).

- **Widths, banking, kerbs.** Half-widths from authored keys: 7.5 m on the start straight, up to 9 m and 8.5 m through La Source, 5.0–5.5 m round the lap, 6 m at the Bus Stop (FIA reference width 10 m as the floor; the TUMFTM profile, used only locally, was scaled by about 1.1 as at Monza). Banking: 1–2.5° into the turn at La Source, Eau Rouge, Raidillon, Bruxelles, Pouhon, Stavelot and Blanchimont. Kerbs: Monza's three profiles; sausage kerbs at the Bus Stop.
- **Run-off and barriers.** OSM gravel along 1218 m (left) and 854 m (right). OSM walls, fences and guard rails are used where mapped within 45 m; fences are read as guard rails (they are the debris fences on them), and type changes shorter than 20 m are merged. Totals: concrete 3118 m / 4954 m, Armco 3030 m / 1538 m, tyres 856 m / 512 m (left / right). Every barrier is kept inside the frame limit the runtime computes (`clampToFrame`), which moved the pit-side barrier at the Bus Stop by up to 0.25 m.
- **Pit lane.** OSM way 323851541, on the right: entry at s = 6657.0 m inside the Bus Stop, exit at s = 433.0 m on the descent from La Source after looping inside the hairpin; 717.2 m long (OSM 720.5 m). The brief's "exit before the first hairpin's braking zone" does not match the mapped way, which rejoins after La Source; the mapped way was kept.
- **Grid.** 20 slots, pole 5 m behind the start line on the right (the 2025 pit-lane drawing marks pole on the right-hand side), 8 m apart; pole to the La Source apex 279 m (published 165 m to the braking point).
- **Pit-lane ground.** Inside La Source the pit lane crosses the line midway between the start straight and the descent, where the lap's ground switches from one leg's cross-section to the other's; it stepped 1.17 m there (found by the ground-continuity walk). `packages/track` now gives the pit lane its own ground: the lap's ground under the pit centreline, smoothed along the pit lane (Gaussian sigma 15 m), fading in over 2 m from the lap's track edge and back out over 2 m beyond the pit lane's edges (`PIT_GROUND_SIGMA`, `PIT_GROUND_BAND`). The sampler, the poses and the pit mesh use it. The track files are unchanged by this.
- **Kemmel, measured in the sim.** Medium trim, 50 kg of fuel, 297 km/h along Kemmel: minimum total tyre load 15.5 kN at s 1434 m with the reviewed profile, 24.6 kN with the correction (mean over Kemmel 25.5 kN in both).

### 5.3 As built for Singapore Marina Bay (M4)

`tools/track-pipeline/circuits/singapore.json`; validation `packages/track/validation/singapore.test.ts`; evidence `docs/evidence/m4-tracks/singapore-*.png`. Rebuild and compare with `npm run track:build -- singapore --offline --check`.

- **Loop and frame.** OSM relation 421263 (public-road members plus raceway sections), closed, start heading 352°. Origin 1.2907° N, 103.8580° E, heights relative to 3 m above EGM2008.
- **Junctions.** Road centrelines meet at sharp vertices (after smoothing alone, radii under 5 m at turns 8 and 14). The pipeline now rounds each vertex turning more than 10° with a 12 m arc before smoothing (`geometry.filletRadius`, estimate), capped at half the distance to the next such vertex. With Gaussian sigma 6 m, the loop shortens by 1.10 % (OSM 4954.7 m to 4900.3 m; the allowance is 1.5 % for this circuit) and the scale factor to the official 4927 m is 1.005457. Tightest radius: turn 13 hairpin, about 8.3 m, where OSM turns 138° within 13 m; the inside half-width there is held at 4.5 m (estimate).
- **Corners.** The 2025 FIA map numbers 19 corners; the default rule merges the turn 4 kink into the turn 3 hairpin and the three final lefts. The circuit's rule (enter 1/300 m, leave 1/600 m, merge gap 20 m) finds exactly the 19 in order: L R L L R R L R L L R L L R L R L L L. Names by the road beside each corner (the nearest named road in OpenStreetMap), avoiding names used as personal names for corners: Republic Boulevard (1–4), Raffles Boulevard (5, 6), Nicoll Highway, Stamford Road, Saint Andrew's Road, Connaught Drive (10, 11), Fullerton Road, Esplanade Drive, Esplanade, Raffles Avenue (15, 16), Marina Promenade (17–19).
- **Elevation.** 400 m opening, 90 m average, 20 m Gaussian, then the bridges. Section 2.3 recommended 300 m; with it a 9 m plateau remains on Raffles Avenue (s 3850 to 4100 m, tree canopy along the avenue by its shape) and a 5 % drop into turn 16. With 400 m the range is 3.9 m (3.1 m at s 1556, 7.0 m at the Esplanade Drive bridge crown) against the published 5.3 ± 1.5 m, which was measured on the pre-2023 layout; steepest grade 3.2 %. Bridges: OSM ways 29377119 (Fullerton Road, s 2775 to 2846 m) and 35037538 (Esplanade Drive, s 2938 to 3228 m) are put back as decks straight between their abutment heights with parabolic crowns of 1.0 m and 1.5 m (estimates); the grade smoothing leaves about 0.26 m of the short Fullerton Road crown.
- **Widths.** From the OSM `lanes` tag of the road under each point, 3.2 m a lane, clipped to 9.5–15 m, 12 m on raceway sections without the tag, smoothed over 25 m (`widths.lanes`); the turn 13 override above.
- **Walls and escape roads.** Concrete walls 1.5 m beyond the kerb or white line on both sides (OSM walls and fences here belong to the city and are not used); escape roads with tyre walls at turns 1, 7, 8, 10, 13, 14 and 16 (estimates; turns 8 and 14 face each other 40 m apart, so their offsets are 12 m and 18 m). Concrete runs along 4721 m (left) and 4535 m (right) of the lap. Run-off nearest the track is road surface (asphalt) everywhere. No banking.
- **Pit lane.** OSM way 100484287, on the left (the inside of the final lefts): entry at s = 4448.1 m between turns 17 and 18, exit at s = 383.4 m at turn 2; 819.7 m long (OSM 822.2 m). 80 km/h from 2025.
- **Grid.** Pole 5 m behind the start line on the right (as marked on the 2025 pit-lane drawing); pole to the turn 1 apex 301 m (published 178 m to the braking point).
- **Night.** `environment.lighting` is `floodlit`. No floodlight mast is mapped (one Overpass query for masts, towers and lamps in the circuit's box found one tower and no lamps), so the masts are a rule: one every 40 m along each side, the sides staggered by 20 m, 1 m behind the wall, 10 m tall (estimates).

### 5.4 Timing lines and environment (track format 3)

Lap and sector times are measured from the timing (control) line, which the circuit maps draw apart from the start line (s = 0, the OpenStreetMap start node). Format 3 carries it as `timingLine: { s, uncertainty, source }`; the game still times laps from s = 0. Each position was measured by fitting the map's drawn track to the committed centreline with a similarity transform (`tools/research/map_fit.py`) and projecting the map's control-line tick; the other ticks under the same fit give the uncertainty.

| Circuit | Timing line | Before the start line | Fit (median miss) | Other ticks against their stored positions | Uncertainty |
|---|---|---|---|---|---|
| Monza | s = 5472.5 m | 320.5 m | 3.4 m | S1 −8.0, S2 −6.6, trap +12.6 m (physics-validation 7.6) | ±13 m |
| Spa | s = 6875.4 m | 128.6 m | 4.7 m | trap +2, S2 +5, S1 −15 m (the S1 centroid is pulled off the track by its label) | ±15 m |
| Singapore | s = 4798.4 m | 128.6 m | 2.7 m | trap −8.3, S1 +0.8, S2 −9.0 m | ±10 m |

Two sector lines are anchored on the start of their corner rather than its apex, because the map's tick shows the source measures from there: Spa sector 2 (48 m before turn 15, Stavelot, a 150 m corner: 5 m from the start-based position, 67 m from the apex-based one) and Singapore sector 1 (150 m before turn 7: 0.8 m against 25 m).

`environment` holds the circuit's position (the world origin), the world yaw of true north (π/2: north is −Z in the tangent plane at the origin), the lap's mean altitude, a typical race air temperature (estimates: Monza 26 °C, Spa 20 °C, Singapore 30 °C) and the ISA pressure at that altitude (Monza 99.1 kPa at 186 m, Spa 96.5 kPa at 408 m, Singapore 101.3 kPa at 5 m), the time zone and UTC offset, a representative race date, the usual local start times of qualifying and the race (2025 events: 16:00 and 15:00 at Monza and Spa, 21:00 and 20:00 at Singapore), the lighting and the floodlights. Format 2 files are migrated on load: the timing line goes on the start line with an unknown uncertainty, and the environment is null.

### 5.5 Offsets measured from "the line"

Every per-circuit position in section 4 and physics-validation 4.6 was checked for which line it is measured from:

| Position | Source wording | Measured from | Change |
|---|---|---|---|
| Monza DRS 2 activation | 12 m after the finish line | the timing (control) line, which the 2025 map labels the finish | moved from s = 12 m to s = 5484.5 m (±13 m with the timing line); the zone now opens before s = 0 and runs through it to turn 1 |
| Monza grid, pole to turn 1 braking (472 m) | from pole position | the grid, behind the start line | none |
| Spa DRS 2 activation | 30 m after turn 19 | turn 19 | none; the zone runs through s = 0 |
| Singapore DRS 4 activation | exit of turn 19 | turn 19's end | none; the zone runs through s = 0 |
| All sector lines, speed traps, other DRS points | before or after a numbered turn | the turn | none (two anchored on the corner's start, section 5.4) |
| Pit-lane limit lines | not in the sources | authored, in the pit frame | none |

The Monza correction changes the DRS zone the reference driver's speed profile uses; the racing-line artefact was rebuilt with `npm run ai:build`, and the reference lap went from 84.969 s to 84.872 s (docs/physics-validation.md 7.6; 85.539 s to 85.452 s before the lap-band changes).

### 5.6 The folded run-off, and what launches cars at the first chicane

**The fold.** Off the track the ground is the track edge's height at the projected s, falling
away at the drainage slope (`Track.ground`). On the inside of a tight corner the track's (s, d)
frame folds: with m = 1 − κd the stretch of the frame across the lap, a world step across the
fold is a step of 1/m along s, so the centreline's grade g becomes a slope of about g/m, and
where the projection jumps to another stretch of the lap the ground has a step. Measured on a
world grid inside the barriers (ground slope over a 0.35 m probe, kerbs and the pit lane's own
ground excluded):

| Circuit | Worst | Where | Contract (`packages/track/test/runoff-grade.test.ts`) |
|---|---|---|---|
| Monza | 41 % | inside of turn 2, s 645–671, d 9–14 (m 0.1–0.4, grade 2.8 %); 24 % inside turn 1 (s 622, d −9.7) | open (expected failure) |
| Spa | 36 % | grass inside the bend at s 3200–3225, 30–36 m out (m 0.2–0.4, grade −7.3 %) | open (expected failure) |
| Singapore | within the contract | its steep spots are kerb outer drops and the pit lane's blend band at the garage wall (s 4662, d 22–23), other contracts | passes |

The contract: off-track ground that is not a kerb is no steeper than the steepest centreline
grade and bank within 50 m plus the drainage fall plus 5 %.

**What launches the car (corrected).** The first version of this section (PR 41) blamed the
chicane's 13 cm sausage kerbs. Measurements in the next step show the sausage does not decide
the outcome; the grade through the folded run-off does. The PR 19 kerb-safety cases that block
the low-trim downforce increase (docs/physics-validation.md 7.9) were run in the game session
(seed 77123, 15 s from 300 km/h, stability assist off) with one thing changed at a time. Safety
resets for teleport(540, 8) steer −0.1 at TC 0 / steer −0.1 at TC 2 / steer 0 at TC 0, and the
run along the turn 2 inside run-off from (620, 11):

| Variant | Low-trim ClA 3.6 | ClA 3.9 |
|---|---|---|
| As built | 0 / 0 / 0 / 1 | 1 / 1 / 1 / 1 |
| Centreline elevation flattened (no grade) | 0 / 0 / 0 / 0 (floor ≤ 0.45 m) | 0 / 0 / 0 / 0 (floor ≤ 0.48 m) |
| Elevation relief × 0.5 | 0 / 0 / 1 / 0 | 0 / 0 / 1 / 0 |
| Elevation relief × 0.75 | 0 / 0 / 0 / 1 | 1 / 0 / 1 / 1 |
| Sausage top 8 cm (same shape) | 1 / 0 / 0 / 1 | 1 / 1 / 0 / 1 |
| Sausage top 5 cm (a flat kerb) | 1 / 1 / 0 / 1 | 1 / 1 / 0 / 1 |
| Chicane kerb as the FIA's combination kerb (below) | 0 / 1 / 1 / 1 | 1 / 1 / 1 / 1 |
| Tyre vertical damping 3 kN·s/m (from 7) | 1 / 0 / 1 / 1 | 1 / 0 / 1 / 1 |
| Tyre vertical damping 1 kN·s/m | 0 / 0 / 1 / 1 | 0 / 0 / 1 / 1 |

With no grade every run stays on its pose limits at both downforce levels; changing the kerb or
the tyre's damping only reshuffles which runs reset. Inside turn 1 the run-off at d −8.6 rises
0.49 m over 28 m of s, which the fold packs into about 6 m of the world: a 9 % ramp across the
car's path at 300 km/h. Single runs are sensitive to their exact path (a flat-out car crossing
kerbs at 300 km/h bounces 0.25–0.5 m even with no grade), so the table is evidence for the
cause, not a per-case prediction.

**Kerb dimensions.** No published height, profile or spacing was found for the raised element
behind Monza's turn 1 kerbs in 2023–2025: the FIA's 2024 event notes say only "All kerbs have
been replaced with new kerbs" [24]. Documented values elsewhere: the FIA circuit drawing
standard's Type 4 combination kerb, "A smooth profile kerb, 80cm wide, rising to 12cm above
track level, for the apex of all corners. This should be installed behind 5cm Vallelunga or
Bevelled kerb" [25]; the race director in 2021 on current practice, "They are the 50mm ones
that we normally have in a lot of places" [26]. The authored `chicane` profile (13 cm, a 0.3 m
top 1.75–2.05 m out) has no source. Replacing it with the Type 4 element (12 cm, rounded,
1.6–2.4 m out; the documented maximum) left every reference lap and racing line bit-identical
but made two kerb-safety cases that pass with the authored profile reset with master's car
(table above), and a 5 cm top did the same; the authored profile stays, recorded as unsourced.

**The tyre at a kerb strike.** Through the turn 1 strike most of the tyre's vertical force is
its damping term (for example 14.5 kN of 20.2 kN), and loads reach the bottoming ceiling (23.7
kN). That term, 7 kN·s/m, is the documented stand-in for the body's heave damping, carried on
the tyre's deflection rate (physics-validation 1.6), so at a kerb face it acts on how fast the
kerb rises into the tyre. No measured damping coefficient for any racing slick was found in
open sources (only a measured vertical stiffness of 130 kN/m for an F4 slick [27], and an F3
car's tyres taking most of its axle travel [28], against the model's 300 kN/m for an 18-inch
tyre, for which no figure was found); with
no source and no effect on the outcome (table above), it is not changed. Past the bottoming
depth `liftOutOfGround` lifts the whole car, body and wheels, inelastically; a rim strike would
move that wheel into its suspension first. Recorded, not changed: the table shows the strike's
details do not decide these cases.

**Tried and not kept.** Two world-space treatments of the folded ground: a base blended to the
centreline height averaged over world distance (gated by m), and the ground itself smoothed in
the world with a width growing as the frame folds. Both left the contract failing (Monza 20–34 %,
Spa 29–44 %, from the blend itself where m changes quickly along s), and neither changed the
three cases or the turn 2 run at ClA 3.9. The turn 2 pocket is enclosed by the track before and
after the chicane, 26 m apart along s (0.73 m in height) and 6–8 m apart in the world, so any
ground joining them climbs about 10 % there. The elevation is the Copernicus profile opened over
300 m and averaged over 90 m (section 2.3), whose relative accuracy is about 2 m [12]; the 0.7 m
rise across this 26 m of lap is below what it resolves. The next step is the elevation through
the chicane (or a ground that interpolates between the bounding track edges), with every passing
check re-run.

### 5.7 Filling the folded run-off: the first version

The first version of the fill (commit 0f42f90), measured before the changes of section 5.8.
Wherever a bend folds before its barrier (the frame's stretch at the barrier, 1 − κd, below
0.6), the run-off inside it, from the track edge to the barrier, is
solved on a 0.5 m grid when the track is built: the least-squares plane through the fixed heights
around the zone (the track edges, the unfolded run-off where the zone ends) plus the smoothest
(harmonic) departure from it, barriers as free edges, and the ground normal from the world
gradient. A plain harmonic fill does not work: on a bend with a steady grade the unfolded ground
already rises with the angle round the bend's centre, which is harmonic, so Laplace's equation
reproduces the fold. Outside those zones the ground is unchanged. Results, master → fill:

| Measure | Master | Fill |
|---|---|---|
| Run-off contract, Monza worst | 40.8 % (turn 2 inside), 20.6 % (turn 1 inside) | 20.4 %, 10.2 %; 31 cells over (100) |
| Run-off contract, Spa worst | 36.1 % (near s 3210) | 40.4 % near s 3219; 1100 cells over (1156) |
| Run-off contract, Singapore | passes | passes |
| Game kerb-review cases (ClA 3.6) | 11 pass | 27 pass: 18 open ones pass, but teleport(5600, 0) at TC 0 and 2 reset |
| Sim kerb-review cases | 2 pass | 11 pass: 10 open ones pass, but seed 97513 fails (wheel centre 1.005 m against 1.004) |
| Blocking runs at ClA 3.6: (540, 8) steer −0.1 TC 0 / TC 2 / steer 0; turn 2 run | 0 / 0 / 0 / 1 resets | 0 / 0 / 0 / 0 |
| The same at ClA 3.9 | 1 / 1 / 1 / 1 | 1 / 1 / 0 / 0 |
| Reference laps | 84.872 / 109.072 / 91.817 s | 84.864 / 109.066 / 91.820 s (two racing lines change) |
| Track build | 89 / 56 / 31 ms | 293 / 251 / 52 ms |

**Why it is not enough.** The pockets inside the chicane's turns are bounded by stretches of
track 20–30 m apart along the lap but 4–8 m apart in the world: inside turn 2 the ground has to
climb from about 0.2 m to 0.7 m across 4 m, inside turn 1 similarly, so any ground that meets the
track edges there is 10–15 % steep, and a car crossing it at 300 km/h can still be thrown. The
three regressed cases and the two remaining 3.9 cases are launched there; they passed on master
because its folded ground happened to slope away from their paths. The grade itself is the
Copernicus profile opened over 300 m and averaged over 90 m (section 2.3), about 3 % through the
chicane; it is a trend at the scale the source resolves, so changing it would be editing below
that resolution. With that elevation, a correct run-off and the kerb-review cases' zero-reset
assertions conflict at the chicane: the fill fixes 28 open cases and the turn 2 run for three
cases that pass now, which is a decision for the owner, not a tolerance this work may move.

The owner chose not to trade: no passing check may regress. Section 5.8 is the model that
meets that rule.

### 5.8 The folded run-off, filled

`Track.ground` now fills the run-off where the (s, d) frame folds (`packages/track/src/fold-ground.ts`;
section 5.7 records the first version). The model:

- **Where.** Beside a lap sample whose bend folds before its barrier (the frame's stretch at the
  barrier, 1 − κd, below 0.6) and whose own edge is compressed by it (the stretch at the kerb's
  outer edge below 0.8): a pocket the bend wraps around, such as Monza's first chicane, Spa's La
  Source and Bus Stop or Singapore's turns 1–3. A wide run-off inside a gentle bend (Ascari, Spa
  near s 3210), where the fold lies far out, keeps its ground. The kerb and 1 m beyond it keep
  their ground exactly (a kerb is laid along the track edge and follows it): no grid node within
  a cell's diagonal of that strip is filled, so no query in it reads one. The fill grows in over
  the next metre.
- **What.** On a 0.5 m grid built with the track: the least-squares plane through the fixed
  ground around each zone (the track and kerbs, the unfolded run-off) plus the smoothest
  (harmonic) departure from it, barriers as free edges with ghost values behind them, blended in
  by a weight that grows with how far the bend folds. Laplace's equation alone reproduces the
  fold (on a bend with a steady grade the edge height rises with the angle round the bend's
  centre, which is harmonic). Normals come from the world gradient.
- **The steepness rule, on the final ground.** A query reads H = O + W (F − O), with O the
  original ground and W, F the bilinear weight and solved height, so
  ∇H = ∇O + W (∇F − ∇O) + (F − O) ∇W. When the track is built, H is checked at points an eighth
  of a cell (6.25 cm) apart in every cell the fill reaches, with O and ∇O read there exactly as
  a query reads them: H may be no steeper than O, or than the run-off contract's bound there
  (5.6) less 1 %, whichever is higher. The 1 % covers the original's slope changing between the
  check points (it is piecewise along the lap). The weights are first scaled down until every
  point holds, then grown back towards their targets in steps, each kept only if every point
  around the node still holds.
- **The pit lane** is its own surface, built from the original ground under it before the fill;
  its blend band joins the two.

`packages/track/test/runoff-grade.test.ts` checks the rule on every probe of the contract
(0.35 m, a contact patch) against the same circuit built without the fill (`fillFolds: false`): every
probe that met the contract without the fill still meets it, and no probe is steeper with the
fill than without it unless still within the contract. It also checks the two patches the review
of the first version of this section found directly: Monza s 649, d 11.5 (7.07 % became 15.39 %
against 10.10 %) and Spa s 6679, d 13.5 (6.77 % became 17.74 % against 10.13 %). That version
broke the contract at 22 probes at Monza and 15 at Spa that met it before, and fails all six
checks; this one breaks none.

Results against master and against that first version:

| Measure | Master | Filled | First version |
|---|---|---|---|
| Run-off contract, Monza worst | 40.8 % turn 2 inside, 20.6 % turn 1 inside (100 cells over) | 36.9 %, 20.6 % (78 cells over); still open | 17.9 %, 11.3 % (41) |
| Run-off contract, Spa worst | 36.1 % near s 3210 (1156 cells over) | 36.1 %, unchanged there (1124 cells over); still open | 36.1 % (1102) |
| Run-off contract, Singapore | passes | passes | passes |
| Probes that met the contract and no longer do (Monza / Spa / Singapore) | – | 0 / 0 / 0 | 22 / 15 / 0 |
| Game kerb-review cases passing (40) | 11 | 12, none lost | 19 |
| Sim kerb-review cases passing (18) | 1 | 1 | 1 |
| Blocking runs at ClA 3.6: (540, 8) steer −0.1 TC 0 / TC 2 / steer 0; turn 2 run | 0 / 0 / 0 / 1 resets | 0 / 0 / 0 / 1 | 0 / 0 / 0 / 1 |
| The same at ClA 3.9 | 1 / 1 / 1 / 1 | 1 / 1 / 0 / 1 | 1 / 1 / 0 / 1 |
| Reference laps, s | 84.87247777781505 / 109.07156183055628 / 91.81685967115246 | identical, bit for bit, traps too | Singapore 91.81685832063064 (1.35 µs faster, trap 2·10⁻⁵ km/h lower; 44092 ticks both); the others identical |
| Track build (best of five, warm) | 29 / 40 / 26 ms | 50 / 52 / 50 ms | 44 / 47 / 42 ms |
| First build in a process (cold) | 101 / 49 / 28 ms | 174 / 64 / 55 ms | 123 / 92 / 58 ms |

With the fill built before the pit lane's ground, Singapore's lap differed (91.81685811829566 s
with this fill, 91.81685832063064 s with the first version): the pit lane's own ground was then
built from the filled ground under it (s 4566–4582), and the pit lane's blend band carries it to
the track edge. The car itself never reads filled ground on that lap. Building the pit lane's
ground first restores the lap bit for bit.

The build runs on the main thread when the game loads a track (`apps/web/src/drive.ts`, and the
online flow). At 12–24 ms more when warm (up to 73 ms on a first build) it is not worth caching
in the track build output yet; if the zones grow, the solved grid and weights can be written by
the track pipeline and read back instead.

**What the rule costs.** Seven of the eight game cases the first version recovered
(teleport(0, ±8), (300, 8) steer 0, (540, 8) steer 0.1 at TC 0, (650, 8) steer 0.1 at TC 0
and 2, (5600, −8)) reset again; teleport(610, 8) steer −0.1 at TC 0 still passes. They passed
on ground the rule forbids: inside the chicane's pockets the climb between track edges 20–30 m
apart along the lap and 4–8 m apart in the world (5.7) is spread across ground that was 5–9 %
steep, which makes it 12–18 % against the contract's 10.1 %. Letting ground already over the
contract get steeper as well (the other half of the rule; tried at a 0.5 m margin) brings none
of them back: 11 pass, and teleport(540, 8) steer 0, which passes on master, resets. With that elevation the pockets
cannot meet the contract everywhere, so at the chicane the contract and those seven cases
conflict; the fill keeps the contract.

**The margin.** With no margin beyond the kerb, the first version passed 27 game and 7 sim
cases, but the disciplined keyboard driver's recorded drivability gap moved from 4 incidents to
6 (barrier strikes past the Lesmo exits after its path changes through the chicane), so it used
0.5 m. With this version's rule, 0.5 m lets that driver brush the fill's edge inside turn 2 on
its second lap in two of its five seeds (s 655–656, d 8.5–8.6, weight at most 0.0003: under a
micrometre of height and a small change of the ground's normal), and both laps go on to strike
the barriers past the Lesmos: 8 incidents. At 0.75 m it still does; at 1 m its ten laps are the
same as on master, to the millisecond, so the margin is 1 m. That run is chaotic at this scale:
it shows the fill's edge is within reach of the driven line there, not that the ground is wrong.
The first version (5.7) also raised Spa's worst slope: a plane fill across the wide run-off
inside the bend near s 3210 is steeper near the barrier than the original ground; that run-off
is not filled.

Two of the three cases that block the low-trim downforce change still reset at ClA 3.9; the
retry was not attempted.

## 6. Sources

All URLs were opened while doing this work (2026-11-21).

1. Overpass API, public instance (queries run by `tools/research/osm_circuit.py`). https://overpass-api.de/api/interpreter
2. OpenStreetMap relations queried: https://www.openstreetmap.org/relation/284565, https://www.openstreetmap.org/relation/284560, https://www.openstreetmap.org/relation/421263 (fetched through [1]).
3. TUMFTM racetrack-database, repository and README. https://github.com/TUMFTM/racetrack-database
4. TUMFTM racetrack-database, LICENSE (LGPL-3.0). https://raw.githubusercontent.com/TUMFTM/racetrack-database/master/LICENSE
5. TUMFTM racetrack-database, track list and files. https://api.github.com/repos/TUMFTM/racetrack-database/contents/tracks, https://raw.githubusercontent.com/TUMFTM/racetrack-database/master/tracks/Monza.csv, https://raw.githubusercontent.com/TUMFTM/racetrack-database/master/tracks/Spa.csv
6. FIA, List of FIA Licensed Circuits, updated 2025-10-02 (lap distance, direction, reference width). https://www.fia.com/sites/default/files/circuits_fia20251002.pdf
7. Circuit de Spa-Francorchamps, full-track map with distance and altitude labels. https://ser2026.racspa.be/docs/CircuitdeSpa-Francorchamps-Fulltrack.pdf
8. Formula 1, "Highs and lows - which F1 track has the most elevation changes?" (2016). https://www.formula1.com/en/latest/article/highs-and-lows-which-f1-track-has-the-most-elevation-changes-.7I9JEcBw3R2AqXbnJ6hyvc
9. OpenStreetMap, Copyright and License. https://www.openstreetmap.org/copyright
10. Registry of Open Data on AWS, Copernicus Digital Elevation Model (DEM). https://registry.opendata.aws/copernicus-dem/
11. Copernicus DEM on AWS, readme. https://copernicus-dem-30m.s3.amazonaws.com/readme.html; tiles fetched: https://copernicus-dem-30m.s3.amazonaws.com/Copernicus_DSM_COG_10_N50_00_E005_00_DEM/Copernicus_DSM_COG_10_N50_00_E005_00_DEM.tif, https://copernicus-dem-30m.s3.amazonaws.com/Copernicus_DSM_COG_10_N45_00_E009_00_DEM/Copernicus_DSM_COG_10_N45_00_E009_00_DEM.tif, https://copernicus-dem-30m.s3.amazonaws.com/Copernicus_DSM_COG_10_N01_00_E103_00_DEM/Copernicus_DSM_COG_10_N01_00_E103_00_DEM.tif
12. Copernicus Data Space Ecosystem, COP-DEM collection description (DSM, EGM2008, accuracy, user obligations). https://dataspace.copernicus.eu/explore-data/data-collections/copernicus-contributing-missions/collections-description/COP-DEM
13. Copernicus Contributing Mission data access and COP-DEM licences, including "Licence for the use of the Copernicus WorldDEM-30" (GLO-30 Full, Free & Open). https://dataspace.copernicus.eu/sites/default/files/media/files/2025-06/copernicus_contributing_mission_data_access_v2_cop_dem_licenses.pdf
14. Tilezen joerd, terrain tiles attribution. https://raw.githubusercontent.com/tilezen/joerd/master/docs/attribution.md; tile fetched: https://s3.amazonaws.com/elevation-tiles-prod/skadi/N50/N50E005.hgt.gz
15. Ferrari, Spa-Francorchamps circuit page (Raidillon 17 % gradient, 40 m). https://ferrari.com/hypercar/spa-francorchamps
16. OSM Foundation, Licence/Attribution Guidelines (computer games and simulations). https://osmfoundation.org/wiki/Licence/Attribution_Guidelines
17. FIA, 2025 Monza event, Circuit Map. https://www.fia.com/system/files/decision-document/2025_monza_event_-_circuit_map_-_monza_2025.pdf
18. FIA, 2025 Belgian Grand Prix, Event Notes: circuit map, pit lane, emergency exits, quarantine zone and red zones. https://www.fia.com/system/files/decision-document/2025_belgian_grand_prix_-_event_notes_-_circuit_map_pit_lane_emergency_exits_quarantine_zone_and_red_zones.pdf
19. FIA, 2025 Singapore Grand Prix, Event Notes: circuit map, pit lane, emergency exits map and quarantine zone. https://www.fia.com/system/files/decision-document/2025_singapore_grand_prix_-_event_notes_-_circuit_map_pit_lane_emergency_exits_map_and_quarantine_zone.pdf
20. Formula 1, Italian Grand Prix 2025 event page. https://www.formula1.com/en/racing/2025/italy
21. Formula 1, Belgian Grand Prix 2025 event page. https://www.formula1.com/en/racing/2025/belgium
22. Formula 1, Singapore Grand Prix 2025 event page. https://www.formula1.com/en/racing/2025/singapore
23. FIA, 2024 Singapore Grand Prix, Event Notes: circuit map, pit lane drawing and red zones. https://www.fia.com/sites/default/files/decision-document/2024%20Singapore%20Grand%20Prix%20-%20Event%20Notes%20-%20Circuit%20Map,%20Pit%20Lane%20Drawing%20and%20Red%20Zones.pdf
24. FIA, 2024 Italian Grand Prix, Race Director's Event Notes V3 (2024-08-31), section 25. https://fia.com/sites/default/files/decision-document/2024%20Italian%20Grand%20Prix%20-%20Race%20Director's%20Event%20Notes%20V3.pdf
25. FIA, "List of Requirements for the Circuit Drawing", circuit drawing standard release 3.2 (2012-12-18), kerb types. https://www.fia.com/sites/default/files/regulation/file/List%20of%20Requirements%20for%20the%20Circuit%20Drawing%20-%20published%20on%2018.12.2012_0.pdf
26. Motorsport.com, J. Noble, "Why the FIA rejected calls to ditch Paul Ricard sausage kerbs" (2021-06-22). https://www.motorsport.com/f1/news/why-the-fia-rejected-calls-to-ditch-paul-ricard-sausage-kerbs/6596554/
27. C. Benini, M. Gadola, D. Chindamo et al., "The influence of suspension components friction on race car vertical dynamics", Vehicle System Dynamics 55(3) (2017): F4 car, "a 130 N/mm tyre vertical stiffness in running conditions". https://sites.usp.br/ldsv/wp-content/uploads/sites/1453/2024/08/The-influence-of-suspension-components-friction-on-race-car-vertical-dynamics_17.pdf
28. Marchesin et al., "High downforce race car vertical dynamics: aerodynamic index", Vehicle System Dynamics (2017): F3 car, tyre deflection 15 of 22 mm front and 18 of 36 mm rear in a 0–230 km/h sweep. https://sites.usp.br/ldsv/wp-content/uploads/sites/1453/2024/08/High-downforce-race-car-vertical-dynamics-aerodynamic-index_17.pdf
