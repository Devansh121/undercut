"""Front wing (four elements, endplates), rear wing (main plane, DRS flap, endplates, swan-neck
pylons, actuator pod) and beam wing. Elements are NACA sections lofted along smooth spanwise laws:
no waves, only a monotone rise and twist towards the tips."""

import math

from mathutils import Vector

from . import dims as D
from .geom import AtlasPatch, Mesh, Pchip, clamp, lerp, loft, naca4, smoothstep


# ---------------------------------------------------------------------------------------------
# Generic plate: an outline in a plane, filled by concentric rings with a rounded edge
# ---------------------------------------------------------------------------------------------
def plate(mesh, outline, centre, thick, mat, to3d, n_rings, n_bevel, patch_key=None, patches=None,
          inner_mat=None):
    """outline: closed list of (a, b) plane coordinates, counter-clockwise seen from the outer
    side; centre: a point the outline is star-shaped about. to3d(a, b, side) maps plane
    coordinates and a side offset (metres, + towards the outer face) to a 3D point.
    The outer face (side +) carries the atlas patch; the inner face can take another material."""
    ca, cb = centre
    m = len(outline)
    rings_out = []
    for k in range(n_rings + 1):
        s = 0.02 + 0.98 * (k / n_rings) ** 0.8
        rings_out.append([(ca + (a - ca) * s, cb + (b - cb) * s) for (a, b) in outline])
    # outward 2D normals of the outline
    nrm = []
    for i in range(m):
        a0, b0 = outline[i - 1]
        a1, b1 = outline[(i + 1) % m]
        ta, tb = a1 - a0, b1 - b0
        ln = math.hypot(ta, tb) or 1.0
        nrm.append((tb / ln, -ta / ln))
    r = thick / 2
    # rings, in order: outer face centre -> edge, bevel round the edge, inner face edge -> centre
    grid_outer = [[to3d(a, b, r) for (a, b) in ring] for ring in rings_out]
    bevel = []
    for k in range(1, n_bevel):
        ang = math.pi * k / n_bevel
        bevel.append([to3d(a + nrm[i][0] * r * math.sin(ang), b + nrm[i][1] * r * math.sin(ang), r * math.cos(ang))
                      for i, (a, b) in enumerate(outline)])
    grid_inner = [[to3d(a, b, -r) for (a, b) in ring] for ring in reversed(rings_out)]
    loft(mesh, grid_outer, mat, closed=True, cap0=True, patch_key=patch_key, patches=patches)
    if patch_key is not None:
        c3 = to3d(ca, cb, r)
        n3 = to3d(ca, cb, r + 0.01) - c3
        patches[-1].normal_hint = tuple(n3.normalized())
    loft(mesh, [grid_outer[-1]] + bevel + [grid_inner[0]], mat, closed=True)
    loft(mesh, grid_inner, inner_mat or mat, closed=True, cap1=True)


# ---------------------------------------------------------------------------------------------
# Front wing
# ---------------------------------------------------------------------------------------------
FW_TIP = D.FRONT_WING_HALF_SPAN - 0.022  # elements end inside the endplate
# name, chord at centre, chord at tip, angle inboard, angle outboard (deg), camber, thickness
FW_ELEMENTS = [
    ("fw_main", 0.300, 0.225, 2.0, 7.0, 0.050, 0.090),
    ("fw_flap1", 0.175, 0.125, 6.0, 17.0, 0.065, 0.080),
    ("fw_flap2", 0.145, 0.105, 11.0, 29.0, 0.070, 0.075),
    ("fw_flap3", 0.120, 0.092, 16.0, 40.0, 0.070, 0.072),
]


def fw_rise(s):
    """Height the whole stack gains towards the endplate (front view 'smile')."""
    return 0.022 * smoothstep(0.35, 1.0, s) ** 1.3 + 0.012 * smoothstep(0.8, 1.0, s)


def fw_sections(y):
    """Leading edge, chord and angle of each element at span station y (left side)."""
    s = clamp(y / FW_TIP)
    out = []
    sst = smoothstep(0.22, 1.0, s) ** 1.3
    le = Vector((D.X_FRONT_WING_LE - 0.050 * s * s, y, D.Z_FRONT_WING_MAIN + 0.018 - 0.010 * smoothstep(0.1, 0.5, s)
                 + fw_rise(s)))
    for k, (_, c0, c1, a0, a1, cam, th) in enumerate(FW_ELEMENTS):
        chord = lerp(c0, c1, smoothstep(0.2, 1.0, s))
        ang = math.radians(lerp(a0, a1, sst))
        if k > 0:
            # slot: the next element starts just above and a little ahead of the previous
            # trailing edge, along the previous element's chord normal
            pc, pa, ple = out[-1][1], out[-1][2], out[-1][0]
            te = ple + Vector((-pc * math.cos(pa), 0, pc * math.sin(pa)))
            nrm = Vector((math.sin(pa), 0, math.cos(pa)))
            tan = Vector((math.cos(pa), 0, -math.sin(pa)))
            le = te + nrm * 0.014 + tan * 0.022
            le.y = y
        out.append((le.copy(), chord, ang, cam, th))
    return out


