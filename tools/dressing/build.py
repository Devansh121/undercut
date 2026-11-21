"""Builds a circuit's dressing file from OpenStreetMap: what is mapped around the track.

    python3 tools/dressing/build.py monza [--offline]

Reads `tools/dressing/circuits/<id>.json` and the committed track file it names, fetches one
Overpass query covering everything within the config's radius of the centreline (cached under
~/.cache/undercut/osm/<id>_dressing.json, with a provenance sidecar), projects it into the
track's world frame (+X east, +Z south, metres from the track origin) and writes
`packages/render/data/<id>.dressing.json`. Standard library only; nothing circuit-specific
lives here.
"""
import argparse
import base64
import json
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "tools", "track-pipeline"))

from lib import inputs  # noqa: E402  (tools/track-pipeline, read only)
from lib.geo import LocalFrame  # noqa: E402

FORMAT_VERSION = 1

# Each class is (name, geometry kind, predicate on tags). First match wins, so order matters.
CLASSES = [
    ("raceway", "line", lambda t: t.get("highway") == "raceway"),
    ("grandstand", "area", lambda t: t.get("building") == "grandstand" or t.get("leisure") == "stadium" and "building" in t or t.get("tourism") == "grandstand" or t.get("grandstand") == "yes"),
    ("bridge", "line", lambda t: t.get("bridge") not in (None, "no") or t.get("man_made") == "bridge"),
    ("tunnel", "line", lambda t: t.get("tunnel") not in (None, "no") or t.get("covered") == "yes" and "highway" in t),
    ("building", "area", lambda t: "building" in t),
    ("treeRow", "line", lambda t: t.get("natural") == "tree_row"),
    ("wood", "area", lambda t: t.get("natural") == "wood" or t.get("landuse") == "forest"),
    ("scrub", "area", lambda t: t.get("natural") == "scrub"),
    ("water", "area", lambda t: t.get("natural") == "water" or t.get("landuse") in ("reservoir", "basin")),
    ("waterway", "line", lambda t: "waterway" in t),
    ("grass", "area", lambda t: t.get("landuse") in ("grass", "meadow", "village_green") or t.get("leisure") in ("pitch", "golf_course")),
    ("parking", "area", lambda t: t.get("amenity") == "parking"),
    ("road", "line", lambda t: t.get("highway") in ("motorway", "trunk", "primary", "secondary", "tertiary", "unclassified", "residential")),
    ("service", "line", lambda t: t.get("highway") in ("service", "track")),
    ("path", "line", lambda t: t.get("highway") in ("footway", "path", "cycleway", "pedestrian", "bridleway", "steps")),
    ("park", "area", lambda t: t.get("leisure") == "park" or t.get("boundary") == "protected_area"),
]

KEEP_TAGS = ("name", "building", "levels", "building:levels", "height", "roof:shape", "surface", "layer", "leaf_type", "leaf_cycle", "covered", "highway", "barrier")


def overpass_query(bbox):
    b = "%.6f,%.6f,%.6f,%.6f" % bbox
    parts = [
        'way["building"]', 'relation["building"]',
        'way["natural"~"^(wood|tree_row|scrub|water)$"]', 'relation["natural"~"^(wood|water|scrub)$"]',
        'way["landuse"~"^(forest|grass|meadow|village_green|reservoir|basin)$"]', 'relation["landuse"~"^(forest|grass|meadow)$"]',
        'way["leisure"~"^(park|stadium|pitch|golf_course)$"]', 'relation["leisure"~"^(park)$"]',
        'way["highway"]', 'way["waterway"]', 'way["bridge"]', 'way["man_made"="bridge"]',
        'way["amenity"="parking"]', 'node["natural"="tree"]',
    ]
    return "[out:json][timeout:180];(%s);out geom;" % "".join("%s(%s);" % (p, b) for p in parts)


def classify(tags):
    for name, kind, pred in CLASSES:
        try:
            if pred(tags):
                return name, kind
        except Exception:  # noqa: BLE001  (predicates read optional tags only)
            pass
    return None, None


