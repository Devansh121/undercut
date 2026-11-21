"""Procedural textures, generated with numpy and handed to Blender as images: carbon twill
(normal and base colour), tyre sidewall (markings and normal), brake-disc glow ramp.
No third-party images. Every function is deterministic."""

import math

import bpy
import numpy as np


def to_image(name, rgb, alpha=None, non_color=False):
    """rgb: float array (h, w, 3) in [0, 1], row 0 at the bottom (Blender convention)."""
    h, w, _ = rgb.shape
    img = bpy.data.images.new(name, width=w, height=h, alpha=alpha is not None, is_data=non_color)
    # the colour space must be set before the pixels: changing it regenerates a generated image
    if non_color:
        img.colorspace_settings.name = "Non-Color"
    a = np.ones((h, w, 1), dtype=np.float32) if alpha is None else alpha[..., None].astype(np.float32)
    px = np.concatenate([rgb.astype(np.float32), a], axis=2)
    img.pixels.foreach_set(px.ravel())
    img.update()
    img.file_format = "PNG"
    img.pack()
    return img


def height_to_normal(hgt, strength, wrap=True):
    """Tangent-space normal map (OpenGL convention, +Y up) from a height field in texels."""
    if wrap:
        dx = (np.roll(hgt, -1, axis=1) - np.roll(hgt, 1, axis=1)) * 0.5
        dy = (np.roll(hgt, -1, axis=0) - np.roll(hgt, 1, axis=0)) * 0.5
    else:
        dy, dx = np.gradient(hgt)
    nx, ny = -dx * strength, -dy * strength
    nz = np.ones_like(hgt)
    ln = np.sqrt(nx * nx + ny * ny + nz * nz)
    return np.stack([nx / ln * 0.5 + 0.5, ny / ln * 0.5 + 0.5, nz / ln * 0.5 + 0.5], axis=2)


def srgb_to_lin(c):
    c = np.asarray(c, dtype=np.float64)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


# ---------------------------------------------------------------------------------------------
# Carbon twill: 2x2 twill, four tows per repeat in each direction; the texture holds 2 repeats
# ---------------------------------------------------------------------------------------------
CARBON_TILE_M = 0.040  # one texture tile covers 40 mm (tows 5 mm wide)


