"""Livery atlas, masks and the bodywork detail normal map.

Every painted surface belongs to a patch (see geom.AtlasPatch). The patches are packed into one
UV atlas (UV0). The patches' own triangles are rasterised once into a buffer holding the 3D
position, normal and part of every texel; each team's livery is then drawn by evaluating its
design on that buffer, so graphics run continuously across parts and match the triangulation the
GPU interpolates.

Mask channels: R = secondary colour weight, G = accent colour weight, B = bare carbon (the paint
is left off). Primary = 1 - R - G where B = 0. The renderer mixes the team's three colours with
these weights; nothing about a team is baked into the mesh.
"""

import math

import numpy as np

from . import dims as D

TEAMS = ["aldermoor", "kestrel", "norrland", "sable", "orrin", "terraluce", "meridian", "brevik",
         "calder", "quillon"]


# ---------------------------------------------------------------------------------------------
# Packing
# ---------------------------------------------------------------------------------------------
def pack(patches, size=1024, pad_px=6):
    """Shelf-pack patches (long side horizontal) into the unit square, as large as they fit.
    Mirrored halves share one patch. Sets patch.rect = (u0, v0, u1, v1, rotated)."""
    pad = pad_px / size
    items = []
    for p in patches:
        w, h = max(p.size_u, 1e-3), max(p.size_v, 1e-3)
        # long thin patches get fewer texels along their length (patterns run along it)
        if w > 2.5 * h:
            w = w * 0.5
        elif h > 2.5 * w:
            h = h * 0.5
        rot = h > w
        items.append((p, (h, w) if rot else (w, h), rot))
    items.sort(key=lambda it: (-it[1][1], -it[1][0], it[0].key))

    def try_scale(s):
        x = y = 0.0
        shelf = 0.0
        out = []
        for p, (w, h), rot in items:
            pw, ph = w * s + 2 * pad, h * s + 2 * pad
            if pw > 1.0:
                return None
            if x + pw > 1.0:
                x, y = 0.0, y + shelf
                shelf = 0.0
            if y + ph > 1.0:
                return None
            out.append((p, (x + pad, y + pad, x + pw - pad, y + ph - pad, rot)))
            x += pw
            shelf = max(shelf, ph)
        return out

    lo, hi = 0.01, 2.0
    best = None
    for _ in range(40):
        mid = 0.5 * (lo + hi)
        r = try_scale(mid)
        if r is None:
            hi = mid
        else:
            lo, best = mid, r
    for p, rect in best:
        # snap to texel centres so masks are deterministic and seams land on texel edges
        u0, v0, u1, v1, rot = rect
        p.rect = (round(u0 * size) / size, round(v0 * size) / size, round(u1 * size) / size,
                  round(v1 * size) / size, rot)
    return lo


# ---------------------------------------------------------------------------------------------
# Rasterising the painted triangles: one buffer of position, normal and part per texel
# ---------------------------------------------------------------------------------------------
class GBuffer:
    def __init__(self, size):
        self.size = size
        self.pos = np.zeros((size, size, 3))
        self.nrm = np.zeros((size, size, 3))
        self.nrm[..., 2] = 1.0
        self.key = np.full((size, size), -1, dtype=np.int32)
        self.keys = []

    def keyed(self, name):
        """Boolean texel mask for a part key; cap patches count as their part."""
        ids = [i for i, k in enumerate(self.keys) if k.split("~")[0] == name]
        return np.isin(self.key, ids)


def _patch_normals(p, P):
    fn = np.cross(P[:, 1] - P[:, 0], P[:, 2] - P[:, 0])
    if p.normal_hint is not None:
        s = np.sign(fn @ np.array(p.normal_hint, dtype=np.float64))
        s[s == 0] = 1
        fn = fn * s[:, None]
    else:
        cen = P.reshape(-1, 3).mean(axis=0)
        if np.sum(np.einsum("ij,ij->i", fn, P.mean(axis=1) - cen)) < 0:
            fn = -fn
    # smooth vertex normals: accumulate face normals at shared positions
    keys = np.round(P.reshape(-1, 3) / 1e-5).astype(np.int64)
    _, inv = np.unique(keys, axis=0, return_inverse=True)
    inv = inv.reshape(-1)
    acc = np.zeros((inv.max() + 1, 3))
    np.add.at(acc, inv, np.repeat(fn, 3, axis=0))
    acc /= np.maximum(np.linalg.norm(acc, axis=1, keepdims=True), 1e-12)
    return acc[inv].reshape(-1, 3, 3)


