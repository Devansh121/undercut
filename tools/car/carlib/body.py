"""Bodywork: the survival cell, nose and engine cover (one loft whose sections blend the tub and
the airbox ridge), the airbox intake, sidepods that grow out of the chassis surface with fillets,
the floor with fences, edge wings and diffuser, plank, rear crash structure with the rain-light
housing, and the exhaust."""

import math

import numpy as np
from mathutils import Vector

from . import dims as D
from .geom import Mesh, Pchip, cap_half_ring, clamp, lerp, loft, resample, smoothstep, superellipse_half


class Q:
    """Tessellation for one level of detail."""

    def __init__(self, lod):
        self.lod = lod
        self.f = {"high": 1.0, "mobile": 0.5, "far": 0.25}[lod]

    def n(self, high, lo=3):
        return max(lo, int(round(high * self.f)))


# ---------------------------------------------------------------------------------------------
# Spine: nose, survival cell and engine cover
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
    (-0.100, 0.405, 0.058, 0.410, 0.690, 5.0, 3.4, 0.70, 0.92),
    (-0.450, 0.350, 0.060, 0.390, 0.660, 4.6, 3.0, 0.62, 0.92),
    (-0.900, 0.280, 0.066, 0.340, 0.610, 4.2, 2.8, 0.58, 0.92),
    (-1.350, 0.205, 0.090, 0.310, 0.545, 3.8, 2.6, 0.58, 0.92),
    (-1.750, 0.150, 0.150, 0.320, 0.490, 3.4, 2.5, 0.60, 0.90),
    (-2.050, 0.110, 0.235, 0.365, 0.462, 3.2, 2.4, 0.62, 0.88),
    (-2.200, 0.080, 0.300, 0.390, 0.445, 3.0, 2.4, 0.70, 0.88),
]
X_SPINE_END = -2.200
_spine = [Pchip([(k[0], k[c]) for k in SPINE_KEYS]) for c in range(1, 9)]

# Engine cover ridge (airbox and spine behind the roll hoop): height and the ridge half width
AB_TOP = Pchip([(D.X_ROLL_HOOP, D.ROLL_HOOP_TOP), (-0.35, 0.915), (-0.70, 0.815), (-1.10, 0.695),
                (-1.40, 0.610), (-1.75, 0.530), (-2.05, 0.475), (-2.20, 0.450)])
AB_W = Pchip([(D.X_ROLL_HOOP, D.AIRBOX_HALF_WIDTH), (-0.35, 0.100), (-0.70, 0.080), (-1.10, 0.062),
              (-1.75, 0.050), (-2.20, 0.045)])
X_HOOP_FACE0 = D.X_COCKPIT_REAR - 0.006  # the ridge starts rising behind the headrest...
X_HOOP_FACE1 = D.X_ROLL_HOOP - 0.010     # ...and reaches the hoop top here


def spine_params(x):
    return [f(x) for f in _spine]


def _blend_max(a, b, k):
    """Smooth maximum: equals max(a, b) when they differ by more than k, rounds the corner
    where they meet (a fillet about k wide)."""
    h = np.clip(k - np.abs(a - b), 0.0, None) / k
    return np.maximum(a, b) + h * h * k * 0.25


def _polar(pts, zc, thetas):
    y = np.array([p.y for p in pts])
    z = np.array([p.z for p in pts]) - zc
    th = np.arctan2(z, y)
    r = np.hypot(y, z)
    order = np.argsort(th)
    return np.interp(thetas, th[order], r[order])


_outline_cache = {}


