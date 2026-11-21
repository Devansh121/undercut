"""
UNDERCUT car proof: front wing assembly (nose tip, four-element wing, endplates) built by script.

Run headless with Blender 5.2 LTS:

    blender -b --factory-startup -P tools/car/front_wing.py -- \
        --out /path/to/outdir --hdri /path/to/studio.hdr --samples 256 --team calder

Writes:
    <out>/front_wing.glb          glTF binary, Draco-compressed, with UVs and named materials
    <out>/front_wing_hero.png     Cycles render, three-quarter front view
    <out>/front_wing_top.png      Cycles render, high rear three-quarter view showing the element stack
    <out>/front_wing_stats.json   triangle counts per part, file size

Everything is generated from parameters in this file: airfoil sections are lofted along the span with
spanwise chord, height, sweep and twist laws, so the surfaces are continuous and curved rather than
assembled from primitives. UVs come straight from the loft parameters (u along the profile, v along
the span, scaled to metres) so a carbon weave or livery mask tiles at true scale.

Axes: X lateral (span, +X is the car's left), Y forward (+Y is the front of the car), Z up. Metres.
"""

import argparse
import json
import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

# --------------------------------------------------------------------------------------------
# Arguments
# --------------------------------------------------------------------------------------------
argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument("--out", required=True)
ap.add_argument("--hdri", default="")
ap.add_argument("--samples", type=int, default=256)
ap.add_argument("--res", default="1600x1000")
ap.add_argument("--team", default="calder")
ap.add_argument("--no-render", action="store_true")
ap.add_argument("--lod", choices=["hero", "game"], default="hero")
args = ap.parse_args(argv)
os.makedirs(args.out, exist_ok=True)

LIVERIES = {
    # primary, secondary, accent (linear values are derived below); mirrors design/teams.json
    "calder": ("#00727C", "#F4F1EA", "#D2463A"),
    "kestrel": ("#1F4FBF", "#C3C8D0", "#0E1116"),
    "meridian": ("#E0A030", "#3A3D42", "#FFFFFF"),
}


def srgb_to_linear(hexstr):
    h = hexstr.lstrip("#")
    out = []
    for i in (0, 2, 4):
        c = int(h[i:i + 2], 16) / 255.0
        out.append(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4)
    return (*out, 1.0)


# --------------------------------------------------------------------------------------------
# Scene reset
# --------------------------------------------------------------------------------------------
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
coll = bpy.data.collections.new("FrontWing")
scene.collection.children.link(coll)


