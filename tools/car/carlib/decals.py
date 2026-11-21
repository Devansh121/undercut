"""Decal carriers for data-driven markings: race numbers and three-letter driver codes.

Each decal is a small grid shrink-wrapped onto the bodywork by ray casting and lifted 1.5 mm off
it, with UV0 running 0..1 across the decal (u to the reader's right, v up). Its material is fully
transparent in the file; the renderer draws the number or code into a texture at runtime."""

import bmesh
import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree

# name: (origin of the decal rectangle, u direction * width, v direction * height, ray direction)
# Rectangles are given in the build frame (+X forward, +Y left, +Z up).
DECALS = {
    # nose top, read from in front of the car
    "decal_number_nose": ((2.50, -0.070, 1.0), (0.0, 0.140, 0.0), (-0.20, 0.0, 0.0), (0, 0, -1)),
    # engine cover flanks, read from the side
    "decal_number_side_L": ((-0.30, 1.0, 0.705), (-0.30, 0.0, 0.0), (0.0, 0.0, 0.135), (0, -1, 0)),
    "decal_number_side_R": ((-0.60, -1.0, 0.705), (0.30, 0.0, 0.0), (0.0, 0.0, 0.135), (0, 1, 0)),
    # driver code on the nose flanks
    "decal_code_L": ((2.28, 1.0, 0.250), (-0.33, 0.0, 0.0), (0.0, 0.0, 0.095), (0, -1, 0)),
    "decal_code_R": ((1.95, -1.0, 0.250), (0.33, 0.0, 0.0), (0.0, 0.0, 0.095), (0, 1, 0)),
}


def build(objs, mats, coll, lod):
    body = objs["body"]
    dg = bpy.context.evaluated_depsgraph_get()
    bvh = BVHTree.FromObject(body.evaluated_get(dg), dg)
    out = {}
    nu, nv = (10, 5) if lod == "high" else (4, 2)
    if lod == "far":
        return out
    for name, (o, du, dv, ray) in DECALS.items():
        o, du, dv, ray = Vector(o), Vector(du), Vector(dv), Vector(ray)
        bm = bmesh.new()
        uvl = bm.loops.layers.uv.new("UVMap")
        verts = {}
        for j in range(nv + 1):
            for i in range(nu + 1):
                start = o + du * (i / nu) + dv * (j / nv)
                hit, nrm, _, _ = bvh.ray_cast(start, ray, 3.0)
                if hit is None:
                    continue
                if nrm.dot(ray) > 0:
                    nrm = -nrm
                verts[(i, j)] = bm.verts.new(hit + nrm * 0.0015)
        for j in range(nv):
            for i in range(nu):
                keys = [(i, j), (i + 1, j), (i + 1, j + 1), (i, j + 1)]
                if all(k in verts for k in keys):
                    f = bm.faces.new([verts[k] for k in keys])
                    for loop, k in zip(f.loops, keys):
                        loop[uvl].uv = (k[0] / nu, k[1] / nv)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        # face the reader: flip if the normal points along the ray
        if bm.faces and bm.faces[0].normal.dot(ray) > 0:
            bmesh.ops.reverse_faces(bm, faces=bm.faces)
        me = bpy.data.meshes.new(name)
        bm.to_mesh(me)
        bm.free()
        for p in me.polygons:
            p.use_smooth = True
        me.uv_layers.new(name="UVMetric")
        me.materials.append(mats["decal"])
        ob = bpy.data.objects.new(name, me)
        coll.objects.link(ob)
        ob.parent = objs["car"]
        ob["decal"] = "number" if "number" in name else "code"
        out[name] = ob
    return out