def spine_outline(x):
    """Dense left half section (Vector(0, y, z)), bottom centre round to top centre. Behind the
    cockpit the tub's section and the engine-cover ridge are joined by a smooth maximum in polar
    form, so the shoulder is one filleted surface instead of two intersecting ones."""
    key = round(x, 6)
    if key in _outline_cache:
        return _outline_cache[key]
    w, zb, zm, zt, eb, et, wtf, wbf = spine_params(x)
    k = 1.0
    tip = D.X_NOSE_TIP - x
    if tip < 0.10:
        k = max(0.04, math.sqrt(clamp(tip / 0.10)))
    base = superellipse_half(w * k, zm - (zm - zb) * k, zm, zm + (zt - zm) * k, eb, et, 400,
                             w_top=w * wtf * k, w_bot=w * wbf * k, dense=400)
    t = smoothstep(X_HOOP_FACE0, X_HOOP_FACE1, x)
    if t <= 0.0:
        out = base
    else:
        ridge = lerp(zt - 0.02, AB_TOP(max(x, -2.2)), t)
        tent = superellipse_half(0.82 * w * wtf, zm - 0.10, zm, ridge, 2.0, 1.30, 400,
                                 w_top=AB_W(max(x, -2.2)) * 0.55, dense=400)
        th = np.linspace(-math.pi / 2, math.pi / 2, 721)
        r = _blend_max(_polar(base, zm, th), _polar(tent, zm, th), 0.05)
        out = [Vector((0.0, max(0.0, rr * math.cos(a)), zm + rr * math.sin(a))) for rr, a in zip(r, th)]
        out[0].y = 0.0
        out[-1].y = 0.0
    _outline_cache[key] = out
    return out


def spine_y(x, z):
    """Outer half width of the spine at height z (0 if z is above or below the section)."""
    pts = spine_outline(x)
    best = 0.0
    for a, b in zip(pts, pts[1:]):
        if (a.z - z) * (b.z - z) <= 0 and abs(b.z - a.z) > 1e-9:
            t = (z - a.z) / (b.z - a.z)
            best = max(best, a.y + (b.y - a.y) * t)
    return best


def spine_half_width_at(x, z):
    return spine_y(x, z)


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
    xs = [D.X_NOSE_TIP - 0.12 * (1 - math.cos(0.5 * math.pi * k / 6)) for k in range(7)]
    xs.extend(lerp(2.88, 1.0, k / q.n(16)) for k in range(1, q.n(16)))
    xs.extend(lerp(1.0, D.X_COCKPIT_FRONT, k / 3) for k in range(0, 3))
    n_ck = q.n(18, 6)
    xs.extend(D.X_COCKPIT_FRONT - (D.X_COCKPIT_FRONT - D.X_COCKPIT_REAR) * (1 - math.cos(math.pi * k / n_ck)) / 2
              for k in range(0, n_ck + 1))
    # the front face of the roll hoop: the ridge climbs quickly, so stations are close
    n_face = q.n(7, 3)
    xs.extend(lerp(X_HOOP_FACE0, X_HOOP_FACE1, k / n_face) for k in range(1, n_face + 1))
    xs.extend(lerp(X_HOOP_FACE1, X_SPINE_END, (k / q.n(22)) ** 1.1) for k in range(1, q.n(22) + 1))
    return sorted(set(round(x, 5) for x in xs), reverse=True)


