"""Geometry kernel for the car: a small mesh builder, lofts, lathes, sweeps and shape laws.

Everything is plain Python plus mathutils so the build is deterministic. A Mesh collects vertices,
faces, per-face material names and per-corner UVs; to_object() turns it into a Blender object.

UV0 is the livery atlas (painted parts only; filled in after the atlas is packed). UV1 is metric
(metres along the surface) for the tiling carbon weave and other detail textures.
"""

import math

import bmesh
import bpy
from mathutils import Matrix, Vector


# ---------------------------------------------------------------------------------------------
# Scalar laws
# ---------------------------------------------------------------------------------------------
def clamp(x, a=0.0, b=1.0):
    return a if x < a else b if x > b else x


def lerp(a, b, t):
    return a + (b - a) * t


def smoothstep(a, b, x):
    t = clamp((x - a) / (b - a))
    return t * t * (3 - 2 * t)


class Pchip:
    """Monotone piecewise cubic through (x, y) keys (Fritsch-Carlson). No overshoot between keys,
    so a profile drawn through hard points never bulges past them."""

    def __init__(self, keys):
        keys = sorted(keys)
        self.x = [k[0] for k in keys]
        self.y = [k[1] for k in keys]
        n = len(self.x)
        h = [self.x[i + 1] - self.x[i] for i in range(n - 1)]
        d = [(self.y[i + 1] - self.y[i]) / h[i] for i in range(n - 1)]
        m = [0.0] * n
        if n == 2:
            m = [d[0], d[0]]
        else:
            m[0], m[-1] = d[0], d[-1]
            for i in range(1, n - 1):
                if d[i - 1] * d[i] <= 0:
                    m[i] = 0.0
                else:
                    w1, w2 = 2 * h[i] + h[i - 1], h[i] + 2 * h[i - 1]
                    m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i])
        self.h, self.m = h, m

    def __call__(self, x):
        xs, ys = self.x, self.y
        if x <= xs[0]:
            return ys[0] + self.m[0] * (x - xs[0]) * 0.0
        if x >= xs[-1]:
            return ys[-1]
        lo, hi = 0, len(xs) - 1
        while hi - lo > 1:
            mid = (lo + hi) // 2
            if xs[mid] <= x:
                lo = mid
            else:
                hi = mid
        h = self.h[lo]
        t = (x - xs[lo]) / h
        t2, t3 = t * t, t * t * t
        return ((2 * t3 - 3 * t2 + 1) * ys[lo] + (t3 - 2 * t2 + t) * h * self.m[lo]
                + (-2 * t3 + 3 * t2) * ys[hi] + (t3 - t2) * h * self.m[hi])


def resample(points, n, closed=False):
    """Resample a polyline (list of Vector) to n points evenly spaced by arc length."""
    pts = list(points) + ([points[0]] if closed else [])
    d = [0.0]
    for i in range(1, len(pts)):
        d.append(d[-1] + (pts[i] - pts[i - 1]).length)
    total = d[-1]
    out = []
    count = n if closed else n - 1
    j = 0
    for k in range(n):
        s = total * k / count
        while j < len(d) - 2 and d[j + 1] < s:
            j += 1
        seg = d[j + 1] - d[j]
        t = 0.0 if seg <= 1e-12 else (s - d[j]) / seg
        out.append(pts[j].lerp(pts[j + 1], clamp(t)))
    return out


def superellipse_half(w, z_bot, z_mid, z_top, e_bot, e_top, n, w_top=None, w_bot=None, dense=160):
    """Left half (y >= 0) of a section, from bottom centre round the side to top centre.

    The lower quarter is a superellipse from (0, z_bot) to (w, z_mid); the upper quarter from
    (w, z_mid) to (0, z_top). Larger exponents give flatter faces and tighter corners. w_top and
    w_bot pull the quarter's flat face in (tumblehome) without moving the widest point.
    Returns n points (Vector(0, y, z)) evenly spaced by arc length."""
    w_top = w if w_top is None else w_top
    w_bot = w if w_bot is None else w_bot
    pts = []
    for i in range(dense + 1):
        th = -math.pi / 2 + math.pi * i / dense
        c, s = math.cos(th), math.sin(th)
        if s < 0:
            e, hz, ww = e_bot, z_mid - z_bot, w_bot
        else:
            e, hz, ww = e_top, z_top - z_mid, w_top
        cy = abs(c) ** (2 / e)
        cz = math.copysign(abs(s) ** (2 / e), s)
        # blend from the widest point's width to the face width as we go towards the centre
        width = w + (ww - w) * (abs(s) ** 1.5)
        pts.append(Vector((0.0, width * cy, z_mid + hz * cz)))
    return resample(pts, n)