# --------------------------------------------------------------------------------------------
# Geometry helpers
# --------------------------------------------------------------------------------------------
def smoothstep(a, b, x):
    t = min(1.0, max(0.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


def naca4(m, p, t, n=36, te_thickness=0.004):
    """Closed NACA 4-digit loop, cosine spaced. Returns [(x, z)] from trailing edge, over the
    upper surface to the leading edge and back along the lower surface (no duplicate TE point).
    The finite trailing edge avoids a knife edge that would break shading."""
    xs = [0.5 * (1 - math.cos(math.pi * i / n)) for i in range(n + 1)]
    up, lo = [], []
    for x in xs:
        yt = 5 * t * (0.2969 * math.sqrt(x) - 0.1260 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4)
        yt += te_thickness * 0.5 * x
        if x < p:
            yc = m / (p * p) * (2 * p * x - x * x)
            dy = 2 * m / (p * p) * (p - x)
        else:
            yc = m / ((1 - p) ** 2) * ((1 - 2 * p) + 2 * p * x - x * x)
            dy = 2 * m / ((1 - p) ** 2) * (p - x)
        th = math.atan(dy)
        up.append((x - yt * math.sin(th), yc + yt * math.cos(th)))
        lo.append((x + yt * math.sin(th), yc - yt * math.cos(th)))
    loop = list(reversed(up)) + lo[1:]
    # Inverted wing: camber points down so the suction side is underneath
    return [(x, -z) for x, z in loop]


def build_loft(name, sections, closed=True, cap_start=False, cap_end=False, v_lengths=None):
    """sections: list of lists of Vector, equal length. Builds quads between consecutive sections,
    with UVs: u = normalised arc length round the profile, v = accumulated span length (metres)."""
    bm = bmesh.new()
    uv_layer = bm.loops.layers.uv.new("UVMap")
    rows = [[bm.verts.new(p) for p in sec] for sec in sections]
    n = len(sections[0])
    # arc-length u per section (use the first section's distribution for stability)
    def arc_u(sec):
        d = [0.0]
        rng = range(n) if closed else range(n - 1)
        for i in rng:
            d.append(d[-1] + (sec[(i + 1) % n] - sec[i]).length)
        tot = d[-1] or 1.0
        return [x / tot for x in d]
    v_acc = [0.0]
    for j in range(1, len(sections)):
        mid_prev = sum(sections[j - 1], Vector()) / n
        mid = sum(sections[j], Vector()) / n
        v_acc.append(v_acc[-1] + (mid - mid_prev).length)
    us = [arc_u(s) for s in sections]
    for j in range(len(sections) - 1):
        rng = range(n) if closed else range(n - 1)
        for i in rng:
            i2 = (i + 1) % n
            f = bm.faces.new((rows[j][i], rows[j][i2], rows[j + 1][i2], rows[j + 1][i]))
            uvs = [(us[j][i], v_acc[j]), (us[j][i + 1], v_acc[j]), (us[j + 1][i + 1], v_acc[j + 1]), (us[j + 1][i], v_acc[j + 1])]
            for loop, uv in zip(f.loops, uvs):
                loop[uv_layer].uv = uv
    if cap_start:
        f = bm.faces.new(list(reversed(rows[0])))
        for loop in f.loops:
            co = loop.vert.co
            loop[uv_layer].uv = (co.y, co.z)
    if cap_end:
        f = bm.faces.new(rows[-1])
        for loop in f.loops:
            co = loop.vert.co
            loop[uv_layer].uv = (co.y, co.z)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    coll.objects.link(ob)
    return ob


def finish_shading(ob, sharp_deg=50.0):
    """Smooth shading with sharp edges above the given dihedral angle (exported as split normals)."""
    me = ob.data
    bm = bmesh.new()
    bm.from_mesh(me)
    lim = math.radians(sharp_deg)
    for f in bm.faces:
        f.smooth = True
    for e in bm.edges:
        if len(e.link_faces) == 2:
            e.smooth = e.calc_face_angle(0.0) < lim
        else:
            e.smooth = False
    bm.to_mesh(me)
    bm.free()


def add_mirror(ob):
    m = ob.modifiers.new("MirrorX", "MIRROR")
    m.use_axis = (True, False, False)
    m.use_clip = True
    m.merge_threshold = 0.0005


def apply_modifiers(ob):
    dg = bpy.context.evaluated_depsgraph_get()
    ev = ob.evaluated_get(dg)
    me = bpy.data.meshes.new_from_object(ev, preserve_all_data_layers=True, depsgraph=dg)
    ob.modifiers.clear()
    old = ob.data
    ob.data = me
    bpy.data.meshes.remove(old)


# --------------------------------------------------------------------------------------------
# Nose dimensions (shared by the nose loft and by the wing elements, which end inside its sides)
# --------------------------------------------------------------------------------------------
NOSE_Y_TIP, NOSE_Y_END, NOSE_CAP = 0.12, -1.25, 0.14


def nose_dims(y):
    """Half-width, half-height and centre height of the nose section at station y."""
    d = NOSE_Y_TIP - y
    f = smoothstep(0.0, 1.0, (d - 0.05) / 1.3)
    hw = 0.046 + 0.080 * f ** 0.8
    hh = 0.040 + 0.068 * f ** 0.9
    zc = 0.138 + 0.15 * smoothstep(0.25, 1.45, d) + 0.012 * smoothstep(0.0, 0.4, d)
    return hw, hh, zc


# --------------------------------------------------------------------------------------------
# Wing elements
# --------------------------------------------------------------------------------------------
# --------------------------------------------------------------------------------------------
X_IN, X_OUT = 0.10, 0.955          # inboard end (inside nose), outboard end (inside endplate)
N_SPAN = 56 if args.lod == "hero" else 28
ARGS_PROFILE_N = 36 if args.lod == "hero" else 14

ELEMENTS = [
    # name, chord, LE y, LE z, angle deg, camber m, p, thickness t
    ("main_plane", 0.300, 0.000, 0.080, 3.0, 0.060, 0.40, 0.085),
    ("flap_1",     0.165, -0.252, 0.116, 15.0, 0.070, 0.42, 0.075),
    ("flap_2",     0.135, -0.372, 0.170, 27.0, 0.075, 0.42, 0.070),
    ("flap_3",     0.112, -0.462, 0.236, 39.0, 0.075, 0.42, 0.065),
]


def span_stations(x_in=X_IN):
    # denser towards the tip where the surfaces curve the most
    return [x_in + (X_OUT - x_in) * (1 - (1 - i / (N_SPAN - 1)) ** 1.6) for i in range(N_SPAN)]


def element_x_in(idx):
    """Inboard end of an element: 75% of the nose half-width at the element's mid-chord, so the
    end is buried in the nose side instead of showing a cut face."""
    _, chord, le_y = ELEMENTS[idx][:3]
    hw, _, _ = nose_dims(le_y - 0.5 * chord)
    return min(X_IN, 0.75 * hw)


def element_frame(idx, x):
    """Spanwise laws for element idx at lateral station x: returns (chord, LE y, LE z, angle rad)."""
    _, chord, le_y, le_z, ang = ELEMENTS[idx][:5]
    s = (x - X_IN) / (X_OUT - X_IN)
    tip = smoothstep(0.55, 1.0, s)
    # chord: flaps fuller mid-span, every element shortens into the tip
    c = chord * (1.0 + (0.16 if idx else 0.05) * math.sin(math.pi * min(1, s / 0.8))) * (1 - 0.22 * tip ** 2)
    # planform sweep (LE moves back outboard) and a smooth outboard rise towards the endplate
    y = le_y - 0.05 * s * s + (0.025 * idx) * tip
    z = le_z + (0.045 + 0.012 * idx) * tip ** 1.4
    # inboard: flaps step down slightly where they meet the nose
    z -= 0.022 * idx * (1 - smoothstep(0.0, 0.25, s))
    # outboard offload: flaps lose angle near the tip, the main plane gains a little
    a = math.radians(ang * (1 - 0.30 * tip) + (1.5 if idx == 0 else 0.0) * tip)
    return c, y, z, a


def element_sections(idx, chord, le_y, le_z, ang, m, p, t):
    prof = naca4(m, p, t, n=ARGS_PROFILE_N)
    secs = []
    for x in span_stations(element_x_in(idx)):
        c, y, z, a = element_frame(idx, x)
        sec = []
        for (u, w) in prof:
            # chord runs rearwards (-Y); rotate by -a in the YZ plane so rearward points rise
            cy, cz = -u * c, w * c
            ry = cy * math.cos(a) + cz * math.sin(a)
            rz = -cy * math.sin(a) + cz * math.cos(a)
            sec.append(Vector((x, y + ry, z + rz)))
        secs.append(sec)
    return secs


elements = []
for i, (nm, *pars) in enumerate(ELEMENTS):
    ob = build_loft(nm, element_sections(i, *pars), closed=True, cap_start=True, cap_end=True)
    finish_shading(ob, 60)
    add_mirror(ob)
    elements.append(ob)

# Gurney flap along the top flap trailing edge (thin L-section strip)
def gurney_sections():
    secs = []
    for x in span_stations(element_x_in(3))[:-2]:
        c, y, z, a = element_frame(3, x)
        ty, tz = y - c * math.cos(a), z + c * math.sin(a)
        h, th = 0.012, 0.0025
        nrm = Vector((0, math.sin(a), math.cos(a)))
        tan = Vector((0, -math.cos(a), math.sin(a)))
        base = Vector((x, ty, tz))
        secs.append([base, base + nrm * h, base + nrm * h + tan * th, base + tan * th])
    return secs


gurney = build_loft("gurney", gurney_sections(), closed=True, cap_start=True, cap_end=True)
finish_shading(gurney, 40)
add_mirror(gurney)

# --------------------------------------------------------------------------------------------
# Endplates: 2D curve outline, extruded and bevelled, then canted inwards
# --------------------------------------------------------------------------------------------
def endplate():
    cu = bpy.data.curves.new("endplate_curve", "CURVE")
    cu.dimensions = "2D"
    cu.fill_mode = "BOTH"
    cu.extrude = 0.004
    cu.bevel_depth = 0.0035
    cu.bevel_resolution = 3 if args.lod == "hero" else 1
    cu.resolution_u = 18 if args.lod == "hero" else 6
    sp = cu.splines.new("BEZIER")
    # outline in (y, z): front foot, leading edge sweeping up, rounded top, rear edge, footplate
    pts = [
        ((0.07, 0.035), "AUTO"),
        ((0.06, 0.15), "AUTO"),
        ((-0.06, 0.24), "AUTO"),
        ((-0.30, 0.33), "AUTO"),
        ((-0.52, 0.385), "AUTO"),
        ((-0.60, 0.35), "AUTO"),
        ((-0.615, 0.12), "AUTO"),
        ((-0.58, 0.035), "AUTO"),
        ((-0.25, 0.022), "AUTO"),
    ]
    sp.bezier_points.add(len(pts) - 1)
    for bp, ((y, z), ht) in zip(sp.bezier_points, pts):
        bp.co = (y, z, 0)
        bp.handle_left_type = ht
        bp.handle_right_type = ht
    sp.use_cyclic_u = True
    ob = bpy.data.objects.new("endplate", cu)
    coll.objects.link(ob)
    # curve plane is XY; map to the YZ plane at the wing tip and cant 4 degrees inwards at the top
    ob.matrix_world = (Matrix.Translation((0.972, 0, 0)) @ Matrix.Rotation(math.radians(-2), 4, "Y")
                       @ Matrix([[0, 0, 1, 0], [1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 0, 1]]))
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg), depsgraph=dg)
    mw = ob.matrix_world.copy()
    bpy.data.objects.remove(ob)
    bpy.data.curves.remove(cu)
    mob = bpy.data.objects.new("endplate", me)
    mob.matrix_world = mw
    coll.objects.link(mob)
    # bake transform, add UVs by box projection in metres
    me.transform(mob.matrix_world)
    mob.matrix_world = Matrix.Identity(4)
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    uvl = bm.loops.layers.uv.new("UVMap")
    for f in bm.faces:
        for l in f.loops:
            l[uvl].uv = (l.vert.co.y * 2, l.vert.co.z * 2)
    bm.to_mesh(me)
    bm.free()
    finish_shading(mob, 35)
    add_mirror(mob)
    return mob


