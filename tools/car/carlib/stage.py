"""Review renders: orthographic proportion sheets on a 500 mm grid (Workbench) and the five
standard perspective stations (EEVEE for iteration, Cycles for the beauty set)."""

import math
import os

import bpy
from mathutils import Vector

from . import dims as D

STATIONS = {
    # name: (eye, target, lens mm)
    "front34": ((6.9, 4.3, 1.55), (0.25, 0.0, 0.36), 50),
    "rear34": ((-6.6, 4.1, 1.75), (-0.35, 0.0, 0.40), 50),
    "side": ((0.0, 9.0, 0.55), (0.0, 0.0, 0.48), 70),
    "top": ((0.6, 0.001, 11.0), (0.2, 0.0, 0.0), 50),
    "front": ((10.0, 0.0, 0.50), (0.0, 0.0, 0.45), 85),
    "wing": ((4.4, 1.35, 0.62), (2.55, 0.35, 0.18), 45),
    "cockpit": ((1.75, 1.05, 1.45), (0.30, 0.0, 0.70), 40),
    "low": ((4.6, -2.4, 0.18), (0.6, 0.0, 0.25), 35),
    "rear": ((-9.0, 0.0, 0.80), (0.0, 0.0, 0.50), 50),
    "chase": ((-6.0, 0.0, 2.00), (1.2, 0.0, 0.45), 28),
}


def _mat(name, rgba, emit=False):
    m = bpy.data.materials.new(name)
    m.diffuse_color = rgba
    try:
        m.use_nodes = True
    except Exception:
        pass
    b = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    b.inputs["Base Color"].default_value = rgba
    if emit:
        b.inputs["Emission Color"].default_value = rgba
        b.inputs["Emission Strength"].default_value = 1.0
    return m


def grid_lines(view, coll):
    """Thin bars every 0.5 m behind the car for one orthographic view."""
    import bmesh

    bm = bmesh.new()
    bm_major = bmesh.new()
    w = 0.006

    def bar(b, p0, p1, normal):
        p0, p1 = Vector(p0), Vector(p1)
        d = (p1 - p0).normalized()
        s = d.cross(Vector(normal)).normalized() * w / 2
        vs = [b.verts.new(p0 + s), b.verts.new(p1 + s), b.verts.new(p1 - s), b.verts.new(p0 - s)]
        b.faces.new(vs)

    def frange(a, b, step):
        n = int(round((b - a) / step))
        return [a + step * i for i in range(n + 1)]

    if view == "side":
        y = -1.6
        for x in frange(-3.5, 3.5, 0.5):
            bar(bm_major if abs(x) < 1e-6 or abs(abs(x) - 1.5) < 1e-6 else bm, (x, y, 0), (x, y, 1.5), (0, 1, 0))
        for z in frange(0, 1.5, 0.5):
            bar(bm_major if z == 0 else bm, (-3.5, y, z), (3.5, y, z), (0, 1, 0))
        for x in (D.X_FRONT_AXLE, D.X_REAR_AXLE):
            bar(bm_major, (x, y + 0.01, 0), (x, y + 0.01, 1.5), (0, 1, 0))
    elif view == "top":
        z = -0.02
        for x in frange(-3.5, 3.5, 0.5):
            bar(bm_major if abs(x) < 1e-6 else bm, (x, -1.5, z), (x, 1.5, z), (0, 0, 1))
        for y in frange(-1.5, 1.5, 0.5):
            bar(bm_major if abs(y) < 1e-6 else bm, (-3.5, y, z), (3.5, y, z), (0, 0, 1))
        for x in (D.X_FRONT_AXLE, D.X_REAR_AXLE):
            bar(bm_major, (x, -1.5, z + 0.001), (x, 1.5, z + 0.001), (0, 0, 1))
    elif view == "front":
        x = -3.4
        for y in frange(-1.5, 1.5, 0.5):
            bar(bm_major if abs(y) < 1e-6 or abs(abs(y) - 1.0) < 1e-6 else bm, (x, y, 0), (x, y, 1.5), (1, 0, 0))
        for z in frange(0, 1.5, 0.5):
            bar(bm_major if z == 0 else bm, (x, -1.5, z), (x, 1.5, z), (1, 0, 0))
    out = []
    for b, nm, col in ((bm, "grid", (0.55, 0.55, 0.55, 1)), (bm_major, "grid_major", (0.85, 0.25, 0.12, 1))):
        me = bpy.data.meshes.new(nm)
        b.to_mesh(me)
        b.free()
        ob = bpy.data.objects.new(nm, me)
        ob.data.materials.append(_mat(nm, col))
        coll.objects.link(ob)
        out.append(ob)
    return out


