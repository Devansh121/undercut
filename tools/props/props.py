"""Scripted modular circuit kit. Author in the delivery frame, convert at export."""
import argparse
import json
import math
import os
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.abspath('tools/car'))
sys.path.insert(0, os.path.abspath('tools/props'))
from carlib.ao import bake

args = argparse.ArgumentParser()
args.add_argument('--out', required=True)
args.add_argument('--kits-only', action='store_true')
a = args.parse_args(sys.argv[sys.argv.index('--') + 1:])
os.makedirs(a.out, exist_ok=True)


def lin_to_srgb(c):
    c = np.clip(c, 0.0, 1.0)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(c, 1.0 / 2.4) - 0.055)


def grain_image(name, rgb_lin, contrast=0.10, kind='grain', size=64):
    """Build a deterministic 64x64 sRGB texture with true linear albedo and subtle surface variation."""
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float64)
    h1 = ((xx * 73 + yy * 151 + xx * yy * 17) % 101) / 100.0
    h2 = (((xx // 2) * 37 + (yy // 2) * 89) % 97) / 96.0
    if kind == 'brush':
        # Directional rolled/brushed steel streaking along U.
        n = 0.65 * (((yy * 47 + (xx // 4) * 13) % 83) / 82.0) + 0.35 * h1
    elif kind == 'weave':
        # Fine woven overall / clothing texture.
        n = 0.55 * (((xx.astype(int) + yy.astype(int)) % 2) * 0.5 + 0.25) + 0.45 * h1
    elif kind == 'rubber':
        # Tight matte pebble grain.
        n = 0.75 * h1 + 0.25 * h2
    else:
        # Weathered mineral/concrete mottling.
        n = 0.45 * h1 + 0.55 * h2
    scale = 1.0 + (n - 0.5) * 2.0 * contrast
    lin = np.clip(np.asarray(rgb_lin, dtype=np.float64)[None, None, :] * scale[..., None], 0.0, 1.0)
    srgb = lin_to_srgb(lin)
    alpha = np.ones((size, size, 1), dtype=np.float32)
    px = np.concatenate([srgb.astype(np.float32), alpha], axis=2)
    img = bpy.data.images.new(name, width=size, height=size, alpha=False)
    img.pixels.foreach_set(px.ravel())
    img.update()
    img.file_format = 'PNG'
    img.pack()
    return img


def material(name, colour, roughness, metallic=0.0, emission=0.0, tex_kind=None, contrast=0.10, double=False):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    m.use_backface_culling = not double
    nt = m.node_tree
    b = nt.nodes.get('Principled BSDF')
    b.inputs['Base Color'].default_value = (*colour, 1.0)
    b.inputs['Roughness'].default_value = roughness
    b.inputs['Metallic'].default_value = metallic
    if emission:
        b.inputs['Emission Color'].default_value = (*colour, 1.0)
        b.inputs['Emission Strength'].default_value = emission
    if tex_kind is not None:
        tex = nt.nodes.new('ShaderNodeTexImage')
        tex.image = grain_image(f'{name}-tex', colour, contrast=contrast, kind=tex_kind)
        nt.links.new(tex.outputs['Color'], b.inputs['Base Color'])
    return m


# Physical linear albedos tuned for Monza sunlight (no crushed blacks, no blown-out whites).
steel = material('galvanised', (.34, .37, .40), .42, .78, tex_kind='brush', contrast=.12)
rail_steel = material('galvanised-rail', (.36, .39, .42), .40, .82, tex_kind='brush', contrast=.12, double=True)
dark_steel = material('dark-steel', (.055, .060, .068), .46, .65, tex_kind='brush', contrast=.08)
concrete = material('concrete', (.34, .33, .30), .90, tex_kind='grain', contrast=.14)
rubber = material('rubber', (.034, .036, .040), .90, tex_kind='rubber', contrast=.14)
paint = material('paint-band', (.08, .22, .38), .52, tex_kind='grain', contrast=.06)
seat = material('seat', (.045, .14, .22), .64)
glass = material('glazing', (.045, .085, .12), .14, .45)
face = material('board-face', (.80, .79, .75), .62)
red = material('lamp-red', (.42, .004, .002), .28, emission=2.4)
cloth = material('clothing', (.52, .54, .56), .92, tex_kind='weave', contrast=.08)
fabric = material('dark-fabric', (.025, .032, .043), .94, tex_kind='weave', contrast=.10)
skin = material('skin', (.46, .29, .19), .72)

objects = []
lod = 0
attachments = []


def apply_metric_uv(ob):
    if not ob.data.uv_layers:
        ob.data.uv_layers.new()
    uv = ob.data.uv_layers.active.data
    for p in ob.data.polygons:
        for i in p.loop_indices:
            v = ob.data.vertices[ob.data.loops[i].vertex_index].co
            uv[i].uv = (v.y * 2.5, v.z * 2.5) if abs(p.normal.x) > .5 else (
                v.x * 2.5, (v.y if abs(p.normal.z) > .5 else v.z) * 2.5
            )


def finish(ob, name, mat, smooth=False, custom_uv=False):
    ob.name = name
    ob.data.materials.append(mat)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if smooth:
        for p in ob.data.polygons:
            p.use_smooth = True
    if not custom_uv:
        apply_metric_uv(ob)
    objects.append(ob)
    return ob


def box(name, pos, size, mat=steel, bevel=.015, rot=(0.0, 0.0, 0.0)):
    bpy.ops.mesh.primitive_cube_add(size=1, location=pos, rotation=rot)
    ob = bpy.context.object
    ob.scale = size
    finish(ob, name, mat)
    if bevel and lod == 0:
        mod = ob.modifiers.new('edge-radius', 'BEVEL')
        mod.width = min(bevel, min(size) * .18)
        mod.segments = 1
        bpy.context.view_layer.objects.active = ob
        bpy.ops.object.modifier_apply(modifier=mod.name)
        wn = ob.modifiers.new('weighted-corner-normals', 'WEIGHTED_NORMAL')
        bpy.ops.object.modifier_apply(modifier=wn.name)
    return ob


def prism_profile(name, profile_xz, y0, y1, mat, cap_ends=True, smooth=False):
    """Extrude a 2D (x, z) cross-section along author Y from y0 to y1."""
    n = len(profile_xz)
    verts = [(x, y0, z) for x, z in profile_xz] + [(x, y1, z) for x, z in profile_xz]
    faces = []
    for i in range(n):
        j = (i + 1) % n
        faces.append((i, j, j + n, i + n))
    if cap_ends and n >= 3:
        faces.append(tuple(range(n - 1, -1, -1)))
        faces.append(tuple(range(n, 2 * n)))
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    return finish(ob, name, mat, smooth=smooth)


def rod(name, a_pt, b_pt, radius=.035, mat=steel, segs=None, smooth=True):
    d = Vector(b_pt) - Vector(a_pt)
    if d.length < 1e-5:
        return None
    n_verts = segs if segs is not None else (10 if lod == 0 else 6)
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=n_verts, radius=radius, depth=d.length, location=(Vector(a_pt) + Vector(b_pt)) / 2
    )
    ob = bpy.context.object
    ob.rotation_euler = d.to_track_quat('Z', 'Y').to_euler()
    return finish(ob, name, mat, smooth=smooth)


def tapered_rod(name, a_pt, b_pt, r1, r2, mat=steel, segs=None, smooth=True):
    d = Vector(b_pt) - Vector(a_pt)
    if d.length < 1e-5:
        return None
    n_verts = segs if segs is not None else (10 if lod == 0 else 6)
    bpy.ops.mesh.primitive_cone_add(
        vertices=n_verts, radius1=r1, radius2=r2, depth=d.length, location=(Vector(a_pt) + Vector(b_pt)) / 2
    )
    ob = bpy.context.object
    ob.rotation_euler = d.to_track_quat('Z', 'Y').to_euler()
    return finish(ob, name, mat, smooth=smooth)


def board_panel(name, pos, width, height, thickness=.04, tilt_y=0.0, frame_mat=dark_steel):
    """Create a UV-mapped board-face (+X canonical [0,1] UVs) with optional slim dark backing frame."""
    ob = box(name, pos, (thickness, width, height), face, bevel=0)
    uv = ob.data.uv_layers.active.data
    for p in ob.data.polygons:
        if p.normal.x > .5:
            for i in p.loop_indices:
                v = ob.data.vertices[ob.data.loops[i].vertex_index].co
                uv[i].uv = (.5 - v.y / width, v.z / height + .5)
    if tilt_y:
        ob.rotation_euler = (0.0, tilt_y, 0.0)
    if frame_mat is not None:
        # Thin perimeter backing frame seated flush behind the +X board face.
        bx = pos[0] - math.cos(tilt_y) * (thickness * .55)
        bz = pos[2] + math.sin(tilt_y) * (thickness * .55)
        box(f'{name}-back', (bx, pos[1], bz), (thickness * .7, width + .06, height + .06), frame_mat,
            bevel=.01, rot=(0.0, tilt_y, 0.0))
    return ob


def rail(z_mid, length=4.0):
    # Rolled W-profile open at module ends for seamless butt joints.
    profile = [(-.045, -.15), (.025, -.10), (.045, -.06), (-.015, 0), (.045, .06), (.025, .10), (-.045, .15)]
    verts = [(x, yy, z_mid + z) for yy in (-length / 2, length / 2) for x, z in profile]
    faces = [(i, i + 1, i + 8, i + 7) for i in range(6)]
    me = bpy.data.meshes.new('rolled-profile')
    me.from_pydata(verts, [], faces)
    ob = bpy.data.objects.new('rail', me)
    bpy.context.collection.objects.link(ob)
    finish(ob, 'rolled-rail', rail_steel)


def fence(length=4.0, height=3.5, z_base=0.0, overhang=0.65, overhang_rise=0.60):
    """Tall continuous trackside catch fence with overhang arm, tension cables, and wire infill."""
    top = z_base + height
    y_post = -length / 2.0
    if z_base < 0.05:
        box('post-base', (0, y_post, .04), (.24, .24, .08), dark_steel, bevel=.008)
    rod('post', (0, y_post, z_base), (0, y_post, top), .055, steel)
    rod('overhang', (0, y_post, top), (overhang, y_post, top + overhang_rise), .045, steel)
    if lod == 0:
        # Gusset brace at the overhang elbow.
        rod('overhang-gusset', (0, y_post, top - .35), (overhang * .45, y_post, top + overhang_rise * .45), .022, dark_steel)
    # Main vertical tension cables spanning full module length.
    cable_levels = [z_base + height * f for f in (.08, .32, .56, .80, 1.0)]
    for z in cable_levels:
        rod('tension-cable', (.01, -length / 2, z), (.01, length / 2, z), .012, steel, segs=6)
    # Overhang cables spanning full module length along the angled top.
    for frac in (.5, 1.0):
        ox = overhang * frac
        oz = top + overhang_rise * frac
        rod('overhang-cable', (ox, -length / 2, oz), (ox, length / 2, oz), .011, steel, segs=6)
    if lod < 2:
        # Coarse real mesh near camera; dropped at far LOD to prevent aliasing shimmer.
        gap = .20 if lod == 0 else .40
        z_start = z_base + .12
        for i in range(round(length / gap) + 1):
            yy = -length / 2 + i * gap
            rod('mesh-vertical', (.008, yy, z_start), (.008, yy, top), .005, steel, segs=5, smooth=False)
            if lod == 0 and i % 2 == 0:
                rod('mesh-overhang', (.008, yy, top), (overhang, yy, top + overhang_rise), .005, steel, segs=5, smooth=False)
        steps = max(1, round((height - .15) / gap))
        for i in range(1, steps):
            zz = z_start + i * gap
            if zz < top - .05:
                rod('mesh-horizontal', (.008, -length / 2, zz), (.008, length / 2, zz), .005, steel, segs=5, smooth=False)


def stand(roof):
    # +X faces the track, length tiles along Z. Row positions agree with dressing constants.
    for r in range(10):
        x, h = 4.25 - r * .85, 1.6 + r * .42
        box('tread', (x, 0, h - .09), (.86, 10, .18), concrete, bevel=.01)
        # Closed concrete riser under each tread so tiers are solid from trackside.
        box('riser', (x + .39, 0, h - .28), (.08, 10, .42), concrete, bevel=0)
        if lod < 2:
            for z in range(16):
                zz = -4.5 + z * .55
                box('seat-pan', (x + .06, zz, h + .40), (.40, .44, .06), seat, bevel=.012)
                box('seat-back', (x - .13, zz, h + .64), (.06, .44, .44), seat, bevel=.012, rot=(0.0, -.12, 0.0))
                if lod == 0:
                    box('seat-leg', (x + .02, zz, h + .20), (.06, .08, .38), dark_steel, bevel=0)
        else:
            box('seat-row', (x, 0, h + .45), (.42, 9.2, .36), seat, bevel=0)
        attachments.append({'name': f'crowd-row-{r}', 'position': [x, h + .42, -4.5], 'axis': [0, 0, 1], 'count': 16, 'spacing': .55})
        for step in range(2):
            box('access-step', (x + .21 - step * .42, 4.65, h - .21 + step * .21), (.42, .7, .18), concrete, bevel=.01)
    # Front fascia wall below row 0.
    box('front-wall', (4.68, 0, .82), (.16, 10, 1.64), concrete, bevel=.015)
    box('front-top-rail', (4.68, 0, 2.15), (.06, 10, .06), dark_steel, bevel=0)
    for y in (-4.8, -2.4, 0.0, 2.4, 4.8):
        rod('front-stanchion', (4.68, y, 1.64), (4.68, y, 2.20), .028, dark_steel)
    # Structural rakers, columns, base plates, and rear bracing.
    for y in (-4.7, 4.7):
        rod('raker', (4.5, y, 1.4), (-4.5, y, 5.8), .14, dark_steel)
        for x, h in ((4.5, 1.6), (0.0, 3.85), (-4.5, 5.8)):
            box('col-base', (x, y, .05), (.42, .42, .10), concrete, bevel=.01)
            box('column', (x, y, h / 2), (.20, .20, h), dark_steel, bevel=.01)
        rod('side-guard', (4.65, y, 2.55), (-4.6, y, 6.95), .032, steel)
        if lod < 2:
            rod('diagonal-brace', (-4.5, y, .15), (0.0, y, 3.8), .045, dark_steel)
            rod('diagonal-brace', (0.0, y, .15), (-4.5, y, 5.6), .045, dark_steel)
    # Rear wind/modesty cladding and top guardrail with stanchions.
    box('rear-cladding', (-4.65, 0, 6.2), (.10, 10, 1.4), steel, bevel=0)
    for z in (6.95, 7.35):
        rod('back-guard', (-4.62, -5, z), (-4.62, 5, z), .032, dark_steel)
    for y in (-4.8, -1.6, 1.6, 4.8):
        rod('back-stanchion', (-4.62, y, 5.5), (-4.62, y, 7.38), .032, dark_steel)
    if roof:
        # Cantilevered roof sloping gently downward toward rear for drainage; beams, purlins and deck meet flush.
        roof_slope = math.atan2(8.5 - 9.2, -4.6 - 4.7)  # rises slightly toward front (+X)
        for y in (-4.7, 4.7):
            box('roof-column', (-4.6, y, 4.35), (.28, .28, 8.7), dark_steel, bevel=.012)
            # Cantilever beam from rear column (-4.6, 8.55) to front tip (4.8, 9.25).
            rod('roof-beam', (-4.6, y, 8.55), (4.8, y, 9.25), .13, dark_steel)
            # Diagonal knee strut supporting the cantilever.
            rod('roof-strut', (-4.6, y, 6.7), (-1.4, y, 8.78), .075, dark_steel)
        # Roof deck tilted by exact slope so it sits flush atop the beams.
        box('roof-deck', (0.1, 0, 9.02), (10.0, 10.0, .14), steel, bevel=0, rot=(0.0, -roof_slope, 0.0))
        # Front roof fascia valance for a crisp broadcast silhouette.
        box('roof-fascia', (5.05, 0, 9.22), (.12, 10.0, .42), paint, bevel=.01)
        for ix in (-3.6, -1.2, 1.2, 3.6):
            frac = (ix - (-4.6)) / (4.8 - (-4.6))
            pz = 8.55 + frac * (9.25 - 8.55) - .04
            rod('roof-purlin', (ix, -5.0, pz), (ix, 5.0, pz), .045, dark_steel)


def pit():
    # Ground-floor slab, full-height rear wall (no gap under roof), and structural piers.
    box('floor', (0, 0, .10), (10, 6, .20), concrete, bevel=.01)
    box('rear-wall', (-4.85, 0, 3.5), (.30, 6, 7.0), concrete, bevel=.01)
    for y in (-2.85, 2.85):
        box('pier', (0, y, 3.5), (10, .30, 7.0), concrete, bevel=.015)
    # Recessed dark garage bay backdrop and ribbed roller shutter door.
    box('garage-door', (4.68, 0, 1.85), (.12, 5.4, 3.7), steel, bevel=.01)
    box('door-header', (4.86, 0, 3.74), (.24, 5.4, .18), dark_steel, bevel=.01)
    if lod < 2:
        for h in range(1, 18):
            box('door-seam', (4.76, 0, h * .20), (.025, 5.3, .018), dark_steel, bevel=0)
    # Team board over garage with canonical [0,1] UVs on +X face.
    board_panel('team-board', (4.95, 0, 4.18), 5.3, .70, thickness=.04, frame_mat=dark_steel)
    # Upper-floor slab and hospitality glazing with dark interior backing and mullions.
    box('upper-floor', (0, 0, 4.72), (10.1, 6, .26), concrete, bevel=.012)
    box('upper-backing', (4.60, 0, 5.75), (.08, 5.4, 1.75), rubber, bevel=0)
    box('upper-glazing', (4.80, 0, 5.75), (.06, 5.4, 1.70), glass, bevel=0)
    for y in (-2.65, -1.32, 0.0, 1.32, 2.65):
        box('mullion', (4.85, y, 5.75), (.10, .07, 1.80), dark_steel, bevel=.006)
    box('transom', (4.85, 0, 4.92), (.12, 5.4, .08), dark_steel, bevel=.006)
    box('transom-top', (4.85, 0, 6.62), (.12, 5.4, .08), dark_steel, bevel=.006)
    # Roof slab, front parapet trim, and terrace guardrail WITH vertical stanchions.
    box('roof', (0.15, 0, 7.0), (10.3, 6.0, .28), concrete, bevel=.015)
    box('roof-fascia', (5.28, 0, 7.05), (.10, 6.0, .38), paint, bevel=.01)
    for y in (-2.85, -1.42, 0.0, 1.42, 2.85):
        rod('terrace-stanchion', (5.12, y, 7.12), (5.12, y, 8.15), .028, dark_steel)
    for h in (7.62, 8.12):
        rod('terrace-rail', (5.12, -3.0, h), (5.12, 3.0, h), .028, steel)
    for z in (-1.8, 0, 1.8):
        attachments.append({'name': f'garage-crew-{z}', 'position': [6.2, 0, z], 'front': '+X', 'role': 'mechanic'})
    attachments.append({'name': 'pit-box-crew', 'position': [9, 0, 0], 'front': '+X', 'role': 'mechanic'})
    attachments.append({'name': 'team-board', 'position': [4.98, 4.18, 0], 'size': [5.3, .70], 'uv': [0, 0, 1, 1]})


def gantry():
    for y in (-9.0, 9.0):
        box('footing', (0, y, .18), (1.5, 1.5, .36), concrete, bevel=.025)
        for x in (-.40, .40):
            rod('upright', (x, y, .36), (x, y, 7.2), .12, steel)
        if lod < 2:
            for h in range(1, 7):
                rod('leg-rung', (-.40, y, h), (.40, y, h), .045, dark_steel)
                if h < 6:
                    rod('leg-diag', (-.40, y, h), (.40, y, h + 1), .035, dark_steel)
    # 3D box truss span across the straight.
    for x in (-.40, .40):
        for h in (6.1, 7.2):
            rod('chord', (x, -9.0, h), (x, 9.0, h), .095, steel)
        for y in range(-9, 9):
            rod('truss', (x, y, 6.1), (x, y + 1, 7.2), .045, steel)
    for y in range(-9, 10, 2):
        rod('cross-bot', (-.40, y, 6.1), (.40, y, 6.1), .045, dark_steel)
        rod('cross-top', (-.40, y, 7.2), (.40, y, 7.2), .045, dark_steel)
    # UV-mapped sponsor/circuit header board on +X face.
    board_panel('board-face', (.49, 0, 6.65), 12.0, .85, thickness=.06, frame_mat=dark_steel)
    # Five dark recessed start-light pods with sun hoods and separately addressable emissive lamps.
    box('light-bar', (.10, 0, 6.02), (.14, 3.8, .12), dark_steel, bevel=.01)
    for i in range(5):
        y = (i - 2) * .72
        box('light-housing', (.12, y, 5.50), (.46, .56, .74), rubber, bevel=.02)
        if lod < 2:
            # Top visor hood over each lamp to keep afternoon sun off the lens.
            box('light-hood', (.42, y, 5.84), (.22, .54, .04), dark_steel, bevel=.006)
        ob = rod(f'start-light-{i}', (.34, y, 5.50), (.39, y, 5.50), .19, red)
        ob['channel'] = i
        attachments.append({'name': f'start-light-{i}', 'position': [.39, 5.50, y], 'node': f'start-light-{i}'})
    attachments.append({'name': 'board-face', 'position': [.53, 6.65, 0], 'size': [12.0, .85], 'uv': [0, 0, 1, 1]})


def sign_board(width=1.0, height=1.3, bottom_z=0.55, twin_posts=False):
    z_mid = bottom_z + height / 2.0
    if twin_posts:
        for y in (-width * .34, width * .34):
            box('post-foot', (-.06, y, .03), (.26, .16, .06), dark_steel, bevel=.006)
            box('post', (-.06, y, z_mid * .78), (.07, .07, z_mid * 1.56), steel, bevel=.006)
    else:
        box('post-foot', (-.06, 0, .03), (.28, .28, .06), dark_steel, bevel=.006)
        box('post', (-.06, 0, z_mid * .82), (.08, .08, z_mid * 1.64), steel, bevel=.006)
        box('post-rail', (-.02, 0, z_mid), (.04, width * .75, .07), dark_steel, bevel=0)
    board_panel('board-face', (.04, 0, z_mid), width, height, thickness=.04, frame_mat=dark_steel)
    attachments.append({'name': 'board-face', 'position': [.07, z_mid, 0], 'size': [width, height], 'uv': [0, 0, 1, 1]})


def hoarding_board(width=4.0, height=0.95):
    """Low-profile grass-edge angled advertising hoarding with rear A-frame steel struts."""
    tilt = -0.22  # ~12.6 deg backward lean so trackside/broadcast cameras read the board face cleanly.
    z_mid = height * .5 * math.cos(abs(tilt)) + .04
    board_panel('board-face', (.06, 0, z_mid), width, height, thickness=.045, tilt_y=tilt, frame_mat=dark_steel)
    for y in (-width * .34, width * .34):
        # Ground runner skids + vertical back post + angled rear strut (grounded at z=0).
        box('skid', (-.26, y, .03), (.68, .08, .06), dark_steel, bevel=.006)
        rod('rear-strut', (-.55, y, .05), (-.06, y, z_mid + .32), .028, steel)
        rod('front-leg', (.02, y, .05), (-.05, y, z_mid + .22), .026, dark_steel)
    attachments.append({'name': 'board-face', 'position': [.10, z_mid, 0], 'size': [width, height], 'uv': [0, 0, 1, 1]})


def person(pose='standing', variant=0, footwear=rubber, trousers=None):
    """Connected, grounded low-poly human silhouette: boots at z=0, legs, pelvis, shaped torso, neck, smooth head."""
    leg_mat = trousers if trousers is not None else cloth
    if pose == 'seated':
        hip_z = 0.50
        for s in (-1, 1):
            y = s * .10
            # Boots planted flat on z=0.0 (no floating).
            box('boot', (.40, y, .045), (.24, .10, .09), footwear, bevel=.012)
            knee = (.36, y, .46)
            rod('shin', (.36, y, .07), knee, .058, leg_mat, segs=8 if lod == 0 else 6)
            rod('thigh', (0.0, y, hip_z), knee, .076, leg_mat, segs=8 if lod == 0 else 6)
        box('pelvis', (0.0, 0.0, hip_z), (.22, .32, .14), leg_mat, bevel=.025)
        tapered_rod('torso', (0.0, 0.0, hip_z + .04), (-.02, 0.0, hip_z + .52), .145, .175, cloth, segs=10 if lod == 0 else 6)
        box('shoulders', (-.02, 0.0, hip_z + .47), (.18, .40, .11), cloth, bevel=.03)
        rod('neck', (-.01, 0.0, hip_z + .50), (0.0, 0.0, hip_z + .60), .055, skin, segs=8 if lod == 0 else 6)
        head_pos = (.01, 0.0, hip_z + .70)
        for s in (-1, 1):
            sh = (-.02, s * .19, hip_z + .46)
            if variant == 2 and s == 1:
                # Raised cheering arm.
                el = (.08, s * .25, hip_z + .64)
                ha = (.14, s * .22, hip_z + .88)
            elif variant == 1:
                # Arms folded / resting forward.
                el = (.08, s * .22, hip_z + .26)
                ha = (.24, s * .07, hip_z + .24)
            else:
                # Forearms resting on knees / desk.
                el = (.06, s * .21, hip_z + .24)
                ha = (.28, s * .14, hip_z + .14)
            rod('upper-arm', sh, el, .052, cloth, segs=8 if lod == 0 else 5)
            rod('forearm', el, ha, .044, cloth, segs=8 if lod == 0 else 5)
            bpy.ops.mesh.primitive_uv_sphere_add(segments=6, ring_count=4, radius=.042, location=ha)
            finish(bpy.context.object, 'hand', skin, smooth=True)
    elif pose == 'crouched':
        # Authentic pit-stop mechanic crouch: boots planted flat on z=0, deep knee bend, leaning forward.
        box('boot-l', (.16, .11, .045), (.25, .10, .09), footwear, bevel=.012)
        box('boot-r', (-.16, -.11, .045), (.25, .10, .09), footwear, bevel=.012)
        hip = (-.10, 0.0, .54)
        knee_l = (.24, .12, .44)
        knee_r = (.04, -.12, .22)
        rod('shin-l', (.14, .11, .08), knee_l, .058, leg_mat, segs=8 if lod == 0 else 6)
        rod('thigh-l', (-.10, .10, .54), knee_l, .078, leg_mat, segs=8 if lod == 0 else 6)
        rod('shin-r', (-.16, -.11, .08), knee_r, .058, leg_mat, segs=8 if lod == 0 else 6)
        rod('thigh-r', (-.10, -.10, .54), knee_r, .078, leg_mat, segs=8 if lod == 0 else 6)
        box('pelvis', hip, (.22, .32, .14), leg_mat, bevel=.025)
        sh_ctr = (.10, 0.0, .96)
        tapered_rod('torso', hip, sh_ctr, .145, .175, cloth, segs=10 if lod == 0 else 6)
        box('shoulders', sh_ctr, (.19, .40, .11), cloth, bevel=.03, rot=(0.0, .38, 0.0))
        rod('neck', sh_ctr, (.16, 0.0, 1.06), .055, skin, segs=8 if lod == 0 else 6)
        head_pos = (.19, 0.0, 1.15)
        for s in (-1, 1):
            sh = (.10, s * .19, .95)
            el = (.24, s * .22, .74)
            ha = (.42, s * .14, .66)
            rod('upper-arm', sh, el, .052, cloth, segs=8 if lod == 0 else 5)
            rod('forearm', el, ha, .045, cloth, segs=8 if lod == 0 else 5)
            bpy.ops.mesh.primitive_uv_sphere_add(segments=6, ring_count=4, radius=.044, location=ha)
            finish(bpy.context.object, 'glove', footwear, smooth=True)
    else:
        # Standing pose: 1.74 m realistic adult height, boots flat at z=0.0.
        hip_z = 0.88
        for s in (-1, 1):
            y = s * .105
            box('boot', (.04, y, .045), (.25, .10, .09), footwear, bevel=.012)
            knee = (.02, y, .47)
            rod('shin', (0.0, y, .08), knee, .058, leg_mat, segs=8 if lod == 0 else 6)
            rod('thigh', (0.0, y, hip_z), knee, .076, leg_mat, segs=8 if lod == 0 else 6)
        box('pelvis', (0.0, 0.0, hip_z + .02), (.20, .32, .14), leg_mat, bevel=.025)
        tapered_rod('torso', (0.0, 0.0, hip_z + .05), (0.0, 0.0, hip_z + .56), .142, .175, cloth, segs=10 if lod == 0 else 6)
        box('shoulders', (0.0, 0.0, hip_z + .51), (.18, .42, .11), cloth, bevel=.03)
        rod('neck', (0.0, 0.0, hip_z + .54), (0.0, 0.0, hip_z + .64), .055, skin, segs=8 if lod == 0 else 6)
        head_pos = (.01, 0.0, hip_z + .74)
        for s in (-1, 1):
            sh = (0.0, s * .20, hip_z + .50)
            if variant == 2 and s == 1:
                el = (.06, s * .26, hip_z + .70)
                ha = (.10, s * .24, hip_z + .96)
            elif variant == 1:
                el = (.06, s * .23, hip_z + .28)
                ha = (.16, s * .06, hip_z + .34)
            else:
                el = (.02, s * .22, hip_z + .25)
                ha = (.07, s * .21, hip_z + .04)
            rod('upper-arm', sh, el, .052, cloth, segs=8 if lod == 0 else 5)
            rod('forearm', el, ha, .044, cloth, segs=8 if lod == 0 else 5)
            bpy.ops.mesh.primitive_uv_sphere_add(segments=6, ring_count=4, radius=.042, location=ha)
            finish(bpy.context.object, 'hand', skin, smooth=True)
    bpy.ops.mesh.primitive_uv_sphere_add(
        segments=14 if lod == 0 else 8, ring_count=8 if lod == 0 else 5, radius=.112, location=head_pos
    )
    finish(bpy.context.object, 'head', skin, smooth=True)
    return head_pos


def tower_lattice(height=8.5, base_half=1.1, top_half=0.72):
    """Tapered 4-leg steel lattice truss tower on concrete footings; exact leg-to-leg girts & X-bracing."""
    def leg_xy(h):
        t = h / height
        return base_half + (top_half - base_half) * t

    for sx in (-1, 1):
        for sy in (-1, 1):
            box('footing', (sx * base_half, sy * base_half, .15), (.48, .48, .30), concrete, bevel=.02)
            rod('leg', (sx * base_half, sy * base_half, .28), (sx * top_half, sy * top_half, height), .095, steel)
    bays = 4
    bay_h = (height - .35) / bays
    for b in range(bays):
        h0 = .35 + b * bay_h
        h1 = h0 + bay_h
        r0 = leg_xy(h0)
        r1 = leg_xy(h1)
        # Horizontal perimeter girts at each bay level (all 4 faces).
        for s in (-1, 1):
            rod('girt-y', (s * r1, -r1, h1), (s * r1, r1, h1), .042, dark_steel)
            rod('girt-x', (-r1, s * r1, h1), (r1, s * r1, h1), .042, dark_steel)
        if lod < 2:
            # Diagonal X-bracing strictly connecting leg-to-leg on all 4 faces (zero overhang).
            for s in (-1, 1):
                rod('brace-y', (s * r0, -r0, h0), (s * r1, r1, h1), .032, steel)
                rod('brace-x', (-r0, s * r0, h0), (r1, s * r1, h1), .032, steel)
                if lod == 0:
                    rod('brace-y2', (s * r0, r0, h0), (s * r1, -r1, h1), .028, steel)
                    rod('brace-x2', (r0, s * r0, h0), (-r1, s * r1, h1), .028, steel)


# Per-figure complexion (multiplies the shared skin material) and warm/cool zones of a face,
# written into COLOR_0 on top of the baked AO: cheeks, nose and ears warmer, lips darker, jaw
# shadowed. Values stay at or below 1 so COLOR_0 remains a plain multiplier.
SKIN_TONE = {'crew-engineer-standing': .62, 'crew-engineer-seated': 1.0}
FACE_ZONES = [  # centre relative to the head (author frame), radius, RGB multiplier
    ((.075, .05, -.02), .03, (1.0, .86, .82)), ((.075, -.05, -.02), .03, (1.0, .86, .82)),
    ((.115, 0, -.015), .025, (1.0, .85, .82)), ((-.008, .095, -.012), .03, (1.0, .84, .80)),
    ((-.008, -.095, -.012), .03, (1.0, .84, .80)), ((.092, 0, -.064), .018, (.72, .52, .52)),
    ((.04, 0, -.15), .06, (.78, .76, .76)), ((.08, 0, .05), .035, (.97, .96, .95)),
]


def skin_tone(merged, head, scale):
    hx, hy, hz = head
    for ob in merged:
        if ob.data.materials[0].name != 'skin':
            continue
        attr = ob.data.color_attributes['AO']
        for v, c in zip(ob.data.vertices, attr.data):
            # Merged meshes are laterally mirrored (author y -> -y); the zones are symmetric.
            d = Vector((v.co.x - hx, -v.co.y - hy, v.co.z - hz))
            rgb = [.92 * scale, .90 * scale, .90 * scale]
            for centre, radius, tint in FACE_ZONES:
                w = math.exp(-((d - Vector(centre)).length / radius) ** 2)
                for i in range(3):
                    rgb[i] *= 1 + (tint[i] - 1) * w
            ao = c.color[0]
            c.color = (ao * rgb[0], ao * rgb[1], ao * rgb[2], 1.0)


specs = [
    ('armco-two', 4), ('armco-three', 4), ('concrete-wall', 4), ('tyre-wall', 4),
    ('absorber-block', 2), ('catch-fence', 4), ('grandstand', 10), ('grandstand-roof', 10),
    ('pit-garage', 6), ('pit-wall', 4), ('start-gantry', 0),
]
specs += [(f'crew-{pose}', 0) for pose in ('mechanic-standing', 'mechanic-crouched', 'engineer-standing', 'engineer-seated')]
specs += [(f'crowd-{pose}-{i}', 0) for pose in ('seated', 'standing') for i in range(3)]
specs += [
    ('braking-board', 0), ('zone-board', 0), ('corner-board', 0), ('kilometre-board', 0),
    ('marshal-post', 0), ('hoarding', 4), ('bridge-banner', 0), ('pedestrian-bridge', 0),
    ('screen-tower', 0), ('camera-tower', 0),
]

from kits import SPECS, build as build_kit
specs = SPECS if a.kits_only else specs + SPECS

catalog = {'version': 1, 'units': 'm', 'up': '+Y', 'front': '+X', 'pivot': 'ground-centre', 'props': []}

for ident, module in specs:
    entry = {'id': ident, 'pivot': [0, 0, 0], 'tiles': bool(module), 'moduleLength': module, 'tileAxis': '+Z', 'lods': []}
    for lod in range(3):
        bpy.ops.object.select_all(action='SELECT')
        bpy.ops.object.delete(use_global=False)
        objects, attachments = [], []

        if ident in dict(SPECS):
            build_kit(globals(), ident)

        elif ident.startswith('armco'):
            count = 2 if ident == 'armco-two' else 3
            for i in range(count):
                rail(.42 + i * .32)
            # Standard 2 m post spacing along a 4 m module (starting-end aligned at -1.9 and +0.1).
            for py in (-1.9, 0.1):
                box('post', (-.15, py, .56), (.11, .12, 1.12), dark_steel, bevel=.008)
                box('spacer', (-.07, py, .42 + (count - 1) * .16), (.07, .10, .28 + (count - 1) * .32), steel, bevel=.006)
                if lod == 0:
                    for i in range(count):
                        rod('fixing-bolt', (.04, py, .42 + i * .32), (.065, py, .42 + i * .32), .016, steel, segs=6)

        elif ident == 'concrete-wall':
            # Sloped precast concrete barrier profile with expansion-joint clearance (3.98 m).
            prof = [(-.31, 0.0), (.31, 0.0), (.31, .16), (.23, .30), (.21, 1.20), (-.21, 1.20), (-.23, .30), (-.31, .16)]
            prism_profile('wall', prof, -1.99, 1.99, concrete)
            # Flush painted top band on trackside (+X) upper face.
            box('top-band', (.216, 0, 1.08), (.014, 3.98, .20), paint, bevel=.004)
            if lod == 0:
                # Top lifting pockets / precast keyways.
                for py in (-1.1, 1.1):
                    box('lift-pocket', (0, py, 1.205), (.12, .16, .02), dark_steel, bevel=0)

        elif ident == 'absorber-block':
            # Tecpro-style high-density barrier block with chamfered ribs, top service lid and dark rubber straps.
            box('block', (0, 0, .55), (1.08, 1.96, 1.10), paint, bevel=.075)
            box('top-lid', (0, 0, 1.105), (.74, 1.48, .03), dark_steel, bevel=.008)
            for py in (-.66, .66):
                box('strap-front', (.545, py, .55), (.028, .075, 1.06), rubber, bevel=.005)
                box('strap-top', (0, py, 1.115), (1.10, .075, .025), rubber, bevel=.004)
                box('strap-back', (-.545, py, .55), (.028, .075, 1.06), rubber, bevel=.005)
            if lod == 0:
                for py in (-0.98, 0.98):
                    box('interlock-lug', (0, py, .55), (.36, .04, .70), dark_steel, bevel=.008)

        elif ident == 'tyre-wall':
            if lod < 2:
                # Two rows deep of smooth-shaded stacked rubber tyres behind a bolted conveyor belt.
                for rx in (-0.28, 0.14):
                    for iy in range(6):
                        for iz in range(3):
                            bpy.ops.mesh.primitive_torus_add(
                                major_segments=14 if lod == 0 else 8,
                                minor_segments=7 if lod == 0 else 5,
                                major_radius=.22,
                                minor_radius=.095,
                                location=(rx, -1.65 + iy * .66, .135 + iz * .265),
                            )
                            finish(bpy.context.object, 'stacked-tyre', rubber, smooth=True)
            else:
                box('tyre-core', (-.08, 0, .42), (.92, 4.0, .84), rubber, bevel=0)
            # Front conveyor belt apron + vertical steel clamping bars.
            box('conveyor-belt', (.46, 0, .43), (.045, 4.0, .78), rubber, bevel=.008)
            for py in (-1.35, 0.0, 1.35):
                box('belt-clamp', (.49, py, .43), (.022, .055, .74), dark_steel, bevel=.004)

        elif ident == 'catch-fence':
            fence(length=4.0, height=3.5, z_base=0.0, overhang=.65, overhang_rise=.60)

        elif ident.startswith('grandstand'):
            stand(ident.endswith('roof'))

        elif ident == 'pit-garage':
            pit()

        elif ident == 'pit-wall':
            # Sloped concrete pit wall with painted top band + catch fence ON TOP of the wall (z_base=1.10).
            prof = [(-.24, 0.0), (.24, 0.0), (.24, .14), (.19, 1.10), (-.19, 1.10), (-.24, .14)]
            prism_profile('wall', prof, -2.0, 2.0, concrete)
            box('wall-band', (.196, 0, .99), (.012, 4.0, .16), paint, bevel=0)
            fence(length=4.0, height=1.35, z_base=1.10, overhang=.45, overhang_rise=.35)
            # Timing stand desk, structural columns, canopy, and tilted telemetry monitors on pit side (-X).
            box('desk', (-.78, 0, 1.06), (1.10, 3.2, .09), paint, bevel=.012)
            box('desk-apron', (-1.30, 0, .88), (.06, 3.2, .32), dark_steel, bevel=.008)
            for y in (-1.45, 1.45):
                box('stand-base', (-1.22, y, .03), (.26, .26, .06), dark_steel, bevel=.006)
                rod('timing-stand', (-1.22, y, .06), (-1.22, y, 2.48), .055, dark_steel)
                rod('desk-bracket', (-.22, y, .72), (-1.22, y, 1.02), .035, dark_steel)
                rod('canopy-arm', (-1.22, y, 2.45), (.12, y, 2.55), .045, dark_steel)
            box('canopy', (-.60, 0, 2.56), (1.90, 3.6, .09), steel, bevel=.01, rot=(0.0, -.06, 0.0))
            box('canopy-fascia', (.32, 0, 2.60), (.06, 3.6, .18), paint, bevel=.008)
            if lod < 2:
                for y in (-1.0, 0.0, 1.0):
                    box('monitor-stand', (-.44, y, 1.18), (.06, .08, .16), dark_steel, bevel=0)
                    box('monitor-case', (-.42, y, 1.38), (.06, .52, .32), rubber, bevel=.008, rot=(0.0, -.18, 0.0))
                    box('monitor-screen', (-.455, y, 1.38), (.012, .47, .27), glass, bevel=0, rot=(0.0, -.18, 0.0))
            for z in (-1, 0, 1):
                attachments.append({'name': f'timing-crew-{z}', 'position': [-.95, 0, z], 'front': '+X', 'role': 'engineer'})

        elif ident == 'start-gantry':
            gantry()

        elif ident.startswith('crew'):
            mechanic = 'mechanic' in ident
            if lod == 0:
                from crew import build as build_crew
                pose = 'crouched' if 'crouched' in ident else 'seated' if 'seated' in ident else 'standing'
                head_pos = build_crew(pose, mechanic, finish, cloth, fabric, rubber, skin, glass,
                                      glasses=ident == 'crew-engineer-standing', objects=objects)
            elif 'crouched' in ident:
                head_pos = person('crouched', 0, footwear=rubber, trousers=cloth)
            elif 'seated' in ident:
                head_pos = person('seated', 0, footwear=rubber, trousers=fabric)
            else:
                head_pos = person('standing', 0, footwear=rubber, trousers=cloth if 'mechanic' in ident else fabric)
            hx, hy, hz = head_pos
            if 'mechanic' in ident and lod > 0:
                # Full-face motorsport pit helmet + wrapped visor + chin guard.
                bpy.ops.mesh.primitive_uv_sphere_add(
                    segments=14 if lod == 0 else 8, ring_count=8 if lod == 0 else 5,
                    radius=.134, location=(hx, hy, hz + .015),
                )
                finish(bpy.context.object, 'helmet-shell', cloth, smooth=True)
                box('helmet-chin', (hx + .08, hy, hz - .055), (.11, .16, .07), cloth, bevel=.018)
                box('helmet-visor', (hx + .115, hy, hz + .015), (.04, .18, .075), glass, bevel=.012)
            elif not mechanic:
                # Over-ear pit-wall race headset: curved arch over head + twin earcups + boom mic.
                for a0, a1 in ((-1.35, -.45), (-.45, .45), (.45, 1.35)):
                    p0 = (hx, hy + math.sin(a0) * .132, hz + math.cos(a0) * .138)
                    p1 = (hx, hy + math.sin(a1) * .132, hz + math.cos(a1) * .138)
                    rod('headset-arch', p0, p1, .016, rubber, segs=6)
                for side in (-1, 1):
                    box('earcup', (hx, hy + side * .125, hz), (.075, .042, .095), rubber, bevel=.012)
                rod('microphone', (hx + .02, hy + .13, hz - .02), (hx + .14, hy + .05, hz - .065), .008, rubber, segs=5)
            attachments.append({'name': 'team-tint', 'position': [0, 0, 0], 'material': 'clothing', 'vertexColour': 'AO'})

        elif ident.startswith('crowd'):
            person('seated' if 'seated' in ident else 'standing', int(ident[-1]), footwear=rubber, trousers=fabric)

        elif ident == 'braking-board':
            sign_board(1.0, 1.3, bottom_z=.50, twin_posts=True)
        elif ident == 'zone-board':
            sign_board(1.25, .85, bottom_z=.65, twin_posts=True)
        elif ident == 'corner-board':
            sign_board(1.55, .85, bottom_z=.60, twin_posts=True)
        elif ident == 'kilometre-board':
            sign_board(.85, 1.10, bottom_z=.60, twin_posts=False)
        elif ident == 'hoarding':
            hoarding_board(4.0, .95)

        elif ident == 'marshal-post':
            box('platform', (0, 0, .20), (2.5, 2.5, .40), concrete, bevel=.025)
            for x in (-1.05, 1.05):
                for y in (-1.05, 1.05):
                    rod('post', (x, y, .40), (x, y, 2.75), .055, dark_steel)
            # Safety waist guardrail on back (-X) and both sides (±Y) so marshals are enclosed.
            for h in (.95, 1.35):
                rod('rail-back', (-1.05, -1.05, h), (-1.05, 1.05, h), .028, steel)
                rod('rail-left', (-1.05, 1.05, h), (1.05, 1.05, h), .028, steel)
                rod('rail-right', (-1.05, -1.05, h), (1.05, -1.05, h), .028, steel)
            # Roof slab + painted trim fascia.
            box('roof', (0, 0, 2.80), (2.8, 2.8, .12), steel, bevel=.012)
            box('roof-trim', (1.38, 0, 2.80), (.06, 2.8, .18), paint, bevel=.008)
            # Light panel securely mounted on a horizontal crossbar between the two front posts (no floating!).
            rod('panel-crossbar', (1.05, -1.05, 1.95), (1.05, 1.05, 1.95), .036, dark_steel)
            rod('panel-crossbar-lo', (1.05, -1.05, 1.55), (1.05, 1.05, 1.55), .028, dark_steel)
            box('panel-housing', (1.07, 0, 1.75), (.12, .74, .74), rubber, bevel=.015)
            box('light-panel', (1.135, 0, 1.75), (.02, .65, .65), glass, bevel=0)
            attachments.append({'name': 'light-panel', 'position': [1.15, 1.75, 0], 'size': [.65, .65]})

        elif ident == 'bridge-banner':
            # Wide overhead truss gantry banner spanning the track (distinct from pedestrian-bridge).
            for y in (-10.0, 10.0):
                box('footing', (0, y, .20), (1.6, 1.6, .40), concrete, bevel=.03)
                for x in (-.45, .45):
                    rod('tower-leg', (x, y, .40), (x, y, 7.6), .11, dark_steel)
                if lod < 2:
                    for h in range(1, 7):
                        rod('tower-rung', (-.45, y, h), (.45, y, h), .04, steel)
                        rod('tower-diag', (-.45, y, h), (.45, y, h + 1), .035, steel)
            for x in (-.45, .45):
                for h in (5.9, 7.5):
                    rod('chord', (x, -10.0, h), (x, 10.0, h), .09, dark_steel)
                for y in range(-10, 10, 2):
                    rod('web', (x, y, 5.9), (x, y + 2, 7.5), .045, steel)
            for y in range(-10, 11, 2):
                rod('tie-bot', (-.45, y, 5.9), (.45, y, 5.9), .042, dark_steel)
                rod('tie-top', (-.45, y, 7.5), (.45, y, 7.5), .042, dark_steel)
            board_panel('banner-face', (.52, 0, 6.70), 18.0, 1.45, thickness=.06, frame_mat=dark_steel)
            attachments.append({'name': 'banner-face', 'position': [.56, 6.70, 0], 'size': [18.0, 1.45], 'uv': [0, 0, 1, 1]})

        elif ident == 'pedestrian-bridge':
            # Full enclosed/railed pedestrian footbridge over the track with stanchions, side truss, and banner face.
            for y in (-10.0, 10.0):
                box('pier-foot', (0, y, .20), (2.2, 1.8, .40), concrete, bevel=.03)
                box('pier', (0, y, 3.1), (1.2, 1.1, 5.8), concrete, bevel=.03)
                box('pier-cap', (0, y, 5.85), (3.1, 1.4, .30), concrete, bevel=.02)
            box('deck', (0, 0, 6.20), (3.1, 21.2, .42), concrete, bevel=.02)
            for x in (-1.45, 1.45):
                for h in (6.85, 7.55, 8.65):
                    rod('parapet', (x, -10.4, h), (x, 10.4, h), .055, dark_steel)
                for y in range(-10, 11, 2):
                    rod('stanchion', (x, y, 6.38), (x, y, 8.68), .05, dark_steel)
                    if lod < 2 and y < 10:
                        rod('truss-diag', (x, y, 6.40), (x, y + 2, 8.65), .035, steel)
                # Side walkway safety glazing strip along the bridge corridor.
                box('side-glazing', (x * .97, 0, 7.75), (.04, 20.4, 1.35), glass, bevel=0)
            # Overhead walkway roof framing + deck.
            box('bridge-roof', (0, 0, 8.75), (3.3, 21.0, .14), steel, bevel=.015)
            for y in range(-10, 11, 2):
                rod('roof-rib', (-1.50, y, 8.68), (1.50, y, 8.68), .045, dark_steel)
            board_panel('banner-face', (1.60, 0, 6.95), 18.0, 1.25, thickness=.05, frame_mat=dark_steel)
            attachments.append({'name': 'banner-face', 'position': [1.64, 6.95, 0], 'size': [18.0, 1.25], 'uv': [0, 0, 1, 1]})

        elif ident in ('screen-tower', 'camera-tower'):
            tower_h = 8.4
            tower_lattice(height=tower_h, base_half=1.15, top_half=0.75)
            box('deck', (0, 0, tower_h + .10), (3.1, 3.1, .20), dark_steel, bevel=.015)
            if ident == 'screen-tower':
                # Steel support cradle behind the LED screen + dark matte bezel + dark LED glazing face.
                for y in (-2.2, 0.0, 2.2):
                    rod('screen-strut', (-.55, y * .32, tower_h + .20), (-.25, y, tower_h + 2.6), .06, dark_steel)
                    rod('screen-post', (0.0, y, tower_h + .20), (0.0, y, tower_h + 4.1), .065, dark_steel)
                box('screen-housing', (0.0, 0, tower_h + 2.3), (.52, 7.2, 4.2), rubber, bevel=.03)
                board_panel('screen-face', (.27, 0, tower_h + 2.3), 6.7, 3.7, thickness=.02, frame_mat=None)
                # Override screen-face material to dark LED glass while preserving canonical [0,1] UVs.
                objects[-1].data.materials[0] = glass
                attachments.append({'name': 'screen-face', 'position': [.29, tower_h + 2.3, 0], 'size': [6.7, 3.7], 'uv': [0, 0, 1, 1]})
            else:
                # Full perimeter safety railing on operator deck + 3-legged tripod + broadcast telephoto camera.
                for h in (tower_h + .65, tower_h + 1.15):
                    for s in (-1, 1):
                        rod('deck-rail-y', (s * 1.48, -1.48, h), (s * 1.48, 1.48, h), .028, steel)
                        rod('deck-rail-x', (-1.48, s * 1.48, h), (1.48, s * 1.48, h), .028, steel)
                for sx in (-1.48, 0.0, 1.48):
                    for sy in (-1.48, 1.48):
                        rod('deck-post', (sx, sy, tower_h + .20), (sx, sy, tower_h + 1.18), .028, dark_steel)
                for sy in (0.0,):
                    for sx in (-1.48, 1.48):
                        rod('deck-post', (sx, sy, tower_h + .20), (sx, sy, tower_h + 1.18), .028, dark_steel)
                # 3-legged broadcast tripod.
                head_z = tower_h + 1.45
                for k in range(3):
                    ang = k * 2.0 * math.pi / 3.0 + math.pi / 6.0
                    rod('tripod-leg', (math.cos(ang) * .48, math.sin(ang) * .48, tower_h + .20), (0, 0, head_z), .03, dark_steel)
                box('tripod-head', (0, 0, head_z + .08), (.24, .22, .16), dark_steel, bevel=.01)
                box('camera-body', (-.04, 0, head_z + .34), (.78, .34, .34), rubber, bevel=.02)
                box('camera-battery', (-.48, 0, head_z + .32), (.14, .24, .26), dark_steel, bevel=.01)
                rod('lens-barrel', (.35, 0, head_z + .34), (.82, 0, head_z + .34), .11, rubber)
                box('lens-hood', (.88, 0, head_z + .34), (.16, .28, .26), dark_steel, bevel=.012)
                rod('lens-glass', (.80, 0, head_z + .34), (.84, 0, head_z + .34), .095, glass)

        # Authored coordinates above are X front, Y lateral, Z up; glTF exports (X,Z,-Y).
        # Flip author lateral so delivery Z is positive right, then rotate Blender Z-up frame.
        for ob in objects:
            ob.matrix_world = Matrix(((1, 0, 0, 0), (0, -1, 0, 0), (0, 0, 1, 0), (0, 0, 0, 1))) @ ob.matrix_world
        bpy.context.view_layer.update()
        bpy.ops.object.select_all(action='DESELECT')
        # Merge by material except independently addressable lamps; small instancing draw count.
        groups = {}
        for ob in objects:
            key = ob.name if ob.name.startswith('start-light-') else ob.data.materials[0].name
            groups.setdefault(key, []).append(ob)
        merged = []
        for key, obs in groups.items():
            bpy.ops.object.select_all(action='DESELECT')
            for ob in obs:
                ob.select_set(True)
            bpy.context.view_layer.objects.active = obs[0]
            bpy.ops.object.join()
            ob = bpy.context.object
            ob.name = key
            bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
            # Lateral reflection reverses winding; recalculate normals preserving per-face smoothness.
            bm = bmesh.new()
            bm.from_mesh(ob.data)
            if ident.startswith('forest-') and lod == 2 and 'needles' in key:
                # Opposing coplanar card faces have intentional winding. Volume-based
                # normal recalculation can turn one inward and erase half the crown.
                bmesh.ops.reverse_faces(bm, faces=list(bm.faces))
            else:
                bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
            bm.to_mesh(ob.data)
            bm.free()
            merged.append(ob)
        bake(merged, rays=8 if lod == 0 else 4, max_dist=.3, floor=.65)
        if ident.startswith('forest-') and lod == 2:
            # Cards represent upward-facing needle boughs, not vertical walls. Each direction
            # has an explicitly wound face so backface normal inversion cannot darken it.
            for ob in merged:
                if 'needles' in ob.data.materials[0].name:
                    normals = [(0, 0, 1)] * len(ob.data.loops)
                    for poly in ob.data.polygons:
                        n = Vector((poly.normal.x * .6, poly.normal.y * .6, .8)).normalized()
                        for i in poly.loop_indices:
                            normals[i] = n
                    ob.data.normals_split_custom_set(normals)
        if ident.startswith('crew-engineer'):
            skin_tone(merged, head_pos, SKIN_TONE[ident])
        points = [v.co for ob in merged for v in ob.data.vertices]
        bounds = {
            'min': [min(p.x for p in points), min(p.z for p in points), min(-p.y for p in points)],
            'max': [max(p.x for p in points), max(p.z for p in points), max(-p.y for p in points)],
        }
        if 'seated' in ident:
            # Seat contact: the lowest point under the pelvis (thigh and seat undersides), measured
            # from this LOD's geometry. Feet, shins and hands lie forward of |x| < 0.12. Every LOD
            # must agree with High, or the figure would pop on its seat at the LOD switch.
            under = [p.z for p in points if abs(p.x) < .12 and abs(p.y) < .16 and p.z > .3]
            seat = round(min(under), 3)
            if lod == 0:
                seat_high = seat
            elif abs(seat - seat_high) > .006:
                raise ValueError(f'{ident} LOD {lod} seat {seat} differs from High {seat_high}')
            attachments.append({'name': 'seat', 'position': [0, seat, 0], 'front': '+X'})
        if lod == 0:
            entry['bounds'] = bounds
            entry['attachments'] = attachments
            entry['materials'] = sorted({ob.data.materials[0].name for ob in merged})
        bpy.ops.object.select_all(action='SELECT')
        filename = f'{ident}_{("high", "mobile", "far")[lod]}.glb'
        bpy.ops.export_scene.gltf(
            filepath=os.path.join(a.out, filename),
            export_format='GLB',
            use_selection=True,
            export_yup=True,
            export_extras=True,
            export_vertex_color='ACTIVE',
            export_draco_mesh_compression_enable=True,
            export_draco_mesh_compression_level=7,
            export_image_format='WEBP',
            export_animations=False,
            export_cameras=False,
            export_lights=False,
        )
        entry['lods'].append({
            'file': f'assets/props/{filename}',
            'maxDistance': (80, 250, 1200)[lod],
            'triangleBudget': ((1000, 500, 100) if ident.startswith('forest-') else (4000, 2200, 1800) if ident == 'temporary-grandstand' else (30000, 12000, 2500))[lod],
        })
    catalog['props'].append(entry)

with open(os.path.join(a.out, 'catalog.json'), 'w') as f:
    json.dump(catalog, f, indent=2)