def spine_ring(x, n_side, n_top):
    """Left half ring from bottom centre to top centre. The last n_top points span the top
    surface inboard of the cockpit edge line so the opening can be cut along a grid column."""
    dense = spine_outline(x)
    w, zb, zm, zt, eb, et, wtf, wbf = spine_params(x)
    tipk = 1.0 if D.X_NOSE_TIP - x >= 0.10 else max(0.04, math.sqrt(clamp((D.X_NOSE_TIP - x) / 0.10)))
    cw_nom = 0.62 * w * wtf * tipk
    cw = cockpit_half_width(x)
    if cw > 0.0:
        edge = max(0.01, cw)
    elif x > D.X_COCKPIT_FRONT:
        edge = lerp(0.01, cw_nom, smoothstep(0.0, 0.25, x - D.X_COCKPIT_FRONT))
    else:
        edge = lerp(D.COCKPIT_HALF_WIDTH, 0.55 * cw_nom, smoothstep(0.0, 0.30, D.X_COCKPIT_REAR - x))
    edge = min(edge, 0.97 * w * wtf * tipk)
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
    grid = [spine_ring(x, n_side, n_top) for x in xs]
    left = Mesh()
    base = loft(left, grid, "paint", patch_key="spine", patches=patches, flip=True)
    cols = len(grid[0])
    # cut the cockpit: remove top faces inboard of the edge column where the opening is
    cut = Mesh()
    cut.v = left.v
    for k, f in enumerate(left.f):
        j = (min(f) - base) // cols
        i = (min(f) - base) % cols
        xa, xb = xs[j], xs[j + 1]
        inside = (i >= n_side - 1 and xa <= D.X_COCKPIT_FRONT + 1e-6 and xb >= D.X_COCKPIT_REAR - 1e-6)
        if not inside:
            cut.add_face(left.f[k], left.mat[k], left.uv1[k], None, None, left.smooth[k])
            cut.uv0[-1], cut.patch[-1] = left.uv0[k], left.patch[k]
    # the tail is the cooling exit: a dark cap closed on the symmetry plane
    last = len(xs) - 1
    cap_half_ring(cut, [cut.v[base + last * cols + i] for i in range(cols)], "dark", flip=True)
    # inner cockpit wall: drop the rim down and in
    rows_in = [j for j in range(len(xs)) if D.X_COCKPIT_REAR - 1e-6 <= xs[j] <= D.X_COCKPIT_FRONT + 1e-6]
    j0, j1 = rows_in[0], rows_in[-1]
    col = n_side - 1
    rim_pts = [base + j * cols + col for j in range(j0, j1 + 1)]
    front = [base + j0 * cols + i for i in range(col, cols)]
    rear = [base + j1 * cols + i for i in range(col, cols)]
    wall_loop = list(reversed(front))[:-1] + rim_pts + rear[1:]
    wall = Mesh()
    top_pts = [cut.v[i].copy() for i in wall_loop]
    bot_pts = [Vector((clamp(p.x, D.X_COCKPIT_REAR + 0.02, D.X_COCKPIT_FRONT - 0.06), p.y * 0.86, p.z - 0.30))
               for p in top_pts]
    loft(wall, [top_pts, bot_pts], "interior")
    mesh_paint.merge(cut.with_mirror())
    mesh_dark.merge(wall.with_mirror())
    floor = Mesh()
    ctr = sum(bot_pts, Vector()) / len(bot_pts)
    ci = floor.add_verts([Vector((ctr.x, 0, ctr.z))] + bot_pts)
    for k in range(len(bot_pts) - 1):
        floor.add_face((ci, ci + 1 + k + 1, ci + 1 + k), "interior")
    mesh_dark.merge(floor.with_mirror())
    return xs, grid


def build_intake(mesh_paint, mesh_dark, q):
    """Airbox intake on the roll hoop's front face: a rounded-triangle opening with a lip that
    stands proud of the face, and a dark duct behind it."""
    n = q.n(24, 10)
    zc, hh, hw = D.ROLL_HOOP_TOP - 0.085, 0.060, 0.078

    def outline(scale):
        pts = []
        for i in range(n):
            a = 2 * math.pi * i / n
            c, s = math.cos(a), math.sin(a)
            # narrower at the top, under the hoop
            wid = hw * (1.0 - 0.35 * max(0.0, s))
            pts.append((wid * math.copysign(abs(c) ** 0.7, c) * scale, zc + hh * math.copysign(abs(s) ** 0.85, s) * scale))
        return pts

    def ring(x, scale):
        return [Vector((x, y, z)) for (y, z) in outline(scale)]

    m = Mesh()
    rings_out = [ring(-0.120, 1.16), ring(-0.050, 1.16), ring(-0.034, 1.10), ring(-0.030, 1.04)]
    rings_in = [ring(-0.030, 1.04), ring(-0.042, 0.98), ring(-0.30, 0.80)]
    loft(m, rings_out, "paint_edge", closed=True, flip=True)
    d = Mesh()
    loft(d, rings_in, "dark", closed=True, cap1=True, flip=True)
    mesh_paint.merge(m)
    mesh_dark.merge(d)


