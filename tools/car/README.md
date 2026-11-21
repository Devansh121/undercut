# tools/car

Scripts that build the car in Blender, headless. The decision and the plan are in `docs/adr/0005-car-model.md`.

## Setup

Blender 5.2 LTS from the official tarball, unpacked outside the repo:

```sh
mkdir -p ~/.cache/undercut/blender && cd ~/.cache/undercut/blender
curl -LO https://download.blender.org/release/Blender5.2/blender-5.2.4-linux-x64.tar.xz
curl -LO https://download.blender.org/release/Blender5.2/blender-5.2.4.sha256
grep linux-x64 blender-5.2.4.sha256 | sha256sum -c - && tar xf blender-5.2.4-linux-x64.tar.xz
```

## Front wing proof

```sh
B=~/.cache/undercut/blender/blender-5.2.4-linux-x64/blender
# geometry and glTF only (no GPU needed)
$B -b --factory-startup -P tools/car/front_wing.py -- --out /tmp/wing --no-render
$B -b --factory-startup -P tools/car/front_wing.py -- --out /tmp/wing-game --lod game --no-render
# reference renders: GPU work must hold the shared lock
flock ~/.cache/undercut/gpu.lock $B -b --factory-startup -P tools/car/front_wing.py -- \
  --out /tmp/wing --hdri /path/to/studio_small_09_2k.hdr --samples 256 --res 1600x1000
```

The studio HDRI is Poly Haven `studio_small_09` (CC0), downloaded from
`https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/2k/studio_small_09_2k.hdr`; it lights the reference renders and is not committed.

Options: `--team calder|kestrel|meridian` picks the livery colours, `--lod hero|game` the tessellation, `--samples` and `--res` the render quality.

Outputs: `front_wing.glb` (Draco), `front_wing_hero.png`, `front_wing_top.png`, `front_wing_stats.json` (triangles per part, GLB size).
