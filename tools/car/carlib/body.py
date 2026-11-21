"""Bodywork: the survival cell with nose and engine cover (one loft), sidepods, airbox and roll
hoop, engine-cover fin, floor with edge wings and fences, diffuser, plank, rear crash structure,
exhaust, cockpit opening and headrest."""

import math

from mathutils import Vector

from . import dims as D
from .geom import Mesh, Pchip, clamp, lerp, loft, resample, smoothstep, superellipse_half


class Q:
    """Tessellation for one level of detail."""

    def __init__(self, lod):
        self.lod = lod
        f = {"high": 1.0, "mobile": 0.5, "far": 0.25}[lod]
        self.f = f

    def n(self, high, lo=3):
        return max(lo, int(round(high * self.f)))


# ---------------------------------------------------------------------------------------------
# Spine: nose, survival cell and engine cover as one continuous loft
# ---------------------------------------------------------------------------------------------
# x: (w, z_bot, z_mid, z_top, e_bot, e_top, w_top_frac, w_bot_frac)
SPINE_KEYS = [
    (3.000, 0.072, 0.120, 0.142, 0.182, 3.2, 2.3, 0.82, 0.88),
    (2.880, 0.085, 0.115, 0.146, 0.205, 3.4, 2.4, 0.80, 0.88),
    (2.600, 0.100, 0.120, 0.165, 0.255, 3.5, 2.5, 0.76, 0.88),
    (2.250, 0.118, 0.140, 0.205, 0.330, 3.5, 2.6, 0.72, 0.87),
    (2.000, 0.138, 0.175, 0.290, 0.455, 3.5, 2.8, 0.70, 0.86),
    (1.750, 0.165, 0.200, 0.360, 0.560, 3.6, 2.9, 0.70, 0.86),
    (1.450, 0.215, 0.170, 0.390, 0.600, 3.8, 2.9, 0.70, 0.86),
    (1.150, 0.275, 0.105, 0.420, 0.660, 4.0, 3.0, 0.72, 0.88),
    (0.880, 0.345, 0.075, 0.440, 0.705, 4.4, 3.2, 0.74, 0.90),
    (0.600, 0.405, 0.062, 0.430, 0.708, 4.8, 3.6, 0.78, 0.92),
    (0.200, 0.420, 0.058, 0.420, 0.700, 5.0, 3.8, 0.80, 0.92),
    (-0.100, 0.410, 0.058, 0.420, 0.725, 5.0, 3.4, 0.62, 0.92),
    (-0.450, 0.360, 0.060, 0.400, 0.720, 5.0, 3.0, 0.48, 0.92),
    (-0.900, 0.285, 0.066, 0.350, 0.650, 4.6, 2.8, 0.45, 0.92),
    (-1.350, 0.205, 0.090, 0.320, 0.570, 4.2, 2.6, 0.48, 0.92),
    (-1.750, 0.150, 0.150, 0.330, 0.505, 3.6, 2.5, 0.55, 0.90),
    (-2.050, 0.110, 0.235, 0.370, 0.470, 3.2, 2.4, 0.62, 0.88),
    (-2.200, 0.080, 0.300, 0.390, 0.445, 3.0, 2.4, 0.70, 0.88),
]
X_SPINE_END = -2.200
_spine = [Pchip([(k[0], k[c]) for k in SPINE_KEYS]) for c in range(1, 9)]


def spine_params(x):
    return [f(x) for f in _spine]


def spine_half_width_at(x, z):
    """Approximate half width of the spine at (x, z), for parts that must bury into it."""
    w, zb, zm, zt, eb, et, wt, wbf = spine_params(x)
    if z >= zm:
        s = clamp((z - zm) / max(1e-4, zt - zm))
        e = et
    else:
        s = clamp((zm - z) / max(1e-4, zm - zb))
        e = eb
    return w * (1 - s ** e) ** (1 / e)


def cockpit_half_width(x):
    """Plan shape of the cockpit opening: rounded front, straight sides, square rear."""
    if x > D.X_COCKPIT_FRONT or x < D.X_COCKPIT_REAR:
        return 0.0
    r = 0.30
    d = D.X_COCKPIT_FRONT - x
    if d < r:
        return D.COCKPIT_HALF_WIDTH * math.sqrt(max(0.0, 1 - ((r - d) / r) ** 2)) ** 0.9
    return D.COCKPIT_HALF_WIDTH