def camera(coll):
    cd = bpy.data.cameras.new("cam")
    cam = bpy.data.objects.new("cam", cd)
    coll.objects.link(cam)
    bpy.context.scene.camera = cam
    return cam


def look(cam, eye, target, lens=50, ortho=None):
    cam.location = eye
    d = Vector(target) - Vector(eye)
    cam.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    if ortho:
        cam.data.type = "ORTHO"
        cam.data.ortho_scale = ortho
    else:
        cam.data.type = "PERSP"
        cam.data.lens = lens
    cam.data.clip_end = 100


def ortho_sheets(out_dir, prefix, coll, res=(1800, 900)):
    sc = bpy.context.scene
    sc.render.engine = "BLENDER_WORKBENCH"
    sh = sc.display.shading
    sh.light = "STUDIO"
    sh.color_type = "MATERIAL"
    sh.show_object_outline = True
    sh.object_outline_color = (0.05, 0.05, 0.05)
    sh.show_cavity = True
    sh.cavity_type = "BOTH"
    sc.display.render_aa = "16"
    sc.view_settings.view_transform = "Standard"
    if sc.world is None:
        sc.world = bpy.data.worlds.new("w")
    sc.world.color = (0.92, 0.92, 0.92)
    sc.render.resolution_x, sc.render.resolution_y = res
    sc.render.film_transparent = False
    cam = camera(coll)
    views = {
        "side": ((0.2, 30.0, 0.55), (0.2, 0.0, 0.55), 6.6),
        "top": ((0.2, 0.0, 30.0), (0.2, 0.0, 0.0), 6.6),
        "front": ((30.0, 0.0, 0.62), (0.0, 0.0, 0.62), 3.0),
    }
    paths = []
    for view, (eye, tgt, scale) in views.items():
        grid = grid_lines(view, coll)
        look(cam, eye, tgt, ortho=scale)
        if view == "top":
            cam.rotation_euler = (0, 0, math.pi)
        if view == "front":
            sc.render.resolution_x, sc.render.resolution_y = (1200, 900)
            cam.data.ortho_scale = 2.6
        else:
            sc.render.resolution_x, sc.render.resolution_y = res
        p = os.path.join(out_dir, "%s_ortho_%s.png" % (prefix, view))
        sc.render.filepath = p
        bpy.ops.render.render(write_still=True)
        for g in grid:
            bpy.data.objects.remove(g)
        paths.append(p)
    return paths


def lighting(hdri, strength=1.0, rot_deg=120):
    sc = bpy.context.scene
    w = bpy.data.worlds.new("env")
    sc.world = w
    try:
        w.use_nodes = True
    except Exception:
        pass
    nt = w.node_tree
    bg = next(n for n in nt.nodes if n.type == "BACKGROUND")
    if hdri and os.path.exists(hdri):
        env = nt.nodes.new("ShaderNodeTexEnvironment")
        env.image = bpy.data.images.load(hdri)
        mp = nt.nodes.new("ShaderNodeMapping")
        mp.inputs["Rotation"].default_value = (0, 0, math.radians(rot_deg))
        tc = nt.nodes.new("ShaderNodeTexCoord")
        nt.links.new(tc.outputs["Generated"], mp.inputs["Vector"])
        nt.links.new(mp.outputs["Vector"], env.inputs["Vector"])
        nt.links.new(env.outputs["Color"], bg.inputs["Color"])
        bg.inputs["Strength"].default_value = strength
    else:
        bg.inputs["Color"].default_value = (0.4, 0.42, 0.45, 1)


