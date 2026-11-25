"""Halo with its fairing, headrest, helmet and visor, steering wheel with display, mirrors on
stalks, T-camera. And the suspension links, which share the streamlined-leg helper."""

import math

from mathutils import Matrix, Vector

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
    frames = []
    for k, p in enumerate(path):
        t = (path[min(k + 1, len(path) - 1)] - path[max(k - 1, 0)]).normalized()
        up = Vector((0, 0, 1))
        side = t.cross(up).normalized()
        upn = side.cross(t).normalized()
        frames.append((p, side, upn))
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
    base = loft(m, grid, "paint", closed=True, cap1=True, patch_key="halo", patches=patches)
    # The underside and the inner face (towards the driver's head) are bare carbon, as on the real
    # part: from the cockpit the hoop reads dark against the sky, with the painted top beyond it.
    cols = len(grid[0])
    for k, f in enumerate(m.f):
        j = (min(f) - base) // cols
        if j >= len(frames) - 1:
            continue
        p, side, upn = frames[j]
        centre = sum((m.v[i] for i in f), Vector()) / len(f)
        d = (centre - p).normalized()
        if d.dot(side) < -0.35 or d.dot(upn) < -0.55:
            m.mat[k] = "carbon"
            m.patch[k] = None
            m.uv0[k] = None
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


# Steering wheel, in its own frame: origin at the wheel centre, +X towards the driver along the
# column, +Y to the wheel's left as built (the assembly turns it to face the driver), +Z up.
WHEEL_HALF_WIDTH, WHEEL_HALF_HEIGHT = 0.120, 0.078
GRIP_Y = WHEEL_HALF_WIDTH + 0.010
GRIP_X = -0.016
DISPLAY_HALF = (0.047, 0.0295)  # the screen is 1.6:1, like the 256 x 160 canvas drawn into it
DISPLAY_Z = 0.014


def _outline(n, scale, x):
    """Faceplate outline: flat top and bottom, full sides where the grips attach."""
    pts = []
    for k in range(n):
        th = 2 * math.pi * k / n
        c, s = math.cos(th), math.sin(th)
        y = math.copysign(abs(c) ** 0.35, c) * WHEEL_HALF_WIDTH * scale
        z = math.copysign(abs(s) ** 0.55, s) * WHEEL_HALF_HEIGHT * scale
        pts.append(Vector((x, y, z)))
    return pts


def _rounded_rect(hw, hh, r, x, n_corner):
    pts = []
    for cy, cz, a0 in ((hw - r, hh - r, 0.0), (-hw + r, hh - r, 0.5 * math.pi),
                       (-hw + r, -hh + r, math.pi), (hw - r, -hh + r, 1.5 * math.pi)):
        for k in range(n_corner + 1):
            a = a0 + 0.5 * math.pi * k / n_corner
            pts.append(Vector((x, cy + r * math.cos(a), DISPLAY_Z + cz + r * math.sin(a))))
    return pts


def _planar_metric_uv(m, mats):
    """Metric UVs projected along each face's dominant axis (the weave keeps its 3 mm scale on
    caps and flat faces, where loft caps would otherwise stretch it into stripes)."""
    for k, f in enumerate(m.f):
        if m.mat[k] not in mats:
            continue
        a, b, c = (m.v[i] for i in f[:3])
        nrm = (b - a).cross(c - a)
        ax = max(range(3), key=lambda i: abs(nrm[i]))
        iu, iv = ((1, 2), (0, 2), (0, 1))[ax]
        m.uv1[k] = [(m.v[i][iu], m.v[i][iv]) for i in f]