def spine_stations(q):
    xs = []
    # dense at the nose tip, at the cockpit edges and at the tail
    tip = [D.X_NOSE_TIP - 0.12 * (1 - math.cos(0.5 * math.pi * k / 6)) for k in range(7)]
    xs.extend(tip)
    xs.extend(lerp(2.88, 1.0, k / q.n(16)) for k in range(1, q.n(16)))
    xs.extend(lerp(1.0, D.X_COCKPIT_FRONT, k / 3) for k in range(0, 3))
    n_ck = q.n(18, 6)
    xs.extend(D.X_COCKPIT_FRONT - (D.X_COCKPIT_FRONT - D.X_COCKPIT_REAR) * (1 - math.cos(math.pi * k / n_ck)) / 2
              for k in range(0, n_ck + 1))
    xs.extend(lerp(D.X_COCKPIT_REAR, X_SPINE_END, k / q.n(22)) for k in range(1, q.n(22) + 1))
    xs = sorted(set(round(x, 5) for x in xs), reverse=True)
    return xs


def spine_ring(x, q, n_side, n_top):
    """Left half ring from bottom centre to top centre. The last n_top points span the top
    surface inboard of the cockpit edge line so the opening can be cut along a grid column."""
    w, zb, zm, zt, eb, et, wtf, wbf = spine_params(x)
    tip = D.X_NOSE_TIP - x
    k = 1.0
    if tip < 0.10:
        k = max(0.04, math.sqrt(clamp(tip / 0.10)))
    dense = superellipse_half(w * k, zm - (zm - zb) * k, zm, zm + (zt - zm) * k, eb, et, 400,
                              w_top=w * wtf * k, w_bot=w * wbf * k, dense=400)
    # the cockpit edge line on the top surface: a fixed fraction of the top width outside the
    # opening, the opening's half width inside it, blended so the grid stays smooth
    cw_nom = 0.62 * w * wtf * k
    cw = cockpit_half_width(x)
    if cw > 0.0:
        edge = max(0.01, cw)
    elif x > D.X_COCKPIT_FRONT:
        edge = lerp(0.01, cw_nom, smoothstep(0.0, 0.25, x - D.X_COCKPIT_FRONT))
    else:
        edge = lerp(D.COCKPIT_HALF_WIDTH, cw_nom, smoothstep(0.0, 0.30, D.X_COCKPIT_REAR - x))
    edge = min(edge, 0.97 * w * wtf * k)
    # split the dense curve where it crosses y = edge on the top half
    split = len(dense) - 1
    for i in range(len(dense) - 1, 0, -1):
        if dense[i].y >= edge and dense[i].z > zm:
            split = i
            break
    side = resample(dense[: split + 1], n_side)
    top = resample(dense[split:], n_top + 1)[1:]
    ring = side + top
    ring[-1] = Vector((0.0, 0.0, ring[-1].z))
    ring[0] = Vector((0.0, 0.0, ring[0].z))
    return [Vector((x, p.y, p.z)) for p in ring]


