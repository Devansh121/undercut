"""Halo with its fairing, headrest, helmet and visor, steering wheel with display, mirrors on
stalks, T-camera. And the suspension links, which share the streamlined-leg helper."""

import math

from mathutils import Vector

from . import dims as D
from .geom import Mesh, arm, clamp, lerp, loft, naca4, smoothstep, superellipse_half, tube


def _smooth_path(ctrl, per=6, iters=3):
    path = []
    for k in range(len(ctrl) - 1):
        for i in range(per):
            path.append(Vector(ctrl[k]).lerp(Vector(ctrl[k + 1]), i / per))
    path.append(Vector(ctrl[-1]))
    for _ in range(iters):
        path = [path[0]] + [(path[i - 1] + path[i] * 2 + path[i + 1]) / 4 for i in range(1, len(path) - 1)] + [path[-1]]
    return path


def build_halo(mesh_paint, patches, q):
    """The halo: a centre pylon from the chassis rising to the hoop, which runs back either side of
    the driver's head to two rear mounts. Faired section, wider than tall on the hoop."""
    hz, hx0, hx1 = D.Z_HALO_TOP, D.X_HALO_FRONT, D.X_HALO_REAR
    hw = D.HALO_HALF_WIDTH_REAR
    # hoop, left half: from the front centre round to the rear mount
    n = q.n(26, 8)
    hoop = []
    for k in range(n + 1):
        t = k / n
        a = math.pi * 0.5 * t
        x = lerp(hx0, hx1 + 0.10, 1 - math.cos(a) ** 1.0) if t < 1 else hx1 + 0.10
        x = hx0 - (hx0 - (hx1 + 0.12)) * (1 - math.cos(a))
        y = hw * math.sin(a) ** 0.85
        z = hz + 0.008 * math.sin(a)
        hoop.append(Vector((x, y, z)))
    # rear leg: from the end of the hoop arc down and back to the mount on the chassis
    end = hoop[-1]
    leg = [end.lerp(Vector((hx1, hw + 0.01, D.Z_HALO_REAR_MOUNT)), k / q.n(8, 3)) for k in range(1, q.n(8, 3) + 1)]
    path = hoop + leg
    for _ in range(4):
        path = [path[0]] + [(path[i - 1] + path[i] * 2 + path[i + 1]) / 4 for i in range(1, len(path) - 1)] + [path[-1]]
    nsec = q.n(16, 8)
    grid = []
    for k, p in enumerate(path):
        t = (path[min(k + 1, len(path) - 1)] - path[max(k - 1, 0)]).normalized()
        up = Vector((0, 0, 1))
        side = t.cross(up).normalized()
        upn = side.cross(t).normalized()
        s = k / (len(path) - 1)
        a, b = lerp(0.034, 0.030, s), lerp(0.024, 0.026, s)
        ring = []
        for i in range(nsec):
            th = 2 * math.pi * i / nsec
            c, si = math.cos(th), math.sin(th)
            # flattened teardrop: fuller on top, a sharper lower edge
            bb = b * (1.0 if si > 0 else 0.8)
            ring.append(p + side * (a * c) + upn * (bb * si))
        grid.append(ring)
    m = Mesh()
    loft(m, grid, "paint", closed=True, cap1=True, patch_key="halo", patches=patches)
    mesh_paint.merge(m.with_mirror())
    # centre pylon: a faired blade from the chassis to the hoop front
    py = Mesh()
    rows = []
    nn = q.n(8, 3)
    for k in range(nn + 1):
        t = k / nn
        x = lerp(D.X_HALO_PYLON_BASE, hx0 + 0.015, t)
        z = lerp(D.Z_HALO_PYLON_BASE - 0.02, hz - 0.004, t ** 0.9)
        chord = lerp(0.12, 0.05, t)
        prof = naca4(0.0, 0.4, 0.28, q.n(16, 8), te=0.03)
        rows.append([Vector((x - u * chord + 0.02, w * chord, z)) for (u, w) in prof])
    loft(py, rows, "paint", closed=True, cap0=True, cap1=True, patch_key="halo_pylon", patches=patches)
    mesh_paint.merge(py)


