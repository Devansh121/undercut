# Research scripts

Exploratory scripts behind `docs/track-data.md`. Python 3.10+, standard library only. They download
nothing into the repository: raw data is cached under `~/.cache/undercut/`.

| Script | What it does |
|---|---|
| `osm_circuit.py` | Fetches a circuit relation from OpenStreetMap through the Overpass API, chains it into a closed centreline in race direction starting at the start/finish node, reports length, pit lane and a feature census. Writes `<circuit>_centreline.csv`, `<circuit>_segments.csv`, `<circuit>_census.json`. |
| `map_fit.py` | Fits a circuit map's drawn track (a page converted to SVG with `pdftocairo -svg`) to a committed centreline with a similarity transform, and projects marks read off the page onto the lap. Measures positions a map draws but does not give as distances, such as the timing (control) line (`docs/track-data.md` section 5.4). The maps themselves are not committed. |
| `dem_profile.py` | Downloads a Copernicus GLO-30 tile from the public AWS bucket and samples it along a centreline CSV (also reads SRTM-style `.hgt`/`.hgt.gz` tiles for cross-checks). Reports min/max/range/gradient raw, smoothed and with an optional 1-D opening filter that strips canopy and buildings from the surface model. |

Reproduce the checks in the document:

```
python3 tools/research/osm_circuit.py all
python3 tools/research/dem_profile.py fetch 50.44 5.97
python3 tools/research/dem_profile.py profile ~/.cache/undercut/osm/out/spa_centreline.csv \
    ~/.cache/undercut/dem/Copernicus_DSM_COG_10_N50_00_E005_00_DEM.tif \
    --segments ~/.cache/undercut/osm/out/spa_segments.csv
python3 tools/research/dem_profile.py fetch 45.62 9.28
python3 tools/research/dem_profile.py profile ~/.cache/undercut/osm/out/monza_centreline.csv \
    ~/.cache/undercut/dem/Copernicus_DSM_COG_10_N45_00_E009_00_DEM.tif --open 300
python3 tools/research/dem_profile.py fetch 1.29 103.86
python3 tools/research/dem_profile.py profile ~/.cache/undercut/osm/out/singapore_centreline.csv \
    ~/.cache/undercut/dem/Copernicus_DSM_COG_10_N01_00_E103_00_DEM.tif --open 300
```

Data fetched by these scripts carries licence obligations (OpenStreetMap: ODbL 1.0, attribution
"© OpenStreetMap contributors"; Copernicus GLO-30: notice and liability sentence). See section 3 of
`docs/track-data.md` before committing anything derived from it.

Timing lines (section 5.4 of the document): render the circuit-map page at 400 dpi with `pdftoppm`,
take the centroid of a tick's dark pixels, convert it to page points (times 72 / 400), and pass it
as a mark:

```
pdftocairo -svg -f 2 -l 2 spa_map.pdf spa.svg
python3 tools/research/map_fit.py packages/track/data/spa.json spa.svg '85.899353%' \
    --mark C:271.77:282.53 --mark S2:185.73:718.93 --mark T:392.42:356.51
```