plate = endplate()

# Outboard dive vane on the endplate (a small cambered strake)
def strake_sections():
    prof = naca4(0.05, 0.4, 0.08, n=16 if args.lod == "hero" else 8)
    secs = []
    nk = 10 if args.lod == "hero" else 5
    for k in range(nk):
        s = k / (nk - 1)
        x = 0.978 + 0.055 * s
        c = 0.14 * (1 - 0.55 * s)
        y, z, a = 0.03 - 0.03 * s, 0.13 + 0.02 * s, math.radians(-12)
        sec = []
        for (u, w) in prof:
            cy, cz = -u * c, w * c
            sec.append(Vector((x, y + cy * math.cos(a) + cz * math.sin(a), z - cy * math.sin(a) + cz * math.cos(a))))
        secs.append(sec)
    return secs


strake = build_loft("dive_vane", strake_sections(), closed=True, cap_start=True, cap_end=True)
finish_shading(strake, 60)
add_mirror(strake)

# --------------------------------------------------------------------------------------------
# Nose: superellipse sections lofted from a rounded tip back towards the chassis
# --------------------------------------------------------------------------------------------
def nose_sections(n_ring=48 if args.lod == "hero" else 24, n_len=44 if args.lod == "hero" else 22):
    y_tip, y_end, cap = NOSE_Y_TIP, NOSE_Y_END, NOSE_CAP
    secs = []
    for j in range(n_len):
        t = j / (n_len - 1)
        y = y_tip - (y_tip - y_end) * (t ** 1.25)
        d = y_tip - y
        hw, hh, zc = nose_dims(y)
        k = math.sqrt(max(0.0, min(1.0, d / cap))) if d < cap else 1.0
        k = max(k, 0.02)
        ring = []
        for i in range(n_ring):
            th = 2 * math.pi * i / n_ring
            c, s = math.cos(th), math.sin(th)
            e_top, e_bot = 2.6, 3.4                     # flatter underside than top
            e = e_top if s >= 0 else e_bot
            px = math.copysign(abs(c) ** (2 / e), c) * hw * k
            pz = math.copysign(abs(s) ** (2 / e), s) * hh * k
            # gentle central ridge on the top surface
            pz += 0.008 * k * max(0.0, s) * (1 - abs(c)) ** 3
            ring.append(Vector((px, y, zc + pz)))
        secs.append(ring)
    return secs