def build_headrest(mesh_dark, q):
    """Padded headrest: side pads along the cockpit rim beside the helmet and a pad behind it,
    each a fat rounded block sitting on the rim."""
    m = Mesh()
    n = q.n(10, 4)

    def pad(x0, x1, y_out, y_in_at, z_top, z_bot, rows):
        grid = []
        for k in range(rows + 1):
            t = k / rows
            x = lerp(x0, x1, t)
            yi = y_in_at(x)
            ring = superellipse_half(0.5 * (y_out - yi), z_bot, lerp(z_bot, z_top, 0.55), z_top, 2.5, 3.0, n)
            cy = 0.5 * (y_out + yi)
            # mirror the half ring into a full closed section around the pad's own centre
            full = [Vector((x, cy + p.y, p.z)) for p in ring] + [Vector((x, cy - p.y, p.z)) for p in reversed(ring[1:-1])]
            grid.append(full)
        loft(m, grid, "headrest", closed=True, cap0=True, cap1=True)

    rim = D.COCKPIT_HALF_WIDTH
    zr = D.Z_CHASSIS_TOP_COCKPIT
    # side pads: from beside the steering wheel back to the opening's rear edge
    pad(0.42, D.X_COCKPIT_REAR + 0.02, rim + 0.035, lambda x: rim - 0.055 - 0.02 * smoothstep(0.42, 0.1, x),
        zr + 0.065, zr - 0.06, q.n(8, 3))
    mesh_dark.merge(m.with_mirror())
    m2 = Mesh()
    grid = []
    for k in range(q.n(8, 3) + 1):
        t = k / q.n(8, 3)
        y = lerp(-rim + 0.02, rim - 0.02, t)
        ring = superellipse_half(0.045, zr - 0.08, zr, zr + 0.085, 2.5, 3.0, n)
        full = [Vector((D.X_COCKPIT_REAR + 0.02 + p.y, y, p.z)) for p in ring] + \
            [Vector((D.X_COCKPIT_REAR + 0.02 - p.y, y, p.z)) for p in reversed(ring[1:-1])]
        grid.append(full)
    loft(m2, grid, "headrest", closed=True, cap0=True, cap1=True)
    mesh_dark.merge(m2)


def build_helmet(q, patches):
    """Helmet in horizontal slices, centred on its own origin. The visor is a clean band of
    rows and ring points facing forward; the shell carries a livery patch."""
    m = Mesh()
    a, b, c = D.HELMET_RADII
    n_ring, n_h = q.n(32, 12), q.n(18, 8)
    z_lo, z_hi = -0.80 * c, c
    zs = [z_lo + (z_hi - z_lo) * (1 - math.cos(0.5 * math.pi * k / n_h)) ** 0.85 if k < n_h else z_hi for k in range(n_h + 1)]
    zs = [z_lo + (z_hi - z_lo) * k / n_h for k in range(n_h + 1)]
    grid = []
    for z in zs:
        s = math.sqrt(max(0.0, 1 - (z / c) ** 2)) if z > 0 else math.sqrt(max(0.0, 1 - (z / (0.95 * c)) ** 2))
        s = max(s, 0.04)
        ring = []
        for i in range(n_ring):
            th = 2 * math.pi * i / n_ring
            x = a * s * math.cos(th)
            y = b * s * math.sin(th)
            # chin bar: the lower front pushes forward
            if z < 0 and math.cos(th) > 0:
                x += 0.020 * math.cos(th) ** 2 * smoothstep(0.0, -0.06, z)
            ring.append(Vector((x, y, z)))
        grid.append(ring)
    loft(m, grid, "paint", closed=True, cap0=True, patch_key="helmet", patches=patches)
    # visor: rows inside the band, ring points facing forward
    rows = len(grid)
    cols = n_ring
    for k in range(len(m.f)):
        f = m.f[k]
        if len(f) != 4:
            continue
        j = min(f) // cols
        i = min(f) % cols
        th = 2 * math.pi * (i + 0.5) / cols
        zc = 0.5 * (zs[j] + zs[min(j + 1, rows - 1)])
        if -0.030 <= zc <= 0.045 and math.cos(th) > math.cos(math.radians(62)):
            m.mat[k] = "visor"
            m.patch[k] = None
            m.uv0[k] = None
    return m


def build_steering_wheel(q):
    """Steering wheel in its own frame: origin at the wheel centre, +X towards the driver along
    the column, display facing the driver."""
    m = Mesh()
    w, h, t = 0.135, 0.075, 0.035
    rows = []
    n = q.n(20, 8)
    for k in range(n):
        th = 2 * math.pi * k / n
        c, s = math.cos(th), math.sin(th)
        y = math.copysign(abs(c) ** 0.4, c) * w
        z = math.copysign(abs(s) ** 0.6, s) * h
        rows.append(Vector((0, y, z)))
    front = rows
    back = [p + Vector((-t, 0, 0)) for p in rows]
    loft(m, [back, front], "carbon", closed=True, cap0=True)
    # display recess on the face
    disp = [Vector((0.001, y, z)) for (y, z) in ((-0.05, -0.028), (0.05, -0.028), (0.05, 0.026), (-0.05, 0.026))]
    d = Mesh()
    i0 = d.add_verts(disp)
    d.add_face((i0, i0 + 1, i0 + 2, i0 + 3), "display", uv1=[(0, 0), (1, 0), (1, 1), (0, 1)])
    m.merge(d)
    # grips
    for side in (-1, 1):
        g = Mesh()
        rows = []
        for k in range(6):
            z = lerp(-0.07, 0.065, k / 5)
            rr = 0.024 * (1 - 0.3 * abs(2 * k / 5 - 1))
            rows.append([Vector((-0.02 + rr * math.cos(2 * math.pi * i / 10), side * (w + 0.010) + rr * 0.8 * math.sin(2 * math.pi * i / 10), z))
                         for i in range(10)])
        loft(g, rows, "grip", closed=True, cap0=True, cap1=True)
        m.merge(g)
    return m