def fw_span(q):
    n = q.n(34, 8)
    return [FW_TIP * (1 - math.cos(0.5 * math.pi * k / n)) ** 0.9 if k else 0.0 for k in range(n + 1)]


def build_front_wing(mesh_paint, mesh_carbon, patches, q):
    ys = fw_span(q)
    nprof = q.n(32, 10)
    for k, (name, *_rest) in enumerate(FW_ELEMENTS):
        cam, th = FW_ELEMENTS[k][5], FW_ELEMENTS[k][6]
        prof = naca4(cam, 0.40, th, nprof, te=0.006, invert=True)
        grid = []
        y_in = 0.0 if k == 0 else 0.05
        for y in ys:
            yy = y_in + (FW_TIP - y_in) * (y / FW_TIP)
            le, chord, ang, _, _ = fw_sections(yy)[k]
            ring = []
            for (u, w) in prof:
                cx, cz = -u * chord, w * chord
                ring.append(Vector((le.x + cx * math.cos(ang) + cz * math.sin(ang), yy,
                                    le.z - cx * math.sin(ang) + cz * math.cos(ang))))
            grid.append(ring)
        m = Mesh()
        painted = k >= 2
        loft(m, grid, "paint" if painted else "carbon", closed=True, cap1=True, cap0=(k > 0),
             patch_key=("fw_flap%d" % k) if painted else None, patches=patches, sharp_cols=(0,))
        (mesh_paint if painted else mesh_carbon).merge(m.with_mirror())
    # endplate: outline in (x, z), bent outwards at the rear (outwash)
    st = fw_sections(FW_TIP)
    te_top = st[3][0] + Vector((-st[3][1] * math.cos(st[3][2]), 0, st[3][1] * math.sin(st[3][2])))
    x0 = D.X_FRONT_WING_LE - 0.02
    x1 = min(te_top.x, 2.48) - 0.03
    ztop = te_top.z + 0.025
    outline = []

    def add_arc(cx, cz, r, a0, a1, n):
        for i in range(n):
            a = math.radians(lerp(a0, a1, i / n))
            outline.append((cx + r * math.cos(a), cz + r * math.sin(a)))

    nb = q.n(6, 2)
    zb = 0.045
    z_front = 0.150
    add_arc(x0 - 0.03, zb + 0.03, 0.03, -90, 0, nb)                     # front foot
    add_arc(x0 - 0.05, z_front - 0.03, 0.05, 0, 75, nb)                 # front top corner
    for i in range(1, 2 * nb):                                          # top edge rising rearwards
        t = i / (2 * nb)
        outline.append((lerp(x0 - 0.06, x1 + 0.07, t), lerp(z_front + 0.02, ztop, t ** 0.75)))
    add_arc(x1 + 0.05, ztop - 0.05, 0.05, 90, 180, nb)                  # rear top corner
    add_arc(x1 + 0.03, zb + 0.06, 0.03, 180, 270, nb)                   # rear foot
    centre = (0.5 * (x0 + x1) - 0.04, zb + 0.07)
    y_in = FW_TIP + 0.002

    def to3d(a, b, side):
        t = clamp((x0 - a) / (x0 - x1))
        y = y_in + 0.010 + 0.035 * t * t - 0.012 * smoothstep(0.6, 1.0, (b - zb) / (ztop - zb))
        return Vector((a, y + side, b))

    m = Mesh()
    plate(m, outline, centre, 0.010, "paint", to3d, q.n(6, 2), q.n(6, 3), patch_key="fw_endplate",
          patches=patches, inner_mat="carbon")
    mesh_paint.merge(m.with_mirror())
    # footplate strake under the endplate
    fp = Mesh()
    rows = []
    for i in range(q.n(10, 4) + 1):
        t = i / q.n(10, 4)
        x = lerp(x0 + 0.02, x1 + 0.05, t)
        y = y_in + 0.012 + 0.035 * t * t
        z = zb + 0.004 + 0.010 * math.sin(math.pi * t)
        rows.append([Vector((x, y + 0.010, z)), Vector((x, y + 0.010, z + 0.004)), Vector((x, y - 0.06, z + 0.012)),
                     Vector((x, y - 0.06, z + 0.006))])
    loft(fp, rows, "carbon", closed=True, cap0=True, cap1=True)
    mesh_carbon.merge(fp.with_mirror())