def build_spine(mesh_paint, mesh_dark, patches, q):
    xs = spine_stations(q)
    n_side, n_top = q.n(34, 8), q.n(8, 3)
    grid = [spine_ring(x, q, n_side, n_top) for x in xs]
    # loft runs nose to tail; rings run bottom-centre to top-centre on the left side, which with
    # the loft going -X gives outward normals
    left = Mesh()
    base = loft(left, grid, "paint", patch_key="spine", patches=patches, flip=True)
    cols = len(grid[0])
    # cut the cockpit: remove top faces inboard of the edge column where the opening is
    keep = []
    rim = []  # (row, col) boundary vertices for the inner wall
    for k, f in enumerate(left.f):
        j = (min(f) - base) // cols
        i = (min(f) - base) % cols
        xa, xb = xs[j], xs[j + 1]
        inside = (i >= n_side - 1 and xa <= D.X_COCKPIT_FRONT + 1e-6 and xb >= D.X_COCKPIT_REAR - 1e-6)
        if not inside:
            keep.append(k)
    cut = Mesh()
    cut.v = left.v
    for k in keep:
        cut.add_face(left.f[k], left.mat[k], left.uv1[k], left.uv0[k], left.patch[k], left.smooth[k])
    # cap the tail (cooling exit) with dark material
    last = len(xs) - 1
    ring = [base + last * cols + i for i in range(cols)]
    tail_c = cut.add_verts([sum((grid[last][i] for i in range(cols)), Vector()) / cols + Vector((-0.02, 0, 0))])
    for i in range(cols - 1):
        cut.add_face((ring[i], ring[i + 1], tail_c), "dark")
        cut.mark_sharp(ring[i], ring[i + 1])
    # inner cockpit wall: drop the rim down and in
    rows_in = [j for j in range(len(xs)) if D.X_COCKPIT_REAR - 1e-6 <= xs[j] <= D.X_COCKPIT_FRONT + 1e-6]
    j0, j1 = rows_in[0], rows_in[-1]
    rim_pts = []
    col = n_side - 1
    for j in range(j0, j1 + 1):
        rim_pts.append(base + j * cols + col)
    # front and rear edges of the opening run across the top to the centreline
    front = [base + j0 * cols + i for i in range(col, cols)]
    rear = [base + j1 * cols + i for i in range(col, cols)]
    wall_loop = list(reversed(front))[:-1] + rim_pts + rear[1:]
    wall = Mesh()
    top_pts = [cut.v[i].copy() for i in wall_loop]
    depth = 0.30
    bot_pts = [Vector((p.x, p.y * 0.86, p.z - depth)) for p in top_pts]
    for k, p in enumerate(bot_pts):
        # keep the rear wall of the opening vertical
        bot_pts[k].x = clamp(p.x, D.X_COCKPIT_REAR + 0.02, D.X_COCKPIT_FRONT - 0.06)
    wall_grid = [top_pts, bot_pts]
    loft(wall, wall_grid, "interior", flip=False)
    mesh_paint.merge(cut.with_mirror())
    mesh_dark.merge(wall.with_mirror())
    # cockpit floor
    floor = Mesh()
    pts = bot_pts
    ctr = sum(pts, Vector()) / len(pts)
    ci = floor.add_verts([Vector((ctr.x, 0, ctr.z))] + pts)
    for k in range(len(pts) - 1):
        floor.add_face((ci, ci + 1 + k + 1, ci + 1 + k), "interior")
    mesh_dark.merge(floor.with_mirror())
    return xs, grid


# ---------------------------------------------------------------------------------------------
# Sidepods
# ---------------------------------------------------------------------------------------------
SP_OUT = Pchip([(D.X_SIDEPOD_INLET, 0.700), (0.45, D.SIDEPOD_HALF_WIDTH), (0.10, 0.720), (-0.30, 0.610),
                (-0.70, 0.455), (-1.05, 0.330), (-1.30, 0.255), (D.X_SIDEPOD_END, 0.215)])
SP_TOP_OUT = Pchip([(D.X_SIDEPOD_INLET, D.Z_SIDEPOD_INLET_TOP - 0.02), (0.40, 0.595), (0.05, 0.560),
                    (-0.35, 0.470), (-0.75, 0.370), (-1.10, 0.285), (D.X_SIDEPOD_END, 0.215)])
SP_TOP_IN = Pchip([(D.X_SIDEPOD_INLET, D.Z_SIDEPOD_INLET_TOP), (0.40, 0.648), (0.05, 0.640),
                   (-0.35, 0.570), (-0.75, 0.460), (-1.10, 0.360), (D.X_SIDEPOD_END, 0.270)])
SP_LIP = Pchip([(D.X_SIDEPOD_INLET, D.Z_SIDEPOD_INLET_BOTTOM), (0.40, 0.350), (0.05, 0.320),
                (-0.35, 0.250), (-0.75, 0.185), (-1.10, 0.140), (D.X_SIDEPOD_END, 0.110)])
SP_BASE = Pchip([(D.X_SIDEPOD_INLET, 0.330), (0.40, 0.280), (0.0, 0.170), (-0.40, D.Z_FLOOR_TOP + 0.02),
                 (-0.80, D.Z_FLOOR_TOP), (D.X_SIDEPOD_END, D.Z_FLOOR_TOP)])