def studio_floor(coll):
    import bmesh

    bm = bmesh.new()
    prof = [(14.0 - 25.0 * i / 30, 0.0) for i in range(31)]
    r = 3.0
    for i in range(1, 17):
        a = math.pi / 2 * i / 16
        prof.append((-11.0 - r * math.sin(a), r - r * math.cos(a)))
    prof.append((-14.0, 10.0))
    left = [bm.verts.new((x, -14, z)) for (x, z) in prof]
    right = [bm.verts.new((x, 14, z)) for (x, z) in prof]
    for i in range(len(prof) - 1):
        bm.faces.new((left[i], right[i], right[i + 1], left[i + 1]))
    me = bpy.data.meshes.new("floor")
    bm.to_mesh(me)
    bm.free()
    for p in me.polygons:
        p.use_smooth = True
    ob = bpy.data.objects.new("studio_floor", me)
    m = _mat("studio_floor", (0.035, 0.036, 0.038, 1))
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Roughness"].default_value = 0.55
    me.materials.append(m)
    coll.objects.link(ob)
    return ob


def area(coll, name, loc, target, size, energy, color=(1, 1, 1)):
    ld = bpy.data.lights.new(name, "AREA")
    ld.shape = "RECTANGLE"
    ld.size, ld.size_y = size
    ld.energy = energy
    ld.color = color
    ob = bpy.data.objects.new(name, ld)
    ob.location = loc
    d = Vector(target) - Vector(loc)
    ob.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    coll.objects.link(ob)


def perspective(out_dir, prefix, coll, stations, engine="EEVEE", samples=64, res=(1440, 900), hdri=None):
    sc = bpy.context.scene
    lighting(hdri, 0.55)
    studio_floor(coll)
    area(coll, "key", (1.0, 2.5, 5.0), (0, 0, 0), (5.0, 2.0), 1600)
    area(coll, "rim", (-5.0, -3.0, 2.5), (0, 0, 0.5), (1.0, 4.0), 500, (0.92, 0.96, 1.0))
    area(coll, "fill", (5.0, 4.0, 1.5), (0, 0, 0.4), (1.0, 3.0), 250, (1.0, 0.97, 0.93))
    if engine == "EEVEE":
        sc.render.engine = "BLENDER_EEVEE"
        try:
            sc.eevee.taa_render_samples = samples
            sc.eevee.use_shadows = True
            sc.eevee.use_raytracing = True
        except Exception:
            pass
    else:
        sc.render.engine = "CYCLES"
        sc.cycles.samples = samples
        sc.cycles.use_denoising = True
        prefs = bpy.context.preferences.addons["cycles"].preferences
        for dev in ("OPTIX", "CUDA"):
            try:
                prefs.compute_device_type = dev
                prefs.get_devices()
                if any(d.type == dev for d in prefs.devices):
                    for d in prefs.devices:
                        d.use = d.type == dev
                    sc.cycles.device = "GPU"
                    break
            except TypeError:
                continue
    sc.view_settings.view_transform = "AgX"
    try:
        sc.view_settings.look = "AgX - Medium High Contrast"
    except TypeError:
        pass
    sc.render.resolution_x, sc.render.resolution_y = res
    cam = camera(coll)
    paths = []
    for st in stations:
        eye, tgt, lens = STATIONS[st]
        if st in ("side", "front", "top"):
            look(cam, eye, tgt, ortho={"side": 6.4, "front": 2.6, "top": 6.4}[st])
            if st == "top":
                cam.rotation_euler = (0, 0, math.pi)
        else:
            look(cam, eye, tgt, lens)
        p = os.path.join(out_dir, "%s_%s.png" % (prefix, st))
        sc.render.filepath = p
        bpy.ops.render.render(write_still=True)
        paths.append(p)
    return paths