def build_steering_wheel(q):
    """A current single-seater wheel: a bevelled carbon faceplate with the screen in a bezel at the
    top, push buttons round it, knurled rotary switches below, and moulded rubber grips with
    finger ridges at both sides."""
    m = Mesh()
    n = q.n(28, 12)
    rows = [_outline(n, 0.95, -0.032), _outline(n, 1.0, -0.027), _outline(n, 1.0, -0.005), _outline(n, 0.97, 0.0)]
    loft(m, rows, "carbon", closed=True, cap0=True, cap1=True)
    if q.lod == "high":
        # Printed legends and switch indices on the existing front polygon; no decal geometry.
        m.mat[-1] = "wheel_controls"
        m.uv0[-1] = [(m.v[i].y / (.24) + .5, m.v[i].z / (.156) + .5) for i in m.f[-1]]
    # screen bezel standing proud of the face, and the screen itself (UV1 0..1 across it; u runs
    # from the driver's left to right once the wheel faces the driver, v from bottom to top)
    hw, hh = DISPLAY_HALF
    nc = q.n(3, 1)
    outer0 = _rounded_rect(hw + 0.007, hh + 0.007, 0.008, 0.0, nc)
    outer1 = _rounded_rect(hw + 0.006, hh + 0.006, 0.007, 0.0045, nc)
    inner1 = _rounded_rect(hw + 0.001, hh + 0.001, 0.003, 0.0045, nc)
    inner0 = _rounded_rect(hw + 0.001, hh + 0.001, 0.003, 0.0025, nc)
    loft(m, [outer0, outer1, inner1, inner0], "dark", closed=True)
    d = Mesh()
    disp = [Vector((0.0026, y, DISPLAY_Z + z)) for (y, z) in ((-hw, -hh), (hw, -hh), (hw, hh), (-hw, hh))]
    i0 = d.add_verts(disp)
    d.add_face((i0, i0 + 1, i0 + 2, i0 + 3), "display", uv1=[(0, 0), (1, 0), (1, 1), (0, 1)])
    m.merge(d)
    # push buttons: alternate team-coloured and black caps, as real wheels colour-code them. On
    # Mobile the phone's driver cluster covers the wheel face, so its triangles go to the hands.
    nb = q.n(8, 6)
    buttons = []
    if q.lod == "high":
        buttons = [(0.078, 0.042), (0.084, 0.016), (0.080, -0.010), (0.064, -0.034), (0.030, -0.036),
                   (0.062, 0.056), (0.092, -0.032)]
    for k, (y, z) in enumerate(buttons):
        for side in (1, -1):
            mat = "paint_edge" if (k % 2 == 0) == (side > 0) else "dark"
            tube(m, (0.0, side * y, z), (0.0045, side * y, z), 0.0068, nb, mat)
    # rotary switches: knurled machined knobs on a collar
    nk = q.n(16, 8)
    for (y, z, r) in ((0.052, -0.052, 0.0115), (-0.052, -0.052, 0.0115), (0.0, -0.060, 0.0095)):
        rings = []
        for x, rr in ((0.0, 1.08), (0.003, 1.08), (0.0035, 1.0), (0.012, 1.0), (0.0135, 0.86)):
            ring = []
            for k in range(nk):
                a = 2 * math.pi * k / nk
                knurl = 1.0 if (k % 2 == 0 or rr > 1.05 or rr < 0.9) else 0.93
                ring.append(Vector((x, y + r * rr * knurl * math.cos(a), z + r * rr * knurl * math.sin(a))))
            rings.append(ring)
        loft(m, rings, "metal_dark", closed=True, cap0=True, cap1=True)
        if q.lod == "high":
            m.mat[-1] = "wheel_controls"
            m.uv0[-1] = [(m.v[i].y / .24 + .5, m.v[i].z / .156 + .5) for i in m.f[-1]]
    # grips: moulded rubber, fuller in the palm, with finger ridges on the back
    ng, nr = q.n(12, 8), q.n(10, 5)
    for side in (1, -1):
        rows = []
        for k in range(nr + 1):
            t = k / nr
            z = lerp(-0.080, 0.070, t)
            body_r = 0.024 * (0.72 + 0.28 * math.sin(math.pi * min(1.0, 0.08 + 0.92 * t)) ** 0.6)
            ridge = 0.12 * max(0.0, math.cos(2 * math.pi * 4 * t)) if 0.18 < t < 0.82 else 0.0
            ring = []
            for i in range(ng):
                a = 2 * math.pi * i / ng
                back = max(0.0, -math.cos(a))
                rr = body_r * (1 + ridge * back)
                ring.append(Vector((GRIP_X + rr * math.cos(a), side * GRIP_Y + rr * 0.85 * math.sin(a), z)))
            rows.append(ring)
        loft(m, rows, "grip", closed=True, cap0=True, cap1=True)
    _planar_metric_uv(m, {"carbon"})
    return m


