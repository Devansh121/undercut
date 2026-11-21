"""Wheels and corners: tyre, rim, wheel cover, nut, brake disc, upright, brake duct, wheel-wake
deflector. Each wheel is built at the origin with its axle along +Y (outboard is +Y for a left
wheel); the assembly mirrors it for the right side."""

import math

from mathutils import Vector

from . import dims as D
from .geom import Mesh, lathe, lerp, loft, naca4, smoothstep


def tyre_profile(width, q):
    """(r, w) profile from the inboard bead, over the sidewall, shoulder and tread to the
    outboard bead. w is along the axle, 0 at the tyre centre plane."""
    R = D.TYRE_RADIUS
    rb = D.RIM_LIP_RADIUS - 0.004
    hw = width / 2
    side_hw = hw - 0.004  # sidewall bulge slightly inside the tread edge
    pts = []
    n_side = q.n(9, 3)
    n_sh = q.n(6, 2)
    n_tr = q.n(6, 2)
    # inboard sidewall: from bead up to the shoulder start, bulging outwards
    r_sh = R - 0.040
    for k in range(n_side + 1):
        t = k / n_side
        r = lerp(rb, r_sh, t)
        bulge = 0.016 * math.sin(math.pi * min(1.0, t * 1.05)) ** 0.8
        w = -(side_hw - 0.022 + 0.022 * t + bulge * (1 - t * 0.4))
        pts.append((r, w))
    # shoulder: quarter round to the tread
    c = (R - 0.040, -(hw - 0.040))
    for k in range(1, n_sh + 1):
        a = math.pi / 2 * k / n_sh
        pts.append((c[0] + 0.040 * math.sin(a), c[1] - 0.040 * math.cos(a)))
    # tread with a slight crown, traversed once from the inboard to the outboard shoulder
    for k in range(1, n_tr):
        w = lerp(-(hw - 0.040), hw - 0.040, k / n_tr)
        pts.append((R + 0.002 * (1 - (w / hw) ** 2), w))
    # outboard shoulder and sidewall: the inboard ones mirrored (tread excluded)
    side_and_shoulder = pts[: n_side + 1 + n_sh]
    prof = pts + [(r, -w) for (r, w) in reversed(side_and_shoulder)]
    # one bead-to-bead pass: no point twice, the tread crossed exactly once
    keys = [(round(r, 6), round(w, 6)) for (r, w) in prof]
    assert len(set(keys)) == len(keys), "tyre profile repeats a point"
    tread = [w for (r, w) in prof if r > R - 0.0005]
    assert all(b > a for a, b in zip(tread, tread[1:])), "tyre tread is not crossed once"
    return prof


def tyre_uv_v(prof):
    """v coordinate of each profile point: arc length with the sidewalls weighted up, so the
    sidewall markings get most of the texture and the plain tread little of it."""
    R = D.TYRE_RADIUS
    acc = [0.0]
    for k in range(1, len(prof)):
        (r0, w0), (r1, w1) = prof[k - 1], prof[k]
        seg = math.hypot(r1 - r0, w1 - w0)
        on_side = max(r0, r1) < R - 0.040 + 1e-6
        acc.append(acc[-1] + seg * (3.0 if on_side else 0.35))
    return [a / acc[-1] for a in acc]


