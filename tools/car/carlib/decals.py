"""Decal carriers for data-driven markings: race numbers and three-letter driver codes.

All five carriers are one mesh (one draw call), shrink-wrapped onto the bodywork by ray casting
and lifted 1.5 mm off it. Its UV0 maps into a single canvas the renderer draws at runtime
(2048 x 512): number carriers use u 0..0.4 of it, code carriers u 0.4..1 (v 0..1, up the
text). The material is fully transparent in the file."""

import bmesh
import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree

CANVAS = (2048, 512)
REGIONS = {"number": (0.0, 0.4), "code": (0.4, 1.0)}

# name: (kind, origin, u direction * width, v direction * height, ray direction), build frame
DECALS = {
    # nose top, read from in front of the car
    "number_nose": ("number", (2.50, -0.070, 1.0), (0.0, 0.140, 0.0), (-0.0875, 0.0, 0.0), (0, 0, -1)),
    # engine cover flanks, read from the side
    "number_side_L": ("number", (-0.30, 1.0, 0.705), (-0.216, 0.0, 0.0), (0.0, 0.0, 0.135), (0, -1, 0)),
    "number_side_R": ("number", (-0.516, -1.0, 0.705), (0.216, 0.0, 0.0), (0.0, 0.0, 0.135), (0, 1, 0)),
    # driver code on the nose flanks
    "code_L": ("code", (2.26, 1.0, 0.250), (-0.26, 0.0, 0.0), (0.0, 0.0, 0.105), (0, -1, 0)),
    "code_R": ("code", (2.00, -1.0, 0.250), (0.26, 0.0, 0.0), (0.0, 0.0, 0.105), (0, 1, 0)),
}


def build(objs, mats, coll, lod):
    if lod == "far":
        return {}
    body = objs["body"]
    dg = bpy.context.evaluated_depsgraph_get()
    bvh = BVHTree.FromObject(body.evaluated_get(dg), dg)
    nu, nv = (10, 5) if lod == "high" else (4, 2)
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new("UVMap")
    for name, (kind, o, du, dv, ray) in DECALS.items():
        o, du, dv, ray = Vector(o), Vector(du), Vector(dv), Vector(ray)
        u0, u1 = REGIONS[kind]
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
                if not all(k in verts for k in keys):
                    continue
                vs = [verts[k] for k in keys]
                # face the reader: the triangle normals point back along the ray
                for tri in ((0, 1, 2), (0, 2, 3)):
                    a, b, c = (vs[t] for t in tri)
                    nrm = (b.co - a.co).cross(c.co - a.co)
                    order = tri if nrm.dot(ray) < 0 else (tri[0], tri[2], tri[1])
                    f = bm.faces.new([vs[t] for t in order])
                    for loop, t in zip(f.loops, order):
                        k = keys[t]
                        loop[uvl].uv = (u0 + (u1 - u0) * k[0] / nu, k[1] / nv)
    me = bpy.data.meshes.new("decals")
    bm.to_mesh(me)
    bm.free()
    for p in me.polygons:
        p.use_smooth = True
    me.uv_layers.new(name="UVMetric")
    me.materials.append(mats["decal"])
    ob = bpy.data.objects.new("decals", me)
    coll.objects.link(ob)
    ob.parent = objs["car"]
    ob["decal"] = {"canvas": list(CANVAS), "number_u": list(REGIONS["number"]), "code_u": list(REGIONS["code"]),
                   "carriers": sorted(DECALS)}
    return {"decals": ob}