def build_cockpit_padding(mesh_dark, q):
    """Padded coaming round the front of the cockpit opening, from the side pads forward round
    the dash: a soft rounded roll sitting on the rim, the edge the driver sees round the wheel."""
    from .body import spine_ring

    n_side, n_top = q.n(34, 8), q.n(8, 3)
    nx, nr = q.n(16, 7), q.n(10, 6)
    m = Mesh()
    rim = []
    for k in range(nx + 1):
        x = lerp(0.42, D.X_COCKPIT_FRONT - 0.035, (k / nx) ** 0.85)
        rim.append(spine_ring(x, n_side, n_top)[n_side - 1])
    rows = []
    for k, p in enumerate(rim):
        tang = (rim[min(k + 1, nx)] - rim[max(k - 1, 0)]).normalized()
        inward = Vector((0, 0, 1)).cross(tang).normalized()
        if inward.y > 0:
            inward = -inward
        c = p + inward * 0.010 + Vector((0, 0, 0.006))
        rows.append([c + inward * (0.020 * math.cos(2 * math.pi * i / nr)) + Vector((0, 0, 0.015 * math.sin(2 * math.pi * i / nr)))
                     for i in range(nr)])
    loft(m, rows, "headrest", closed=True, cap0=True, cap1=True)
    mesh_dark.merge(m.with_mirror())


def sleeve_path(side):
    return [Vector((.20, side * .176, .622)), Vector((.27, side * .178, .632)),
            Vector((.37, side * .166, .630)), Vector((.455, side * .151, .617))]


def sleeve_point(side, t):
    """Point and unit tangent at t (0 at the shoulder, 1 at the wrist) on a Catmull-Rom curve
    through the sleeve path: the end points are the path's own, so the wrist join is unchanged."""
    pts = sleeve_path(side)
    ext = [pts[0] * 2 - pts[1]] + pts + [pts[-1] * 2 - pts[-2]]
    f = min(t, 1.0 - 1e-9) * (len(pts) - 1)
    i = int(f)
    u = f - i
    p0, p1, p2, p3 = ext[i], ext[i + 1], ext[i + 2], ext[i + 3]
    pos = 0.5 * ((2 * p1) + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u * u
                 + (-p0 + 3 * p1 - 3 * p2 + p3) * u ** 3)
    der = 0.5 * ((-p0 + p2) + 2 * (2 * p0 - 5 * p1 + 4 * p2 - p3) * u + 3 * (-p0 + 3 * p1 - 3 * p2 + p3) * u * u)
    if t >= 1.0:
        pos = pts[-1]
    return pos, der.normalized()


def sleeve_radius(t):
    """The sleeve's radius along the arm: full at the elbow, swelling over the forearm, narrowing
    to the wrist where the gauntlet's cuff covers it, m."""
    return 0.040 + 0.004 * math.sin(math.pi * min(1.0, t / 0.6)) - 0.010 * smoothstep(0.55, 1.0, t)


def wrist_join(side):
    transform = Matrix.Rotation(math.radians(D.STEERING_COLUMN_PITCH_DEG), 3, "Y") @ Matrix.Rotation(math.pi, 3, "Z")
    sleeve = sleeve_path(-side)
    endpoint = sleeve[-1]
    inside = endpoint + (sleeve[-2] - endpoint).normalized() * .020
    origin = Vector(D.STEERING_WHEEL_CENTRE)
    local = transform.transposed()
    # Closed gauntlet cap stays buried inside the final sleeve segment, even after export.
    assert (transform @ (local @ (endpoint - origin)) + origin - endpoint).length < 1e-8
    return local @ (endpoint - origin), local @ (inside - origin)


