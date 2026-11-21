# Track pipeline

Builds a committed track file (`packages/track/data/<circuit>.json`) from open geodata and the
circuit's authored tables. Python 3.10+, standard library only. It reuses the fetch, chaining and
DEM code in `tools/research/`. The steps follow `docs/track-data.md` section 5.

```
npm run track:build -- monza            # fetch what is not cached, build, write the file
npm run track:build -- monza --offline  # never fetch; fail if an input is not cached
npm run track:build -- monza --check    # rebuild in memory and compare with the committed file
npm run track:plot -- spa               # plan, close-ups and profiles to docs/evidence/m4-tracks/
npm run track:plot -- spa --vertical 0:2000   # also the side elevation with grade and vertical g
npm run track:plot -- monza             # Monza's evidence goes to docs/evidence/m1-track/
```

Circuits: `monza`, `spa`, `singapore`. Output is track format 3 (`packages/track/src/data.ts`),
which adds the timing line and the environment; format 2 files still load through a migration.

The pipeline does not run in CI. CI validates the committed file instead
(`packages/track/validation/`), and `licence.test.mjs` here checks its manifest entry and notices.

## Inputs and reproducibility

Raw inputs are cached under `~/.cache/undercut/` and never committed:

| Input | Cache file |
|---|---|
| OSM circuit relation with its ways and nodes (Overpass) | `osm/<id>_layout.json` |
| OSM barriers and gravel/sand areas in the circuit's bounding box (Overpass, `out geom`) | `osm/<id>_features.json` |
| Copernicus GLO-30 tile (public AWS bucket) | `dem/Copernicus_DSM_COG_10_<tile>_DEM.tif` |

The first time a cached file is seen, a sidecar `<file>.fetch.json` records its URL, fetch time and
sha256. The track file copies those records into `source`, together with the OSM database
timestamp, the elevation filter, the length scale factor and the pipeline version. Output is
written with fixed rounding and key order, so the same cache gives the same bytes. If a cached
file changes, the build stops until its sidecar is deleted, which records the new fetch.

## Adding a circuit

Add `circuits/<id>.json`; no code changes for a circuit like the three built. It holds:

- `osm`: the circuit relation, the pit-lane way and the bounding box for the feature query;
- `geometry`: densify step, smoothing sigma, sample step, the allowed length change and the start
  heading range used to check the loop; optional `filletRadius` rounds sharp vertices (road
  junctions on a street circuit) with arcs of that radius before smoothing;
- `cornerRule` (optional): overrides of the curvature rule (`smoothSigma`, `enter`, `exit`,
  `mergeGap`, `minTurn`) where the official numbering needs them; the file records the rule used;
- `elevation`: the circuit's filter (opening window, average, Gaussian), the published range the
  result must match, optional `bridges` (OSM ways put back as crowned decks after the opening) and
  `corrections` (spans whose surface-model profile is replaced by a cubic matching height and grade
  at both ends, each with a `note` saying why);
- `corners`: official numbering, names by place and direction. The build fails unless the
  curvature rule finds exactly these corners in this order;
- `timing`, `grid`, `pit`: positions as offsets from corners (`{"corner": 4, "offset": -233}`,
  from the apex, or with `"at": "start"` or `"end"`), from the start line (`{"s": 12}`), from the
  timing line (`{"line": "timing", "offset": 12}`) or from the pit junctions
  (`{"pit": "entry", "offset": 40}`). A DRS zone runs to the next corner's start unless it names an
  `end`;
- `timingLine`: where lap and sector times run from, with its uncertainty and source;
- `environment`: time zone, race date, session times, typical air temperature, lighting and
  floodlights (mapped masts or a placement rule); the build adds position, north, altitude and
  ISA pressure;
- `widths` (keys, or `lanes` from the OSM lanes tag with `overrides`), `banking`, `kerbProfiles`,
  `kerbs`, `runoff`, `barriers`: authored tables. Every value in them is an estimate and says so
  in its `note`. `barriers` may remap mapped types (`mappedTypes`), merge short type runs
  (`minTypeRun`) and keep every barrier inside the runtime's frame limit (`clampToFrame`).

## What is measured and what is authored

Measured from open data: the centreline, its length, the corner positions and directions, the
heights, the pit-lane path and its junctions, gravel and sand extents, and barrier offsets and
types where OpenStreetMap maps a wall, fence or guard rail near the track.

Authored estimates: half-widths, banking, kerb positions and profiles, the run-off kind nearest
the track where it is not gravel, barrier offsets and types where nothing is mapped (by rule: at
least `minRunoff` beyond the edge and `behindGravel` behind mapped gravel), pit-lane widths,
speed-limit lines and boxes, and grid slots. Two rules keep the geometry sound: barriers on the
inside of a bend stay within 0.95 of the local radius, where the (s, d) frame would fold, and the
pit wall stands halfway between the track edge and the pit lane.