def build_mirrors(mesh_paint, mesh_carbon, mesh_dark, patches, q):
    m = Mesh()
    cx, cy, cz = 0.79, 0.555, 0.705
    w, h, d = 0.165, 0.058, 0.085
    n = q.n(18, 8)
    rows = []
    for k in range(q.n(8, 4) + 1):
        t = k / q.n(8, 4)
        x = cx + d * 0.5 - d * t
        s = math.sin(math.pi * min(1.0, 0.15 + t)) ** 0.35 if t < 0.85 else 1.0
        ring = []
        for i in range(n):
            th = 2 * math.pi * i / n
            c, si = math.cos(th), math.sin(th)
            ring.append(Vector((x, cy + math.copysign(abs(c) ** 0.45, c) * w / 2 * s,
                                cz + math.copysign(abs(si) ** 0.6, si) * h / 2 * s)))
        rows.append(ring)
    loft(m, rows, "paint", closed=True, patch_key="mirror", patches=patches, flip=True)
    glass = [p + Vector((0.004, 0, 0)) for p in rows[-1]]
    glass = [Vector((p.x, cy + (p.y - cy) * 0.9, cz + (p.z - cz) * 0.85)) for p in glass]
    g = Mesh()
    loft(g, [rows[-1], glass], "dark", closed=True)
    cen = sum(glass, Vector()) / len(glass)
    ci = g.add_verts([cen])
    gi = g.add_verts(glass)
    for i in range(n):
        g.add_face((gi + i, gi + (i + 1) % n, ci), "mirror_glass")
    mesh_paint.merge(m.with_mirror())
    mesh_dark.merge(g.with_mirror())
    st = Mesh()
    arm(st, (cx - 0.01, cy - 0.06, cz - 0.02), (0.80, 0.50, 0.60), 0.04, 0.010, q.n(12, 6), "carbon")
    arm(st, (cx - 0.02, cy - 0.07, cz), (0.84, 0.36, 0.69), 0.035, 0.009, q.n(12, 6), "carbon")
    mesh_carbon.merge(st.with_mirror())


def build_tcam(mesh_dark, q):
    m = Mesh()
    from .body import AB_TOP

    x0 = D.X_ROLL_HOOP - 0.10
    rows = []
    n = q.n(12, 6)
    for k in range(6):
        t = k / 5
        x = x0 - 0.14 * t
        r = 0.022 * math.sin(math.pi * min(1.0, 0.1 + 0.9 * t)) ** 0.5 + 0.004
        z0 = AB_TOP(x) - 0.006
        rows.append([Vector((x, r * math.cos(2 * math.pi * i / n) * 1.6, z0 + 0.018 + r * math.sin(2 * math.pi * i / n)))
                     for i in range(n)])
    loft(m, rows, "tcam", closed=True, cap0=True, cap1=True)
    mesh_dark.merge(m)


# ---------------------------------------------------------------------------------------------
# Suspension links
# ---------------------------------------------------------------------------------------------
def link_mesh(points, q, chord=0.055, thick=0.016, mat="carbon"):
    """A wishbone (two legs meeting at the outboard point) or a single rod, in world space."""
    m = Mesh()
    n = q.n(14, 6)
    if len(points) == 3:
        a, b, out = (Vector(p) for p in points)
        arm(m, a, out, chord, thick, n, mat, pad=0.01)
        arm(m, b, out, chord, thick, n, mat, pad=0.01)
    else:
        a, out = (Vector(p) for p in points)
        arm(m, a, out, chord * 0.8, thick * 0.9, n, mat, pad=0.01)
    return m


def driveshaft(q, y_out):
    m = Mesh()
    n = q.n(12, 6)
    a = Vector((D.X_REAR_AXLE, 0.14, D.WHEEL_Z - 0.03))
    b = Vector((D.X_REAR_AXLE, y_out, D.WHEEL_Z))
    tube(m, a, b, 0.022, n, "metal_dark")
    for p, r in ((a.lerp(b, 0.06), 0.040), (a.lerp(b, 0.94), 0.040)):
        tube(m, p - (b - a).normalized() * 0.03, p + (b - a).normalized() * 0.03, r, n, "boot", radius_b=0.026)
    return m