def carbon(size=512):
    n_tows = 8  # tows across the texture in each direction (2 twill repeats)
    t = np.arange(size) / size * n_tows
    u, v = np.meshgrid(t, t)
    iu, iv = np.floor(u).astype(int), np.floor(v).astype(int)
    fu, fv = u - iu, v - iv
    # 2x2 twill: warp over two, under two, shifted by one each pick
    warp_on_top = ((iu + iv) // 2) % 2 == 0
    # each tow is a rounded ridge across its width; along its length it dips where it goes under
    ridge_w = np.sin(np.pi * fv) ** 0.6  # warp tows run along u, width across v
    ridge_f = np.sin(np.pi * fu) ** 0.6
    along_w = 0.85 + 0.15 * np.cos(np.pi * (((iu + iv) % 2) + fu - 0.5)) ** 2
    along_f = 0.85 + 0.15 * np.cos(np.pi * (((iu + iv) % 2) + fv - 0.5)) ** 2
    h_warp = ridge_w * along_w
    h_fill = ridge_f * along_f
    hgt = np.where(warp_on_top, h_warp, h_fill)
    # fine fibre striation along each tow's direction
    fib = np.where(warp_on_top, np.sin(v * 2 * np.pi * 9.0), np.sin(u * 2 * np.pi * 9.0)) * 0.04
    hgt = hgt + fib
    normal = height_to_normal(hgt, strength=size / n_tows * 0.10)
    # base colour: tows facing different directions catch light differently; a slight tone split
    tone = np.where(warp_on_top, 0.030, 0.020) + 0.006 * ridge_w * ridge_f
    base = np.repeat(tone[..., None], 3, axis=2) * np.array([1.0, 1.0, 1.08])
    # back to sRGB-encoded values for a colour texture
    base = np.where(base <= 0.0031308, base * 12.92, 1.055 * np.power(base, 1 / 2.4) - 0.055)
    return normal, base


# ---------------------------------------------------------------------------------------------
# Tyre: sidewall markings (an invented maker's mark, size and a compound band) and normal map
# ---------------------------------------------------------------------------------------------
# Tiny stroke font on a 4 x 6 grid; only the glyphs the markings use.
GLYPHS = {
    "V": [((0, 6), (2, 0)), ((2, 0), (4, 6))],
    "A": [((0, 0), (2, 6)), ((2, 6), (4, 0)), ((1, 2.5), (3, 2.5))],
    "R": [((0, 0), (0, 6)), ((0, 6), (3, 6)), ((3, 6), (4, 5)), ((4, 5), (4, 4)), ((4, 4), (3, 3)), ((3, 3), (0, 3)), ((2, 3), (4, 0))],
    "O": [((0, 1), (0, 5)), ((0, 5), (1, 6)), ((1, 6), (3, 6)), ((3, 6), (4, 5)), ((4, 5), (4, 1)), ((4, 1), (3, 0)), ((3, 0), (1, 0)), ((1, 0), (0, 1))],
    "S": [((4, 5), (3, 6)), ((3, 6), (1, 6)), ((1, 6), (0, 5)), ((0, 5), (0, 4)), ((0, 4), (1, 3)), ((1, 3), (3, 3)), ((3, 3), (4, 2)), ((4, 2), (4, 1)), ((4, 1), (3, 0)), ((3, 0), (1, 0)), ((1, 0), (0, 1))],
    "L": [((0, 6), (0, 0)), ((0, 0), (4, 0))],
    "I": [((2, 0), (2, 6)), ((1, 6), (3, 6)), ((1, 0), (3, 0))],
    "C": [((4, 5), (3, 6)), ((3, 6), (1, 6)), ((1, 6), (0, 5)), ((0, 5), (0, 1)), ((0, 1), (1, 0)), ((1, 0), (3, 0)), ((3, 0), (4, 1))],
    "K": [((0, 0), (0, 6)), ((0, 3), (4, 6)), ((1, 3.7), (4, 0))],
    "1": [((1, 5), (2, 6)), ((2, 6), (2, 0)), ((1, 0), (3, 0))],
    "8": [((1, 3), (0, 4)), ((0, 4), (0, 5)), ((0, 5), (1, 6)), ((1, 6), (3, 6)), ((3, 6), (4, 5)), ((4, 5), (4, 4)), ((4, 4), (3, 3)), ((3, 3), (1, 3)), ((1, 3), (0, 2)), ((0, 2), (0, 1)), ((0, 1), (1, 0)), ((1, 0), (3, 0)), ((3, 0), (4, 1)), ((4, 1), (4, 2)), ((4, 2), (3, 3))],
    "-": [((0.5, 3), (3.5, 3))],
    " ": [],
}


def _stroke_mask(w, h, segs, width):
    """Anti-aliased mask of thick line segments in texel coordinates."""
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float64) + 0.5
    m = np.zeros((h, w))
    for (x0, y0), (x1, y1) in segs:
        lo_x, hi_x = int(max(0, min(x0, x1) - width - 2)), int(min(w, max(x0, x1) + width + 3))
        lo_y, hi_y = int(max(0, min(y0, y1) - width - 2)), int(min(h, max(y0, y1) + width + 3))
        if lo_x >= hi_x or lo_y >= hi_y:
            continue
        px, py = xx[lo_y:hi_y, lo_x:hi_x], yy[lo_y:hi_y, lo_x:hi_x]
        dx, dy = x1 - x0, y1 - y0
        L2 = dx * dx + dy * dy or 1e-9
        t = np.clip(((px - x0) * dx + (py - y0) * dy) / L2, 0, 1)
        d = np.hypot(px - (x0 + t * dx), py - (y0 + t * dy))
        m[lo_y:hi_y, lo_x:hi_x] = np.maximum(m[lo_y:hi_y, lo_x:hi_x], np.clip(width / 2 + 0.5 - d, 0, 1))
    return m


def _text_segments(text, x, y, size, spacing=1.45, slant=0.18):
    segs = []
    cx = x
    s = size / 6.0
    for ch in text:
        for (a, b) in GLYPHS.get(ch, []):
            segs.append(((cx + (a[0] + slant * a[1]) * s, y + a[1] * s), (cx + (b[0] + slant * b[1]) * s, y + b[1] * s)))
        cx += 4 * s * spacing
    return segs, cx