def naca4(m, p, t, n, te=0.004, invert=False):
    """Closed NACA 4-digit loop, chord 0..1 along +u, thickness along +w, cosine spaced.
    Starts at the trailing edge, runs over the upper surface to the leading edge and back along
    the lower surface; the last point is next to the first (no duplicate). invert flips camber
    (a downforce section: suction side below)."""
    half = n // 2
    xs = [0.5 * (1 - math.cos(math.pi * i / half)) for i in range(half + 1)]
    up, lo = [], []
    for x in xs:
        yt = 5 * t * (0.2969 * math.sqrt(x) - 0.1260 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1015 * x ** 4)
        yt += te * 0.5 * x
        if m == 0:
            yc, dy = 0.0, 0.0
        elif x < p:
            yc = m / (p * p) * (2 * p * x - x * x)
            dy = 2 * m / (p * p) * (p - x)
        else:
            yc = m / ((1 - p) ** 2) * ((1 - 2 * p) + 2 * p * x - x * x)
            dy = 2 * m / ((1 - p) ** 2) * (p - x)
        th = math.atan(dy)
        up.append((x - yt * math.sin(th), yc + yt * math.cos(th)))
        lo.append((x + yt * math.sin(th), yc - yt * math.cos(th)))
    loop = list(reversed(up)) + lo[1:-1]
    if invert:
        loop = [(u, -w) for (u, w) in reversed(loop)]
        # keep the start at the trailing edge
        loop = loop[-1:] + loop[:-1]
    return loop


def ellipse_ring(a, b, n, e=2.0, start=0.0):
    """Superellipse ring in the local (u, w) plane, n points, counter-clockwise."""
    out = []
    for i in range(n):
        th = start + 2 * math.pi * i / n
        c, s = math.cos(th), math.sin(th)
        out.append((math.copysign(abs(c) ** (2 / e), c) * a, math.copysign(abs(s) ** (2 / e), s) * b))
    return out


def frames_along(path, up_hint=Vector((0, 0, 1))):
    """Tangent, normal, binormal at each path point (rotation-minimising, seeded by up_hint)."""
    n = len(path)
    tans = []
    for i in range(n):
        a = path[max(0, i - 1)]
        b = path[min(n - 1, i + 1)]
        tans.append((b - a).normalized())
    frames = []
    t0 = tans[0]
    nrm = (up_hint - t0 * up_hint.dot(t0))
    if nrm.length < 1e-6:
        nrm = Vector((1, 0, 0)) - t0 * t0.x
    nrm.normalize()
    for i in range(n):
        t = tans[i]
        nrm = (nrm - t * nrm.dot(t))
        if nrm.length < 1e-9:
            nrm = Vector((0, 0, 1))
        nrm.normalize()
        frames.append((t, nrm, t.cross(nrm)))
    return frames


# ---------------------------------------------------------------------------------------------
# Mesh builder
# ---------------------------------------------------------------------------------------------
class AtlasPatch:
    """A painted surface patch: a grid of points with a rectangle in the livery atlas.
    grid[j][i] is section j, ring point i; the patch maps u = i / (cols - 1), v = j / (rows - 1)
    inside its atlas rectangle. mirrored patches are drawn once and used by both sides."""

    def __init__(self, key, grid, size_u, size_v, closed=False, normal_hint=None):
        self.key = key
        self.grid = grid
        self.closed = closed
        self.normal_hint = normal_hint
        self.vrows = None  # v of each row (arc length along the loft, normalised)
        self.size_u = size_u  # metres, for texel density
        self.size_v = size_v
        self.rect = None  # (u0, v0, u1, v1) after packing