def _catmull(pts, per_seg, closed=True):
    """Centripetal Catmull-Rom through pts, a fixed number of samples per segment so features
    stay on the same ring index from section to section."""
    n = len(pts)
    out = []
    segs = n if closed else n - 1
    for s in range(segs):
        p0 = pts[(s - 1) % n] if closed or s > 0 else pts[0]
        p1, p2 = pts[s % n], pts[(s + 1) % n]
        p3 = pts[(s + 2) % n] if closed or s + 2 < n else pts[-1]
        k = per_seg[s] if isinstance(per_seg, (list, tuple)) else per_seg

        def tj(ti, a, b):
            return ti + max(1e-6, (b - a).length) ** 0.5

        t0 = 0.0
        t1 = tj(t0, p0, p1)
        t2 = tj(t1, p1, p2)
        t3 = tj(t2, p2, p3)
        for i in range(k):
            t = t1 + (t2 - t1) * i / k
            a1 = p0 * ((t1 - t) / (t1 - t0)) + p1 * ((t - t0) / (t1 - t0))
            a2 = p1 * ((t2 - t) / (t2 - t1)) + p2 * ((t - t1) / (t2 - t1))
            a3 = p2 * ((t3 - t) / (t3 - t2)) + p3 * ((t - t2) / (t3 - t2))
            b1 = a1 * ((t2 - t) / (t2 - t0)) + a2 * ((t - t0) / (t2 - t0))
            b2 = a2 * ((t3 - t) / (t3 - t1)) + a3 * ((t - t1) / (t3 - t1))
            out.append(b1 * ((t2 - t) / (t2 - t1)) + b2 * ((t - t1) / (t2 - t1)))
    if not closed:
        out.append(pts[-1])
    return out


def sidepod_section(x, q):
    """Closed ring in the (y, z) plane, counter-clockwise seen from the front: inner top, outer
    shoulder, outer face, lip, undercut, base on the chassis side."""
    yo, zto, zti, zl, zb = SP_OUT(x), SP_TOP_OUT(x), SP_TOP_IN(x), SP_LIP(x), SP_BASE(x)
    yi = 0.6 * spine_half_width_at(x, 0.5 * (zti + zb))
    yi = min(yi, yo - 0.08)
    h = zto - zl
    r = min(0.075, 0.42 * h)
    ctrl = [
        Vector((yi, zti)),
        Vector((lerp(yi, yo, 0.55), lerp(zti, zto, 0.62) + 0.010)),
        Vector((yo - 0.55 * r, zto)),
        Vector((yo, zto - 0.75 * r)),
        Vector((yo - 0.004, lerp(zto, zl, 0.55))),
        Vector((yo - 0.35 * r, zl + 0.20 * r)),
        Vector((yo - 1.6 * r, zl - 0.004)),
        Vector((lerp(yo, yi, 0.55), lerp(zl, zb, 0.55) + 0.012)),
        Vector((yi + 0.045, zb + 0.004)),
        Vector((yi, zb)),
    ]
    per = [q.n(10), q.n(6), q.n(4), q.n(6), q.n(5), q.n(4), q.n(8), q.n(7), q.n(3), q.n(8)]
    ring = _catmull(ctrl, per)
    return ring


def build_sidepods(mesh_paint, mesh_dark, patches, q):
    nx = q.n(30, 8)
    xs = [D.X_SIDEPOD_INLET - (D.X_SIDEPOD_INLET - D.X_SIDEPOD_END) * (k / nx) ** 1.15 for k in range(nx + 1)]
    grid = []
    for k, x in enumerate(xs):
        ring2 = sidepod_section(x, q)
        rake = 1 - smoothstep(0.0, 0.35, D.X_SIDEPOD_INLET - x)
        zmid = 0.5 * (SP_TOP_IN(x) + SP_LIP(x))
        row = []
        for p in ring2:
            # the inlet face is raked: the top lip reaches further forward than the bottom
            dx = rake * 0.07 * (p.y - zmid) / 0.15
            row.append(Vector((x + dx, p.x, p.y)))
        grid.append(row)
    # rear end: pull the last ring onto the spine side so it closes into the bodywork
    left = Mesh()
    loft(left, grid, "paint", patch_key="sidepod", patches=patches)
    # inlet lip and duct
    front = grid[0]
    cen = sum(front, Vector()) / len(front)
    lip = [cen + (p - cen) * 0.90 + Vector((-0.012, 0, 0)) for p in front]
    duct = [cen + (p - cen) * 0.78 + Vector((-0.20, 0, 0)) for p in front]
    inner = Mesh()
    loft(inner, [front, lip], "paint_edge", flip=False)
    loft(inner, [lip, duct], "dark", cap1=True, flip=False)
    mesh_paint.merge(left.with_mirror())
    mesh_dark.merge(inner.with_mirror())
    return grid


