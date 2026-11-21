#!/usr/bin/env python3
"""Fetch a circuit from OpenStreetMap via the Overpass API and measure it.

Standard library only. Data fetched is (c) OpenStreetMap contributors, ODbL 1.0.

Usage:
  python3 tools/research/osm_circuit.py <circuit> [--out DIR] [--cache DIR]
  python3 tools/research/osm_circuit.py all

<circuit> is one of the keys in CIRCUITS below. For each circuit the script:
  1. fetches the circuit relation (or the listed raceway ways) with full geometry,
  2. chains the racing-layout ways into one closed, ordered centreline,
     oriented in race direction, starting at the start/finish node,
  3. reports the centreline length, closure gap and which ways were used,
  4. fetches a feature census in the circuit bounding box (width tags, kerbs,
     barriers, run-off surfaces, grandstands, buildings) and prints counts,
  5. writes <out>/<circuit>_centreline.csv (lat,lon,s_m),
     <out>/<circuit>_segments.csv (distance range of each named way) and
     <out>/<circuit>_census.json.

Raw Overpass responses are cached in --cache (default: ~/.cache/undercut/osm)
so repeated runs do not load the public servers. Be polite: the public
Overpass instances rate-limit; the script backs off and rotates mirrors.
"""
import json
import math
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
]
USER_AGENT = "undercut-track-research/0.1 (open-source game; track geometry survey)"

# Each circuit: bounding box (south, west, north, east) for the feature census,
# the OSM relation that describes the racing layout (type=circuit), the race
# direction (the chain is flipped to match it, using the signed area of the
# loop) and the official lap length the measurement is compared with.
# Optional `exclude_ways` drops relation members that belong to other layouts
# and `extra_ways` adds raceway ways the relation is missing; none of the three
# default circuits needed either on 2026-11-21.
CIRCUITS = {
    "monza": {
        "bbox": (45.605, 9.270, 45.635, 9.300),
        "relation": 284565,
        "direction": "clockwise",
        "official_length_m": 5793.0,
    },
    "spa": {
        "bbox": (50.425, 5.955, 50.448, 5.990),
        "relation": 284560,
        "direction": "clockwise",
        "official_length_m": 7004.0,
    },
    "singapore": {
        "bbox": (1.283, 103.850, 1.300, 103.867),
        "relation": 421263,
        "direction": "anticlockwise",
        "official_length_m": 4927.0,  # FIA licence list and 2025 map; 4940 m in 2023-2024
    },
}

EARTH_R = 6371008.8


def hav(a, b):
    """Great-circle distance in metres between (lat, lon) pairs."""
    la1, lo1 = math.radians(a[0]), math.radians(a[1])
    la2, lo2 = math.radians(b[0]), math.radians(b[1])
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 2 * EARTH_R * math.asin(math.sqrt(h))


def overpass(query, cache_dir, tag):
    os.makedirs(cache_dir, exist_ok=True)
    path = os.path.join(cache_dir, tag + ".json")
    if os.path.exists(path):
        with open(path) as f:
            return json.load(f)
    body = urllib.parse.urlencode({"data": query}).encode()
    delay = 5
    last = None
    for attempt in range(12):
        ep = ENDPOINTS[attempt % len(ENDPOINTS)]
        req = urllib.request.Request(ep, data=body, headers={"User-Agent": USER_AGENT})
        try:
            with urllib.request.urlopen(req, timeout=180) as r:
                raw = r.read()
            data = json.loads(raw)
            with open(path, "wb") as f:
                f.write(raw)
            return data
        except (urllib.error.URLError, json.JSONDecodeError, TimeoutError, OSError) as e:
            last = e
            sys.stderr.write("overpass %s failed (%s); retry in %ss\n" % (ep, e, delay))
            time.sleep(delay)
            delay = min(delay * 2, 60)
    raise RuntimeError("Overpass failed: %s" % last)


def bbox_str(b):
    return "%f,%f,%f,%f" % b


def ways_and_nodes(data):
    nodes = {e["id"]: (e["lat"], e["lon"]) for e in data["elements"] if e["type"] == "node"}
    ways = {e["id"]: e for e in data["elements"] if e["type"] == "way"}
    rels = {e["id"]: e for e in data["elements"] if e["type"] == "relation"}
    return nodes, ways, rels


def chain(way_ids, ways):
    """Chain ways into ordered node sequences by shared endpoints.

    Returns a list of node-id lists (one per connected chain)."""
    remaining = {w: list(ways[w]["nodes"]) for w in way_ids}
    chains = []
    while remaining:
        wid, seq = remaining.popitem()
        seq = list(seq)
        grown = True
        while grown:
            grown = False
            for w, ns in list(remaining.items()):
                if ns[0] == seq[-1]:
                    seq += ns[1:]
                elif ns[-1] == seq[-1]:
                    seq += ns[::-1][1:]
                elif ns[-1] == seq[0]:
                    seq = ns[:-1] + seq
                elif ns[0] == seq[0]:
                    seq = ns[::-1][:-1] + seq
                else:
                    continue
                del remaining[w]
                grown = True
        chains.append(seq)
    chains.sort(key=len, reverse=True)
    return chains