class Mesh:
    def __init__(self):
        self.v = []
        self.f = []
        self.mat = []
        self.uv0 = []  # per face: list of (u, v) or None, local to an atlas patch
        self.patch = []  # per face: AtlasPatch or None
        self.uv1 = []  # per face: list of (u, v) metric
        self.smooth = []
        self.sharp = set()  # (a, b) vertex pairs, a < b

    def add_verts(self, pts):
        base = len(self.v)
        self.v.extend(Vector(p) for p in pts)
        return base

    def add_face(self, idx, mat, uv1=None, uv0=None, patch=None, smooth=True):
        self.f.append(tuple(idx))
        self.mat.append(mat)
        self.uv1.append(uv1 or [(0.0, 0.0)] * len(idx))
        self.uv0.append(uv0)
        self.patch.append(patch)
        self.smooth.append(smooth)

    def mark_sharp(self, a, b):
        self.sharp.add((a, b) if a < b else (b, a))

    def merge(self, other):
        base = len(self.v)
        self.v.extend(v.copy() for v in other.v)
        for k in range(len(other.f)):
            self.f.append(tuple(i + base for i in other.f[k]))
        self.mat.extend(other.mat)
        self.uv0.extend(other.uv0)
        self.patch.extend(other.patch)
        self.uv1.extend(other.uv1)
        self.smooth.extend(other.smooth)
        self.sharp.update((a + base, b + base) for a, b in other.sharp)
        return self

    def transformed(self, m):
        out = Mesh().merge(self)
        out.v = [m @ v for v in out.v]
        if m.to_3x3().determinant() < 0:
            out._flip()
        return out

    def _flip(self):
        self.f = [tuple(reversed(f)) for f in self.f]
        self.uv0 = [None if u is None else list(reversed(u)) for u in self.uv0]
        self.uv1 = [list(reversed(u)) for u in self.uv1]

    def mirrored_y(self):
        return self.transformed(Matrix.Scale(-1, 4, Vector((0, 1, 0))))

    def with_mirror(self):
        return Mesh().merge(self).merge(self.mirrored_y())

    def translate(self, d):
        d = Vector(d)
        self.v = [v + d for v in self.v]
        return self

    def tri_count(self):
        return sum(len(f) - 2 for f in self.f)

    def to_object(self, name, materials, collection, sharp_angle_deg=40.0, merge_dist=0.0, recalc=True):
        """materials: dict name -> bpy material. Faces keep their material by name."""
        names = []
        for m in self.mat:
            if m not in names:
                names.append(m)
        me = bpy.data.meshes.new(name)
        me.from_pydata([tuple(v) for v in self.v], [], [list(f) for f in self.f])
        for nm in names:
            me.materials.append(materials[nm])
        slot = {nm: i for i, nm in enumerate(names)}
        me.polygons.foreach_set("material_index", [slot[m] for m in self.mat])
        me.polygons.foreach_set("use_smooth", [bool(s) for s in self.smooth])
        uv1 = me.uv_layers.new(name="UVMap")
        uvm = me.uv_layers.new(name="UVMetric")
        flat0, flat1 = [], []
        for k, f in enumerate(self.f):
            u0 = self.uv0[k]
            p = self.patch[k]
            for c in range(len(f)):
                if u0 is not None and p is not None and p.rect is not None:
                    a, b, c2, d, rot = p.rect
                    lu, lv = (u0[c][1], u0[c][0]) if rot else u0[c]
                    flat0.extend((a + (c2 - a) * lu, b + (d - b) * lv))
                else:
                    flat0.extend((0.002, 0.002))  # a corner texel kept blank in every mask
                flat1.extend(self.uv1[k][c])
        uv1.data.foreach_set("uv", flat0)
        uvm.data.foreach_set("uv", flat1)
        me.validate(clean_customdata=False)
        me.update()
        ob = bpy.data.objects.new(name, me)
        collection.objects.link(ob)
        # sharp edges: explicit marks plus a dihedral threshold
        bm = bmesh.new()
        bm.from_mesh(me)
        if merge_dist > 0:
            bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=merge_dist)
        if recalc:
            bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        bm.verts.ensure_lookup_table()
        lim = math.radians(sharp_angle_deg)
        for e in bm.edges:
            a, b = e.verts[0].index, e.verts[1].index
            key = (a, b) if a < b else (b, a)
            if key in self.sharp:
                e.smooth = False
            elif len(e.link_faces) == 2:
                e.smooth = e.calc_face_angle(0.0) < lim
            else:
                e.smooth = False
        bm.to_mesh(me)
        bm.free()
        return ob