# ---------------------------------------------------------------------------------------------
# Sidepods: open sections that leave and rejoin the chassis surface with fillets
# ---------------------------------------------------------------------------------------------
SP_OUT = Pchip([(D.X_SIDEPOD_INLET, 0.700), (0.45, D.SIDEPOD_HALF_WIDTH), (0.10, 0.720), (-0.30, 0.610),
                (-0.70, 0.455), (-1.05, 0.330), (-1.30, 0.255), (D.X_SIDEPOD_END, 0.215)])
SP_TOP_OUT = Pchip([(D.X_SIDEPOD_INLET, D.Z_SIDEPOD_INLET_TOP - 0.02), (0.40, 0.595), (0.05, 0.560),
                    (-0.35, 0.470), (-0.75, 0.370), (-1.10, 0.285), (D.X_SIDEPOD_END, 0.215)])
SP_TOP_IN = Pchip([(D.X_SIDEPOD_INLET, D.Z_SIDEPOD_INLET_TOP), (0.40, 0.630), (0.05, 0.615),
                   (-0.35, 0.555), (-0.75, 0.460), (-1.10, 0.360), (D.X_SIDEPOD_END, 0.270)])
SP_LIP = Pchip([(D.X_SIDEPOD_INLET, D.Z_SIDEPOD_INLET_BOTTOM), (0.40, 0.350), (0.05, 0.320),
                (-0.35, 0.250), (-0.75, 0.185), (-1.10, 0.140), (D.X_SIDEPOD_END, 0.110)])
SP_BASE = Pchip([(D.X_SIDEPOD_INLET, 0.330), (0.40, 0.280), (0.0, 0.170), (-0.40, D.Z_FLOOR_TOP + 0.02),
                 (-0.80, D.Z_FLOOR_TOP + 0.004), (D.X_SIDEPOD_END, D.Z_FLOOR_TOP + 0.004)])


def _catmull(pts, per_seg, closed=True):
    """Centripetal Catmull-Rom through pts, a fixed number of samples per segment so features
    stay on the same ring index from section to section."""
    n = len(pts)
    out = []
    segs = n if closed else n - 1
    for s in range(segs):
        p0 = pts[(s - 1) % n] if closed or s > 0 else pts[0] * 2 - pts[1]
        p1, p2 = pts[s % n], pts[(s + 1) % n]
        p3 = pts[(s + 2) % n] if closed or s + 2 < n else pts[-1] * 2 - pts[-2]
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
    """Open profile in (y, z): from the chassis side above the sidepod, a fillet out onto the
    sidepod top, over the shoulder, down the outer face, round the lip, back along the undercut
    and down to the chassis or floor. Both ends sit just inside the chassis surface. Towards the
    rear the whole profile relaxes onto the chassis so the sidepod closes without an end cap."""
    yo, zto, zti, zl, zb = SP_OUT(x), SP_TOP_OUT(x), SP_TOP_IN(x), SP_LIP(x), SP_BASE(x)
    ys_t = spine_y(x, zti)
    h = zto - zl
    r = min(0.075, 0.42 * h)
    yb = spine_y(x, max(zb + 0.004, spine_params(x)[1] + 0.006))
    ctrl = [
        Vector((spine_y(x, zti + 0.060) - 0.003, zti + 0.060)),
        Vector((spine_y(x, zti + 0.022) + 0.002, zti + 0.020)),
        Vector((ys_t + 0.040, zti + 0.003)),
        Vector((lerp(ys_t, yo, 0.55), lerp(zti, zto, 0.62) + 0.008)),
        Vector((yo - 0.55 * r, zto)),
        Vector((yo, zto - 0.75 * r)),
        Vector((yo - 0.004, lerp(zto, zl, 0.55))),
        Vector((yo - 0.35 * r, zl + 0.20 * r)),
        Vector((yo - 1.6 * r, zl - 0.004)),
        Vector((lerp(yo, yb, 0.55), lerp(zl, zb, 0.55) + 0.012)),
        Vector((yb + 0.035, zb + 0.004)),
        Vector((yb - 0.003, zb - 0.010)),
    ]
    per = [q.n(4, 1), q.n(5, 1), q.n(8, 2), q.n(6, 2), q.n(4, 2), q.n(6, 2), q.n(5, 2), q.n(4, 2), q.n(8, 2),
           q.n(7, 2), q.n(3, 1)]
    pts = _catmull(ctrl, per, closed=False)
    # relax onto the chassis over the last 0.3 m
    c = smoothstep(D.X_SIDEPOD_END, D.X_SIDEPOD_END + 0.30, x)
    if c < 1.0:
        pts = [Vector((spine_y(x, p.y) - 0.003, p.y)).lerp(p, c) for p in pts]
    return pts