def signed_area(pts):
    """Shoelace area in local metres; >0 means anticlockwise."""
    lat0 = sum(p[0] for p in pts) / len(pts)
    k = math.cos(math.radians(lat0))
    xy = [(math.radians(p[1]) * EARTH_R * k, math.radians(p[0]) * EARTH_R) for p in pts]
    a = 0.0
    for i in range(len(xy)):
        x1, y1 = xy[i]
        x2, y2 = xy[(i + 1) % len(xy)]
        a += x1 * y2 - x2 * y1
    return a / 2


def length(pts):
    return sum(hav(pts[i], pts[i + 1]) for i in range(len(pts) - 1))


def build_centreline(cfg, data):
    nodes, ways, rels = ways_and_nodes(data)
    rel = rels.get(cfg["relation"]) if cfg.get("relation") else None
    start_node = None
    pit_ways = []
    if rel:
        race_ways = []
        for m in rel["members"]:
            if m["type"] == "way":
                if m["role"] in ("pit_lane", "pitlane"):
                    pit_ways.append(m["ref"])
                elif m["ref"] not in cfg.get("exclude_ways", ()):
                    race_ways.append(m["ref"])
            elif m["type"] == "node" and m["role"] == "start":
                start_node = m["ref"]
        race_ways += list(cfg.get("extra_ways", ()))
    else:
        race_ways = list(cfg["ways"])
    race_ways = [w for w in race_ways if w in ways]
    chains = chain(race_ways, ways)
    main = chains[0]
    closed = main[0] == main[-1]
    if closed and start_node in main:
        i = main.index(start_node)
        main = main[i:-1] + main[:i + 1]
    pts = [nodes[n] for n in main]
    area = signed_area(pts)
    is_ccw = area > 0
    want_ccw = cfg["direction"] == "anticlockwise"
    if is_ccw != want_ccw:
        main = main[::-1]
        pts = pts[::-1]
    return {
        "nodes": main,
        "pts": pts,
        "closed": closed,
        "closure_gap_m": hav(pts[0], pts[-1]),
        "leftover_chains": [len(c) for c in chains[1:]],
        "race_ways": race_ways,
        "pit_ways": pit_ways,
        "start_node": start_node,
        "length_m": length(pts),
        "pit_length_m": sum(length([nodes[n] for n in ways[w]["nodes"]]) for w in pit_ways if w in ways),
        "way_tags": {w: ways[w].get("tags", {}) for w in race_ways + pit_ways if w in ways},
        "segments": segments(main, pts, race_ways, ways),
        "pit": pit_positions(pts, pit_ways, ways, nodes),
    }


def pit_positions(pts, pit_ways, ways, nodes):
    """Project both ends of the pit-lane way onto the centreline.

    Returns [(s_m, offset_m, lat, lon), ...] for the two ends, ordered by s.
    Which end is entry and which is exit follows from race direction: the
    entry is the end the car reaches first after the last corner, i.e. the
    larger s when the pit lane straddles the start/finish line."""
    if not pit_ways or pit_ways[0] not in ways:
        return []
    s = [0.0]
    for i in range(1, len(pts)):
        s.append(s[-1] + hav(pts[i - 1], pts[i]))
    out = []
    w = ways[pit_ways[0]]["nodes"]
    for n in (w[0], w[-1]):
        p = nodes[n]
        best = min(range(len(pts)), key=lambda i: hav(p, pts[i]))
        out.append((round(s[best], 1), round(hav(p, pts[best]), 1), p[0], p[1]))
    return sorted(out)


def segments(main, pts, race_ways, ways):
    """Distance range along the centreline covered by each racing-layout way."""
    s = [0.0]
    for i in range(1, len(pts)):
        s.append(s[-1] + hav(pts[i - 1], pts[i]))
    total = s[-1]
    first = {}
    for i, n in enumerate(main[:-1]):
        first.setdefault(n, i)
    out = []
    for w in race_ways:
        idx = [first[n] for n in ways[w]["nodes"] if n in first]
        if len(idx) < 2:
            continue
        a, b = s[min(idx)], s[max(idx)]
        if b - a > total / 2:  # way straddles the start/finish node
            gaps = sorted(s[i] for i in idx)
            a = max(x for x in gaps if x < total / 2)
            b = min(x for x in gaps if x > total / 2)
            a, b = b, a
        out.append((a, b, w, ways[w].get("tags", {}).get("name", "")))
    out.sort()
    return out