# ---------------------------------------------------------------------------------------------
# Airbox and roll hoop, engine-cover fin
# ---------------------------------------------------------------------------------------------
AB_TOP = Pchip([(D.X_ROLL_HOOP + 0.06, 0.900), (D.X_ROLL_HOOP, D.ROLL_HOOP_TOP), (-0.35, 0.915),
                (-0.70, 0.820), (-1.10, 0.700), (-1.40, 0.610)])
AB_W = Pchip([(D.X_ROLL_HOOP + 0.06, 0.090), (D.X_ROLL_HOOP, D.AIRBOX_HALF_WIDTH), (-0.35, 0.100),
              (-0.70, 0.080), (-1.10, 0.060), (-1.40, 0.045)])


def build_airbox(mesh_paint, mesh_dark, patches, q):
    nx = q.n(20, 6)
    xs = [lerp(D.X_ROLL_HOOP + 0.04, -1.40, (k / nx) ** 1.1) for k in range(nx + 1)]
    grid = []
    n_side = q.n(16, 6)
    for x in xs:
        sp = spine_params(x)
        zt = AB_TOP(x)
        base_w = 0.80 * sp[0] * sp[6]
        zb = sp[3] - 0.10
        zm = sp[3] - 0.035
        ring = superellipse_half(base_w, zb, zm, zt, 2.0, 1.25, n_side, w_top=AB_W(x) * 0.55)
        grid.append([Vector((x, p.y, p.z)) for p in ring])
    left = Mesh()
    loft(left, grid, "paint", patch_key="airbox", patches=patches, flip=True)
    # inlet: a rounded triangle under the hoop top, lip then duct
    front = grid[0]
    zt0 = AB_TOP(xs[0])
    mouth = []
    for p in front:
        t = clamp((p.z - (zt0 - 0.15)) / 0.15)
        mouth.append(Vector((p.x + 0.004, p.y * 0.80, lerp(zt0 - 0.150, zt0 - 0.035, t))))
    duct = [Vector((p.x - 0.25, p.y * 0.6, p.z - 0.02)) for p in mouth]
    inner = Mesh()
    loft(inner, [front, mouth], "paint_edge", flip=True)
    loft(inner, [mouth, duct], "dark", cap1=True, flip=True)
    mesh_paint.merge(left.with_mirror())
    mesh_dark.merge(inner.with_mirror())


# ---------------------------------------------------------------------------------------------
# Floor, edge wing, fences, diffuser, plank
# ---------------------------------------------------------------------------------------------
FLOOR_HW = Pchip([(D.X_FLOOR_FRONT, 0.30), (1.15, 0.55), (D.X_FLOOR_BODY_START, 0.82), (0.70, 0.935),
                  (0.30, D.FLOOR_HALF_WIDTH), (-0.40, 0.965), (-0.90, 0.915), (-1.15, 0.845), (-1.35, 0.70),
                  (-1.50, 0.565), (-1.60, 0.52), (D.X_DIFFUSER_EXIT, 0.505)])


def diffuser_roof(x):
    t = clamp((D.X_DIFFUSER_START - x) / (D.X_DIFFUSER_START - D.X_DIFFUSER_EXIT))
    return D.Z_REF + (D.Z_DIFFUSER_EXIT - D.Z_REF) * (t ** 1.6)


def inlet_roof(x):
    """The floor's leading section is raised to form the tunnel inlets."""
    return D.Z_REF + 0.085 * smoothstep(0.75, D.X_FLOOR_FRONT, x)