def chain(segments):
    """Joins open way geometries that share endpoints into rings (multipolygon outer members)."""
    segs = [list(s) for s in segments if len(s) >= 2]
    rings = []
    while segs:
        cur = segs.pop(0)
        changed = True
        while changed and cur[0] != cur[-1]:
            changed = False
            for i, s in enumerate(segs):
                if s[0] == cur[-1]:
                    cur += s[1:]
                elif s[-1] == cur[-1]:
                    cur += s[::-1][1:]
                elif s[-1] == cur[0]:
                    cur = s[:-1] + cur
                elif s[0] == cur[0]:
                    cur = s[::-1][:-1] + cur
                else:
                    continue
                segs.pop(i)
                changed = True
                break
        rings.append(cur)
    return rings


def simplify(pts, tol):
    """Douglas-Peucker on (x, z) points."""
    if len(pts) < 3:
        return pts
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        a, b = stack.pop()
        ax, az = pts[a]
        bx, bz = pts[b]
        dx, dz = bx - ax, bz - az
        L = math.hypot(dx, dz)
        best, bi = -1.0, -1
        for i in range(a + 1, b):
            px, pz = pts[i]
            d = abs(dx * (az - pz) - dz * (ax - px)) / L if L > 1e-9 else math.hypot(px - ax, pz - az)
            if d > best:
                best, bi = d, i
        if best > tol:
            keep[bi] = True
            stack += [(a, bi), (bi, b)]
    return [p for p, k in zip(pts, keep) if k]


