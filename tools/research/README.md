# Research scripts

Exploratory scripts behind `docs/track-data.md`. Python 3.10+, standard library only. They download
nothing into the repository: raw data is cached under `~/.cache/undercut/`.

| Script | What it does |
|---|---|
| `osm_circuit.py` | Fetches a circuit relation from OpenStreetMap through the Overpass API, chains it into a closed centreline in race direction starting at the start/finish node, reports length, pit lane and a feature census. Writes `<circuit>_centreline.csv`, `<circuit>_segments.csv`, `<circuit>_census.json`. |
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
