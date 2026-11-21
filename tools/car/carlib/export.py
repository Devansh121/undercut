"""glTF export and the per-LOD stats."""

import json
import os

import bpy


def write(objs, car, out_dir, tris, stats_dir):
    names = set()

    def walk(ob):
        names.add(ob.name)
        for c in ob.children:
            walk(c)

    walk(objs["car"])
    for ob in bpy.context.view_layer.objects:
        ob.select_set(ob.name in names)
    path = os.path.join(out_dir, "car_%s.glb" % car.lod)
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        use_selection=True,
        export_apply=False,
        export_yup=True,
        export_extras=True,
        export_texcoords=True,
        export_normals=True,
        export_tangents=False,
        export_vertex_color="ACTIVE",
        export_materials="EXPORT",
        export_image_format="WEBP",
        export_image_quality=90,
        export_draco_mesh_compression_enable=True,
        export_draco_mesh_compression_level=7,
        export_draco_position_quantization=14,
        export_draco_normal_quantization=10,
        export_draco_texcoord_quantization=12,
        export_cameras=False,
        export_lights=False,
        export_animations=False,
    )
    draw_calls = 0
    for n in names:
        ob = bpy.data.objects[n]
        if ob.type == "MESH":
            draw_calls += len({p.material_index for p in ob.data.polygons})
    # triangle and draw-call numbers for the record are measured on the GLB by build.mjs; this
    # file only carries the texture sizes, which the GLB does not state
    stats = {
        "lod": car.lod,
        "images": {img.name: list(img.size) for img in bpy.data.images
                   if img.users and img.name.startswith(("carbon", "tyre", "disc", "body_detail"))},
    }
    os.makedirs(stats_dir, exist_ok=True)
    with open(os.path.join(stats_dir, "stats_%s.json" % car.lod), "w") as fh:
        json.dump(stats, fh, indent=2, sort_keys=True)
    print("EXPORTED", path, os.path.getsize(path), "bytes", draw_calls, "draw calls")