class Proximity:
    """Distance from a point to the nearest centreline sample, on a bucket grid."""

    def __init__(self, xs, zs, cell):
        self.cell = cell
        self.grid = {}
        for x, z in zip(xs, zs):
            self.grid.setdefault((int(x // cell), int(z // cell)), []).append((x, z))

    def near(self, x, z, r):
        cx, cz = int(x // self.cell), int(z // self.cell)
        n = int(math.ceil(r / self.cell))
        r2 = r * r
        for i in range(cx - n, cx + n + 1):
            for j in range(cz - n, cz + n + 1):
                for px, pz in self.grid.get((i, j), ()):
                    if (px - x) ** 2 + (pz - z) ** 2 <= r2:
                        return True
        return False


def _filter2d(h, cols, rows, n, op):
    """Separable running `op` (min or max) over a square window of n cells, clamped at the edges."""
    half = n // 2
    tmp = [0.0] * len(h)
    for r in range(rows):
        row = h[r * cols:(r + 1) * cols]
        for c in range(cols):
            tmp[r * cols + c] = op(row[max(0, c - half):c + half + 1])
    out = [0.0] * len(h)
    for c in range(cols):
        col = tmp[c::cols]
        for r in range(rows):
            out[r * cols + c] = op(col[max(0, r - half):r + half + 1])
    return out


def _blur2d(h, cols, rows, n):
    half = n // 2
    tmp = [0.0] * len(h)
    for r in range(rows):
        row = h[r * cols:(r + 1) * cols]
        for c in range(cols):
            w = row[max(0, c - half):c + half + 1]
            tmp[r * cols + c] = sum(w) / len(w)
    out = [0.0] * len(h)
    for c in range(cols):
        col = tmp[c::cols]
        for r in range(rows):
            w = col[max(0, r - half):r + half + 1]
            out[r * cols + c] = sum(w) / len(w)
    return out


def terrain_grid(cfg, frame, datum, offline):
    """Bare-ground heights on a square grid around the origin, relative to the track datum.

    The Copernicus model is a surface model (canopy and roofs included), so the grid gets the same
    treatment as the lap profile in 2-D: an opening (running minimum, then maximum) wider than any
    wood or building, then a box average. Stored as int16 decimetres, little endian, base64.
    """
    t = cfg["terrain"]
    cell, half = t["cell"], t["halfSize"]
    n = int(round(2 * half / cell)) + 1
    lat0, lon0 = frame.lat0, frame.lon0
    dem, rec = inputs.dem_tile(lat0, lon0, offline)
    h = []
    for r in range(n):
        z = -half + r * cell
        for c in range(n):
            x = -half + c * cell
            lat, lon = frame.to_latlon(x, z)
            h.append(dem.sample(lat, lon) - datum)
    w = int(round(t["openWindow"] / cell)) | 1
    h = _filter2d(_filter2d(h, n, n, w, min), n, n, w, max)
    h = _blur2d(h, n, n, int(round(t["average"] / cell)) | 1)
    raw = b"".join(int(round(v * 10)).to_bytes(2, "little", signed=True) for v in h)
    return {
        "x0": -half, "z0": -half, "cell": cell, "cols": n, "rows": n,
        "unit": "dm above the track datum, int16 little endian, rows run +z (south)",
        "filter": {"openWindow": t["openWindow"], "average": t["average"]},
        "source": rec,
        "heights": base64.b64encode(raw).decode(),
        "range": [round(min(h), 1), round(max(h), 1)],
    }


def flat(pts):
    out = []
    for x, z in pts:
        out += [round(x, 1), round(z, 1)]
    return out


def build(cfg, offline):
    with open(os.path.join(ROOT, cfg["track"])) as f:
        track = json.load(f)
    o = track["origin"]
    frame = LocalFrame(o["lat"], o["lon"])
    xs, zs = track["centreline"]["x"], track["centreline"]["z"]
    r = cfg["radius"]
    corners = [frame.to_latlon(x, z) for x in (min(xs) - r, max(xs) + r) for z in (min(zs) - r, max(zs) + r)]
    bbox = (min(c[0] for c in corners), min(c[1] for c in corners), max(c[0] for c in corners), max(c[1] for c in corners))
    data, rec = inputs.overpass(overpass_query(bbox), cfg["id"] + "_dressing", offline)

    prox = Proximity(xs, zs, 100.0)
    out = {name: [] for name, _, _ in CLASSES}
    out["tree"] = []
    seen = set()
    stats = {"elements": len(data["elements"]), "outside": 0, "unclassified": 0}

    def proj(geom):
        return [frame.to_xz(p["lat"], p["lon"]) for p in geom if p]

    for el in data["elements"]:
        key = (el["type"], el["id"])
        if key in seen:
            continue
        seen.add(key)
        tags = el.get("tags", {})
        if el["type"] == "node":
            x, z = frame.to_xz(el["lat"], el["lon"])
            if prox.near(x, z, r):
                out["tree"] += [round(x, 1), round(z, 1)]
            continue
        name, kind = classify(tags)
        if name is None:
            stats["unclassified"] += 1
            continue
        if el["type"] == "way":
            rings = [proj(el.get("geometry", []))]
        else:
            outers = [[(p["lat"], p["lon"]) for p in m.get("geometry", []) if p] for m in el.get("members", []) if m.get("type") == "way" and m.get("role") in ("outer", "")]
            rings = [[frame.to_xz(la, lo) for la, lo in ring] for ring in chain(outers)]
        for ring in rings:
            if len(ring) < 2 or not any(prox.near(x, z, r) for x, z in ring):
                stats["outside"] += 1
                continue
            pts = simplify(ring, cfg["simplify"])
            item = {"id": "%s/%d" % (el["type"][0], el["id"]), "p": flat(pts)}
            kept = {k: tags[k] for k in KEEP_TAGS if k in tags}
            if kept:
                item["t"] = kept
            out[name].append(item)

    for name in out:
        if name != "tree":
            out[name].sort(key=lambda it: it["id"])
    terrain = terrain_grid(cfg, frame, o["datum"], offline)
    counts = {k: (len(v) // 2 if k == "tree" else len(v)) for k, v in out.items()}
    return {
        "format": "undercut-dressing",
        "version": FORMAT_VERSION,
        "id": cfg["id"],
        "frame": {"origin": o, "axes": "x east, z south, metres from the track origin"},
        "radius": r,
        "source": {"osm": rec, "licence": "ODbL-1.0", "attribution": "(c) OpenStreetMap contributors"},
        "counts": counts,
        "stats": stats,
        "mapped": out,
        "terrain": terrain,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("circuit")
    ap.add_argument("--offline", action="store_true")
    ap.add_argument("--out")
    a = ap.parse_args()
    with open(os.path.join(HERE, "circuits", a.circuit + ".json")) as f:
        cfg = json.load(f)
    doc = build(cfg, a.offline)
    path = a.out or os.path.join(ROOT, "packages", "render", "data", cfg["id"] + ".dressing.json")
    with open(path, "w") as f:
        json.dump(doc, f, separators=(",", ":"), sort_keys=False)
        f.write("\n")
    print("wrote %s (%d bytes)" % (os.path.relpath(path, ROOT), os.path.getsize(path)))
    print(json.dumps(doc["counts"]))
    print(json.dumps(doc["stats"]))
    print("terrain %dx%d, range %s m" % (doc["terrain"]["cols"], doc["terrain"]["rows"], doc["terrain"]["range"]))


if __name__ == "__main__":
    main()