nose = build_loft("nose", nose_sections(), closed=True, cap_start=True, cap_end=True)
finish_shading(nose, 70)

# --------------------------------------------------------------------------------------------
# Materials (Principled BSDF only, so they translate to glTF metallic-roughness + clearcoat)
# --------------------------------------------------------------------------------------------
P, S, A = (srgb_to_linear(c) for c in LIVERIES.get(args.team, LIVERIES["calder"]))


def principled(name):
    mat = bpy.data.materials.new(name)
    if hasattr(mat, "use_nodes"):
        try:
            mat.use_nodes = True
        except Exception:
            pass
    nt = mat.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    return mat, nt, bsdf


def carbon_material():
    mat, nt, b = principled("carbon_twill")
    uv = nt.nodes.new("ShaderNodeTexCoord")
    mapn = nt.nodes.new("ShaderNodeMapping")
    mapn.inputs["Scale"].default_value = (1.0, 1.0, 1.0)
    nt.links.new(uv.outputs["UV"], mapn.inputs["Vector"])
    # 2x2 twill approximated with a rotated checker at 6 mm tow width; UVs are in metres
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(mapn.outputs["Vector"], sep.inputs["Vector"])
    mathu = nt.nodes.new("ShaderNodeMath"); mathu.operation = "MULTIPLY"; mathu.inputs[1].default_value = 1.0
    nt.links.new(sep.outputs["X"], mathu.inputs[0])
    comb = nt.nodes.new("ShaderNodeCombineXYZ")
    nt.links.new(mathu.outputs[0], comb.inputs["X"])
    nt.links.new(sep.outputs["Y"], comb.inputs["Y"])
    rot = nt.nodes.new("ShaderNodeMapping")
    rot.inputs["Rotation"].default_value = (0, 0, math.radians(45))
    rot.inputs["Scale"].default_value = (110.0, 110.0, 1.0)
    nt.links.new(comb.outputs["Vector"], rot.inputs["Vector"])
    chk = nt.nodes.new("ShaderNodeTexChecker")
    chk.inputs["Scale"].default_value = 1.0
    chk.inputs["Color1"].default_value = (0.010, 0.010, 0.011, 1)
    chk.inputs["Color2"].default_value = (0.032, 0.032, 0.035, 1)
    nt.links.new(rot.outputs["Vector"], chk.inputs["Vector"])
    nt.links.new(chk.outputs["Color"], b.inputs["Base Color"])
    b.inputs["Roughness"].default_value = 0.42
    b.inputs["Metallic"].default_value = 0.0
    b.inputs["Coat Weight"].default_value = 1.0
    b.inputs["Coat Roughness"].default_value = 0.06
    if "Anisotropic" in b.inputs:
        b.inputs["Anisotropic"].default_value = 0.4
    return mat