def _metric_uv(grid, closed):
    """Per-vertex metric UVs for a grid: u = arc length along the ring, v = distance along the
    loft, both in metres (measured on the middle ring / middle column for stability)."""
    rows, cols = len(grid), len(grid[0])
    mid_j = rows // 2
    us = [0.0]
    for i in range(1, cols + (1 if closed else 0)):
        us.append(us[-1] + (grid[mid_j][i % cols] - grid[mid_j][i - 1]).length)
    mid_i = cols // 2
    vs = [0.0]
    for j in range(1, rows):
        vs.append(vs[-1] + (grid[j][mid_i] - grid[j - 1][mid_i]).length)
    return us, vs


def loft(mesh, grid, mat, closed=False, cap0=False, cap1=False, patch_key=None, patches=None,
         smooth=True, sharp_cols=(), sharp_rows=(), cap_mat=None, flip=False):
    """Quads between consecutive rings. grid[j][i]: ring j, point i. closed wraps the ring.
    Returns the vertex index base. Faces face outwards if rings run counter-clockwise when looking
    down the loft direction; pass flip=True otherwise."""
    rows, cols = len(grid), len(grid[0])
    base = mesh.add_verts([p for ring in grid for p in ring])
    us, vs = _metric_uv(grid, closed)
    patch = None
    vrow = [j / (rows - 1) for j in range(rows)]
    if patch_key is not None:
        # v follows the arc length down the middle column so every LOD maps the atlas alike
        if vs[-1] > 1e-5:
            vrow = [v / vs[-1] for v in vs]
        shared = next((p for p in patches if p.key == patch_key), None)
        if shared is not None:
            patch = shared  # another copy of the same part (the four wheels share one patch)
        else:
            patch = AtlasPatch(patch_key, grid, us[-1], vs[-1], closed=closed)
            patch.vrows = vrow
            patches.append(patch)
    ncol = cols if closed else cols - 1
    for j in range(rows - 1):
        for i in range(ncol):
            i2 = (i + 1) % cols
            a, b = base + j * cols + i, base + j * cols + i2
            c, d = base + (j + 1) * cols + i2, base + (j + 1) * cols + i
            ia = i + 1  # metric/atlas column of the second corner (no wrap)
            uvm = [(us[i], vs[j]), (us[ia], vs[j]), (us[ia], vs[j + 1]), (us[i], vs[j + 1])]
            uv0 = None
            if patch is not None:
                den = float(ncol)
                uv0 = [(i / den, vrow[j]), (ia / den, vrow[j]), (ia / den, vrow[j + 1]), (i / den, vrow[j + 1])]
            idx = (a, b, c, d)
            if flip:
                idx, uvm = tuple(reversed(idx)), list(reversed(uvm))
                uv0 = None if uv0 is None else list(reversed(uv0))
            mesh.add_face(idx, mat, uvm, uv0, patch, smooth)
    for i in sharp_cols:
        for j in range(rows - 1):
            mesh.mark_sharp(base + j * cols + i, base + (j + 1) * cols + i)
    for j in sharp_rows:
        for i in range(ncol):
            mesh.mark_sharp(base + j * cols + i, base + j * cols + (i + 1) % cols)
    cm = cap_mat or mat
    for which, do in ((0, cap0), (rows - 1, cap1)):
        if not do:
            continue
        ring = [base + which * cols + i for i in range(cols)]
        ctr = sum((grid[which][i] for i in range(cols)), Vector()) / cols
        ci = mesh.add_verts([ctr])
        reverse = (which == 0) != flip
        den = float(cols if closed else cols - 1)
        for i in range(cols if closed else cols - 1):
            i2 = (i + 1) % cols
            tri = (ring[i], ring[i2], ci) if not reverse else (ring[i2], ring[i], ci)
            pts = [mesh.v[k] for k in tri]
            uv0 = None
            if patch is not None:
                # caps sample the patch along their rim ring
                ua, ub = i / den, (i + 1) / den
                uv0 = [(ua, vrow[which]), (ub, vrow[which]), (0.5 * (ua + ub), vrow[which])]
                if reverse:
                    uv0 = [uv0[1], uv0[0], uv0[2]]
            mesh.add_face(tri, cm, [(p.x, p.z) for p in pts], uv0, patch, True)
        for i in range(cols if closed else cols - 1):
            mesh.mark_sharp(ring[i], ring[(i + 1) % cols])
    return base