def rasterise(patches, size=1024):
    gb = GBuffer(size)
    for pi, p in enumerate(patches):
        gb.keys.append(p.key)
        if not p.tris or p.rect is None:
            continue
        P = np.array([[tuple(v) for v in t[0]] for t in p.tris], dtype=np.float64)
        UV = np.array([t[1] for t in p.tris], dtype=np.float64)
        N = _patch_normals(p, P)
        u0, v0, u1, v1, rot = p.rect
        lu, lv = (UV[..., 1], UV[..., 0]) if rot else (UV[..., 0], UV[..., 1])
        X = (u0 + (u1 - u0) * lu) * size
        Y = (v0 + (v1 - v0) * lv) * size
        for t in range(len(P)):
            x, y = X[t], Y[t]
            x0, x1 = int(max(0, np.floor(x.min() - 0.5))), int(min(size - 1, np.ceil(x.max() + 0.5)))
            y0, y1 = int(max(0, np.floor(y.min() - 0.5))), int(min(size - 1, np.ceil(y.max() + 0.5)))
            if x1 < x0 or y1 < y0:
                continue
            gx, gy = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
            d = (y[1] - y[2]) * (x[0] - x[2]) + (x[2] - x[1]) * (y[0] - y[2])
            if abs(d) < 1e-12:
                continue
            w0 = ((y[1] - y[2]) * (gx - x[2]) + (x[2] - x[1]) * (gy - y[2])) / d
            w1 = ((y[2] - y[0]) * (gx - x[2]) + (x[0] - x[2]) * (gy - y[2])) / d
            w2 = 1 - w0 - w1
            inside = (w0 >= -1e-6) & (w1 >= -1e-6) & (w2 >= -1e-6)
            if not inside.any():
                continue
            iy, ix = np.nonzero(inside)
            ww = np.stack([w0[inside], w1[inside], w2[inside]], axis=1)
            gb.pos[iy + y0, ix + x0] = ww @ P[t]
            nn = ww @ N[t]
            gb.nrm[iy + y0, ix + x0] = nn / np.maximum(np.linalg.norm(nn, axis=1, keepdims=True), 1e-12)
            gb.key[iy + y0, ix + x0] = pi
    _dilate(gb, 6)
    return gb


def _dilate(gb, steps):
    """Spread covered texels into the gutters so bilinear filtering and mips never pick up the
    empty background at patch edges."""
    for _ in range(steps):
        empty = gb.key < 0
        if not empty.any():
            break
        for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0)):
            src_key = np.roll(gb.key, (dy, dx), axis=(0, 1))
            take = empty & (src_key >= 0)
            if take.any():
                gb.key[take] = src_key[take]
                gb.pos[take] = np.roll(gb.pos, (dy, dx), axis=(0, 1))[take]
                gb.nrm[take] = np.roll(gb.nrm, (dy, dx), axis=(0, 1))[take]
                empty = gb.key < 0


# ---------------------------------------------------------------------------------------------
# Designs: one per team, built from a shared vocabulary of graphics
# ---------------------------------------------------------------------------------------------
def _band(x, lo, hi, w=0.003):
    return np.clip((x - lo) / w + 0.5, 0, 1) * np.clip((hi - x) / w + 0.5, 0, 1)


def _above(x, e, w=0.003):
    return np.clip((x - e) / w + 0.5, 0, 1)


BODY = ("spine", "sidepod")
WINGS = ("fw_flap2", "fw_flap3", "rw_main", "rw_flap", "rw_tip")
ENDPLATES = ("fw_endplate", "rw_endplate")