def _relative_shrink(x, pts, s, zmid):
    """Shrink a sidepod profile towards the mouth's centre while keeping its ends on the chassis:
    the distance out from the chassis and the height from the mouth centre both scale by s."""
    out = []
    for p in pts:
        z = zmid + (p.y - zmid) * s
        d = p.x - spine_y(x, p.y)
        out.append(Vector((spine_y(x, z) + d * s, z)))
    return out


def build_sidepods(mesh_paint, mesh_dark, patches, q):
    nx = q.n(30, 8)
    xs = [D.X_SIDEPOD_INLET - (D.X_SIDEPOD_INLET - D.X_SIDEPOD_END) * (k / nx) ** 1.15 for k in range(nx + 1)]

    def to3d(x, prof):
        rake = 1 - smoothstep(0.0, 0.35, D.X_SIDEPOD_INLET - x)
        zmid = 0.5 * (SP_TOP_IN(x) + SP_LIP(x))
        # the inlet face is raked: the top lip reaches further forward than the bottom
        return [Vector((x + rake * 0.07 * (p.y - zmid) / 0.15, p.x, p.y)) for p in prof]

    grid = [to3d(x, sidepod_section(x, q)) for x in xs]
    left = Mesh()
    loft(left, grid, "paint", patch_key="sidepod", patches=patches)
    # inlet: rounded lip, then the dark duct, closed against the chassis
    x0 = xs[0]
    prof = sidepod_section(x0, q)
    zmid = 0.5 * (SP_TOP_IN(x0) + SP_LIP(x0))
    lip = [p + Vector((-0.014, 0, 0)) for p in to3d(x0, _relative_shrink(x0, prof, 0.92, zmid))]
    duct = [p + Vector((-0.22, 0, 0)) for p in to3d(x0, _relative_shrink(x0, prof, 0.78, zmid))]
    inner = Mesh()
    loft(inner, [grid[0], lip], "paint_edge", flip=True)
    loft(inner, [lip, duct], "dark", flip=True)
    end = Vector((duct[0].x, spine_y(x0, zmid) - 0.004, zmid))
    ci = inner.add_verts([end])
    bi = inner.add_verts(duct)
    for i in range(len(duct) - 1):
        inner.add_face((bi + i + 1, bi + i, ci), "dark")
    mesh_paint.merge(left.with_mirror())
    mesh_dark.merge(inner.with_mirror())
    return grid


# ---------------------------------------------------------------------------------------------
# Floor, edge wing, fences, diffuser, plank
# ---------------------------------------------------------------------------------------------
FLOOR_HW = Pchip([(D.X_FLOOR_FRONT, 0.30), (1.15, 0.55), (D.X_FLOOR_BODY_START, 0.82), (0.70, 0.935),
                  (0.30, D.FLOOR_HALF_WIDTH), (-0.40, 0.965), (-0.90, 0.915), (-1.15, 0.845), (-1.35, 0.70),
                  (-1.50, 0.565), (-1.60, 0.52), (D.X_DIFFUSER_EXIT, 0.505)])
