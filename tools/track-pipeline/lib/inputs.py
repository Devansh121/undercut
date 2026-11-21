"""Cached raw inputs and their provenance.

Raw downloads live under ~/.cache/undercut/ and are never committed. Each cached file gets a
sidecar `<file>.fetch.json` recording the URL, when it was fetched and its sha256, written once
when the file is first seen. The track file's metadata copies these records, so a rebuild from
the same cache writes the same bytes.
"""
import datetime
import hashlib
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
RESEARCH = os.path.normpath(os.path.join(HERE, "..", "..", "research"))
if RESEARCH not in sys.path:
    sys.path.insert(0, RESEARCH)

import dem_profile  # noqa: E402  (tools/research)
import osm_circuit  # noqa: E402  (tools/research)

CACHE = os.path.expanduser(os.environ.get("UNDERCUT_CACHE", "~/.cache/undercut"))
OSM_CACHE = os.path.join(CACHE, "osm")
DEM_CACHE = os.path.join(CACHE, "dem")


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def provenance(path, url):
    """Returns the provenance record for a cached file, creating the sidecar on first sight."""
    side = path + ".fetch.json"
    digest = sha256(path)
    if os.path.exists(side):
        with open(side) as f:
            rec = json.load(f)
        if rec.get("sha256") != digest:
            raise SystemExit("%s changed since it was fetched (sha256 mismatch); delete %s to accept it" % (path, side))
        return rec
    mtime = datetime.datetime.fromtimestamp(os.path.getmtime(path), tz=datetime.timezone.utc)
    rec = {
        "file": os.path.basename(path),
        "url": url,
        "fetched": mtime.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "sha256": digest,
    }
    with open(side, "w") as f:
        json.dump(rec, f, indent=1)
    return rec


def overpass(query, tag, offline):
    path = os.path.join(OSM_CACHE, tag + ".json")
    if offline and not os.path.exists(path):
        raise SystemExit("offline: %s is not cached" % path)
    data = osm_circuit.overpass(query, OSM_CACHE, tag)
    rec = provenance(path, osm_circuit.ENDPOINTS[0] + "?data=" + query)
    rec["osmBase"] = data.get("osm3s", {}).get("timestamp_osm_base", "")
    return data, rec


def layout(cfg, offline):
    q = "[out:json][timeout:120];relation(%d);(._;>;);out body;" % cfg["osm"]["relation"]
    return overpass(q, cfg["id"] + "_layout", offline)


FEATURE_FILTERS = [
    'way[barrier~"^(wall|fence|guard_rail|jersey_barrier|tyres|retaining_wall)$"]',
    'way[~"^(surface|natural|landuse)$"~"^(gravel|sand|fine_gravel)$"]',
    'way[~"^(surface|landuse)$"~"^(grass)$"]',
]


def features(cfg, offline):
    b = "%f,%f,%f,%f" % tuple(cfg["osm"]["bbox"])
    q = "[out:json][timeout:120];(%s);out geom;" % "".join("%s(%s);" % (f, b) for f in FEATURE_FILTERS)
    return overpass(q, cfg["id"] + "_features", offline)


def dem_tile(lat, lon, offline):
    name = dem_profile.tile_name(lat, lon)
    path = os.path.join(DEM_CACHE, name + ".tif")
    url = "%s/%s/%s.tif" % (dem_profile.BUCKET, name, name)
    if not os.path.exists(path):
        if offline:
            raise SystemExit("offline: %s is not cached" % path)
        dem_profile.fetch(lat, lon, DEM_CACHE)
    return dem_profile.GeoTiff(path), provenance(path, url)