def build_floor(mesh_carbon, mesh_dark, q):
    nx = q.n(40, 10)
    xs = [lerp(D.X_FLOOR_FRONT, D.X_DIFFUSER_EXIT, k / nx) for k in range(nx + 1)]
    xs = sorted(set(xs + [D.X_DIFFUSER_START, D.X_FLOOR_BODY_START]), reverse=True)
    n_in, n_out = q.n(10, 4), q.n(16, 4)
    grid = []
    yd = D.DIFFUSER_HALF_WIDTH
    for x in xs:
        hw = FLOOR_HW(x)
        under_in = max(diffuser_roof(x), inlet_roof(x) if x > 0.75 else D.Z_REF)
        bottom = []
        ys_in = [yd * k / n_in for k in range(n_in + 1)]
        ys_out = [lerp(yd + 0.015, max(hw, yd + 0.03), (k / n_out) ** 0.9) for k in range(n_out + 1)]
        for y in ys_in:
            bottom.append(Vector((x, y, under_in if y < yd - 0.012 else lerp(under_in, D.Z_REF, 0.5))))
        for y in ys_out:
            z = inlet_roof(x) if x > 0.75 else D.Z_REF
            # the floor edge curls up into the edge wing
            e = smoothstep(hw - 0.07, hw, y) if hw > yd + 0.1 else 0.0
            bottom.append(Vector((x, y, z + 0.030 * e)))
        top = [Vector((p.x, p.y, p.z + D.FLOOR_THICK)) for p in bottom]
        tip = Vector((x, bottom[-1].y + 0.004, bottom[-1].z + 0.5 * D.FLOOR_THICK + 0.010 * (1 if hw > yd + 0.1 else 0)))
        ring = bottom + [tip] + list(reversed(top))
        grid.append(ring)
    # ring runs centre-bottom -> edge -> centre-top: open at the centreline, mirrored below
    left = Mesh()
    loft(left, grid, "carbon_matte", cap0=False, cap1=False, flip=True)
    mesh_carbon.merge(left.with_mirror())
    # diffuser side strakes
    strakes = Mesh()
    for y in (0.20, 0.36):
        rows = []
        for k in range(q.n(8, 3) + 1):
            x = lerp(D.X_DIFFUSER_START - 0.1, D.X_DIFFUSER_EXIT + 0.02, k / q.n(8, 3))
            r = diffuser_roof(x)
            rows.append([Vector((x, y + 0.004, r)), Vector((x, y + 0.004, D.Z_REF - 0.012)),
                         Vector((x, y - 0.004, D.Z_REF - 0.012)), Vector((x, y - 0.004, r))])
        loft(strakes, rows, "carbon_matte", closed=True, cap0=True, cap1=True)
    mesh_carbon.merge(strakes.with_mirror())
    # floor fences under the leading edge, curving outboard
    fences = Mesh()
    for k, y0 in enumerate((0.16, 0.25, 0.34, 0.43)):
        rows = []
        nn = q.n(8, 3)
        for s in range(nn + 1):
            t = s / nn
            x = lerp(D.X_FLOOR_FRONT - 0.02, 0.70, t)
            y = y0 + (0.06 + 0.05 * k) * t ** 1.5
            zt = inlet_roof(x)
            zb = D.Z_REF + 0.03 + 0.02 * (1 - t)
            rows.append([Vector((x, y + 0.003, zt)), Vector((x, y + 0.003, zb)),
                         Vector((x, y - 0.003, zb)), Vector((x, y - 0.003, zt))])
        loft(fences, rows, "carbon_matte", closed=True, cap0=True, cap1=True)
    mesh_carbon.merge(fences.with_mirror())
    # edge wing above the floor edge
    ew = Mesh()
    rows = []
    nn = q.n(16, 4)
    for s in range(nn + 1):
        x = lerp(0.70, -0.70, s / nn)
        hw = FLOOR_HW(x)
        y = hw - 0.025
        z = D.Z_FLOOR_TOP + 0.026 + 0.008 * math.sin(math.pi * s / nn)
        c = 0.070
        rows.append([Vector((x, y + 0.002, z)), Vector((x, y - c * 0.95, z + 0.018)), Vector((x, y - c, z + 0.012)),
                     Vector((x, y - 0.004, z - 0.004))])
    loft(ew, rows, "carbon_matte", closed=True, cap0=True, cap1=True)
    # small brackets
    for x in (0.45, -0.1, -0.55):
        hw = FLOOR_HW(x) - 0.03
        rows = [[Vector((x + 0.02, hw, D.Z_FLOOR_TOP)), Vector((x - 0.02, hw, D.Z_FLOOR_TOP)),
                 Vector((x - 0.02, hw - 0.004, D.Z_FLOOR_TOP)), Vector((x + 0.02, hw - 0.004, D.Z_FLOOR_TOP))]]
        rows.append([p + Vector((0, 0, 0.030)) for p in rows[0]])
        loft(ew, rows, "carbon_matte", closed=True)
    mesh_carbon.merge(ew.with_mirror())
    # plank with skids
    pl = Mesh()
    rows = []
    for s in range(q.n(6, 2) + 1):
        x = lerp(D.X_PLANK_FRONT, D.X_PLANK_REAR, s / q.n(6, 2))
        w = D.PLANK_HALF_WIDTH
        z0, z1 = D.PLANK_BOTTOM, D.Z_REF + 0.001
        rows.append([Vector((x, w, z1)), Vector((x, w, z0 + 0.004)), Vector((x, w - 0.006, z0)),
                     Vector((x, -w + 0.006, z0)), Vector((x, -w, z0 + 0.004)), Vector((x, -w, z1))])
    loft(pl, rows, "plank", closed=True, cap0=True, cap1=True)
    mesh_dark.merge(pl)
    skid = Mesh()
    for x in (0.80, 0.10, -0.60):
        for y in (-0.08, 0.08):
            ring = [Vector((x + 0.022 * math.cos(a), y + 0.022 * math.sin(a), D.PLANK_BOTTOM - 0.0006))
                    for a in [2 * math.pi * k / 12 for k in range(12)]]
            ring2 = [p + Vector((0, 0, 0.003)) for p in ring]
            loft(skid, [ring, ring2], "metal_satin", closed=True, cap0=True)
    mesh_dark.merge(skid)


