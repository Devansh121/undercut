"""Step 9 inputs: OpenStreetMap gravel polygons and barrier lines near the track."""
import math

from . import geom

BARRIER_TYPES = {
    "guard_rail": "armco",
    "wall": "concrete",
    "jersey_barrier": "concrete",
    "retaining_wall": "concrete",
    "tyres": "tyres",
    "fence": "fence",
}
GRAVEL = ("gravel", "fine_gravel", "sand")


def _bbox(pts):
    xs = [p[0] for p in pts]
    zs = [p[1] for p in pts]
    return min(xs), min(zs), max(xs), max(zs)


def load(data, frame):
    """Returns (gravel polygons, barrier lines) in the local frame, sorted by OSM id."""
    gravel, barriers = [], []
    for e in sorted(data["elements"], key=lambda e: e["id"]):
        if e["type"] != "way" or "geometry" not in e:
            continue
        tags = e.get("tags", {})
        pts = [frame.to_xz(g["lat"], g["lon"]) for g in e["geometry"]]
        if any(tags.get(k) in GRAVEL for k in ("surface", "natural", "landuse")) and e["nodes"][0] == e["nodes"][-1]:
            gravel.append({"id": e["id"], "poly": pts[:-1], "bbox": _bbox(pts)})
        elif tags.get("barrier") in BARRIER_TYPES:
            barriers.append({"id": e["id"], "type": BARRIER_TYPES[tags["barrier"]], "line": pts, "bbox": _bbox(pts)})
    return gravel, barriers


def _ray_hits_bbox(ax, az, bx, bz, box):
    return not (max(ax, bx) < box[0] or min(ax, bx) > box[2] or max(az, bz) < box[1] or min(az, bz) > box[3])


def gravel_extent(c, n, inner, outer, step, polys):
    """First contiguous run of gravel along the ray c + n * u, u in [inner, outer]. Returns (u0, u1) or None."""
    ax, az = c[0] + n[0] * inner, c[1] + n[1] * inner
    bx, bz = c[0] + n[0] * outer, c[1] + n[1] * outer
    cand = [p for p in polys if _ray_hits_bbox(ax, az, bx, bz, p["bbox"])]
    if not cand:
        return None
    u0 = None
    u = inner
    while u <= outer:
        x, z = c[0] + n[0] * u, c[1] + n[1] * u
        hit = any(geom.point_in_polygon(x, z, p["poly"]) for p in cand)
        if hit and u0 is None:
            u0 = u
        elif not hit and u0 is not None:
            return u0, u - step
        u += step
    return (u0, outer) if u0 is not None else None


def barrier_hit(c, n, inner, outer, lines):
    """Nearest mapped barrier crossing the ray c + n * u, u in [inner, outer]. Returns (u, type) or None."""
    ax, az = c[0] + n[0] * inner, c[1] + n[1] * inner
    bx, bz = c[0] + n[0] * outer, c[1] + n[1] * outer
    best = None
    for b in lines:
        if not _ray_hits_bbox(ax, az, bx, bz, b["bbox"]):
            continue
        pts = b["line"]
        for i in range(len(pts) - 1):
            u = _intersect(c, n, pts[i], pts[i + 1])
            if u is not None and inner <= u <= outer and (best is None or u < best[0]):
                best = (u, b["type"])
    return best


def _intersect(c, n, p, q):
    ex, ez = q[0] - p[0], q[1] - p[1]
    den = n[0] * ez - n[1] * ex
    if abs(den) < 1e-12:
        return None
    wx, wz = p[0] - c[0], p[1] - c[1]
    u = (wx * ez - wz * ex) / den
    t = (wx * n[1] - wz * n[0]) / den
    if 0 <= t <= 1:
        return u
    return None


def left_normals(pts):
    hs = geom.headings(pts, True)
    return [(math.sin(h), -math.cos(h)) for h in hs]
