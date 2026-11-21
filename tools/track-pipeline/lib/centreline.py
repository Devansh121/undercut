"""Steps 2-5: check the OSM loop, project it to metres, smooth, resample and scale s."""
import math

from . import geom
from .inputs import osm_circuit


def osm_loop(cfg, data):
    """Chains the relation's racing ways into the closed loop (research script) and checks it."""
    rcfg = {
        "relation": cfg["osm"]["relation"],
        "direction": cfg["direction"],
        "exclude_ways": cfg["osm"].get("excludeWays", []),
        "extra_ways": cfg["osm"].get("extraWays", []),
    }
    cl = osm_circuit.build_centreline(rcfg, data)
    problems = []
    if not cl["closed"] or cl["closure_gap_m"] > 0.01:
        problems.append("loop does not close (gap %.2f m)" % cl["closure_gap_m"])
    if cl["leftover_chains"]:
        problems.append("leftover way chains: %s" % cl["leftover_chains"])
    off = cfg["officialLength"]
    delta = (cl["length_m"] - off) / off
    if abs(delta) > 0.01:
        problems.append("OSM length %.1f m is %.2f %% from the official %.0f m" % (cl["length_m"], 100 * delta, off))
    if problems:
        raise SystemExit("loop check failed: " + "; ".join(problems))
    return cl


def build(cfg, cl, frame):
    """Returns the resampled centreline and its quality figures."""
    g = cfg["geometry"]
    raw = [frame.to_xz(lat, lon) for lat, lon in cl["pts"][:-1]]  # last point repeats the first
    raw_len = geom.cumulative(raw, True)[-1]
    dense_step = g["denseStep"]
    dense = geom.densify(raw, True, dense_step)
    smooth = geom.smooth_points(dense, True, g["smoothSigma"] / dense_step)
    # The smoothed loop starts where the start/finish node projects onto it.
    s_sm = geom.cumulative(smooth, True)
    s0, _, _ = geom.project_closed(raw[0], smooth, s_sm)
    geo_len = s_sm[-1]
    count = int(round(cfg["officialLength"] / g["sampleStep"]))
    pts = geom.resample(smooth, True, count, offset=s0)
    seg = geom.seg_lengths(pts, True)
    kappa = geom.curvature(pts, True)
    heading = math.degrees(math.atan2(pts[1][0] - pts[0][0], -(pts[1][1] - pts[0][1]))) % 360
    q = {
        "osmLength": round(raw_len, 2),
        "smoothedLength": round(geo_len, 2),
        "lengthChangePct": round(100 * (geo_len - raw_len) / raw_len, 4),
        "scale": cfg["officialLength"] / geo_len,
        "sampleCount": count,
        "segmentMin": min(seg),
        "segmentMax": max(seg),
        "maxAbsCurvature": max(abs(k) for k in kappa),
        "maxCurvatureJump": max(abs(kappa[i] - kappa[i - 1]) for i in range(count)),
        "startHeadingDeg": round(heading, 1),
    }
    if abs(q["lengthChangePct"]) > g["maxLengthChangePct"]:
        raise SystemExit("smoothing changed the length by %.3f %%" % q["lengthChangePct"])
    if abs(q["scale"] - 1) > 0.01:
        raise SystemExit("scale factor %.5f is more than 1 %% from 1" % q["scale"])
    lo, hi = g["startHeadingDeg"]
    if not lo <= heading <= hi:
        raise SystemExit("start heading %.1f deg is outside [%s, %s]" % (heading, lo, hi))
    return pts, kappa, q