# ---------------------------------------------------------------------------------------------
# Rear wing
# ---------------------------------------------------------------------------------------------
RW_TIP = D.REAR_WING_HALF_SPAN - 0.012
RW_MAIN = (0.300, 0.060, 0.12, 11.0)  # chord, camber, thickness, angle
RW_FLAP = (0.225, 0.070, 0.10, 34.0)


def rw_main_le(y):
    s = clamp(y / RW_TIP)
    # spoon: the centre of the main plane sits lower than its tips
    return Vector((D.X_REAR_WING_LE - 0.010 * s, y, D.Z_REAR_WING_MAIN_LE - 0.030 * (1 - smoothstep(0.35, 0.9, s))))


def rw_frames(y):
    c, _, _, a = RW_MAIN
    le = rw_main_le(y)
    a = math.radians(a + 2.0 * smoothstep(0.5, 1.0, y / RW_TIP))
    te = le + Vector((-c * math.cos(a), 0, c * math.sin(a)))
    fc, _, _, fa = RW_FLAP
    fa = math.radians(fa + 3.0 * smoothstep(0.5, 1.0, y / RW_TIP))
    nrm = Vector((math.sin(a), 0, math.cos(a)))
    tan = Vector((math.cos(a), 0, -math.sin(a)))
    fle = te + nrm * 0.012 + tan * 0.018
    fte = fle + Vector((-fc * math.cos(fa), 0, fc * math.sin(fa)))
    return (le, c, a), (fle, fc, fa), fte


def drs_hinge():
    """Hinge axis of the DRS flap: a spanwise line through the flap trailing edge at the centre."""
    _, _, fte = rw_frames(0.0)
    return fte


def _element_grid(frames_fn, which, prof, ys):
    grid = []
    for y in ys:
        le, c, a = frames_fn(y)[which]
        ring = []
        for (u, w) in prof:
            cx, cz = -u * c, w * c
            ring.append(Vector((le.x + cx * math.cos(a) + cz * math.sin(a), y, le.z - cx * math.sin(a) + cz * math.cos(a))))
        grid.append(ring)
    return grid