def paint_material(name, base, band=None, band_lo=0.0, band_hi=0.0, pin=None):
    """Clear-coated paint. Optional livery band in object Z (stand-in for the M2 livery mask)."""
    mat, nt, b = principled(name)
    b.inputs["Roughness"].default_value = 0.32
    b.inputs["Coat Weight"].default_value = 1.0
    b.inputs["Coat Roughness"].default_value = 0.03
    if band is None:
        b.inputs["Base Color"].default_value = base
        return mat
    tc = nt.nodes.new("ShaderNodeTexCoord")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(tc.outputs["Object"], sep.inputs["Vector"])
    # band where z (relative to a sloped line along the nose) is within [lo, hi]
    slope = nt.nodes.new("ShaderNodeMath"); slope.operation = "MULTIPLY_ADD"
    slope.inputs[1].default_value = 0.13
    nt.links.new(sep.outputs["Y"], slope.inputs[0])
    nt.links.new(sep.outputs["Z"], slope.inputs[2])
    lo = nt.nodes.new("ShaderNodeMath"); lo.operation = "GREATER_THAN"; lo.inputs[1].default_value = band_lo
    hi = nt.nodes.new("ShaderNodeMath"); hi.operation = "LESS_THAN"; hi.inputs[1].default_value = band_hi
    nt.links.new(slope.outputs[0], lo.inputs[0]); nt.links.new(slope.outputs[0], hi.inputs[0])
    both = nt.nodes.new("ShaderNodeMath"); both.operation = "MULTIPLY"
    nt.links.new(lo.outputs[0], both.inputs[0]); nt.links.new(hi.outputs[0], both.inputs[1])
    # side panels only: keep the band off the top and bottom surfaces
    geo = nt.nodes.new("ShaderNodeNewGeometry")
    nsep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(geo.outputs["Normal"], nsep.inputs["Vector"])
    nabs = nt.nodes.new("ShaderNodeMath"); nabs.operation = "ABSOLUTE"
    nt.links.new(nsep.outputs["X"], nabs.inputs[0])
    side = nt.nodes.new("ShaderNodeMath"); side.operation = "GREATER_THAN"; side.inputs[1].default_value = 0.45
    nt.links.new(nabs.outputs[0], side.inputs[0])
    both2 = nt.nodes.new("ShaderNodeMath"); both2.operation = "MULTIPLY"
    nt.links.new(both.outputs[0], both2.inputs[0]); nt.links.new(side.outputs[0], both2.inputs[1])
    both = both2
    mix = nt.nodes.new("ShaderNodeMix"); mix.data_type = "RGBA"
    mix.inputs[6].default_value = base
    mix.inputs[7].default_value = band
    nt.links.new(both.outputs[0], mix.inputs[0])
    out_col = mix.outputs[2]
    if pin is not None:
        plo = nt.nodes.new("ShaderNodeMath"); plo.operation = "GREATER_THAN"; plo.inputs[1].default_value = band_lo - 0.006
        phi = nt.nodes.new("ShaderNodeMath"); phi.operation = "LESS_THAN"; phi.inputs[1].default_value = band_lo
        nt.links.new(slope.outputs[0], plo.inputs[0]); nt.links.new(slope.outputs[0], phi.inputs[0])
        pb0 = nt.nodes.new("ShaderNodeMath"); pb0.operation = "MULTIPLY"
        nt.links.new(plo.outputs[0], pb0.inputs[0]); nt.links.new(phi.outputs[0], pb0.inputs[1])
        pb = nt.nodes.new("ShaderNodeMath"); pb.operation = "MULTIPLY"
        nt.links.new(pb0.outputs[0], pb.inputs[0]); nt.links.new(side.outputs[0], pb.inputs[1])
        mix2 = nt.nodes.new("ShaderNodeMix"); mix2.data_type = "RGBA"
        nt.links.new(pb.outputs[0], mix2.inputs[0])
        nt.links.new(out_col, mix2.inputs[6])
        mix2.inputs[7].default_value = pin
        out_col = mix2.outputs[2]
    nt.links.new(out_col, b.inputs["Base Color"])
    return mat


