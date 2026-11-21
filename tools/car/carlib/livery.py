"""Livery atlas and masks.

Every painted surface is a grid patch (see geom.AtlasPatch). The patches are packed into one UV
atlas (UV0). For each livery pattern a mask is drawn into that atlas by evaluating the pattern at
the 3D position and normal of every texel, so the patterns stay continuous across parts.

Mask channels: R = secondary colour weight, G = accent colour weight, B = bare carbon (the paint
is left off). Primary = 1 - R - G where B = 0. The renderer mixes the team's three colours with
these weights; nothing about a team is baked into the mesh.
"""

import math

import numpy as np

from . import dims as D

PATTERNS = ["split-diagonal", "chevron-nose", "side-band", "pinstripe", "two-tone-horizontal",
            "fade-rear", "block-sidepod"]


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
# Texel -> surface sampling
# ---------------------------------------------------------------------------------------------
def _grid_arrays(p):
    g = np.array([[tuple(v) for v in row] for row in p.grid], dtype=np.float64)
    if p.closed:
        g = np.concatenate([g, g[:, :1]], axis=1)
    rows, cols = g.shape[0], g.shape[1]
    du = np.gradient(g, axis=1)
    dv = np.gradient(g, axis=0) if rows > 1 else np.zeros_like(g)
    n = np.cross(du, dv)
    ln = np.linalg.norm(n, axis=2, keepdims=True)
    n = n / np.maximum(ln, 1e-12)
    if p.normal_hint is not None:
        s = np.sign(np.sum(n * np.array(p.normal_hint), axis=2, keepdims=True))
    else:
        cen = g.mean(axis=1, keepdims=True)
        s = np.sign(np.sum(n * (g - cen), axis=2, keepdims=True))
    s[s == 0] = 1
    return g, n * s


def sample_patch(p, size):
    """Returns (ix, iy, pos, nrm) for every texel the patch covers, padding included."""
    u0, v0, u1, v1, rot = p.rect
    pad = 6
    x0, x1 = int(round(u0 * size)) - pad, int(round(u1 * size)) + pad
    y0, y1 = int(round(v0 * size)) - pad, int(round(v1 * size)) + pad
    x0, y0 = max(0, x0), max(0, y0)
    x1, y1 = min(size, x1), min(size, y1)
    ix, iy = np.meshgrid(np.arange(x0, x1), np.arange(y0, y1))
    lu = np.clip(((ix + 0.5) / size - u0) / max(u1 - u0, 1e-9), 0, 1)
    lv = np.clip(((iy + 0.5) / size - v0) / max(v1 - v0, 1e-9), 0, 1)
    if rot:
        lu, lv = lv, lu
    g, n = _grid_arrays(p)
    rows, cols = g.shape[0], g.shape[1]
    fi = lu * (cols - 1)
    vr = np.array(p.vrows if p.vrows is not None else np.linspace(0, 1, rows))
    fj = np.interp(lv, vr, np.arange(rows, dtype=np.float64))
    i0 = np.clip(np.floor(fi).astype(int), 0, cols - 2)
    j0 = np.clip(np.floor(fj).astype(int), 0, max(rows - 2, 0))
    ti, tj = (fi - i0)[..., None], (fj - j0)[..., None]
    j1 = np.minimum(j0 + 1, rows - 1)

    def bil(a):
        return (a[j0, i0] * (1 - ti) * (1 - tj) + a[j0, i0 + 1] * ti * (1 - tj)
                + a[j1, i0] * (1 - ti) * tj + a[j1, i0 + 1] * ti * tj)

    pos = bil(g)
    nrm = bil(n)
    nrm /= np.maximum(np.linalg.norm(nrm, axis=-1, keepdims=True), 1e-12)
    return ix, iy, pos, nrm


# ---------------------------------------------------------------------------------------------
# Patterns
# ---------------------------------------------------------------------------------------------
def _band(x, lo, hi, w=0.003):
    return np.clip((x - lo) / w + 0.5, 0, 1) * np.clip((hi - x) / w + 0.5, 0, 1)


def _above(x, e, w=0.003):
    return np.clip((x - e) / w + 0.5, 0, 1)


BODY = {"spine", "sidepod", "airbox"}
WING_TOP = {"fw_flap2", "fw_flap3", "rw_main", "rw_flap"}
ENDPLATES = {"fw_endplate", "rw_endplate"}