def build_gloves(q):
    """Gloved hands round the grips, in the wheel's frame so they turn with it: a closed fist
    with knuckles over the grip, the thumb along the faceplate towards the buttons, and the
    gauntlet with its wrist strap running back towards the driver."""
    m = Mesh()
    # the hands are the nearest objects to the cockpit camera: smooth sections, many rows
    n, rows_n = {"high": (22, 14), "mobile": (14, 9)}.get(q.lod, (8, 5))
    for side in (1, -1):
        cx, cy = GRIP_X + 0.010, side * (GRIP_Y + 0.006)
        rows = []
        for k in range(rows_n + 1):
            t = k / rows_n
            z = lerp(-0.050, 0.048, t)
            end = math.sin(math.pi * min(1.0, 0.10 + 0.90 * t)) ** 0.45
            ring = []
            for i in range(n):
                a = 2 * math.pi * i / n
                # a = 0 faces the driver, a = pi/2 faces outboard
                dx, dy = math.cos(a), math.sin(a)
                # a squared-off section: a flat back of the hand, not a ball
                r = (0.034 * end + 0.004) / (abs(dx) ** 3 + abs(dy) ** 3) ** (1 / 3)
                # knuckles: four ridges where the fingers fold over the grip (driver side, outboard)
                facing = max(0.0, math.cos(a - 0.8))
                if 0.12 < t < 0.92:
                    r += 0.0075 * facing ** 3 * max(0.0, math.cos(2 * math.pi * 4 * (t - 0.12) / 0.8)) ** 2
                ring.append(Vector((cx + r * dx, cy + side * r * 0.85 * dy, z)))
            rows.append(ring if side > 0 else list(reversed(ring)))
        loft(m, rows, "glove", closed=True, cap0=True, cap1=True)
        # thumb: from the inside of the fist across the face towards the upper buttons
        path = [Vector((0.006, side * (GRIP_Y - 0.020), 0.022)),
                Vector((0.020, side * (GRIP_Y - 0.035), 0.028)),
                Vector((0.027, side * (GRIP_Y - 0.034), 0.009)),
                Vector((0.015, side * (GRIP_Y - 0.020), -0.004))]
        radii = (0.0105, 0.0092, 0.0084, 0.0055)
        nt = q.n(12, 6)
        rings = []
        for p, r, t_ in zip(path, radii, range(len(path))):
            tang = (path[min(t_ + 1, 3)] - path[max(t_ - 1, 0)]).normalized()
            u = tang.cross(Vector((0, 0, 1))).normalized()
            w = tang.cross(u)
            rings.append([p + (u * math.cos(2 * math.pi * k / nt) + w * math.sin(2 * math.pi * k / nt) * 0.8) * r
                          for k in range(nt)])
        loft(m, rings, "glove", closed=True, cap0=True, cap1=True, flip=side > 0)
        # Derive the join in wheel-local coordinates from the actual sleeve end. Local hand
        # side is reversed by the assembly's half-turn. The closed rear cap is 20 mm inside
        # the sleeve; the flared middle ring overlaps its open mouth.
        sleeve, inside = wrist_join(side)
        a = Vector((cx + 0.026, cy + side * 0.012, -0.004))
        axis = (inside - a).normalized()
        u = axis.cross(Vector((0, 0, 1))).normalized()
        w = axis.cross(u)
        ng = q.n(20, 10)
        # The gauntlet: snug at the hand, a soft fold across the middle, flaring into a cuff that
        # sits over the sleeve's mouth, then turned in under it (the closed cap stays buried).
        sections = ((a, .029, 0.0), (a.lerp(sleeve, .45), .031, .05), (a.lerp(sleeve, .82), .036, .03),
                    (sleeve, .039, 0.0), (sleeve.lerp(inside, .5), .034, 0.0), (inside, .026, 0.0))
        grid = []
        for p, r, fold in sections:
            grid.append([p + (u * math.cos(2 * math.pi * k / ng) + w * math.sin(2 * math.pi * k / ng))
                         * r * (1 + fold * math.cos(5 * 2 * math.pi * k / ng + 0.7))
                         for k in range(ng)])
        loft(m, grid, "glove", closed=True, cap0=True, cap1=True)
        tube(m, a.lerp(sleeve, .30), a.lerp(sleeve, .52), .034, ng, "dark")
    _planar_metric_uv(m, {"glove"})
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
    # housing lip and a short recess wall down to the glass
    lip = [Vector((p.x + 0.004, cy + (p.y - cy) * 0.9, cz + (p.z - cz) * 0.85)) for p in rows[-1]]
    seat = [p + Vector((0.006, 0, 0)) for p in lip]
    g = Mesh()
    loft(g, [rows[-1], lip, seat], "dark", closed=True)
    # The glass has its own vertices (no normals shared with the lip, which made the old fan read
    # as facets) and is gently convex, about 1.2 m radius, so the environment slides across it.
    rings = []
    for s_ in (1.0, 0.72, 0.42, 0.16):
        rings.append([Vector((p.x - 0.0002 - 0.0045 * (1 - s_ * s_), cy + (p.y - cy) * s_, cz + (p.z - cz) * s_))
                      for p in seat])
    gi = g.add_verts([v for ring in rings for v in ring])
    for r in range(len(rings) - 1):
        for i in range(n):
            a0, a1 = gi + r * n + i, gi + r * n + (i + 1) % n
            b0, b1 = a0 + n, a1 + n
            g.add_face((a0, a1, b1, b0), "mirror_glass")
    centre = sum(rings[-1], Vector()) / n
    centre.x -= 0.0005
    ci = g.add_verts([centre])
    last = gi + (len(rings) - 1) * n
    for i in range(n):
        g.add_face((last + i, last + (i + 1) % n, ci), "mirror_glass")
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