m_carbon = carbon_material()
m_nose = paint_material("paint_nose", P, band=S, band_lo=0.205, band_hi=0.232, pin=A)
m_primary = paint_material("paint_primary", P)
m_secondary = paint_material("paint_secondary", S)
m_accent = paint_material("paint_accent", A)

nose.data.materials.append(m_nose)
for i, ob in enumerate(elements):
    ob.data.materials.append(m_carbon if i < 2 else m_primary)
elements[0].data.materials.append(m_primary)
gurney.data.materials.append(m_accent)
plate.data.materials.append(m_carbon)
plate.data.materials.append(m_secondary)
bm = bmesh.new()
bm.from_mesh(plate.data)
for f in bm.faces:
    f.material_index = 1 if f.normal.x > 0.6 else 0
bm.to_mesh(plate.data)
bm.free()
strake.data.materials.append(m_carbon)

# Paint the upper surface of the main plane's outboard third in the team colour (livery split)
bm = bmesh.new()
bm.from_mesh(elements[0].data)
for f in bm.faces:
    c = f.calc_center_median()
    if c.x > 0.62 and f.normal.z > 0.2:
        f.material_index = 1
bm.to_mesh(elements[0].data)
bm.free()

# --------------------------------------------------------------------------------------------
# Apply mirrors, gather stats, export glTF (Draco)
# --------------------------------------------------------------------------------------------
parts = elements + [gurney, plate, strake]
for ob in parts:
    apply_modifiers(ob)