DIFF_TUNNELS = ((0.0, 0.215), (0.215, 0.475))  # (y from, y to) of each diffuser tunnel


def diffuser_roof(x):
    t = clamp((D.X_DIFFUSER_START - x) / (D.X_DIFFUSER_START - D.X_DIFFUSER_EXIT))
    # a shaped throat: flat, then a smooth kick that steepens towards the exit
    return D.Z_REF + (D.Z_DIFFUSER_EXIT - D.Z_REF) * (t * t * (3 - 2 * t) * 0.55 + t ** 2.2 * 0.45)


def tunnel_roof(x, y):
    """Diffuser roof with an arched section in each tunnel (higher in the middle of a tunnel,
    lower at the strakes between them)."""
    r = diffuser_roof(x)
    lift = r - D.Z_REF
    for a, b in DIFF_TUNNELS:
        if a <= y <= b:
            return D.Z_REF + lift * (0.80 + 0.20 * math.sin(math.pi * (y - a) / (b - a)))
    return r


def inlet_roof(x):
    """The floor's leading section is raised to form the tunnel inlets."""
    return D.Z_REF + 0.085 * smoothstep(0.75, D.X_FLOOR_FRONT, x)


def build_floor(mesh_carbon, mesh_dark, q):
    # 32 stations along the floor (16 on Mobile): it is seen edge-on or not at all, and the
    # triangles it gave up pay for the cockpit (wheel, gloves, padding) within the LOD budgets.
    nx = q.n(32, 8)
    xs = [lerp(D.X_FLOOR_FRONT, D.X_DIFFUSER_EXIT, k / nx) for k in range(nx + 1)]
    xs = sorted(set(xs + [D.X_DIFFUSER_START, D.X_FLOOR_BODY_START]), reverse=True)
    n_in, n_out = q.n(20, 6), q.n(16, 4)
    grid = []
    yd = D.DIFFUSER_HALF_WIDTH
    for x in xs:
        hw = FLOOR_HW(x)
        bottom = []
        ys_in = [yd * k / n_in for k in range(n_in + 1)]
        ys_out = [lerp(yd + 0.015, max(hw, yd + 0.03), (k / n_out) ** 0.9) for k in range(n_out + 1)]
        for y in ys_in:
            z = max(tunnel_roof(x, y), inlet_roof(x) if x > 0.75 else D.Z_REF)
            bottom.append(Vector((x, y, z if y < yd - 0.012 else lerp(z, D.Z_REF, 0.5))))
        for y in ys_out:
            z = inlet_roof(x) if x > 0.75 else D.Z_REF
            e = smoothstep(hw - 0.06, hw, y) if hw > yd + 0.1 else 0.0
            bottom.append(Vector((x, y, z + 0.024 * e)))
        # thickness tapers to a thin edge
        top = []
        for p in bottom:
            edge = smoothstep(0.0, 0.06, max(hw, yd + 0.03) - p.y)
            top.append(Vector((p.x, p.y, p.z + lerp(0.005, D.FLOOR_THICK, edge))))
        tip = Vector((x, bottom[-1].y + 0.002, bottom[-1].z + 0.0025))
        grid.append(bottom + [tip] + list(reversed(top)))
    left = Mesh()
    loft(left, grid, "carbon_matte", flip=True)
    mesh_carbon.merge(left.with_mirror())
    # diffuser: outer walls down to the reference plane, a keel, and curved strakes
    walls = Mesh()
    nn = q.n(10, 3)
    for y0, th, flare in ((yd + 0.004, 0.006, 0.030),):
        rows = []
        for k in range(nn + 1):
            t = k / nn
            x = lerp(D.X_DIFFUSER_START + 0.05, D.X_DIFFUSER_EXIT, t)
            y = y0 + flare * t * t
            r = diffuser_roof(x) + 0.004
            zb = D.Z_REF - 0.004 + 0.010 * t
            rows.append([Vector((x, y + th, r)), Vector((x, y + th, zb)), Vector((x, y, zb)), Vector((x, y, r))])
        loft(walls, rows, "carbon_matte", closed=True, cap0=True, cap1=True)
    for y0 in (DIFF_TUNNELS[0][1],):
        rows = []
        for k in range(nn + 1):
            t = k / nn
            x = lerp(D.X_DIFFUSER_START - 0.10, D.X_DIFFUSER_EXIT + 0.01, t)
            y = y0 + 0.055 * t * t
            r = tunnel_roof(x, y) + 0.003
            zb = D.Z_REF - 0.003 + 0.02 * t * t
            rows.append([Vector((x, y + 0.0025, r)), Vector((x, y + 0.0025, zb)), Vector((x, y - 0.0025, zb)),
                         Vector((x, y - 0.0025, r))])
        loft(walls, rows, "carbon_matte", closed=True, cap0=True, cap1=True)
    # exit lip: a small upturned strip on the roof's trailing edge
    rows = []
    for k in range(q.n(12, 4) + 1):
        y = yd * k / q.n(12, 4)
        x = D.X_DIFFUSER_EXIT + 0.004
        z = tunnel_roof(x, y) + D.FLOOR_THICK * 0.5
        rows.append([Vector((x, y, z)), Vector((x - 0.010, y, z + 0.020)), Vector((x - 0.014, y, z + 0.018)),
                     Vector((x - 0.006, y, z - 0.004))])
    # starts on the centreline: the mirrored half closes it, so no cap there
    loft(walls, rows, "carbon_matte", closed=True, cap1=True)
    mesh_carbon.merge(walls.with_mirror())
    if q.lod == "far":
        # the far car keeps the floor, plank and diffuser walls; fences, edge wings and skids go
        pl = Mesh()
        rows = []
        for s in range(3):
            x = lerp(D.X_PLANK_FRONT, D.X_PLANK_REAR, s / 2)
            w = D.PLANK_HALF_WIDTH
            rows.append([Vector((x, w, D.Z_REF + 0.001)), Vector((x, w, D.PLANK_BOTTOM)), Vector((x, -w, D.PLANK_BOTTOM)),
                         Vector((x, -w, D.Z_REF + 0.001))])
        loft(pl, rows, "plank", closed=True, cap0=True, cap1=True)
        mesh_dark.merge(pl)
        return
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
            rows.append([Vector((x, y + 0.0025, zt)), Vector((x, y + 0.0025, zb)),
                         Vector((x, y - 0.0025, zb)), Vector((x, y - 0.0025, zt))])
        loft(fences, rows, "carbon_matte", closed=True, cap0=True, cap1=True)
    mesh_carbon.merge(fences.with_mirror())
    # edge wing above the floor edge: a thin cambered strip on slim brackets
    ew = Mesh()
    rows = []
    nn = q.n(16, 4)
    for s in range(nn + 1):
        x = lerp(0.70, -0.70, s / nn)
        hw = FLOOR_HW(x)
        y = hw - 0.020
        z = D.Z_FLOOR_TOP + 0.022 + 0.006 * math.sin(math.pi * s / nn)
        c = 0.055
        rows.append([Vector((x, y + 0.001, z)), Vector((x, y - c * 0.95, z + 0.013)), Vector((x, y - c, z + 0.009)),
                     Vector((x, y - 0.003, z - 0.003))])
    loft(ew, rows, "carbon_matte", closed=True, cap0=True, cap1=True)
    for x in (0.45, -0.1, -0.55):
        hw = FLOOR_HW(x) - 0.028
        rows = [[Vector((x + 0.015, hw, D.Z_FLOOR_TOP - 0.002)), Vector((x - 0.015, hw, D.Z_FLOOR_TOP - 0.002)),
                 Vector((x - 0.015, hw - 0.003, D.Z_FLOOR_TOP - 0.002)), Vector((x + 0.015, hw - 0.003, D.Z_FLOOR_TOP - 0.002))]]
        rows.append([p + Vector((0, 0, 0.026)) for p in rows[0]])
        loft(ew, rows, "carbon_matte", closed=True, cap0=True, cap1=True)
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
    if q.lod == "far":
        return
    skid = Mesh()
    for x in (0.80, 0.10, -0.60):
        for y in (-0.08, 0.08):
            ring = [Vector((x + 0.022 * math.cos(a), y + 0.022 * math.sin(a), D.PLANK_BOTTOM - 0.0006))
                    for a in [2 * math.pi * k / 12 for k in range(12)]]
            ring2 = [p + Vector((0, 0, 0.003)) for p in ring]
            loft(skid, [ring, ring2], "metal_satin", closed=True, cap0=True, cap1=True)
    mesh_dark.merge(skid)