class Paint:
    """Accumulates the three mask channels; later layers win."""

    def __init__(self, gb):
        self.gb = gb
        shp = gb.key.shape
        self.sec = np.zeros(shp)
        self.acc = np.zeros(shp)
        self.carb = np.zeros(shp)
        p, n = gb.pos, gb.nrm
        self.x, self.y, self.z = p[..., 0], np.abs(p[..., 1]), p[..., 2]
        self.ny, self.nz = np.abs(n[..., 1]), n[..., 2]
        self.side = _above(self.ny, 0.30, 0.08)
        self.top = _above(self.nz, 0.25, 0.08)
        self._parts = {}

    def on(self, *names):
        m = np.zeros(self.x.shape, dtype=bool)
        for nm in names:
            if nm not in self._parts:
                self._parts[nm] = self.gb.keyed(nm)
            m |= self._parts[nm]
        return m.astype(np.float64)

    def secondary(self, w):
        w = np.clip(w, 0, 1)
        self.sec = np.maximum(self.sec * (1 - w), w)
        self.acc *= 1 - w

    def primary(self, w):
        w = np.clip(w, 0, 1)
        self.sec *= 1 - w
        self.acc *= 1 - w

    def accent(self, w):
        w = np.clip(w, 0, 1)
        self.acc = np.maximum(self.acc, w)
        self.sec *= 1 - w

    def carbon(self, w):
        self.carb = np.maximum(self.carb, np.clip(w, 0, 1))

    def image(self):
        acc = np.clip(self.acc, 0, 1)
        sec = np.clip(self.sec, 0, 1) * (1 - acc)
        return np.stack([sec, acc, np.clip(self.carb, 0, 1)], axis=2)


def _common(L):
    """Shared by every livery: bare carbon low on the bodywork, under the sidepod undercut and
    the wings; helmet crown; wheel-cover ring."""
    x, z, nz = L.x, L.z, L.nz
    body = L.on(*BODY)
    L.carbon(body * (1 - _above(z, D.Z_FLOOR_TOP + 0.050, 0.004)))
    L.carbon(L.on("sidepod") * _above(-nz, 0.35, 0.05) * (1 - _above(z, 0.45, 0.01)))
    L.carbon(L.on("spine") * _above(-nz, 0.55, 0.05))
    L.carbon(L.on(*WINGS) * _above(-nz, 0.45, 0.08))
    L.carbon(L.on("halo") * _above(-nz, 0.6, 0.1))
    # helmet: local frame (centre at the origin)
    h = L.on("helmet")
    L.secondary(h * _above(z, 0.060, 0.004))
    L.accent(h * _band(z, 0.048, 0.056, 0.002))
    # wheel cover: local frame (axle along y)
    wc = L.on("wheel_cover")
    r = np.sqrt(L.gb.pos[..., 0] ** 2 + L.gb.pos[..., 2] ** 2)
    L.carbon(wc * (1 - _band(r, 0.186, 0.240, 0.0015)))
    L.accent(wc * _band(r, 0.188, 0.195, 0.0015))


def _diag(L, z0, slope, pin):
    """Diagonal split: secondary below a line rising towards the tail, accent pin line on it."""
    d = (L.z - z0) + slope * (L.x - 0.20)
    b = L.on(*BODY)
    L.secondary(b * (1 - _above(d, 0.0)))
    if pin:
        L.accent(b * _band(d, 0.0, 0.014))


def _chevron(L, x0, k, width):
    f = (L.x - x0) + k * L.y
    b = L.on("spine")
    L.secondary(b * _band(f, 0.0, width) * L.top)
    L.accent(b * _band(f, width + 0.035, width + 0.06) * L.top)


def _side_band(L, z0, slope, half, pin):
    zc = z0 + slope * (L.x - 0.3)
    b = L.on(*BODY)
    L.secondary(b * _band(L.z, zc - half, zc + half) * L.side)
    if pin:
        L.accent(b * _band(L.z, zc - half - 0.018, zc - half - 0.006) * L.side)


def _nose_tip(L, x0, channel):
    w = L.on("spine") * _above(L.x, x0, 0.004)
    getattr(L, channel)(w)


def _spine_stripe(L, half, x0, x1, channel):
    w = L.on("spine") * _band(L.y, -1, half, 0.002) * L.top * _band(L.x, x1, x0, 0.01)
    getattr(L, channel)(w)


def _parts(L, names, channel):
    getattr(L, channel)(L.on(*names))


