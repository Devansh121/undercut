# tools/car

Builds the car by script in Blender, headless. The decision is `docs/adr/0005-car-model.md`; how the game loads, liveries and animates the result is `docs/car-asset.md`; the hard points and their sources are `DIMENSIONS.md`.

## Commands

```sh
npm run car:build              # rebuild apps/web/public/assets/car/* and update assets/MANIFEST.json
npm run car:build -- --check   # rebuild into a temporary directory and compare hashes with the manifest
flock ~/.cache/undercut/gpu.lock npm run car:preview   # three.js captures into docs/evidence/m2-car/threejs
```

`car:build` takes about 25 s and needs no GPU. On first use it downloads the Blender 5.2.4 LTS tarball from download.blender.org into `~/.cache/undercut/blender/`, checks it against the published sha256 and unpacks it there. Nothing is installed system-wide and nothing from Blender is committed. The output is deterministic: two builds give byte-identical files.

## Review renders

GPU work holds the shared lock. One station per run keeps each hold short.

```sh
B=~/.cache/undercut/blender/blender-5.2.4-linux-x64/blender
# orthographic proportion sheets on a 500 mm grid (Workbench)
flock ~/.cache/undercut/gpu.lock $B -b --factory-startup -P tools/car/car.py -- --mode ortho --out /tmp/car
# EEVEE iteration renders: stations front34, rear34, side, top, front, wing, cockpit, low
flock ~/.cache/undercut/gpu.lock $B -b --factory-startup -P tools/car/car.py -- --mode review --out /tmp/car \
  --stations front34 --team kestrel --hdri /path/to/studio.hdr --samples 24
# Cycles beauty render
flock ~/.cache/undercut/gpu.lock $B -b --factory-startup -P tools/car/car.py -- --mode beauty --out /tmp/car \
  --stations front34 --team calder --hdri /path/to/studio.hdr --samples 128 --res 1600x1000
```

The studio HDRI used for the committed renders is Poly Haven `studio_small_09` (CC0), downloaded from `https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/2k/studio_small_09_2k.hdr`. It only lights the renders and is not committed.

## Layout

| File | What it does |
| --- | --- |
| `build.mjs` | `npm run car:build`: fetches Blender, runs `car.py` per level of detail and for the masks, writes the livery index, the manifest entries and `docs/evidence/m2-car/stats.json` |
| `car.py` | Blender entry point: `--mode export, masks, review, beauty, ortho` |
| `carlib/dims.py` | Hard points, with assertions |
| `carlib/geom.py` | Mesh builder, lofts, lathes, sweeps, monotone splines, NACA sections |
| `carlib/body.py` | Survival cell with nose and engine cover, cockpit opening, sidepods, airbox, floor, fences, edge wings, diffuser, plank, crash structure, exhaust |
| `carlib/wings.py` | Front wing (four elements, endplates), rear wing (main plane, DRS flap, endplates, swan necks, actuator pod), beam wing |
| `carlib/wheels.py` | Tyres, rims, wheel covers, discs, uprights, brake ducts, wheel-wake deflectors |
| `carlib/cockpit.py` | Halo, headrest, helmet, steering wheel, mirrors, T-camera, suspension links, driveshafts |
| `carlib/assemble.py` | The node hierarchy with pivots, and the level-of-detail rules |
| `carlib/livery.py` | Livery atlas packing and the seven mask patterns |
| `carlib/textures.py`, `png.py` | Procedural carbon twill, tyre sidewall and disc-glow textures; a deterministic PNG writer |
| `carlib/ao.py` | Per-vertex ambient occlusion baked by ray casting |
| `carlib/decals.py` | Carriers for race numbers and driver codes |
| `carlib/materials.py`, `export.py`, `stage.py` | Materials, glTF export, review cameras and lights |
| `preview/` | Standalone three.js viewer (`server.mjs`, `index.html`, `viewer.js`), the reference rig (`car-rig.js`) and the Playwright capture (`capture.mjs`); not part of the app build |
