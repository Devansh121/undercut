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