# ---------------------------------------------------------------------------------------------
# Driver (shoulders, arms, harness) and halo mounts
# ---------------------------------------------------------------------------------------------
def build_driver(mesh_paint, mesh_dark, q):
    """Shoulders in the race suit (primary colour, no livery patch), forearms reaching for the
    wheel, and the harness straps over the shoulders. The gloves are part of the steering wheel
    node so they turn with it."""
    m = Mesh()
    n = q.n(18, 8)
    # shoulders and upper chest: a squat rounded block under the helmet, sunk into the seat
    rows = []
    for k in range(q.n(8, 4) + 1):
        t = k / q.n(8, 4)
        x = lerp(0.235, -0.010, t)
        s = math.sin(math.pi * min(1.0, 0.06 + 0.94 * t)) ** 0.45
        hw = 0.205 * s
        z0, z1 = 0.540, 0.540 + 0.150 * s
        ring = superellipse_half(hw, z0, lerp(z0, z1, 0.45), z1, 3.0, 2.2, n)
        rows.append([Vector((x, p.y, p.z)) for p in ring])
    loft(m, rows, "paint_edge", flip=True)
    mesh_paint.merge(m.with_mirror())
    # forearms: from the shoulder line to the wrists beside the wheel grips, resampled along a
    # smooth curve through the sleeve path, swelling over the forearm and tapering to the wrist,
    # with shallow creases where the suit gathers at the elbow
    arms = Mesh()
    na = q.n(18, 9)
    nk = q.n(7, 4)
    for side in (1, -1):
        rings = []
        for k in range(nk + 1):
            t = k / nk
            p, tang = sleeve_point(side, t)
            r = sleeve_radius(t)
            u = tang.cross(Vector((0, 0, 1))).normalized()
            w = tang.cross(u)
            crease = 0.035 * (1 - smoothstep(0.0, 0.45, t)) * math.sin(3 * math.pi * t)
            ring = []
            for i in range(na):
                a = 2 * math.pi * i / na
                ri = r * (1 + crease * math.cos(3 * a + 1.3 * k))
                ring.append(p + (u * math.cos(a) * 1.07 + w * math.sin(a) * 0.93) * ri)
            rings.append(ring)
        loft(arms, rings, "paint_edge", closed=True, cap0=True, cap1=False)
    mesh_paint.merge(arms)
    # harness: two straps over the shoulders, converging at the chest
    hn = Mesh()
    for side in (1, -1):
        path = [Vector((0.02, side * 0.085, 0.700)), Vector((0.10, side * 0.080, 0.662)),
                Vector((0.18, side * 0.060, 0.630)), Vector((0.235, side * 0.035, 0.590))]
        grid = []
        for p in path:
            grid.append([p + Vector((0, dy, dz)) for (dy, dz) in ((0.024, 0.004), (-0.024, 0.004), (-0.024, -0.002),
                                                                  (0.024, -0.002))])
        loft(hn, grid, "dark", closed=True, cap0=True, cap1=True)
    mesh_dark.merge(hn)


def build_halo_mounts(mesh_paint, q):
    """Fairings over the halo's three mounting points."""
    m = Mesh()
    n = q.n(12, 6)
    for (x, y, z, rx, ry, rz) in ((D.X_HALO_REAR + 0.01, D.HALO_HALF_WIDTH_REAR + 0.01, D.Z_HALO_REAR_MOUNT - 0.006, 0.055, 0.034, 0.026),):
        rows = []
        for k in range(7):
            t = k / 6
            s = math.sin(math.pi * t) ** 0.6
            rows.append([Vector((x + rx * (1 - 2 * t), y + ry * s * math.cos(2 * math.pi * i / n), z + rz * s * max(-0.2, math.sin(2 * math.pi * i / n))))
                         for i in range(n)])
        loft(m, rows, "paint_edge", closed=True)
    mesh_paint.merge(m.with_mirror())
    fr = Mesh()
    rows = []
    for k in range(7):
        t = k / 6
        s = math.sin(math.pi * t) ** 0.6
        rows.append([Vector((D.X_HALO_PYLON_BASE + 0.05 - 0.14 * t, 0.040 * s * math.cos(2 * math.pi * i / n),
                             D.Z_HALO_PYLON_BASE - 0.01 + 0.022 * s * max(-0.2, math.sin(2 * math.pi * i / n)))) for i in range(n)])
    loft(fr, rows, "paint_edge", closed=True)
    mesh_paint.merge(fr)
