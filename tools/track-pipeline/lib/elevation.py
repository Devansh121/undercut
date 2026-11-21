"""Step 6: heights along the lap from the Copernicus GLO-30 surface model."""
from . import geom
from .inputs import dem_profile


def profile(pts, frame, dem, cfg, step):
    e = cfg["elevation"]
    raw = []
    for x, z in pts:
        lat, lon = frame.to_latlon(x, z)
        raw.append(dem.sample(lat, lon))
    h = list(raw)
    if e.get("openWindow"):
        h = dem_profile.opening(h, int(round(e["openWindow"] / step)) | 1)
    h = dem_profile.moving_average(h, int(round(e["average"] / step)) | 1)
    # A light Gaussian pass on top of the box filter keeps the grade continuous.
    h = geom.smooth_closed(h, e["gradeSigma"] / step)
    lo, hi = min(h), max(h)
    rng = hi - lo
    want, tol = e["publishedRange"], e["rangeTolerance"]
    if abs(rng - want) > tol:
        raise SystemExit("elevation range %.1f m is outside %.1f +/- %.1f m" % (rng, want, tol))
    return raw, h