# ---------------------------------------------------------------------------------------------
# Rear crash structure, rain-light housing, exhaust
# ---------------------------------------------------------------------------------------------
RAIN_LIGHT = (0.040, 0.026)  # half width, half height of the lamp


def build_rear(mesh_carbon, mesh_dark, q):
    n = q.n(10, 4)
    x0 = -1.85
    xs = [lerp(x0, D.X_CRASH_TIP, k / n) for k in range(n + 1)]
    grid = []
    for x in xs:
        t = (x - x0) / (D.X_CRASH_TIP - x0)
        hw = lerp(0.105, 0.064, t ** 0.9)
        zb = lerp(D.Z_CRASH_CENTRE - 0.090, D.Z_CRASH_CENTRE - 0.050, t)
        zt = lerp(D.Z_CRASH_CENTRE + 0.075, D.Z_CRASH_CENTRE + 0.046, t)
        zm = lerp(zb, zt, 0.42)
        # flat underside, rounded top
        ring = superellipse_half(hw, zb, zm, zt, 4.5, 2.6, q.n(14, 6), w_top=0.78 * hw)
        grid.append([Vector((x, p.y, p.z)) for p in ring])
    m = Mesh()
    loft(m, grid, "carbon", flip=True)
    # tip: a frame round the lamp, closed on the symmetry plane
    tip = grid[-1]
    cap_half_ring(m, tip, "carbon", flip=True)
    mesh_carbon.merge(m.with_mirror())
    # lamp bezel standing 6 mm proud of the tip
    lw, lh = RAIN_LIGHT
    zc = D.Z_CRASH_CENTRE
    xt = D.X_CRASH_TIP
    bz = Mesh()
    outer = [Vector((xt, y, zc + z)) for (y, z) in ((lw + 0.010, -lh - 0.010), (lw + 0.010, lh + 0.010),
                                                    (-lw - 0.010, lh + 0.010), (-lw - 0.010, -lh - 0.010))]
    front = [p + Vector((-0.006, 0, 0)) for p in outer]
    inner = [Vector((xt - 0.006, p.y * lw / (lw + 0.010), zc + (p.z - zc) * lh / (lh + 0.010))) for p in outer]
    loft(bz, [[p + Vector((0.004, 0, 0)) for p in outer], front, inner], "dark", closed=True)
    mesh_dark.merge(bz)
    # exhaust: tailpipe with a rolled lip and a dark bore
    ex = Mesh()
    n = q.n(20, 8)
    ze = 0.445

    def circ(x, r):
        return [Vector((x, r * math.cos(2 * math.pi * k / n), ze + r * math.sin(2 * math.pi * k / n))) for k in range(n)]

    loft(ex, [circ(-1.95, 0.052), circ(-2.22, 0.050), circ(-2.275, 0.051), circ(-2.285, 0.048),
              circ(-2.278, 0.044)], "exhaust", closed=True, flip=True)
    loft(ex, [circ(-2.278, 0.044), circ(-2.05, 0.043)], "soot", closed=True, cap1=True, flip=True)
    mesh_dark.merge(ex)