def design(team, gb):
    L = Paint(gb)
    x, y, z = L.x, L.y, L.z
    if team == "aldermoor":
        _diag(L, 0.34, 0.22, True)
        _nose_tip(L, 2.86, "secondary")
        _spine_stripe(L, 0.016, -0.05, -2.2, "secondary")
        _parts(L, ("fw_flap3",), "secondary")
        _parts(L, ("halo", "halo_pylon"), "secondary")
        L.secondary(L.on("rw_endplate") * (1 - _above(z, 0.70)))
        L.accent(L.on("rw_endplate") * _band(z, 0.70, 0.715))
    elif team == "brevik":
        _diag(L, 0.30, 0.30, False)
        for off in (-0.022, 0.022):
            L.accent(L.on("spine") * _band(y, abs(off) - 0.004, abs(off) + 0.004, 0.002) * L.top * _band(x, 1.2, 2.75, 0.01))
        _parts(L, ("rw_main",), "secondary")
        _parts(L, ("fw_endplate", "rw_endplate"), "secondary")
        L.accent(L.on("rw_endplate") * _band(z, 0.88, 0.90))
        L.accent(L.on("fw_endplate") * _band(z, 0.20, 0.215))
    elif team == "kestrel":
        _chevron(L, 2.20, 1.45, 0.20)
        # a secondary slash across the sidepod, from the inlet top falling to the rear
        d = (z - 0.62) + 0.30 * (0.70 - x)
        L.secondary(L.on("sidepod") * _band(d, -0.03, 0.03) * L.side)
        # dark engine-cover panel behind the airbox: the number sits on it
        L.accent(L.on("spine") * _band(x, -0.75, -0.18, 0.004) * _above(z, 0.66, 0.004))
        _parts(L, ("fw_endplate", "rw_endplate"), "secondary")
    elif team == "quillon":
        _nose_tip(L, 2.58, "secondary")
        L.accent(L.on("spine") * _band(x, 2.52, 2.56, 0.003))
        # navy lower body from behind the nose (the code on the nose flank stays on lime)
        low = L.on(*BODY) * (1 - _above(z, 0.36, 0.004)) * _band(L.x, -1.6, 1.25, 0.01)
        L.secondary(low)
        L.accent(L.on(*BODY) * _band(z, 0.36, 0.372, 0.002) * L.side * _band(L.x, -1.6, 1.25, 0.01))
        _spine_stripe(L, 0.03, -0.12, -2.2, "secondary")
        _parts(L, ("fw_endplate", "rw_endplate"), "secondary")
        _parts(L, ("halo", "halo_pylon"), "accent")
    elif team == "norrland":
        _side_band(L, 0.40, 0.045, 0.040, True)
        _spine_stripe(L, 0.045, 2.95, 1.0, "secondary")
        _parts(L, ("fw_endplate", "rw_endplate", "halo"), "secondary")
        L.secondary(L.on("fw_flap3") * _above(y, 0.70, 0.004))
    elif team == "calder":
        _side_band(L, 0.40, 0.045, 0.045, True)
        _parts(L, ("fw_endplate", "rw_endplate", "halo"), "secondary")
        L.accent(L.on("fw_endplate") * _band(z, 0.18, 0.20))
        L.accent(L.on("rw_endplate") * _band(z, 0.86, 0.885))
        L.secondary(L.on("spine") * _above(z, 0.86, 0.004) * _band(x, -0.75, 0.0, 0.01))
    elif team == "sable":
        for off in (0.0, 0.035, 0.070):
            zc = 0.47 + 0.06 * (x - 0.3) - off
            L.accent(L.on(*BODY) * _band(z, zc, zc + 0.008) * L.side)
        L.secondary(L.on(*BODY) * _band(x, -1.30, -0.90) * L.side * _above(z, 0.20))
        _nose_tip(L, 2.80, "secondary")
        _parts(L, ("fw_endplate", "rw_endplate", "halo", "halo_pylon"), "secondary")
        L.accent(L.on("rw_main", "rw_flap") * _band(y, 0.40, 0.408))
    elif team == "orrin":
        zs = 0.48 + 0.05 * (x - 0.3)
        L.secondary(L.on(*BODY) * (1 - _above(z, zs)))
        L.accent(L.on(*BODY) * _band(z, zs, zs + 0.014))
        _spine_stripe(L, 0.02, -0.15, -2.2, "secondary")
        L.secondary(L.on("fw_endplate") * (1 - _above(z, 0.20)))
        L.secondary(L.on("rw_endplate") * (1 - _above(z, 0.72)))
        _parts(L, ("fw_flap2", "fw_flap3", "rw_flap"), "secondary")
    elif team == "terraluce":
        L.secondary(L.on(*BODY) * np.clip((0.55 - x) / 1.9, 0, 1) ** 1.4)
        L.accent(L.on("sidepod") * _band(z, 0.585 + 0.04 * x, 0.597 + 0.04 * x) * _band(x, -0.9, 0.62) * L.side)
        _nose_tip(L, 2.90, "secondary")
        _parts(L, ("rw_endplate", "rw_main", "rw_flap"), "secondary")
        L.accent(L.on("fw_endplate") * _band(z, 0.22, 0.245))
        _parts(L, ("halo",), "accent")
    elif team == "meridian":
        panel = _band(x, -0.55, 0.45) * _band(z, 0.20, 0.47) * L.side
        L.secondary(L.on("sidepod") * panel)
        L.accent(L.on("sidepod") * (_band(x, 0.45, 0.47) + _band(x, -0.57, -0.55)) * _band(z, 0.20, 0.47) * L.side)
        L.secondary(L.on("spine") * _above(z, 0.80, 0.004) * _band(x, -0.9, 0.0, 0.01))
        g = x + 1.2 * (z - 0.3)
        L.accent(L.on("spine") * (_band(g, 1.85, 1.89) + _band(g, 1.93, 1.97)) * L.side)
        _parts(L, ("fw_endplate", "rw_endplate", "halo", "halo_pylon", "mirror"), "secondary")
    else:
        raise ValueError(team)
    _common(L)
    return L.image()


