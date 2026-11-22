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
# 3K-class twill on visible parts has tows about 3 mm wide; the first build used 6 mm, which read
# as coarse 12K cloth from the cockpit camera.
CARBON_TILE_M = 0.024  # one texture tile covers 24 mm (tows 3 mm wide)


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


def carbon_anisotropy(size=128):
    """KHR_materials_anisotropy texture for the same twill: RG is the fibre direction in tangent
    space (warp tows run along u, fill tows along v), B the strength, highest on each tow's crown
    and falling off where it dives under its neighbour. Same tile and tow layout as carbon()."""
    n_tows = 8
    t = (np.arange(size) + 0.5) / size * n_tows
    u, v = np.meshgrid(t, t)
    iu, iv = np.floor(u).astype(int), np.floor(v).astype(int)
    fu, fv = u - iu, v - iv
    warp_on_top = ((iu + iv) // 2) % 2 == 0
    crown = np.where(warp_on_top, np.sin(np.pi * fv), np.sin(np.pi * fu)) ** 0.5
    r = np.where(warp_on_top, 1.0, 0.5)
    g = np.where(warp_on_top, 0.5, 1.0)
    b = 0.35 + 0.65 * crown
    return np.stack([r, g, b], axis=2)


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


TYRE_MARK_GROUPS = 4  # compound tick groups round each sidewall
TYRE_MARK_SLOT = 0.012  # u spacing of the three tick slots in a group


def tyre(profile_v, width_px=2048, height_px=512):
    """Texture in the tyre's UV space: u round the wheel, v across the profile from the inboard
    bead (0) over the tread to the outboard bead (1). profile_v gives the v of the shoulder on
    each side ('in', 'out'); the sidewalls are v < in and v > out.

    Markings (invented): the maker's mark once on each sidewall, and four groups of three short
    radial ticks. The renderer shows one, two or all three ticks of each group in the compound's
    colour (see design/compounds.json); the lettering stays neutral. There are no full rings and
    no repeated lettering. The normal map adds raised lettering and ticks, fine concentric
    moulding on the sidewalls and a restrained rubber grain everywhere."""
    w, h = width_px, height_px
    r_in = profile_v["in"] * (h - 1)
    r_out = profile_v["out"] * (h - 1)
    span = min(r_in, (h - 1) - r_out)
    th = int(round(span * 0.30))
    size = th * 0.80
    # lettering: one mark per sidewall, placed between the tick groups (u 0.16 .. 0.34)
    s1, xe = _text_segments("VARRO", w * 0.165, th * 0.10, size, spacing=1.55)
    s2, _ = _text_segments("18", xe + size * 1.2, th * 0.22, size * 0.52, spacing=1.5, slant=0.0)
    strip = _stroke_mask(w, th, s1 + s2, max(1.6, size * 0.16))
    # ticks: radial bars at the three slots of every group
    tk = int(round(span * 0.26))
    tsegs = []
    for g in range(TYRE_MARK_GROUPS):
        uc = (g + 0.5) / TYRE_MARK_GROUPS
        for s in (-1, 0, 1):
            x = (uc + s * TYRE_MARK_SLOT) * w
            tsegs.append(((x, tk * 0.12), (x, tk * 0.88)))
    ticks = _stroke_mask(w, tk, tsegs, max(2.0, w * 0.0035))
    marks = np.zeros((h, w))
    rows = np.arange(h)[:, None]
    # outboard sidewall: radius falls as v rises, so strips are flipped vertically
    t0 = int(round(r_out + span * 0.40))
    marks[t0:t0 + th] = np.maximum(marks[t0:t0 + th], strip[::-1, :])
    k0 = int(round(r_out + span * 0.08))
    marks[k0:k0 + tk] = np.maximum(marks[k0:k0 + tk], ticks[::-1, :])
    # inboard sidewall: seen from the other side, so strips are flipped horizontally
    t1 = int(round(r_in - span * 0.40)) - th
    marks[t1:t1 + th] = np.maximum(marks[t1:t1 + th], strip[:, ::-1])
    k1 = int(round(r_in - span * 0.08)) - tk
    marks[k1:k1 + tk] = np.maximum(marks[k1:k1 + tk], ticks[:, ::-1])
    lin = 0.016 + (0.62 - 0.016) * np.clip(marks, 0, 1)
    rgb = np.repeat(lin[..., None], 3, axis=2)
    rgb = np.where(rgb <= 0.0031308, rgb * 12.92, 1.055 * np.power(rgb, 1 / 2.4) - 0.055)
    side = ((rows < r_in) | (rows > r_out)).astype(np.float64)
    mould = 0.12 * np.sin(rows * 2 * np.pi / 3.0) * side * np.ones((1, w))
    # rubber grain: a fixed hash, two octaves, very low amplitude
    ii, jj = np.meshgrid(np.arange(w, dtype=np.int64), np.arange(h, dtype=np.int64))
    hsh = ((ii * 73856093) ^ (jj * 19349663)) % 1000003
    grain = (hsh / 1000003.0 - 0.5) * 0.10
    grain = grain + 0.5 * (np.roll(grain, 1, 0) + np.roll(grain, 1, 1)) * 0.5
    hgt = marks * 1.2 + mould + grain
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


def wheel_controls(size=512):
    """Original block legends and index strokes over a restrained carbon-coloured face."""
    yy, xx = np.mgrid[0:size, 0:size]
    grain = ((xx * 37 + yy * 61) % 97) / 96
    rgb = np.ones((size, size, 3)) * (.026 + grain[..., None] * .006)
    glyphs = {
        "N": ["10001","11001","10101","10011","10001","10001","10001"],
        "P": ["11110","10001","10001","11110","10000","10000","10000"],
        "R": ["11110","10001","10001","11110","10100","10010","10001"],
        "A": ["01110","10001","10001","11111","10001","10001","10001"],
        "B": ["11110","10001","10001","11110","10001","10001","11110"],
        "D": ["11110","10001","10001","10001","10001","10001","11110"],
        "E": ["11111","10000","10000","11110","10000","10000","11111"],
        "S": ["01111","10000","10000","01110","00001","00001","11110"],
        "L": ["10000","10000","10000","10000","10000","10000","11111"],
    }
    def label(text,y,z,scale=2):
        x0=int((y/.24+.5)*size)-len(text)*6*scale//2
        z0=int((z/.156+.5)*size)-7*scale//2
        for c in text:
            for row,bits in enumerate(glyphs[c]):
                for col,bit in enumerate(bits):
                    if bit == '1':
                        u=x0+col*scale; v=z0+(6-row)*scale
                        rgb[max(v,0):min(v+scale,size),max(u,0):min(u+scale,size)] = (.62,.64,.62)
            x0+=6*scale
    buttons=[(.078,.042),(.084,.016),(.080,-.010),(.064,-.034),(.030,-.036),(.062,.056),(.092,-.032)]
    for k,(y,z) in enumerate(buttons):
        for side in (-1,1):
            label(('N','P','R','A','B','D','S')[k],side*y,z+.0105,1)
    for text,y,z,r in [('B',.052,-.052,.0115),('D',-.052,-.052,.0115),('E',0,-.060,.0095)]:
        label(text,y,z-r-.004,1)
        # White pointer stroke on the rotary cap and short registration ticks around its collar.
        u=(xx/size-.5)*.24-y; v=(yy/size-.5)*.156-z
        rgb[(np.abs(u)<.0008)&(v>.002)&(v<r*.82)] = (.8,.77,.65)
        for ang in (-1.0,-.5,0,.5,1.0):
            a=ang+math.pi/2
            along=u*math.cos(a)+v*math.sin(a)
            across=-u*math.sin(a)+v*math.cos(a)
            rgb[(np.abs(across)<.0005)&(along>r*1.15)&(along<r*1.35)] = (.4,.42,.4)
    # Sparse edge scuffs, not a uniform dirt overlay.
    edge=(np.abs((xx/size-.5)*.24)>.108)&(grain>.97)
    rgb[edge]=(.09,.09,.085)
    return rgb


def glove_suede(size=256):
    y,x=np.mgrid[0:size,0:size]/size
    noise=((x*size*73+y*size*151)%101)/100
    base=.40+noise*.07
    seam=(np.abs(x-.22)<.009)|(np.abs(x-.78)<.009)
    stitches=seam&((np.floor(y*60)%2)==0)
    base[seam]*=.72
    base[stitches]*=1.35
    base[(noise>.985)&(x>.3)&(x<.7)]*=1.12
    return np.stack([base*.96,base*.98,base],axis=2)


def build_all(lod, tyre_profile_v):
    big = lod == "high"
    out = {}
    if big:
        out["wheel_controls"] = to_image("wheel_controls", wheel_controls())
    if lod != "far":
        out["glove_suede"] = to_image("glove_suede", glove_suede(256 if big else 128))
    n, b = carbon(512 if big else 256)
    out["carbon_normal"] = to_image("carbon_normal", n, non_color=True)
    out["carbon_base"] = to_image("carbon_base", b)
    out["carbon_aniso"] = to_image("carbon_aniso", carbon_anisotropy(128 if big else 64), non_color=True)
    rgb, nrm = tyre(tyre_profile_v, 2048 if big else 1024, 512 if big else 256)
    out["tyre_base"] = to_image("tyre_base", rgb)
    out["tyre_normal"] = to_image("tyre_normal", nrm, non_color=True)
    out["disc_glow"] = to_image("disc_glow", disc_glow(64))
    return out