# ---------------------------------------------------------------------------------------------
# Rear crash structure, rain light housing, exhaust
# ---------------------------------------------------------------------------------------------
def build_rear(mesh_carbon, mesh_dark, q):
    xs = [lerp(-1.85, D.X_CRASH_TIP, k / q.n(10, 4)) for k in range(q.n(10, 4) + 1)]
    grid = []
    for x in xs:
        t = (x - (-1.85)) / (D.X_CRASH_TIP + 1.85)
        hw = lerp(0.105, 0.072, t)
        hh = lerp(0.085, 0.058, t)
        zc = D.Z_CRASH_CENTRE + 0.02 * (1 - t)
        ring = superellipse_half(hw, zc - hh, zc, zc + hh, 3.0, 3.0, q.n(12, 5))
        grid.append([Vector((x, p.y, p.z)) for p in ring])
    m = Mesh()
    loft(m, grid, "carbon", cap1=False, flip=True)
    mesh_carbon.merge(m.with_mirror())
    # tip face carries the rain light housing (the light itself is its own node)
    tip = Mesh()
    ring = grid[-1]
    cen = sum(ring, Vector()) / len(ring)
    ci = tip.add_verts([cen])
    bi = tip.add_verts(ring)
    for i in range(len(ring) - 1):
        tip.add_face((bi + i, bi + i + 1, ci), "dark")
    mesh_dark.merge(tip.with_mirror())
    # exhaust tailpipe
    ex = Mesh()
    n = q.n(20, 8)
    rows = []
    for x, r in ((-1.95, 0.052), (-2.22, 0.050), (-2.28, 0.049)):
        rows.append([Vector((x, r * math.cos(2 * math.pi * k / n), 0.445 + r * math.sin(2 * math.pi * k / n)))
                     for k in range(n)])
    inner = [Vector((-2.27, p.y * 0.86, 0.445 + (p.z - 0.445) * 0.86)) for p in rows[-1]]
    deep = [Vector((-2.05, p.y * 0.86, 0.445 + (p.z - 0.445) * 0.86)) for p in rows[-1]]
    loft(ex, rows, "exhaust", closed=True)
    loft(ex, [rows[-1], inner], "exhaust", closed=True)
    loft(ex, [inner, deep], "soot", closed=True, cap1=True)
    mesh_dark.merge(ex)