def tyre_shoulders(prof):
    vs = tyre_uv_v(prof)
    R = D.TYRE_RADIUS
    side = [i for i, (r, _) in enumerate(prof) if r < R - 0.040 + 1e-6]
    first = [i for i in side if i < len(prof) // 2]
    last = [i for i in side if i >= len(prof) // 2]
    return {"in": vs[max(first)], "out": vs[min(last)]}


def build_tyre(width, q, segs):
    m = Mesh()
    prof = tyre_profile(width, q)
    lathe(m, prof, segs, "tyre", flip=True)
    # UV1 for the tyre: u round the wheel (0..1), v along the profile (see tyre_uv_v); the
    # sidewall texture is laid out in this space
    vs = tyre_uv_v(prof)
    for k in range(len(m.f)):
        uv = []
        for vi in m.f[k]:
            j, i = divmod(vi, segs)
            uv.append((i / segs, vs[j]))
        us = [u for u, _ in uv]
        if max(us) - min(us) > 0.5:
            uv = [(u + 1.0 if u < 0.5 else u, v) for u, v in uv]
        m.uv1[k] = uv
    return m


def build_rim(width, q, segs, patches=None):
    """Rim barrel with outer lip, a domed wheel cover over the outboard face and the nut."""
    m = Mesh()
    hw = width / 2
    rl, rb = D.RIM_LIP_RADIUS, D.RIM_BEAD_RADIUS
    # barrel seen from outboard: lip, bead seat, drop into the barrel, back out to inboard lip
    prof = [
        (rb - 0.010, hw - 0.002),
        (rl - 0.002, hw + 0.003),
        (rl + 0.001, hw - 0.006),
        (rb + 0.006, hw - 0.014),
        (rb + 0.004, -hw + 0.014),
        (rl + 0.001, -hw + 0.006),
        (rl - 0.002, -hw - 0.003),
        (rb - 0.010, -hw + 0.002),
        (rb - 0.014, -hw + 0.030),
        (rb - 0.014, hw - 0.020),
    ]
    if q.lod == "far":
        # far: the visible lip and a flat cover, nothing behind them
        lathe(m, [(rb - 0.012, hw - 0.004), (rl, hw + 0.002), (rl, hw - 0.010)], segs, "rim")
        lathe(m, [(rb - 0.012, hw - 0.004), (0.12, hw - 0.030), (0.0, hw - 0.022)], segs, "paint", flip=True,
              patch_key="wheel_cover" if patches is not None else None, patches=patches)
        return m
    lathe(m, prof, segs, "rim", sharp_rows=(1, 2, 5, 6, 7))
    # wheel cover: a rolled rim tucked behind the wheel lip, a dished face with a shallow step
    # ring, then a raised hub boss round the nut
    hi = q.f >= 1
    cov = [(rb - 0.004, hw - 0.010), (rb - 0.012, hw - 0.015)]
    n = 6 if hi else 3
    for k in range(1, n + 1):
        t = k / n
        cov.append((lerp(rb - 0.012, 0.132, t), hw - 0.015 - 0.026 * math.sin(math.pi * 0.5 * t) ** 1.2))
    cov += [(0.126, hw - 0.037), (0.090, hw - 0.036), (0.066, hw - 0.031), (0.056, hw - 0.024), (0.050, hw - 0.028)]
    lathe(m, cov, segs, "paint", flip=True, patch_key="wheel_cover" if patches is not None else None,
          patches=patches, sharp_rows=(1, n + 1, n + 2))
    # centre-lock nut
    nut = [(0.050, hw - 0.029), (0.046, hw - 0.006), (0.036, hw + 0.002), (0.012, hw + 0.004), (0.001, hw + 0.004)]
    lathe(m, nut, max(12, segs // 3), "nut", sharp_rows=(1, 2), flip=True)
    return m


def build_disc(width, q, segs, front):
    """Ventilated carbon disc inside the rim, inboard of the hub. The emissive mask on its
    material is driven by brake temperature at runtime."""
    m = Mesh()
    r_out, r_in = (0.170, 0.108) if front else (0.160, 0.102)
    th = 0.032 if front else 0.028
    w0 = -0.03
    prof = [(r_in, w0 - th / 2), (r_out, w0 - th / 2), (r_out, w0 + th / 2), (r_in, w0 + th / 2)]
    lathe(m, prof + [prof[0]], segs, "brake_disc", sharp_rows=(1, 2, 3), flip=True)
    # UV1: v is the radial position across the friction ring (the glow ramp runs along v)
    for k in range(len(m.f)):
        uv = []
        for vi in m.f[k]:
            p = m.v[vi]
            r = math.hypot(p.x, p.z)
            uv.append((0.5, (r - r_in) / (r_out - r_in)))
        m.uv1[k] = uv
    return m


def build_upright(front, q):
    """Upright, caliper and brake duct drum, in the wheel frame (origin at the wheel centre,
    +Y outboard). Not spinning; steers with the wheel."""
    m = Mesh()
    segs = q.n(28, 10)
    w = D.TYRE_WIDTH_FRONT if front else D.TYRE_WIDTH_REAR
    rim_in = -(D.RIM_WIDTH_FRONT if front else D.RIM_WIDTH_REAR) / 2
    # brake duct drum: a cylinder filling the inboard side of the rim
    drum_r = D.RIM_BEAD_RADIUS - 0.022
    prof = [(0.002, rim_in - 0.035), (drum_r - 0.02, rim_in - 0.035), (drum_r, rim_in - 0.015),
            (drum_r, -0.07), (drum_r - 0.03, -0.06), (0.002, -0.06)]
    lathe(m, prof, segs, "carbon", flip=True)
    # duct inlet scoop on the front of the drum
    sc = Mesh()
    rows = []
    n = q.n(8, 4)
    for k in range(n + 1):
        t = k / n
        x = lerp(0.20, 0.10, t)
        zc = lerp(0.03 if front else 0.05, 0.0, t)
        hw_ = lerp(0.045, 0.06, t)
        hh = lerp(0.055, 0.07, t)
        y0 = rim_in - lerp(0.075, 0.06, t)
        ring = []
        for a in range(12):
            th = 2 * math.pi * a / 12
            ring.append(Vector((x, y0 + hw_ * math.cos(th), zc + hh * math.sin(th))))
        rows.append(ring)
    lip = [rows[0][0] * 0 + (p - sum(rows[0], Vector()) / 12) * 0.8 + sum(rows[0], Vector()) / 12 for p in rows[0]]
    loft(sc, rows, "carbon", closed=True)
    loft(sc, [lip, rows[0]], "carbon", closed=True)
    loft(sc, [[p + Vector((-0.06, 0, 0)) for p in lip], lip], "dark", closed=True, cap0=True)
    m.merge(sc)
    # caliper: a curved block on the disc, behind the axle
    cal = Mesh()
    rows = []
    for k in range(7):
        a = math.radians(lerp(150, 215, k / 6))
        ring = []
        for (dr, dw) in ((-0.035, -0.028), (0.012, -0.028), (0.012, 0.028), (-0.035, 0.028)):
            r = 0.165 + dr
            ring.append(Vector((r * math.cos(a), -0.03 + dw, r * math.sin(a))))
        rows.append(ring)
    loft(cal, rows, "caliper", closed=True, cap0=True, cap1=True)
    m.merge(cal)
    if front:
        # wheel-wake deflector above the drum, inboard of the tyre top
        dv = Mesh()
        prof2 = naca4(0.06, 0.4, 0.10, q.n(16, 8))
        rows = []
        n = q.n(10, 4)
        for k in range(n + 1):
            t = k / n
            a = math.radians(lerp(60, 120, t))
            r = D.RIM_BEAD_RADIUS + 0.005
            cx, cz = r * math.cos(a), r * math.sin(a)
            chord = 0.085
            y = rim_in - 0.055
            # profile lies along the circumference, thickness radial
            tan = Vector((-math.sin(a), 0, math.cos(a)))
            rad = Vector((math.cos(a), 0, math.sin(a)))
            ring = [Vector((cx, y, cz)) + Vector((0, -u * chord + 0.04, 0)) + rad * (wv * chord) for (u, wv) in prof2]
            rows.append(ring)
        loft(dv, rows, "carbon", closed=True, cap0=True, cap1=True)
        m.merge(dv)
    # upright body: a tall streamlined block inside the drum
    up = Mesh()
    rows = []
    for k in range(5):
        z = lerp(-0.18, 0.20, k / 4)
        ring = []
        for a in range(10):
            th = 2 * math.pi * a / 10
            ring.append(Vector((0.045 * math.cos(th), rim_in + 0.03 + 0.025 * math.sin(th), z)))
        rows.append(ring)
    loft(up, rows, "metal_dark", closed=True, cap0=True, cap1=True)
    m.merge(up)
    # UV1 pinned to the cold end of the disc's glow ramp: where an LOD gives the upright the
    # disc material, only the disc itself lights up
    m.uv1 = [[(0.5, 0.0)] * len(uv) for uv in m.uv1]
    return m