def sweep(mesh, path, section, mat, up=Vector((0, 0, 1)), scale=None, cap0=True, cap1=True,
          twist=None, patch_key=None, patches=None, sharp_cols=()):
    """Sweep a 2D section [(u, w)] along a 3D path. u runs along the frame normal, w along the
    binormal. scale(t) -> (su, sw) tapers the section; twist(t) rotates it (radians)."""
    frames = frames_along(path, up)
    grid = []
    n = len(path)
    for k, (p, (t, nrm, bn)) in enumerate(zip(path, frames)):
        s = k / (n - 1)
        su, sw = scale(s) if scale else (1.0, 1.0)
        tw = twist(s) if twist else 0.0
        c, si = math.cos(tw), math.sin(tw)
        ring = []
        for (u, w) in section:
            uu, ww = u * su, w * sw
            ru, rw = uu * c - ww * si, uu * si + ww * c
            ring.append(p + nrm * ru + bn * rw)
        grid.append(ring)
    return loft(mesh, grid, mat, closed=True, cap0=cap0, cap1=cap1, patch_key=patch_key,
                patches=patches, sharp_cols=sharp_cols)


def lathe(mesh, profile, segments, mat, axis_origin=Vector((0, 0, 0)), sharp_rows=(), flip=False,
          patch_key=None, patches=None):
    """Revolve a profile [(r, w)] about the +Y axis through axis_origin (r radial, w along Y).
    Rings run round the axle; the grid is profile-major so UV1 u = angle, v = profile length."""
    grid = []
    for (r, w) in profile:
        ring = []
        for k in range(segments):
            a = 2 * math.pi * k / segments
            ring.append(axis_origin + Vector((r * math.cos(a), w, r * math.sin(a))))
        grid.append(ring)
    # a profile running towards +w with growing radius faces inwards: callers pass flip for it
    return loft(mesh, grid, mat, closed=True, sharp_rows=sharp_rows, flip=flip, patch_key=patch_key,
                patches=patches)


def arm_section(chord, thick, n):
    """Symmetric aerofoil section for a suspension leg, centred on the quarter chord."""
    loop = naca4(0.0, 0.4, thick / chord, n, te=0.02)
    return [((u - 0.35) * chord, w * chord) for (u, w) in loop]


def arm(mesh, a, b, chord, thick, n, mat, flow=Vector((-1, 0, 0)), taper=0.85, pad=0.0):
    """A streamlined leg from a to b with its chord aligned to the airflow (-X by default)."""
    a, b = Vector(a), Vector(b)
    d = (b - a)
    if pad:
        a = a - d.normalized() * pad
        b = b + d.normalized() * pad
    path = [a.lerp(b, k / 4) for k in range(5)]
    axis = (b - a).normalized()
    # frame normal along the flow projected off the leg axis, so the chord lies in the flow
    fl = flow - axis * flow.dot(axis)
    if fl.length < 1e-6:
        fl = Vector((0, 0, 1))
    fl.normalize()
    sec = [(u * 1.0, w) for (u, w) in arm_section(chord, thick, n)]
    grid = []
    for k, p in enumerate(path):
        s = k / 4
        sc = 1.0 - (1.0 - taper) * abs(2 * s - 1)
        bn = axis.cross(fl)
        grid.append([p + fl * (-u * sc) + bn * (w * sc) for (u, w) in sec])
    return loft(mesh, grid, mat, closed=True, cap0=True, cap1=True)


def tube(mesh, a, b, radius, n, mat, cap=True, radius_b=None):
    a, b = Vector(a), Vector(b)
    axis = (b - a).normalized()
    ref = Vector((0, 0, 1)) if abs(axis.z) < 0.9 else Vector((1, 0, 0))
    u = axis.cross(ref).normalized()
    w = axis.cross(u)
    rb = radius if radius_b is None else radius_b
    grid = []
    for p, r in ((a, radius), (b, rb)):
        grid.append([p + (u * math.cos(2 * math.pi * k / n) + w * math.sin(2 * math.pi * k / n)) * r
                     for k in range(n)])
    return loft(mesh, grid, mat, closed=True, cap0=cap, cap1=cap)
