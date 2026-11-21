"""Deterministic modular circuit kit. Author in the delivery frame, convert at export."""
import argparse
import json
import math
import os
import sys

import bpy
from mathutils import Vector, Matrix

sys.path.insert(0, os.path.abspath('tools/car'))
from carlib.ao import bake

args = argparse.ArgumentParser()
args.add_argument('--out', required=True)
a = args.parse_args(sys.argv[sys.argv.index('--') + 1:])
os.makedirs(a.out, exist_ok=True)


def material(name, colour, roughness, metallic=0, emission=0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes.get('Principled BSDF')
    b.inputs['Base Color'].default_value = (*colour, 1)
    b.inputs['Roughness'].default_value = roughness
    b.inputs['Metallic'].default_value = metallic
    if emission:
        b.inputs['Emission Color'].default_value = (*colour, 1)
        b.inputs['Emission Strength'].default_value = emission
    return m

steel = material('galvanised', (.40, .44, .46), .42, .8)
concrete = material('concrete', (.46, .44, .40), .9)
rubber = material('rubber', (.027, .029, .031), .92)
paint = material('paint-band', (.22, .30, .32), .55)
seat = material('seat', (.045, .13, .19), .67)
glass = material('glazing', (.065, .12, .16), .16, .55)
face = material('board-face', (.84, .83, .78), .63)
red = material('lamp-red', (.35, .002, .001), .3, emission=2)
cloth = material('clothing', (.48, .5, .53), .95)
skin = material('skin', (.43, .24, .15), .86)

# A shared, deterministic metric detail tile survives glTF export without Blender shaders.
image = bpy.data.images.new('surface-grain', width=64, height=64)
image.pixels = [v for y in range(64) for x in range(64)
                for v in (3 * [.80 + .20 * ((x * 73 + y * 151 + x * y * 17) % 101) / 100] + [1])]
for m in (steel, concrete, rubber, paint, cloth):
    nt = m.node_tree
    b = nt.nodes.get('Principled BSDF')
    tex = nt.nodes.new('ShaderNodeTexImage')
    tex.image = image
    mix = nt.nodes.new('ShaderNodeMixRGB')
    mix.blend_type = 'MULTIPLY'
    mix.inputs[0].default_value = 1
    mix.inputs[1].default_value = b.inputs['Base Color'].default_value
    nt.links.new(tex.outputs['Color'], mix.inputs[2])
    nt.links.new(mix.outputs[0], b.inputs['Base Color'])

objects = []
lod = 0
attachments = []


def finish(ob, name, mat):
    ob.name = name
    ob.data.materials.append(mat)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    # Metric UVs, fixed XY projection with height on vertical surfaces.
    if not ob.data.uv_layers:
        ob.data.uv_layers.new()
    uv = ob.data.uv_layers.active.data
    for p in ob.data.polygons:
        for i in p.loop_indices:
            v = ob.data.vertices[ob.data.loops[i].vertex_index].co
            uv[i].uv = (v.y * 3, v.z * 3) if abs(p.normal.x) > .5 else (v.x * 3, (v.y if abs(p.normal.z) > .5 else v.z) * 3)
    objects.append(ob)
    return ob


def box(name, pos, size, mat=steel, bevel=.015):
    bpy.ops.mesh.primitive_cube_add(size=1, location=pos)
    ob = bpy.context.object
    ob.scale = size
    finish(ob, name, mat)
    if bevel and lod == 0:
        mod = ob.modifiers.new('edge-radius', 'BEVEL')
        mod.width = min(bevel, min(size) * .18)
        mod.segments = 1
        bpy.context.view_layer.objects.active = ob
        bpy.ops.object.modifier_apply(modifier=mod.name)
        ob.modifiers.new('weighted-corner-normals', 'WEIGHTED_NORMAL')
        bpy.ops.object.modifier_apply(modifier=ob.modifiers[-1].name)
    return ob


def rod(name, a, b, radius=.035, mat=steel):
    d = Vector(b) - Vector(a)
    bpy.ops.mesh.primitive_cylinder_add(vertices=10 if lod == 0 else 6, radius=radius, depth=d.length,
                                      location=(Vector(a) + Vector(b)) / 2)
    ob = bpy.context.object
    ob.rotation_euler = d.to_track_quat('Z', 'Y').to_euler()
    return finish(ob, name, mat)


def rail(y, length=4):
    # Rolled W-profile, open at module ends for seamless butt joints.
    profile = [(-.045, -.15), (.025, -.10), (.045, -.06), (-.015, 0), (.045, .06), (.025, .10), (-.045, .15)]
    verts = [(x, yy, y + z) for yy in (-length / 2, length / 2) for x, z in profile]
    faces = [(i, i + 1, i + 8, i + 7) for i in range(6)]
    me = bpy.data.meshes.new('rolled-profile')
    me.from_pydata(verts, [], faces)
    ob = bpy.data.objects.new('rail', me)
    bpy.context.collection.objects.link(ob)
    finish(ob, 'rolled-rail', steel)
    me.materials[0].use_backface_culling = False


def fence(length=4, height=3):
    for z in (-length / 2,):
        rod('post', (0, z, 0), (0, z, height), .055)
        rod('overhang', (0, z, height), (.55, z, height + .6), .045)
    for y in (.5, 1.4, 2.3, height):
        rod('tension-cable', (0, -length / 2, y), (0, length / 2, y), .012)
    if lod < 2:
        # Coarse real mesh near camera; no alpha sorting or transparent shadow mismatch.
        gap = .20 if lod == 0 else .4
        for i in range(round(length / gap) + 1):
            z = -length / 2 + i * gap
            rod('mesh-vertical', (.005, z, .15), (.005, z, height), .005)
        for i in range(1, round(height / gap)):
            y = i * gap
            rod('mesh-horizontal', (.005, -length / 2, y), (.005, length / 2, y), .005)


def stand(roof):
    # +X faces the track, length tiles along Z. Row positions agree with dressing constants.
    for r in range(10):
        x, h = 4.25 - r * .85, 1.6 + r * .42
        box('tread', (x, 0, h - .09), (.85, 10, .18), concrete)
        if lod < 2:
            for z in range(16):
                zz = -4.5 + z * .55
                box('seat-pan', (x + .06, zz, h + .4), (.40, .46, .07), seat)
                box('seat-back', (x - .14, zz, h + .64), (.07, .46, .45), seat)
        else:
            box('seat-row', (x, 0, h + .42), (.4, 9, .25), seat, 0)
        attachments.append({'name': f'crowd-row-{r}', 'position': [x, h + .42, -4.5], 'axis': [0, 0, 1], 'count': 16, 'spacing': .55})
        for step in range(2):
            box('access-step', (x + .21 - step * .42, 4.65, h - .21 + step * .21), (.42, .7, .18), concrete)
    for z in (-4.7, 4.7):
        rod('raker', (4.5, z, 1.4), (-4.5, z, 5.8), .13)
        for x, h in ((4.5, 1.6), (0, 3.9), (-4.5, 5.8)):
            box('column', (x, z, h / 2), (.18, .18, h))
        rod('front-guard', (4.65, z, 2.6), (-4.6, z, 7), .035)
        if lod < 2:
            rod('diagonal-brace', (-4.5, z, .1), (0, z, 3.8), .045)
    for y in (6.5, 7):
        rod('back-guard', (-4.5, -5, y), (-4.5, 5, y), .04)
    if roof:
        for z in (-4.7, 4.7):
            box('roof-column', (-4.5, z, 4.5), (.25, .25, 9))
            rod('roof-beam', (-4.5, z, 8.9), (4.5, z, 8.2), .12)
        box('roof', (0, 0, 9), (10, 10, .16), steel)
        for z in range(-4, 5, 2):
            rod('roof-purlin', (-5, z, 8.85), (5, z, 8.85), .05)


def pit():
    box('floor', (0, 0, .1), (10, 6, .2), concrete)
    box('rear-wall', (-4.85, 0, 3), (.3, 6, 6), concrete)
    for z in (-2.85, 2.85):
        box('pier', (0, z, 3.5), (10, .3, 7), concrete)
    box('garage-door', (4.72, 0, 1.8), (.12, 5.3, 3.6), steel)
    for h in range(1, 18):
        if lod < 2:
            box('door-seam', (4.8, 0, h * .2), (.025, 5.2, .018), rubber, 0)
    box('team-board', (4.95, 0, 4.15), (.05, 5.3, .7), face)
    box('upper-floor', (0, 0, 4.7), (10, 6, .25), concrete)
    box('upper-glazing', (4.8, 0, 5.7), (.09, 5.4, 1.6), glass)
    for z in (-1.8, 0, 1.8):
        box('mullion', (4.86, z, 5.7), (.12, .08, 1.7))
    box('roof', (0, 0, 7), (10.3, 6, .25), concrete)
    for h in (7.5, 8):
        rod('terrace-rail', (5, -3, h), (5, 3, h), .035)
    for z in (-1.8, 0, 1.8):
        attachments.append({'name': f'garage-crew-{z}', 'position': [6.2, 0, z], 'front': '+X', 'role': 'mechanic'})
    attachments.append({'name': 'pit-box-crew', 'position': [9, 0, 0], 'front': '+X', 'role': 'mechanic'})
    attachments.append({'name': 'team-board', 'position': [5, 4.15, 0], 'size': [5.3, .7]})


def gantry():
    for z in (-9, 9):
        box('footing', (0, z, .15), (1.4, 1.4, .3), concrete)
        for x in (-.35, .35):
            rod('upright', (x, z, .3), (x, z, 7), .12)
    for x in (-.35, .35):
        for h in (6.1, 7):
            rod('chord', (x, -9, h), (x, 9, h), .09)
        for z in range(-9, 9):
            rod('truss', (x, z, 6.1), (x, z + 1, 7), .045)
    box('board-face', (.44, 0, 6.6), (.08, 12, .7), face)
    for i in range(5):
        z = (i - 2) * .7
        box('light-housing', (.1, z, 5.6), (.5, .55, .7), rubber)
        ob = rod(f'start-light-{i}', (.37, z, 5.6), (.4, z, 5.6), .19, red)
        ob['channel'] = i
        attachments.append({'name': f'start-light-{i}', 'position': [.4, 5.6, z], 'node': f'start-light-{i}'})
    attachments.append({'name': 'board-face', 'position': [.49, 6.6, 0], 'size': [12, .7]})


def board(width=1, height=1.4):
    box('post', (0, 0, .65), (.09, .09, 1.3))
    ob = box('board-face', (.05, 0, 1.5), (.05, width, height), face)
    # Canonical UV square on the +X face for dressing's atlas.
    uv = ob.data.uv_layers.active.data
    for p in ob.data.polygons:
        if p.normal.x > .5:
            for i in p.loop_indices:
                v = ob.data.vertices[ob.data.loops[i].vertex_index].co
                uv[i].uv = (v.y / width + .5, v.z / height + .5)
    attachments.append({'name': 'board-face', 'position': [.08, 1.5, 0], 'size': [width, height], 'uv': [0, 0, 1, 1]})


def person(seated, variant):
    hip = .65 if seated else .9
    rod('torso', (0, 0, hip), (0, 0, hip + .45), .17, cloth)
    bpy.ops.mesh.primitive_uv_sphere_add(segments=12 if lod == 0 else 8, ring_count=6 if lod == 0 else 4,
                                      radius=.115, location=(0, 0, hip + .64))
    finish(bpy.context.object, 'head', skin)
    for s in (-1, 1):
        knee = (.32 if seated else .02, s * .10, hip - (.08 if seated else .43))
        rod('thigh', (0, s * .1, hip), knee, .08, cloth)
        rod('shin', knee, (knee[0], s * .10, .07), .06, rubber)
        rod('arm', (0, s * .2, hip + .37), (.22, s * .25, hip + .12 + variant * .05), .052, cloth)


specs = [('armco-two', 4), ('armco-three', 4), ('concrete-wall', 4), ('tyre-wall', 4), ('absorber-block', 2), ('catch-fence', 4), ('grandstand', 10), ('grandstand-roof', 10), ('pit-garage', 6), ('pit-wall', 4), ('start-gantry', 0)]
specs += [(f'crew-{pose}', 0) for pose in ('mechanic-standing', 'mechanic-crouched', 'engineer-standing', 'engineer-seated')]
specs += [(f'crowd-{pose}-{i}', 0) for pose in ('seated', 'standing') for i in range(3)]
specs += [(s, 0) for s in ('braking-board', 'zone-board', 'corner-board', 'kilometre-board', 'marshal-post', 'hoarding', 'bridge-banner', 'pedestrian-bridge', 'screen-tower', 'camera-tower')]
catalog = {'version': 1, 'units': 'm', 'up': '+Y', 'front': '+X', 'pivot': 'ground-centre', 'props': []}
for ident, module in specs:
    entry = {'id': ident, 'pivot': [0, 0, 0], 'tiles': bool(module), 'moduleLength': module, 'tileAxis': '+Z', 'lods': []}
    for lod in range(3):
        bpy.ops.object.select_all(action='SELECT')
        bpy.ops.object.delete(use_global=False)
        objects, attachments = [], []
        if ident.startswith('armco'):
            count = 2 if ident == 'armco-two' else 3
            for i in range(count):
                rail(.45 + i * .32)
            box('post', (-.12, -1.9, .55), (.12, .14, 1.1))
            if lod == 0:
                for i in range(count):
                    rod('fixing-bolt', (.045, -1.9, .45 + i * .32), (.065, -1.9, .45 + i * .32), .018)
        elif ident == 'concrete-wall':
            box('wall', (0, 0, .6), (.55, 3.98, 1.2), concrete, .045)
            box('top-band', (.28, 0, 1.03), (.012, 3.98, .18), paint)
        elif ident == 'absorber-block':
            box('block', (0, 0, .55), (1.1, 1.98, 1.1), paint, .09)
            for z in (-.7, .7):
                box('strap', (.56, z, .55), (.025, .06, 1.05), rubber)
        elif ident == 'tyre-wall':
            if lod < 2:
                for z in range(6):
                    for y in range(3):
                        bpy.ops.mesh.primitive_torus_add(major_segments=16 if lod == 0 else 8, minor_segments=6 if lod == 0 else 4,
                                                        major_radius=.22, minor_radius=.09, location=(0, -1.65 + z * .66, .13 + y * .26))
                        finish(bpy.context.object, 'stacked-tyre', rubber)
            else:
                box('tyre-core', (0, 0, .4), (.6, 4, .8), rubber, 0)
            box('conveyor-belt', (.32, 0, .38), (.045, 4, .68), rubber)
        elif ident == 'catch-fence':
            fence()
        elif ident.startswith('grandstand'):
            stand(ident.endswith('roof'))
        elif ident == 'pit-garage':
            pit()
        elif ident == 'pit-wall':
            box('wall', (0, 0, .55), (.45, 4, 1.1), concrete)
            box('desk', (-.7, 0, 1.1), (1.2, 3, .10), paint)
            for z in (-1.4, 1.4):
                rod('timing-stand', (-1, z, 0), (-1, z, 2.3))
            box('canopy', (-.6, 0, 2.3), (1.8, 3.5, .08))
            fence(4, 1.8)
            for z in (-1, 0, 1):
                attachments.append({'name': f'timing-crew-{z}', 'position': [-.85, 0, z], 'front': '+X', 'role': 'engineer'})
        elif ident == 'start-gantry':
            gantry()
        elif ident.startswith('crew'):
            seated = ident.endswith(('seated', 'crouched'))
            person(seated, 0)
            hip = .65 if seated else .9
            if 'mechanic' in ident:
                bpy.ops.mesh.primitive_uv_sphere_add(segments=12 if lod == 0 else 8, ring_count=6 if lod == 0 else 4, radius=.132, location=(0, 0, hip + .67))
                finish(bpy.context.object, 'helmet-shell', cloth)
                box('helmet-visor', (.12, 0, hip + .65), (.025, .17, .07), glass, .015)
            else:
                rod('headset-band', (0, -.13, hip + .68), (0, .13, hip + .68), .016, rubber)
                for side in (-1, 1):
                    box('earcup', (0, side * .12, hip + .62), (.08, .04, .09), rubber)
                rod('microphone', (.02, .14, hip + .62), (.15, .08, hip + .56), .009, rubber)
            attachments.append({'name': 'team-tint', 'position': [0, 0, 0], 'material': 'clothing', 'vertexColour': 'AO'})
        elif ident.startswith('crowd'):
            person('seated' in ident, int(ident[-1]))
        elif ident in ('braking-board', 'zone-board', 'corner-board', 'kilometre-board', 'hoarding'):
            board(4 if ident == 'hoarding' else 1, 1 if ident == 'hoarding' else 1.4)
        elif ident == 'marshal-post':
            box('platform', (0, 0, .2), (2.5, 2.5, .4), concrete)
            for x in (-1, 1):
                for z in (-1, 1):
                    rod('post', (x, z, .4), (x, z, 2.7), .05)
            box('roof', (0, 0, 2.7), (2.8, 2.8, .12))
            box('light-panel', (1.04, 0, 1.8), (.08, .65, .65), glass)
            attachments.append({'name': 'light-panel', 'position': [1.1, 1.8, 0], 'size': [.65, .65]})
        elif ident in ('bridge-banner', 'pedestrian-bridge'):
            for z in (-10, 10):
                box('pier', (0, z, 3), (1, 1, 6), concrete)
            box('deck', (0, 0, 6.2), (3, 21, .4), concrete)
            for x in (-1.5, 1.5):
                for h in (6.6, 7.5):
                    rod('parapet', (x, -10, h), (x, 10, h), .06)
            box('banner-face', (1.58, 0, 6.8), (.04, 18, 1), face)
            attachments.append({'name': 'banner-face', 'position': [1.61, 6.8, 0], 'size': [18, 1]})
        elif ident in ('screen-tower', 'camera-tower'):
            for x in (-1, 1):
                for z in (-1, 1):
                    rod('leg', (x, z, 0), (x * .7, z * .7, 8), .1)
                    if lod < 2:
                        for h in range(0, 8, 2):
                            rod('brace', (x, -1, h), (x, 1, h + 2), .04)
            box('deck', (0, 0, 8), (3, 3, .2))
            if ident == 'screen-tower':
                box('screen-housing', (0, 0, 10), (.5, 7, 4), rubber)
                box('screen-face', (.26, 0, 10), (.02, 6.6, 3.6), glass)
                attachments.append({'name': 'screen-face', 'position': [.28, 10, 0], 'size': [6.6, 3.6]})
            else:
                rod('tripod', (0, 0, 8.1), (0, 0, 9.3), .06)
                box('camera', (0, 0, 9.4), (.8, .35, .35), rubber)
                rod('lens', (.4, 0, 9.4), (.8, 0, 9.4), .12, glass)
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
            # A lateral reflection reverses winding.
            import bmesh
            bm = bmesh.new()
            bm.from_mesh(ob.data)
            bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
            bm.to_mesh(ob.data)
            bm.free()
            merged.append(ob)
        bake(merged, rays=8 if lod == 0 else 4, max_dist=.3, floor=.65)
        points = [v.co for ob in merged for v in ob.data.vertices]
        bounds = {'min': [min(p.x for p in points), min(p.z for p in points), min(-p.y for p in points)],
                  'max': [max(p.x for p in points), max(p.z for p in points), max(-p.y for p in points)]}
        if lod == 0:
            entry['bounds'] = bounds
            entry['attachments'] = attachments
            entry['materials'] = sorted({ob.data.materials[0].name for ob in merged})
        bpy.ops.object.select_all(action='SELECT')
        filename = f'{ident}_{("high", "mobile", "far")[lod]}.glb'
        bpy.ops.export_scene.gltf(filepath=os.path.join(a.out, filename), export_format='GLB', use_selection=True,
                                  export_yup=True, export_extras=True, export_vertex_color='ACTIVE',
                                  export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=7,
                                  export_image_format='WEBP', export_animations=False, export_cameras=False, export_lights=False)
        entry['lods'].append({'file': f'assets/props/{filename}', 'maxDistance': (80, 250, 1200)[lod],
                              'triangleBudget': (30000, 12000, 2500)[lod]})
    catalog['props'].append(entry)
with open(os.path.join(a.out, 'catalog.json'), 'w') as f:
    json.dump(catalog, f, indent=2)