stats = {}
for ob in coll.objects:
    me = ob.data
    me.calc_loop_triangles()
    stats[ob.name] = len(me.loop_triangles)
stats["total_triangles"] = sum(v for k, v in stats.items())

for ob in bpy.context.view_layer.objects:
    ob.select_set(ob.name in coll.objects)
glb = os.path.join(args.out, "front_wing.glb")
bpy.ops.export_scene.gltf(
    filepath=glb,
    export_format="GLB",
    use_selection=True,
    export_apply=True,
    export_draco_mesh_compression_enable=True,
    export_draco_mesh_compression_level=7,
    export_draco_position_quantization=14,
    export_draco_normal_quantization=10,
    export_draco_texcoord_quantization=12,
)
stats["glb_bytes"] = os.path.getsize(glb)
print("STATS", json.dumps(stats))

# --------------------------------------------------------------------------------------------
# Render setup: studio sweep, HDRI lighting, one softbox, Cycles on the GPU
# --------------------------------------------------------------------------------------------
if args.no_render:
    with open(os.path.join(args.out, "front_wing_stats.json"), "w") as fh:
        json.dump(stats, fh, indent=2)
    sys.exit(0)


def sweep():
    bm = bmesh.new()
    prof = []
    for i in range(24):            # floor
        prof.append((6.0 - 7.5 * i / 23, 0.0))
    r = 2.0
    for i in range(1, 17):         # cove
        a = math.pi / 2 * i / 16
        prof.append((-1.5 - r * math.sin(a), r - r * math.cos(a)))
    prof.append((-3.5, 7.0))
    left = [bm.verts.new((-9, y, z)) for (y, z) in prof]
    right = [bm.verts.new((9, y, z)) for (y, z) in prof]
    for i in range(len(prof) - 1):
        bm.faces.new((left[i], right[i], right[i + 1], left[i + 1]))
    me = bpy.data.meshes.new("sweep")
    bm.to_mesh(me)
    bm.free()
    for p in me.polygons:
        p.use_smooth = True
    ob = bpy.data.objects.new("sweep", me)
    scene.collection.objects.link(ob)
    mat, nt, b = principled("studio_floor")
    b.inputs["Base Color"].default_value = (0.018, 0.019, 0.021, 1)
    b.inputs["Roughness"].default_value = 0.38
    me.materials.append(mat)


sweep()

world = bpy.data.worlds.new("studio")
scene.world = world
if hasattr(world, "use_nodes"):
    try:
        world.use_nodes = True
    except Exception:
        pass