def build_rear_wing(mesh_paint, mesh_carbon, flap_paint, patches, q):
    n = q.n(24, 6)
    ys = [RW_TIP * k / n for k in range(n + 1)]
    nprof = q.n(32, 10)
    pm = naca4(RW_MAIN[1], 0.4, RW_MAIN[2], nprof, te=0.006, invert=True)
    pf = naca4(RW_FLAP[1], 0.4, RW_FLAP[2], nprof, te=0.006, invert=True)
    m = Mesh()
    loft(m, _element_grid(rw_frames, 0, pm, ys), "paint", closed=True, cap1=True, patch_key="rw_main",
         patches=patches, sharp_cols=(0,))
    mesh_paint.merge(m.with_mirror())
    f = Mesh()
    loft(f, _element_grid(rw_frames, 1, pf, ys), "paint", closed=True, cap1=True, patch_key="rw_flap",
         patches=patches, sharp_cols=(0,))
    # gurney strip on the flap trailing edge
    rows = []
    for y in ys[:-1]:
        _, (fle, fc, fa), fte = rw_frames(y)
        nrm = Vector((math.sin(fa), 0, math.cos(fa)))
        tan = Vector((-math.cos(fa), 0, math.sin(fa)))
        rows.append([fte, fte + nrm * 0.014, fte + nrm * 0.014 + tan * 0.003, fte + tan * 0.003])
    loft(f, rows, "carbon", closed=True, cap1=True)
    flap_paint.merge(f.with_mirror())
    # endplates: tall plates with a large rounded leading top corner
    (le_t, c_t, a_t), (fle_t, fc_t, fa_t), fte_t = rw_frames(RW_TIP)
    x0, x1 = D.X_REAR_WING_LE + 0.035, min(fte_t.x, D.X_TAIL) - 0.012
    z0, z1 = 0.440, D.Z_REAR_WING_TOP
    outline = []

    def add_arc(cx, cz, r, a0, a1, k):
        for i in range(k):
            a = math.radians(lerp(a0, a1, i / k))
            outline.append((cx + r * math.cos(a), cz + r * math.sin(a)))

    nb = q.n(6, 2)
    outline.append((x0 - 0.20, z0))
    for i in range(1, nb + 1):                                          # raked lower leading edge
        t = i / nb
        outline.append((lerp(x0 - 0.20, x0, t ** 0.8), lerp(z0, z1 - 0.24, t)))
    add_arc(x0 - 0.22, z1 - 0.22, 0.22, 0, 90, nb * 3)                  # large rounded top corner
    add_arc(x1 + 0.05, z1 - 0.05, 0.05, 90, 180, nb)
    add_arc(x1 + 0.08, z0 + 0.14, 0.08, 180, 240, nb)
    outline.append((x1 + 0.12, z0 + 0.04))
    centre = (0.5 * (x0 + x1) - 0.03, 0.5 * (z0 + z1) + 0.06)

    def to3d(a, b, side):
        return Vector((a, RW_TIP + 0.006 + side, b))

    ep = Mesh()
    plate(ep, outline, centre, 0.012, "paint", to3d, q.n(6, 2), q.n(6, 3), patch_key="rw_endplate",
          patches=patches, inner_mat="carbon")
    mesh_paint.merge(ep.with_mirror())
    # swan-neck pylons: from the engine cover tail, up behind the main plane, hooking over its
    # leading edge onto the upper surface
    py = Mesh()
    for y in (0.085,):
        le0, c0, a0 = rw_frames(y)[0]
        attach = le0 + Vector((-0.45 * c0 * math.cos(a0), 0, 0.45 * c0 * math.sin(a0) + 0.022))
        ctrl = [Vector((-1.97, y, 0.47)), Vector((-2.05, y, 0.58)), Vector((-2.17, y, 0.72)),
                Vector((-2.20, y, 0.84)), Vector((-2.16, y, 0.90)), Vector((attach.x - 0.01, y, attach.z + 0.03)),
                Vector((attach.x, y, attach.z))]
        path = []
        for k in range(len(ctrl) - 1):
            for i in range(4):
                path.append(ctrl[k].lerp(ctrl[k + 1], i / 4))
        path.append(ctrl[-1])
        # smooth the polyline a little
        for _ in range(3):
            path = [path[0]] + [(path[i - 1] + path[i] * 2 + path[i + 1]) / 4 for i in range(1, len(path) - 1)] + [path[-1]]
        grid = []
        for k, p in enumerate(path):
            nxt = path[min(k + 1, len(path) - 1)] - path[max(k - 1, 0)]
            t = nxt.normalized()
            side = Vector((0, 1, 0))
            u = t.cross(side).normalized()
            wd = lerp(0.070, 0.040, k / (len(path) - 1))
            th = 0.008
            ring = []
            for (a, b) in ((wd / 2, th), (-wd / 2, th), (-wd / 2, -th), (wd / 2, -th)):
                ring.append(p + u * a + side * b)
            grid.append(ring)
        loft(py, grid, "carbon", closed=True, cap0=True, cap1=True)
    mesh_carbon.merge(py.with_mirror())
    # DRS actuator pod on top of the main plane at the centre
    pod = Mesh()
    le0, c0, a0 = rw_frames(0.0)[0]
    rows = []
    nn = q.n(10, 4)
    for k in range(nn + 1):
        t = k / nn
        x = le0.x - 0.04 - 0.20 * t
        r = 0.030 * math.sin(math.pi * min(1.0, 0.08 + t * 0.92)) ** 0.6 + 0.002
        zc = le0.z + 0.045 - 0.02 * t
        ring = [Vector((x, r * math.cos(2 * math.pi * i / 12), zc + 1.2 * r * math.sin(2 * math.pi * i / 12)))
                for i in range(12)]
        rows.append(ring)
    loft(pod, rows, "carbon", closed=True, cap0=True, cap1=True)
    mesh_carbon.merge(pod)


def build_beam_wing(mesh_carbon, q):
    n = q.n(16, 6)
    hs = 0.47
    ys = [hs * k / n for k in range(n + 1)]
    nprof = q.n(28, 10)
    for k, (dx, dz, chord, ang) in enumerate(((0.0, 0.0, 0.17, 6.0), (-0.16, 0.055, 0.13, 22.0))):
        prof = naca4(0.06, 0.4, 0.10, nprof, te=0.005, invert=True)
        grid = []
        for y in ys:
            s = y / hs
            le = Vector((D.X_BEAM_WING + dx + 0.03 * s * s, y, D.Z_BEAM_WING + dz + 0.03 * smoothstep(0.5, 1.0, s)))
            a = math.radians(ang)
            ring = []
            for (u, w) in prof:
                cx, cz = -u * chord, w * chord
                ring.append(Vector((le.x + cx * math.cos(a) + cz * math.sin(a), y, le.z - cx * math.sin(a) + cz * math.cos(a))))
            grid.append(ring)
        m = Mesh()
        loft(m, grid, "carbon", closed=True, cap1=True)
        mesh_carbon.merge(m.with_mirror())
