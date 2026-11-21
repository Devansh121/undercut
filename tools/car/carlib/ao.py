"""Per-vertex ambient occlusion, baked by ray casting against the whole car and the ground in its
rest pose. Stored as a colour attribute that the exporter writes as COLOR_0, so the renderer
multiplies it into the base colour (three.js does this when a primitive has COLOR_0).
Ray directions are a fixed cosine-weighted set, so the result is deterministic."""

import math

import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree


def _directions(n):
    out = []
    golden = math.pi * (3 - math.sqrt(5))
    for i in range(n):
        r = math.sqrt((i + 0.5) / n)  # cosine-weighted disc sample
        a = golden * i
        x, y = r * math.cos(a), r * math.sin(a)
        out.append(Vector((x, y, math.sqrt(max(0.0, 1 - x * x - y * y)))))
    return out


def bake(objects, rays=20, max_dist=0.35, floor=0.22):
    verts, polys = [], []
    for ob in objects:
        mw = ob.matrix_world
        base = len(verts)
        verts.extend(mw @ v.co for v in ob.data.vertices)
        polys.extend([base + i for i in p.vertices] for p in ob.data.polygons)
    g = len(verts)
    verts.extend([Vector((-6, -4, 0)), Vector((6, -4, 0)), Vector((6, 4, 0)), Vector((-6, 4, 0))])
    polys.append([g, g + 1, g + 2, g + 3])
    bvh = BVHTree.FromPolygons(verts, polys, all_triangles=False)
    dirs = _directions(rays)
    for ob in objects:
        me = ob.data
        mw = ob.matrix_world
        rot = mw.to_3x3()
        attr = me.color_attributes.new("AO", "FLOAT_COLOR", "POINT")
        aos = []
        buried = []
        for v in me.vertices:
            p = mw @ v.co
            n = (rot @ v.normal).normalized()
            t = n.orthogonal().normalized()
            b = n.cross(t)
            origin = p + n * 0.002
            occ = 0.0
            near = 0
            for d in dirs:
                wd = t * d.x + b * d.y + n * d.z
                hit = bvh.ray_cast(origin, wd, max_dist)
                if hit[0] is not None:
                    occ += 1.0 - hit[3] / max_dist
                    # hitting the inside of a surface means this vertex is inside that part
                    if hit[1].dot(wd) > 0.0 or hit[3] < 0.004:
                        near += 1
            aos.append(1.0 - occ / rays)
            # a vertex inside another part (where panels overlap) sees almost nothing; it would
            # smear dark into the visible faces around it, so it takes its neighbours' value
            buried.append(near >= 0.5 * rays)
        nbr = [[] for _ in me.vertices]
        for e in me.edges:
            a_, b_ = e.vertices
            nbr[a_].append(b_)
            nbr[b_].append(a_)
        for _ in range(6):
            nxt = list(aos)
            for i, bur in enumerate(buried):
                if bur:
                    good = [aos[k] for k in nbr[i] if not buried[k]]
                    if good:
                        nxt[i] = sum(good) / len(good)
                        buried[i] = False
            aos = nxt
        vals = []
        for i, a_ in enumerate(aos):
            ao = floor + (1.0 - floor) * (0.6 if buried[i] else a_)
            vals.extend((ao, ao, ao, 1.0))
        attr.data.foreach_set("color", vals)
        me.color_attributes.active_color = attr
        me.color_attributes.render_color_index = me.color_attributes.active_color_index


def mesh_objects(root):
    out = []

    def walk(ob):
        if ob.type == "MESH" and not ob.get("decal"):
            out.append(ob)
        for c in sorted(ob.children, key=lambda c: c.name):
            walk(c)

    walk(root)
    return out
