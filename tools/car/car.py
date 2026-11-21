"""Entry point for Blender: builds the car and exports it or renders review images.

    blender -b --factory-startup -P tools/car/car.py -- --mode export --out <dir> --lod high
    blender -b --factory-startup -P tools/car/car.py -- --mode masks --out <dir>
    blender -b --factory-startup -P tools/car/car.py -- --mode review --out <dir> --team calder
    blender -b --factory-startup -P tools/car/car.py -- --mode ortho --out <dir>

npm run car:build wraps export and masks; see tools/car/README.md.
"""

import argparse
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import bpy  # noqa: E402
import numpy as np  # noqa: E402

from carlib import ao, assemble, decals, livery, materials, png, stage, textures, wheels  # noqa: E402
from carlib import dims as D  # noqa: E402

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument("--mode", choices=["export", "masks", "review", "ortho", "beauty"], default="review")
ap.add_argument("--out", required=True)
ap.add_argument("--lod", default="high")
ap.add_argument("--stations", default="front34,rear34,side,top,front")
ap.add_argument("--hdri", default="")
ap.add_argument("--samples", type=int, default=64)
ap.add_argument("--res", default="1440x900")
ap.add_argument("--prefix", default="car")
ap.add_argument("--team", default="calder")
ap.add_argument("--drs", type=float, default=0.0, help="review only: DRS opening, 0..1")
ap.add_argument("--stats-dir", default="")
args = ap.parse_args(argv)
os.makedirs(args.out, exist_ok=True)

MASK_SIZE = 1024
TEAMS = json.load(open(os.path.join(HERE, "..", "..", "design", "teams.json")))["teams"]

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
coll = bpy.data.collections.new("Car")
scene.collection.children.link(coll)

car = assemble.build(args.lod)
# the livery atlas layout is the same for every level of detail: pack the high patches, then
# give each lower LOD the same rectangles by key
ref = car if args.lod == "high" else assemble.build("high")
livery.pack(ref.patches, MASK_SIZE)
rects = {p.key: p.rect for p in ref.patches}
for p in car.patches:
    p.rect = rects[p.key]

prof = wheels.tyre_profile(D.TYRE_WIDTH_REAR, car.q)
tex = textures.build_all(args.lod, wheels.tyre_shoulders(prof))

mask_img = None
team = next(t for t in TEAMS if t["id"] == args.team)
if args.mode in ("review", "beauty", "ortho"):
    m = livery.draw_mask(ref.patches, team["liveryPattern"], MASK_SIZE)
    mask_img = textures.to_image("mask_review", m, non_color=True)
    c = team["colours"]
    mats = materials.build(tex, livery=(mask_img, c["primary"], c["secondary"], c["accent"]))
else:
    mats = materials.build(tex)

objs = assemble.to_blender(car, mats, coll)
decal_objs = decals.build(objs, mats, coll, car.lod)
tris = sum(car.stats.values())
print("STATS", json.dumps(car.stats), "total", tris)

if args.drs and "drs_flap" in objs:
    import math

    objs["drs_flap"].rotation_euler = (0, math.radians(D.DRS_OPEN_DEG) * args.drs, 0)

res = tuple(int(v) for v in args.res.split("x"))
for ob in decal_objs.values():
    ob.hide_render = args.mode in ("ortho",)
if args.mode == "ortho":
    stage.ortho_sheets(args.out, args.prefix, coll)
elif args.mode == "review":
    stage.perspective(args.out, args.prefix, coll, args.stations.split(","), "EEVEE", args.samples, res, args.hdri)
elif args.mode == "beauty":
    stage.perspective(args.out, args.prefix, coll, args.stations.split(","), "CYCLES", args.samples, res, args.hdri)
elif args.mode == "masks":
    os.makedirs(os.path.join(args.out, "livery"), exist_ok=True)
    for pat in livery.PATTERNS:
        m = livery.draw_mask(ref.patches, pat, MASK_SIZE)
        png.write(os.path.join(args.out, "livery", pat + ".png"), m)
    print("MASKS", len(livery.PATTERNS))
elif args.mode == "export":
    from carlib import export

    bpy.context.view_layer.update()
    ao.bake(ao.mesh_objects(objs["car"]), rays={"high": 24, "mobile": 14, "far": 8}[args.lod])

    export.write(objs, car, args.out, tris, args.stats_dir or args.out)