def evaluate(pattern, key, pos, nrm):
    x, y, z = pos[..., 0], np.abs(pos[..., 1]), pos[..., 2]
    nx, ny, nz = nrm[..., 0], np.abs(nrm[..., 1]), nrm[..., 2]
    shp = x.shape
    sec = np.zeros(shp)
    acc = np.zeros(shp)
    carb = np.zeros(shp)

    # common: bare carbon low on the body and under the sidepod undercut, under the wings
    if key in BODY:
        carb = np.maximum(carb, 1 - _above(z, D.Z_FLOOR_TOP + 0.050, 0.004))
        if key == "sidepod":
            carb = np.maximum(carb, _above(-nz, 0.35, 0.05) * (1 - _above(z, 0.45, 0.01)))
        if key == "spine":
            carb = np.maximum(carb, _above(-nz, 0.55, 0.05))
    if key in WING_TOP:
        carb = np.maximum(carb, _above(-nz, 0.45, 0.08))
    if key == "halo":
        carb = np.maximum(carb, _above(-nz, 0.6, 0.1))

    if key == "helmet":
        # helmet in team colours: primary shell, secondary crown, accent pin line (local frame)
        sec = _above(z, 0.060, 0.004)
        acc = _band(z, 0.048, 0.056, 0.002)
        return np.clip(sec * (1 - acc), 0, 1), acc, np.zeros(shp)
    if key == "wheel_cover":
        # every livery: bare carbon cover with a primary ring and an accent pin line near the rim
        r = np.sqrt(pos[..., 0] ** 2 + pos[..., 2] ** 2)
        acc = _band(r, 0.188, 0.195, 0.0015)
        carb = 1 - _band(r, 0.199, 0.240, 0.0015) - acc
        return np.zeros(shp), np.clip(acc, 0, 1), np.clip(carb, 0, 1)

    side = _above(ny, 0.30, 0.08)
    top = _above(nz, 0.25, 0.08)

    if pattern == "split-diagonal":
        # primary forward and high, secondary low at the rear, split by a line that rises
        # towards the tail
        d = (z - 0.34) + 0.22 * (x - 0.20)
        if key in BODY:
            sec = 1 - _above(d, 0.0)
            acc = _band(d, 0.0, 0.016)
        elif key in ENDPLATES:
            sec[:] = 1.0
            acc = _band(z, 0.90, 0.93) if key == "rw_endplate" else _band(z, 0.24, 0.26)
        elif key in ("halo", "halo_pylon", "mirror"):
            sec[:] = 1.0
        elif key in ("fw_flap3",):
            acc = _above(y, 0.80, 0.01)
    elif pattern == "chevron-nose":
        f = (x - 2.20) + 1.45 * y
        if key in BODY:
            sec = _band(f, 0.0, 0.20) * top
            acc = _band(f, 0.24, 0.27) * top
            g = (x + 0.45) + 0.9 * y
            sec = np.maximum(sec, _band(g, 0.0, 0.14) * top)
            if key == "sidepod":
                acc = np.maximum(acc, _above(x, D.X_SIDEPOD_INLET - 0.05, 0.004))
        elif key in ENDPLATES:
            sec[:] = 1.0
        elif key in ("halo", "halo_pylon"):
            acc[:] = 1.0
        elif key in ("rw_main",):
            sec = _above(y, 0.36, 0.004)
    elif pattern == "side-band":
        zc = 0.40 + 0.045 * (x - 0.3)
        if key in BODY:
            sec = _band(z, zc - 0.045, zc + 0.045) * side
            acc = _band(z, zc - 0.062, zc - 0.050) * side
        elif key in ENDPLATES:
            sec[:] = 1.0
            acc = _band(z, 0.18 if key == "fw_endplate" else 0.86, 0.20 if key == "fw_endplate" else 0.885)
        elif key in ("halo",):
            sec[:] = 1.0
    elif pattern == "pinstripe":
        if key in BODY:
            for off in (0.0, 0.035, 0.070):
                zc = 0.47 + 0.06 * (x - 0.3) - off
                acc = np.maximum(acc, _band(z, zc, zc + 0.008) * side)
            sec = _band(x, -1.30, -0.90) * side * _above(z, 0.20)
        elif key in ENDPLATES:
            sec[:] = 1.0
            acc = _band(z, 0.80, 0.81) if key == "rw_endplate" else acc
        elif key in ("rw_main", "rw_flap"):
            acc = _band(y, 0.40, 0.408)
        elif key in ("halo", "halo_pylon"):
            sec[:] = 1.0
    elif pattern == "two-tone-horizontal":
        zs = 0.48 + 0.05 * (x - 0.3)
        if key in BODY:
            sec = 1 - _above(z, zs)
            acc = _band(z, zs, zs + 0.014)
        elif key in ENDPLATES:
            sec = 1 - _above(z, 0.20 if key == "fw_endplate" else 0.70)
        elif key in ("fw_flap2", "fw_flap3", "rw_flap"):
            sec[:] = 1.0
    elif pattern == "fade-rear":
        if key in BODY:
            sec = np.clip((0.55 - x) / 1.9, 0, 1) ** 1.4
            acc = _band(z, 0.585 + 0.04 * x, 0.597 + 0.04 * x) * _band(x, -0.9, 0.62) * side
        elif key in ENDPLATES:
            sec[:] = 1.0 if key == "rw_endplate" else 0.0
            acc = _band(z, 0.22, 0.245) if key == "fw_endplate" else acc
        elif key in ("rw_main", "rw_flap"):
            sec[:] = 1.0
        elif key in ("halo",):
            acc[:] = 1.0
    elif pattern == "block-sidepod":
        if key == "sidepod":
            # a square-cornered panel on the sidepod flank only; tops and inlet stay primary
            panel = _band(x, -0.55, 0.45) * _band(z, 0.20, 0.47) * side
            sec = panel
            acc = (_band(x, 0.45, 0.47) + _band(x, -0.57, -0.55)) * _band(z, 0.20, 0.47) * side
        elif key in ENDPLATES:
            sec[:] = 1.0
        elif key in ("halo", "halo_pylon", "mirror"):
            sec[:] = 1.0
        elif key == "spine":
            # an invented graphic: two parallel slashes on the nose flanks
            g = x + 1.2 * (z - 0.3)
            acc = (_band(g, 1.85, 1.89) + _band(g, 1.93, 1.97)) * side

    acc = np.clip(acc, 0, 1)
    sec = np.clip(sec, 0, 1) * (1 - acc)
    carb = np.clip(carb, 0, 1)
    return sec, acc, carb


def draw_mask(patches, pattern, size=1024):
    img = np.zeros((size, size, 3), dtype=np.float64)
    for p in patches:
        ix, iy, pos, nrm = sample_patch(p, size)
        s, a, c = evaluate(pattern, p.key, pos, nrm)
        img[iy, ix, 0] = s
        img[iy, ix, 1] = a
        img[iy, ix, 2] = c
    return img