wn = world.node_tree
bg = next(n for n in wn.nodes if n.type == "BACKGROUND")
if args.hdri and os.path.exists(args.hdri):
    env = wn.nodes.new("ShaderNodeTexEnvironment")
    env.image = bpy.data.images.load(args.hdri)
    mp = wn.nodes.new("ShaderNodeMapping")
    mp.inputs["Rotation"].default_value = (0, 0, math.radians(120))
    tc = wn.nodes.new("ShaderNodeTexCoord")
    wn.links.new(tc.outputs["Generated"], mp.inputs["Vector"])
    wn.links.new(mp.outputs["Vector"], env.inputs["Vector"])
    wn.links.new(env.outputs["Color"], bg.inputs["Color"])
    bg.inputs["Strength"].default_value = 0.9
else:
    bg.inputs["Color"].default_value = (0.05, 0.05, 0.055, 1)

def area(name, loc, rot, size, energy, color=(1, 1, 1)):
    ld = bpy.data.lights.new(name, "AREA")
    ld.shape = "RECTANGLE"
    ld.size, ld.size_y = size
    ld.energy = energy
    ld.color = color
    ob = bpy.data.objects.new(name, ld)
    ob.location = loc
    ob.rotation_euler = rot
    scene.collection.objects.link(ob)
    return ob

area("softbox_top", (0.3, -0.2, 2.6), (0, 0, 0), (2.4, 0.9), 320)
area("strip_left", (2.4, 1.2, 0.9), (math.radians(70), 0, math.radians(120)), (0.3, 2.0), 140, (1.0, 0.96, 0.92))
area("strip_rear", (-1.5, -2.4, 1.2), (math.radians(-60), 0, math.radians(-30)), (0.3, 2.0), 90, (0.9, 0.95, 1.0))

cam_d = bpy.data.cameras.new("cam")
cam_d.lens = 60
cam_d.dof.use_dof = True
cam_d.dof.aperture_fstop = 5.6
cam = bpy.data.objects.new("cam", cam_d)
scene.collection.objects.link(cam)
scene.camera = cam


def look_at(ob, eye, target):
    ob.location = eye
    d = Vector(target) - Vector(eye)
    ob.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    cam_d.dof.focus_distance = d.length


rx, ry = (int(v) for v in args.res.split("x"))
scene.render.engine = "CYCLES"
scene.render.resolution_x, scene.render.resolution_y = rx, ry
scene.render.resolution_percentage = 100
scene.cycles.samples = args.samples
scene.cycles.use_denoising = True
scene.cycles.use_adaptive_sampling = True
scene.view_settings.view_transform = "AgX"
try:
    scene.view_settings.look = "AgX - Medium High Contrast"
except TypeError:
    pass
scene.render.film_transparent = False

try:
    prefs = bpy.context.preferences.addons["cycles"].preferences
    for dev_type in ("OPTIX", "CUDA"):
        try:
            prefs.compute_device_type = dev_type
            prefs.get_devices()
            gpus = [d for d in prefs.devices if d.type == dev_type]
            if gpus:
                for d in prefs.devices:
                    d.use = d.type == dev_type
                scene.cycles.device = "GPU"
                print("CYCLES DEVICE", dev_type, [d.name for d in gpus])
                break
        except TypeError:
            continue
except Exception as exc:  # fall back to CPU quietly
    print("GPU setup failed, using CPU:", exc)

shots = [
    ("front_wing_hero.png", (2.55, 2.45, 0.70), (0.10, -0.32, 0.17)),
    ("front_wing_top.png", (-2.1, 1.9, 1.75), (0.05, -0.35, 0.12)),
]
for fname, eye, tgt in shots:
    look_at(cam, eye, tgt)
    scene.render.filepath = os.path.join(args.out, fname)
    bpy.ops.render.render(write_still=True)

with open(os.path.join(args.out, "front_wing_stats.json"), "w") as fh:
    json.dump(stats, fh, indent=2)
print("DONE", args.out)
