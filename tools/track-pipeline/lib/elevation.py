"""Step 6: heights along the lap from the Copernicus GLO-30 surface model."""
from . import geom
from .inputs import dem_profile


def bridges(h, spans, step):
    """Re-inserts bridges the opening filter removed: a deck straight between the heights at its
    abutments plus a parabolic crown (estimate), over each (first_s, last_s, crown) span."""
    n = len(h)
    out = list(h)
    for a, b, crown in spans:
        i0 = int(round(a / step))
        m = int(round(((b - a) % (n * step)) / step))
        h0, h1 = h[i0 % n], h[(i0 + m) % n]
        for k in range(m + 1):
            u = k / m
            out[(i0 + k) % n] = h0 + (h1 - h0) * u + 4 * crown * u * (1 - u)
    return out


def profile(pts, frame, dem, cfg, step, bridge_spans=()):
    e = cfg["elevation"]
    raw = []
    for x, z in pts:
        lat, lon = frame.to_latlon(x, z)
        raw.append(dem.sample(lat, lon))
    h = list(raw)
    if e.get("openWindow"):
        h = dem_profile.opening(h, int(round(e["openWindow"] / step)) | 1)
    h = dem_profile.moving_average(h, int(round(e["average"] / step)) | 1)
    if bridge_spans:
        h = bridges(h, bridge_spans, step)
    # A light Gaussian pass on top of the box filter keeps the grade continuous.
    h = geom.smooth_closed(h, e["gradeSigma"] / step)
    lo, hi = min(h), max(h)
    rng = hi - lo
    want, tol = e["publishedRange"], e["rangeTolerance"]
    if abs(rng - want) > tol:
        raise SystemExit("elevation range %.1f m is outside %.1f +/- %.1f m" % (rng, want, tol))
    return raw, h