# ---------------------------------------------------------------------------------------------
# Bodywork detail: panel gaps, fasteners and cooling louvres as a height field -> normal map
# ---------------------------------------------------------------------------------------------
def detail_normal(gb, strength=2.5):
    L = Paint(gb)
    x, y, z = L.x, L.y, L.z
    body = L.on(*BODY)
    h = np.zeros(x.shape)

    def groove(mask):
        nonlocal h
        h = h - mask * 1.0

    sp, side = L.on("spine"), L.on("sidepod")
    # panel joints round the nose (at the bulkhead) and on the engine cover
    groove(sp * _band(x, 1.718, 1.722, 0.0012))
    groove(sp * _band(x, -1.712, -1.708, 0.0012))
    # removable engine-cover panel line along the shoulder
    groove(sp * _band(z, 0.598 + 0.08 * (x + 0.2), 0.602 + 0.08 * (x + 0.2), 0.0012) * _band(x, -1.7, -0.25, 0.01) * L.side)
    # sidepod: inlet surround panel joint and a lengthwise joint above the undercut
    groove(side * _band(x, 0.455, 0.459, 0.0012) * _above(z, 0.30, 0.01))
    groove(side * _band(z, 0.300 + 0.05 * x, 0.304 + 0.05 * x, 0.0012) * L.side * _band(x, -0.9, 0.45, 0.01))
    # fasteners: small dimples every 70 mm along the joints
    for xc in np.arange(-1.6, -0.3, 0.07):
        zc = 0.6 + 0.08 * (xc + 0.2)
        r = np.sqrt((x - xc) ** 2 + (z - zc - 0.012) ** 2)
        h -= sp * L.side * np.clip(1 - r / 0.0045, 0, 1) ** 0.5 * 0.8
    for zc in np.arange(0.33, 0.62, 0.06):
        r = np.sqrt((x - 0.445) ** 2 + (z - zc) ** 2)
        h -= side * np.clip(1 - r / 0.0045, 0, 1) ** 0.5 * 0.8
    # cooling louvres on the sidepod tops ahead of the coke-bottle exit
    lou = side * L.top * _band(x, -0.95, -0.55, 0.01) * _band(y, 0.30, 0.52, 0.01)
    ph = (x + 0.95) / 0.4 * 7
    h += lou * (np.clip(np.sin(ph * 2 * math.pi) * 1.6, -1, 1))
    # engine-cover outlet gills either side of the spine behind the airbox
    gil = sp * L.side * _band(x, -1.45, -1.15, 0.01) * _band(z, 0.46, 0.55, 0.01)
    h += gil * np.clip(np.sin((x + 1.45) / 0.3 * 6 * 2 * math.pi) * 1.6, -1, 1)
    h *= body
    # smooth a touch so the grooves have rounded edges, then differentiate in texel space
    hs = (h + np.roll(h, 1, 0) + np.roll(h, -1, 0) + np.roll(h, 1, 1) + np.roll(h, -1, 1)) / 5
    dx = (np.roll(hs, -1, axis=1) - np.roll(hs, 1, axis=1)) * 0.5
    dy = (np.roll(hs, -1, axis=0) - np.roll(hs, 1, axis=0)) * 0.5
    nx, ny = -dx * strength, -dy * strength
    nz = np.ones_like(hs)
    ln = np.sqrt(nx * nx + ny * ny + nz * nz)
    return np.stack([nx / ln * 0.5 + 0.5, ny / ln * 0.5 + 0.5, nz / ln * 0.5 + 0.5], axis=2)
