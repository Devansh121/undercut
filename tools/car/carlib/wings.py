"""Front wing (four elements, endplates), rear wing (main plane, DRS flap, endplates, swan-neck
pylons, actuator pod) and beam wing. Elements are NACA sections lofted along smooth spanwise laws:
no waves, only a monotone rise and twist towards the tips."""

import math

from mathutils import Vector

from . import dims as D
from .geom import Mesh, clamp, lerp, loft, naca4, smoothstep


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
    hint = None
    if patch_key is not None:
        c3 = to3d(ca, cb, r)
        hint = tuple((to3d(ca, cb, r + 0.01) - c3).normalized())
    mesh.begin_part(patch_key or "plate", True)
    # planar UVs over the whole outer face and the outer half of the bevel, so graphics on a plate
    # keep their proportions and run onto its edge
    loft(mesh, grid_outer, mat, closed=True, cap0=True, patch_key=patch_key, patches=patches, planar=hint)
    nb = len(bevel)
    loft(mesh, [grid_outer[-1]] + bevel[: nb // 2 + 1], mat, closed=True, patch_key=patch_key, patches=patches,
         planar=hint)
    loft(mesh, bevel[nb // 2:] + [grid_inner[0]], inner_mat or mat, closed=True)
    loft(mesh, grid_inner, inner_mat or mat, closed=True, cap1=True)
    mesh.end_part()


def curl_rings(section_at, ys, y_s, radius, n_curl, z_ref, down=True, squash=0.12, phi_max=90.0):
    """Rings for a wing element that runs straight along the span and then rolls over at its tip.
    section_at(y) gives the section as (x, n) pairs with n = z - z_ref. Straight stations are ys;
    the tip then turns through phi_max degrees about a spanwise line radius away from z_ref (below
    it when down, above it when up). The section's height is squashed towards squash as it turns,
    so stacked elements close up into one thin edge that meets the endplate."""
    grid = [[Vector((x, y, z_ref + n)) for (x, n) in section_at(y)] for y in ys]
    sec = section_at(y_s)
    for k in range(1, n_curl + 1):
        t = k / n_curl
        phi = math.radians(phi_max) * t
        sq = lerp(1.0, squash, smoothstep(0.0, 1.0, t))
        ring = []
        for (x, n) in sec:
            nq = n * sq
            if down:
                ring.append(Vector((x, y_s + (radius + nq) * math.sin(phi), z_ref - radius + (radius + nq) * math.cos(phi))))
            else:
                ring.append(Vector((x, y_s + (radius - nq) * math.sin(phi), z_ref + radius - (radius - nq) * math.cos(phi))))
        grid.append(ring)
    return grid


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
    nprof = q.n(32, 8)
    for k, (name, *_rest) in enumerate(FW_ELEMENTS):
        cam, th = FW_ELEMENTS[k][5], FW_ELEMENTS[k][6]
        prof = naca4(cam, 0.40, th, nprof, te=0.006, invert=True)
        y_in = 0.0 if k == 0 else 0.05
        curl = k >= 2
        radius = 0.034
        y_end = FW_TIP - radius - 0.004 if curl else FW_TIP

        def section_at(yy, k=k, prof=prof):
            le, chord, ang, _, _ = fw_sections(yy)[k]
            pts = []
            for (u, wv) in prof:
                cx, cz = -u * chord, wv * chord
                pts.append((le.x + cx * math.cos(ang) + cz * math.sin(ang), le.z - cx * math.sin(ang) + cz * math.cos(ang)))
            return pts

        ys_k = [y_in + (y_end - y_in) * (y / FW_TIP) for y in ys]
        if curl:
            z_ref = fw_sections(y_end)[k][0].z
            grid = curl_rings(lambda yy: [(x, z - z_ref) for (x, z) in section_at(yy)], ys_k, y_end, radius,
                              q.n(6, 2), z_ref, down=False, squash=0.45, phi_max=70.0)
        else:
            grid = [[Vector((x, yy, z)) for (x, z) in section_at(yy)] for yy in ys_k]
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


RW_CURL = 0.100  # radius of the rolled tips


def _rw_section(which, prof, z_ref):
    def at(y):
        le, c, a = rw_frames(y)[which]
        pts = []
        for (u, wv) in prof:
            cx, cz = -u * c, wv * c
            pts.append((le.x + cx * math.cos(a) + cz * math.sin(a), le.z - cx * math.sin(a) + cz * math.cos(a) - z_ref))
        return pts
    return at


def build_rear_wing(mesh_paint, mesh_carbon, flap_paint, patches, q):
    """Main plane and flap whose tips roll down into the endplates (the rolled tips of this era),
    a static fairing that carries the flap's profile into the roll so the DRS flap can open
    inside it, endplates with a shaped lower cut-out, swan-neck pylons and the actuator pod."""
    nprof = q.n(32, 8)
    pm = naca4(RW_MAIN[1], 0.4, RW_MAIN[2], nprof, te=0.006, invert=True)
    pf = naca4(RW_FLAP[1], 0.4, RW_FLAP[2], nprof, te=0.006, invert=True)
    y_s = RW_TIP - RW_CURL - 0.020  # where the roll starts
    z_ref = rw_frames(y_s)[0][0].z  # main-plane leading edge height at the roll
    n = q.n(22, 6)
    ys = [y_s * k / n for k in range(n + 1)]
    n_curl = q.n(10, 3)
    m = Mesh()
    loft(m, curl_rings(_rw_section(0, pm, z_ref), ys, y_s, RW_CURL, n_curl, z_ref), "paint", closed=True,
         cap1=True, patch_key="rw_main", patches=patches, sharp_cols=(0,))
    # flap-tip fairing: the flap's section from just outboard of the moving flap, rolled down
    y_f = y_s - 0.060
    tip = Mesh()
    ys_t = [y_f + 0.004 + (y_s - y_f - 0.004) * k / 3 for k in range(4)]
    loft(tip, curl_rings(_rw_section(1, pf, z_ref), ys_t, y_s, RW_CURL, n_curl, z_ref), "paint", closed=True,
         cap0=True, cap1=True, patch_key="rw_tip", patches=patches, sharp_cols=(0,))
    mesh_paint.merge(m.with_mirror()).merge(tip.with_mirror())
    # moving flap, straight, ending just inboard of its fairing
    f = Mesh()
    ys_f = [y_f * k / n for k in range(n + 1)]
    loft(f, [[Vector((x, y, z_ref + zz)) for (x, zz) in _rw_section(1, pf, z_ref)(y)] for y in ys_f], "paint",
         closed=True, cap1=True, patch_key="rw_flap", patches=patches, sharp_cols=(0,))
    rows = []
    for y in ys_f[:-1]:
        _, (fle, fc, fa), fte = rw_frames(y)
        nrm = Vector((math.sin(fa), 0, math.cos(fa)))
        tan = Vector((-math.cos(fa), 0, math.sin(fa)))
        rows.append([fte, fte + nrm * 0.014, fte + nrm * 0.014 + tan * 0.003, fte + tan * 0.003])
    rows.append([p + Vector((0, y_f - 0.006 - rows[-1][0].y, 0)) for p in rows[-1]])
    loft(f, rows, "carbon", closed=True, cap1=True)
    flap_paint.merge(f.with_mirror())
    # endplate: hangs below the roll; concave leading edge and a cut-away lower front
    (le_t, c_t, a_t), (fle_t, fc_t, fa_t), fte_t = rw_frames(y_s)
    x_le, x_te = le_t.x - 0.004, fte_t.x + 0.004
    z_top = z_ref - RW_CURL + 0.030
    z_bot = 0.455
    pts = [(x_le, z_top), (x_le - 0.035, z_top - 0.075), (x_le - 0.090, z_top - 0.150), (x_le - 0.150, 0.560),
           (x_le - 0.215, 0.500), (x_le - 0.255, z_bot + 0.008), (x_le - 0.280, z_bot)]
    k_b = q.n(5, 2)
    for i in range(1, k_b):
        pts.append((lerp(x_le - 0.280, x_te + 0.045, i / k_b), z_bot))
    for i in range(q.n(4, 2) + 1):
        a = math.radians(270 - 90 * i / q.n(4, 2))
        pts.append((x_te + 0.045 + 0.045 * math.cos(a), z_bot + 0.045 + 0.045 * math.sin(a)))
    pts += [(x_te + 0.004, lerp(z_bot + 0.045, z_top, 0.5)), (x_te + 0.010, z_top)]
    for i in range(1, q.n(6, 2)):
        pts.append((lerp(x_te + 0.010, x_le, i / q.n(6, 2)), z_top + 0.004 * math.sin(math.pi * i / q.n(6, 2))))
    outline = list(reversed(pts))  # counter-clockwise in (x, z)
    centre = (x_le - 0.290, 0.610)
    y_e = y_s + RW_CURL + 0.010

    def to3d(a, b, side):
        return Vector((a, y_e + side, b))

    ep = Mesh()
    plate(ep, outline, centre, 0.012, "paint", to3d, q.n(6, 2), q.n(6, 3), patch_key="rw_endplate",
          patches=patches, inner_mat="carbon")
    mesh_paint.merge(ep.with_mirror())
    # swan-neck pylons: from the crash structure, up behind the main plane, hooking over its
    # leading edge onto the upper surface, with a foot block at each end
    py = Mesh()
    for y in (0.085,):
        le0, c0, a0 = rw_frames(y)[0]
        attach = le0 + Vector((-0.45 * c0 * math.cos(a0), 0, 0.45 * c0 * math.sin(a0) + 0.022))
        ctrl = [Vector((-2.02, y, 0.405)), Vector((-2.08, y, 0.52)), Vector((-2.18, y, 0.70)),
                Vector((-2.21, y, 0.84)), Vector((-2.16, y, 0.905)), Vector((attach.x - 0.01, y, attach.z + 0.03)),
                Vector((attach.x, y, attach.z))]
        path = []
        for k in range(len(ctrl) - 1):
            for i in range(4):
                path.append(ctrl[k].lerp(ctrl[k + 1], i / 4))
        path.append(ctrl[-1])
        for _ in range(3):
            path = [path[0]] + [(path[i - 1] + path[i] * 2 + path[i + 1]) / 4 for i in range(1, len(path) - 1)] + [path[-1]]
        grid = []
        for k, p in enumerate(path):
            t = (path[min(k + 1, len(path) - 1)] - path[max(k - 1, 0)]).normalized()
            side = Vector((0, 1, 0))
            u = t.cross(side).normalized()
            wd = lerp(0.075, 0.042, k / (len(path) - 1))
            th = 0.008
            grid.append([p + u * (a * wd / 2) + side * (b * th) for (a, b) in ((1, 1), (-1, 1), (-1, -1), (1, -1))])
        loft(py, grid, "carbon", closed=True, cap0=True, cap1=True)
        for c in (path[0], path[-1]):
            box = [[c + Vector((dx, y_ * 0.016, dz)) for (dx, y_) in ((0.025, 1), (0.025, -1), (-0.025, -1), (-0.025, 1))]
                   for dz in (-0.010, 0.006)]
            loft(py, box, "metal_dark", closed=True, cap0=True, cap1=True)
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
        rows.append([Vector((x, r * math.cos(2 * math.pi * i / 12), zc + 1.2 * r * math.sin(2 * math.pi * i / 12)))
                     for i in range(12)])
    loft(pod, rows, "carbon", closed=True, cap0=True, cap1=True)
    mesh_carbon.merge(pod)


def build_beam_wing(mesh_carbon, q):
    """Two-element beam wing on a centre mount, its tips rolled down."""
    n = q.n(14, 5)
    hs = 0.43
    ys = [hs * k / n for k in range(n + 1)]
    nprof = q.n(28, 10)
    for k, (dx, dz, chord, ang) in enumerate(((0.0, 0.0, 0.17, 6.0), (-0.16, 0.055, 0.13, 22.0))):
        prof = naca4(0.06, 0.4, 0.10, nprof, te=0.005, invert=True)
        z_ref = D.Z_BEAM_WING + 0.03

        def at(y, dx=dx, dz=dz, chord=chord, ang=ang, prof=prof, z_ref=z_ref):
            s = y / hs
            le = Vector((D.X_BEAM_WING + dx + 0.03 * s * s, y, D.Z_BEAM_WING + dz + 0.03 * smoothstep(0.5, 1.0, s)))
            a = math.radians(ang)
            return [(le.x - u * chord * math.cos(a) + wv * chord * math.sin(a),
                     le.z + u * chord * math.sin(a) + wv * chord * math.cos(a) - z_ref) for (u, wv) in prof]

        m = Mesh()
        loft(m, curl_rings(at, ys, hs, 0.045, q.n(6, 2), z_ref, squash=0.35, phi_max=80.0), "carbon",
             closed=True, cap1=True)
        mesh_carbon.merge(m.with_mirror())
    # centre mount: a faired blade from the crash structure up through both elements
    mt = Mesh()
    prof = naca4(0.0, 0.4, 0.14, q.n(16, 8), te=0.02)
    rows = []
    for z in (D.Z_CRASH_CENTRE + 0.05, D.Z_BEAM_WING + 0.10):
        rows.append([Vector((D.X_BEAM_WING + 0.02 - u * 0.30, wv * 0.30, z)) for (u, wv) in prof])
    loft(mt, rows, "carbon", closed=True, cap0=True, cap1=True)
    mesh_carbon.merge(mt)