def tyre(profile_v, width_px=2048, height_px=512):
    """Texture in the tyre's UV space: u round the wheel, v across the profile from the inboard
    bead (0) over the tread to the outboard bead (1). profile_v gives the v of the shoulder on
    each side ('in', 'out'); the sidewalls are v < in and v > out. Both sidewalls carry the
    invented maker's mark, a size marking and the compound band (coloured at runtime by the
    material colour)."""
    w, h = width_px, height_px
    r_in = profile_v["in"] * (h - 1)
    r_out = profile_v["out"] * (h - 1)
    span = min(r_in, (h - 1) - r_out)
    th = int(round(span * 0.34))  # text strip height in rows
    segs = []
    size = th * 0.80
    for k in range(2):
        x0 = w * (0.05 + 0.5 * k)
        s1, xe = _text_segments("VARRO", x0, th * 0.10, size, spacing=1.55)
        s2, _ = _text_segments("SLICK 18", xe + size * 1.6, th * 0.22, size * 0.52, spacing=1.5, slant=0.0)
        segs += s1 + s2
    strip = _stroke_mask(w, th, segs, max(1.6, size * 0.16))
    marks = np.zeros((h, w))
    band = np.zeros((h, w))
    rows = np.arange(h)[:, None]
    # outboard sidewall: radius falls as v rises, so the strip is flipped vertically
    t0 = int(round(r_out + span * 0.40))
    marks[t0:t0 + th] = np.maximum(marks[t0:t0 + th], strip[::-1, :])
    band += np.clip(1.0 - np.abs(rows - (r_out + span * 0.18)) / (span * 0.035), 0, 1)
    # inboard sidewall: seen from the other side, so the strip is flipped horizontally
    t1 = int(round(r_in - span * 0.40)) - th
    marks[t1:t1 + th] = np.maximum(marks[t1:t1 + th], strip[:, ::-1])
    band += np.clip(1.0 - np.abs(rows - (r_in - span * 0.18)) / (span * 0.035), 0, 1)
    band = np.clip(band, 0, 1) * np.ones((1, w))
    paint = np.clip(marks + band, 0, 1)
    lin = 0.016 + (0.78 - 0.016) * paint
    rgb = np.repeat(lin[..., None], 3, axis=2)
    rgb = np.where(rgb <= 0.0031308, rgb * 12.92, 1.055 * np.power(rgb, 1 / 2.4) - 0.055)
    # raised lettering and band, plus fine concentric moulding lines on the sidewalls
    side = ((rows < r_in) | (rows > r_out)).astype(np.float64)
    mould = 0.15 * np.sin(rows * 2 * np.pi / 3.0) * side * np.ones((1, w))
    hgt = marks * 1.2 + band * 0.5 + mould
    normal = height_to_normal(hgt, strength=1.2)
    return rgb, normal


def disc_glow(size=256):
    """Emissive colour ramp across the disc face (UV1 v runs inner to outer radius): hottest in
    the middle of the friction ring, cooler at the edges."""
    v = np.linspace(0, 1, size)[:, None]
    heat = np.sin(np.pi * np.clip(v, 0, 1)) ** 0.7
    r = 1.0 * heat
    g = 0.28 * heat ** 1.6
    b = 0.06 * heat ** 3
    rgb = np.concatenate([np.repeat(r, 16, 1)[..., None], np.repeat(g, 16, 1)[..., None], np.repeat(b, 16, 1)[..., None]], axis=2)
    return np.clip(rgb, 0, 1)


def build_all(lod, tyre_profile_v):
    big = lod == "high"
    out = {}
    n, b = carbon(512 if big else 256)
    out["carbon_normal"] = to_image("carbon_normal", n, non_color=True)
    out["carbon_base"] = to_image("carbon_base", b)
    rgb, nrm = tyre(tyre_profile_v, 2048 if big else 1024, 512 if big else 256)
    out["tyre_base"] = to_image("tyre_base", rgb)
    out["tyre_normal"] = to_image("tyre_normal", nrm, non_color=True)
    out["disc_glow"] = to_image("disc_glow", disc_glow(64))
    return out