CENSUS_FILTERS = {
    "raceway_ways": 'way[highway=raceway]',
    "raceway_ways_with_width": 'way[highway=raceway][width]',
    "raceway_area_polygons": 'way["area:highway"="raceway"]',
    "kerb_ways": 'way[barrier=kerb]',
    "kerb_ways_tagged_raceway": 'way[raceway=kerb]',
    "barrier_wall": 'way[barrier=wall]',
    "barrier_fence": 'way[barrier=fence]',
    "barrier_guard_rail": 'way[barrier=guard_rail]',
    "barrier_jersey": 'way[barrier=jersey_barrier]',
    "barrier_tyres": 'way[barrier=tyres]',
    "gravel_or_sand_areas": 'way[~"^(surface|natural|landuse)$"~"^(gravel|sand|fine_gravel)$"]',
    "runoff_tagged": 'way[raceway~"runoff|run_off|gravel_trap"]',
    "grandstands": 'way[~"^(building|man_made|leisure)$"~"grandstand"]',
    "buildings": 'way[building]',
    "grass_areas": 'way[~"^(landuse|surface)$"~"^(grass)$"]',
}


def census(cfg, cache_dir, name):
    b = bbox_str(cfg["bbox"])
    parts = "".join("way%s(%s);" % (f[3:], b) for f in CENSUS_FILTERS.values())
    q = "[out:json][timeout:120];(%s);out tags;" % parts
    data = overpass(q, cache_dir, name + "_census")
    out = {}
    els = data["elements"]
    for key, f in CENSUS_FILTERS.items():
        out[key] = sum(1 for e in els if match(e.get("tags", {}), f))
    return out, els


def match(tags, f):
    # Minimal evaluator for the filter strings above.
    import re
    for cond in re.findall(r'\[([^\]]+)\]', f):
        if cond.startswith("~"):
            m = re.match(r'~"(.+)"~"(.+)"', cond)
            kre, vre = m.group(1), m.group(2)
            if not any(re.search(kre, k) and re.search(vre, v) for k, v in tags.items()):
                return False
        elif "~" in cond:
            k, v = cond.split("~", 1)
            k, v = k.strip('"'), v.strip('"')
            if k not in tags or not re.search(v, tags[k]):
                return False
        elif "=" in cond:
            k, v = cond.split("=", 1)
            if tags.get(k.strip('"')) != v.strip('"'):
                return False
        else:
            if cond.strip('"') not in tags:
                return False
    return True


def main(argv):
    if len(argv) < 2:
        print(__doc__)
        return 2
    out_dir = os.path.expanduser("~/.cache/undercut/osm/out")
    cache_dir = os.path.expanduser("~/.cache/undercut/osm")
    if "--out" in argv:
        out_dir = argv[argv.index("--out") + 1]
    if "--cache" in argv:
        cache_dir = argv[argv.index("--cache") + 1]
    os.makedirs(out_dir, exist_ok=True)
    names = list(CIRCUITS) if argv[1] == "all" else [argv[1]]
    for name in names:
        cfg = CIRCUITS[name]
        if cfg.get("relation"):
            q = "[out:json][timeout:120];relation(%d);(._;>;);out body;" % cfg["relation"]
        else:
            q = "[out:json][timeout:120];way(id:%s);(._;>;);out body;" % ",".join(str(w) for w in cfg["ways"])
        data = overpass(q, cache_dir, name + "_layout")
        cl = build_centreline(cfg, data)
        with open(os.path.join(out_dir, name + "_centreline.csv"), "w") as f:
            f.write("lat,lon,s_m\n")
            s = 0.0
            for i, p in enumerate(cl["pts"]):
                if i:
                    s += hav(cl["pts"][i - 1], p)
                f.write("%.7f,%.7f,%.2f\n" % (p[0], p[1], s))
        with open(os.path.join(out_dir, name + "_segments.csv"), "w") as f:
            f.write("s_start,s_end,way_id,name\n")
            for a, b, w, nm in cl["segments"]:
                f.write("%.1f,%.1f,%d,%s\n" % (a, b, w, nm.replace(",", " ")))
        cen, _ = census(cfg, cache_dir, name)
        report = {
            "circuit": name,
            "race_way_count": len(cl["race_ways"]),
            "node_count": len(cl["nodes"]),
            "closed": cl["closed"],
            "closure_gap_m": round(cl["closure_gap_m"], 2),
            "leftover_chain_node_counts": cl["leftover_chains"],
            "start_node": cl["start_node"],
            "centreline_length_m": round(cl["length_m"], 1),
            "official_length_m": cfg["official_length_m"],
            "delta_pct": round(100 * (cl["length_m"] - cfg["official_length_m"]) / cfg["official_length_m"], 2),
            "pit_ways": cl["pit_ways"],
            "pit_length_m": round(cl["pit_length_m"], 1),
            "pit_way_ends_s_offset": cl["pit"],
            "race_ways_with_width": sorted({t.get("width") for t in cl["way_tags"].values() if t.get("width")}),
            "census": cen,
        }
        with open(os.path.join(out_dir, name + "_census.json"), "w") as f:
            json.dump(report, f, indent=1)
        print(json.dumps(report, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
