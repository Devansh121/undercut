#!/usr/bin/env python3
"""Build a committed track file from open geodata and the circuit's authored tables.

Usage:
  python3 tools/track-pipeline/build.py <circuit> [--offline] [--out PATH] [--check]

  <circuit>   a file name in tools/track-pipeline/circuits/ without .json (for example monza)
  --offline   fail instead of fetching when a raw input is not cached
  --out PATH  write somewhere other than packages/track/data/<circuit>.json
  --check     build into memory and compare with the committed file byte for byte

Raw inputs (Overpass responses, the Copernicus tile) are cached under ~/.cache/undercut/ and
never committed. Steps follow docs/track-data.md section 5. Standard library only.
"""
import hashlib
import json
import math
import os
import sys

sys.dont_write_bytecode = True  # keep __pycache__ out of tools/

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, HERE)

from lib import authored, centreline, corners, elevation, geo, geom, inputs, osmfeatures  # noqa: E402
from lib.writer import dumps  # noqa: E402

PIPELINE_VERSION = "1.2.0"
FORMAT = "undercut-track"
FORMAT_VERSION = 3

OSM_ATTRIBUTION = (
    "© OpenStreetMap contributors. Data available under the Open Database License 1.0, "
    "https://www.openstreetmap.org/copyright"
)
DEM_ATTRIBUTION = (
    "produced using Copernicus WorldDEM-30 © DLR e.V. 2010-2014 and © Airbus Defence and "
    "Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved"
)
DEM_LIABILITY = (
    "The organisations in charge of the Copernicus programme by law or by delegation do not incur "
    "any liability for any use of the Copernicus WorldDEM-30"
)


def log(msg):
    sys.stderr.write(msg + "\n")


def match_corners(cfg, detected, step):
    want = cfg["corners"]
    if len(detected) != len(want):
        found = ", ".join("%s at %.0f m" % ("L" if c[1] > 0 else "R", c[0] * step) for c in detected)
        raise SystemExit("curvature gives %d corners, the circuit has %d: %s" % (len(detected), len(want), found))
    # Number from the first corner after the start line.
    out = {}
    for c, (apex, sign, first, last, turn) in zip(want, detected):
        if (sign > 0) != (c["direction"] == "left"):
            raise SystemExit("turn %d should be a %s-hander, curvature says otherwise" % (c["number"], c["direction"]))
        out[c["number"]] = {
            "apex_s": apex * step,
            "first_s": first * step,
            "last_s": last * step,
            "sign": sign,
            "turn_deg": turn,
            "name": c["name"],
            "direction": c["direction"],
        }
    return out


def bridge_spans(cfg, data, frame, pts, step):
    """Lap spans (geometric s) of the OSM bridge ways listed in the elevation table."""
    nodes = {e["id"]: (e["lat"], e["lon"]) for e in data["elements"] if e["type"] == "node"}
    ways = {e["id"]: e for e in data["elements"] if e["type"] == "way"}
    S = [i * step for i in range(len(pts) + 1)]
    out = []
    for b in cfg["elevation"].get("bridges", []):
        w = ways[b["way"]]
        ends = [geom.project_closed(frame.to_xz(*nodes[n]), pts, S)[0] for n in (w["nodes"][0], w["nodes"][-1])]
        total = len(pts) * step
        a, c = ends
        if (c - a) % total > total / 2:
            a, c = c, a
        out.append((a, c, b["crown"]))
    return out


def way_tags_lookup(cl, layout, L):
    """For lap s, the tags of the OSM way the loop follows there (from the research chaining)."""
    ways = {e["id"]: e for e in layout["elements"] if e["type"] == "way"}
    k = L / cl["length_m"]
    segs = [(a * k, b * k, ways[w].get("tags", {})) for a, b, w, _ in cl["segments"]]

    def at(s):
        for a, b, tags in segs:
            if a <= s <= b or (a > b and (s >= a or s <= b)):
                return tags
        return {}

    return at


def isa_pressure(altitude):
    """ISA pressure at an altitude (Pa), as packages/sim's airDensity computes it."""
    return 101325 * (1 - 2.25577e-5 * altitude) ** 5.25588


def environment(cfg, lat0, lon0, heights):
    e = cfg["environment"]
    altitude = sum(heights) / len(heights)
    fl = e.get("floodlights")
    return {
        "latitude": lat0,
        "longitude": lon0,
        # World frame: +X east, +Z south, so true north is -Z, yaw +pi/2 (yaw 0 faces +X, positive
        # turns left). The frame is the tangent plane at the origin, so grid north is true north there.
        "northYaw": math.pi / 2,
        "altitude": altitude,
        "airTemperature": e["airTemperature"],
        "airPressure": isa_pressure(altitude),
        "timeZone": e["timeZone"],
        "utcOffset": e["utcOffset"],
        "raceDate": e["raceDate"],
        "sessions": e["sessions"],
        "lighting": e["lighting"],
        "floodlights": None if fl is None else {"mapped": fl["mapped"], "masts": fl.get("masts", []), "rule": fl.get("rule")},
        "notes": e["note"],
    }


def interp_closed(values, s, step):
    n = len(values)
    u = s / step
    i = int(math.floor(u))
    t = u - i
    return values[i % n] * (1 - t) + values[(i + 1) % n] * t


def build_pit(cfg, data, frame, lap, pts, heights, s_scaled):
    """Pit-lane path in its own (s_pit, d) frame, joined to the lap at both ends."""
    nodes = {e["id"]: (e["lat"], e["lon"]) for e in data["elements"] if e["type"] == "node"}
    ways = {e["id"]: e for e in data["elements"] if e["type"] == "way"}
    way = ways[cfg["osm"]["pitWay"]]
    raw = [frame.to_xz(*nodes[n]) for n in way["nodes"]]
    S = [i * lap.step / lap.scale for i in range(lap.count)] + [lap.count * lap.step / lap.scale]

    def proj(p):
        sg, d, _ = geom.project_closed(p, pts, S)
        return sg * lap.scale, d

    a, b = proj(raw[0]), proj(raw[-1])
    length = geom.cumulative(raw, False)[-1]
    # The entry is the end from which the lap reaches the other end in about one pit-lane length.
    if abs(lap.forward(a[0], b[0]) - length) > abs(lap.forward(b[0], a[0]) - length):
        raw = raw[::-1]
        a, b = b, a
    entry_s, exit_s = a[0], b[0]
    dense = geom.densify(raw, False, 0.5)
    sm = geom.smooth_points(dense, False, cfg["geometry"]["smoothSigma"] / 0.5)
    L = geom.cumulative(sm, False)[-1]
    count = int(round(L / cfg["geometry"]["sampleStep"])) + 1
    pp = geom.resample(sm, False, count)
    # Snap both ends onto the smoothed lap, fading the correction over 40 m.
    step = L / (count - 1)
    fade = int(round(40 / step))
    for end, s_main in ((0, entry_s), (count - 1, exit_s)):
        i = lap.index(s_main)
        tx, tz = pts[i][0] - pp[end][0], pts[i][1] - pp[end][1]
        for k in range(fade + 1):
            j = end + k if end == 0 else end - k
            w = 1 - k / fade
            pp[j] = (pp[j][0] + tx * w, pp[j][1] + tz * w)
    # Heights follow the lap at the projected s.
    ys = []
    side = []
    main_s = []
    for p in pp:
        sm_s, d = proj(p)
        ys.append(interp_closed(heights, sm_s, lap.step))
        side.append(d)
        main_s.append(sm_s)
    ys = geom.smooth_open(ys, 10)
    widths = authored.pit_widths(cfg, L, count)
    pc = cfg["pit"]
    half = (pc["boxes"]["count"] - 1) * pc["boxes"]["spacing"] / 2
    boxes = [{"s": L / 2 - half + k * pc["boxes"]["spacing"], "d": pc["boxes"]["lateral"]} for k in range(pc["boxes"]["count"])]
    return {
        "pts": pp,
        "y": ys,
        "d_main": side,
        "main_s": main_s,
        "widths": widths,
        "length": L,
        "entry_s": entry_s,
        "exit_s": exit_s,
        "limit_start": pc["limitStart"],
        "limit_end": L - pc["limitEndFromExit"],
        "boxes": boxes,
        "osm_length": length,
    }


def pit_offsets(lap, pit, pts, side):
    """For each lap sample, the pit centre's lateral offset and its near- and far-side half-widths, or None."""
    # The pit lane runs the same way as the lap, so its side facing the lap is the opposite one:
    # a pit lane on the lap's right faces it with its left side, and the reverse.
    near_k = 0 if side == "right" else 1
    out = [None] * lap.count
    pp = pit["pts"]
    S = [i * lap.step / lap.scale for i in range(lap.count)] + [lap.count * lap.step / lap.scale]
    for j, p in enumerate(pp):
        sg, d, _ = geom.project_closed(p, pts, S)
        i = lap.index(sg * lap.scale)
        near = pit["widths"][j][near_k]
        far = pit["widths"][j][1 - near_k]
        cur = out[i]
        if cur is None or abs(d) < abs(cur[0]):
            out[i] = (d, near, far)
    # Fill gaps between projected pit samples.
    idx = lap.span(pit["entry_s"], pit["exit_s"])
    last = None
    for i in idx:
        if out[i] is None:
            out[i] = last
        last = out[i]
    return out


def zones(cfg, lap, pts, kappa, widths, kerb, gravel_polys, barrier_lines, pit_off):
    rc, bc = cfg["runoff"], cfg["barriers"]
    normals = authored.normals_from(pts)
    # Millimetre-rounded, as the file stores them and the runtime reads them.
    path_kappa = authored.path_curvature([(round(x, 3), round(z, 3)) for x, z in pts])
    res = {}
    report = {}
    for side, sgn in (("left", 1), ("right", -1)):
        hw = [w[0] if side == "left" else w[1] for w in widths]
        kw = [authored.kerb_width(cfg, k) for k in kerb[side]]
        edge = [hw[i] + kw[i] for i in range(lap.count)]
        inner = [rc["default"]] * lap.count
        for item in rc["items"]:
            if item["side"] != side:
                continue
            for i in lap.span(lap.resolve(item["from"]), lap.resolve(item["to"])):
                inner[i] = item["kind"]
        # Mapped gravel.
        g = []
        for i in range(lap.count):
            n = (normals[i][0] * sgn, normals[i][1] * sgn)
            g.append(osmfeatures.gravel_extent(pts[i], n, edge[i] + 0.5, edge[i] + rc["maxScan"], 0.5, gravel_polys))
        keep = authored.clean_runs([x is not None for x in g], int(round(rc["minGravelLength"] / lap.step)))
        g = [g[i] if keep[i] else None for i in range(lap.count)]
        # Mapped barriers.
        m = []
        for i in range(lap.count):
            n = (normals[i][0] * sgn, normals[i][1] * sgn)
            m.append(osmfeatures.barrier_hit(pts[i], n, edge[i] + 2.0, edge[i] + bc["maxScan"], barrier_lines))
        steady = [m[i] is not None and m[i - 1] is not None and abs(m[i][0] - m[i - 1][0]) < 1.0 for i in range(lap.count)]
        steady = authored.clean_runs(steady, 15)
        m = [m[i] if steady[i] else None for i in range(lap.count)]
        # A circuit may read a mapped barrier kind as another type (Spa: fences stand on guard rails).
        remap = bc.get("mappedTypes", {})
        m = [None if x is None else (x[0], remap.get(x[1], x[1])) for x in m]
        # Barrier offsets: authored offset, else mapped, else the default rule.
        off = []
        typ = []
        source = []
        for i in range(lap.count):
            o = edge[i] + bc["minRunoff"]
            t = bc["default"]
            src = "rule"
            if g[i] is not None:
                o = max(o, g[i][1] + bc["behindGravel"])
            if m[i] is not None and m[i][0] >= (g[i][1] if g[i] else edge[i]) + 1.0:
                o, t, src = m[i][0], m[i][1], "osm"
            off.append(o)
            typ.append(t)
            source.append(src)
        for item in bc["items"]:
            if item["side"] != side:
                continue
            for i in lap.span(lap.resolve(item["from"]), lap.resolve(item["to"])):
                typ[i] = item["type"]
                if "offset" in item:
                    off[i] = item["offset"]
                    source[i] = "authored"
        if bc.get("minTypeRun"):
            typ = authored.merge_short_runs(typ, int(round(bc["minTypeRun"] / lap.step)))
        off = authored.slope_limit(off, 0.5 * lap.step)
        # Pit side: the pit wall stands halfway between the track edge and the pit lane; where
        # the two surfaces are too close for a wall, the barrier moves behind the pit lane.
        if cfg["pit"]["side"] == side:
            for i in range(lap.count):
                po = pit_off[i]
                if po is None:
                    continue
                pd, near, far = abs(po[0]), po[1], po[2]
                gap = pd - near - edge[i]
                if gap >= 2.0:
                    off[i] = edge[i] + gap / 2
                    source[i] = "pitwall"
                else:
                    off[i] = max(off[i], pd + far + 1.5)
                    source[i] = "pit"
                typ[i] = "concrete"
        # Inside of tight corners: keep the barrier short of the centre of curvature, where the
        # (s, d) frame folds.
        kmax = authored.local_max_curvature(kappa, sgn, 12)
        for i in range(lap.count):
            if kmax[i] > 0:
                cap = 0.95 / kmax[i]
                if off[i] > cap:
                    off[i] = cap
                    source[i] = source[i] + "+capped"
        # Taper away from capped stretches so the barrier never sweeps across a chicane.
        off = authored.taper_down(off, 0.5 * lap.step, [x.startswith("pit") for x in source])
        # Nothing, not even a barrier placed behind the pit lane, may stand where the frame folds:
        # with `clampToFrame`, no barrier goes beyond the frame limit the runtime computes.
        # (Monza's file predates this rule; it is left as built.)
        if bc.get("clampToFrame"):
            flim = authored.frame_limit(path_kappa, sgn, lap.step)
            for i in range(lap.count):
                if off[i] > flim[i]:
                    off[i] = flim[i]
                    source[i] = source[i] + "+frame"
        for i in range(lap.count):
            if off[i] < edge[i] + 1.0:
                raise SystemExit("%s barrier at s=%.0f is %.1f m from the centreline, inside the kerb" % (side, i * lap.step, off[i]))
        # Gravel extent clipped to the barrier: split = where gravel begins (>= barrier: none).
        split = []
        outer = []
        for i in range(lap.count):
            if g[i] is not None and g[i][0] < off[i] - 0.5:
                split.append(max(g[i][0], edge[i]))
                outer.append("gravel")
            else:
                split.append(off[i])
                outer.append(inner[i])
        res[side] = {
            "kerb": authored.runs(kerb[side]),
            "inner": authored.runs(inner),
            "outer": authored.runs(outer),
            "split": split,
            "barrier": off,
            "barrierType": authored.runs(typ),
        }
        report[side] = {
            "gravelSamples": sum(1 for x in g if x),
            "osmBarrierSamples": sum(1 for x in source if x.startswith("osm")),
            "cappedSamples": sum(1 for x in source if x.endswith("capped")),
        }
    return res, report


def main(argv):
    if len(argv) < 2 or argv[1].startswith("-"):
        print(__doc__)
        return 2
    cid = argv[1]
    offline = "--offline" in argv
    out_path = argv[argv.index("--out") + 1] if "--out" in argv else os.path.join(ROOT, "packages", "track", "data", cid + ".json")
    with open(os.path.join(HERE, "circuits", cid + ".json")) as f:
        cfg = json.load(f)

    # 1-2. Fetch and check the loop.
    layout, layout_rec = inputs.layout(cfg, offline)
    feats, feats_rec = inputs.features(cfg, offline)
    cl = centreline.osm_loop(cfg, layout)
    # 3. Local frame centred on the circuit.
    lats = [p[0] for p in cl["pts"]]
    lons = [p[1] for p in cl["pts"]]
    lat0 = round((min(lats) + max(lats)) / 2, 4)
    lon0 = round((min(lons) + max(lons)) / 2, 4)
    frame = geo.LocalFrame(lat0, lon0)
    # 4-5. Smooth, resample, scale.
    pts, kappa, quality = centreline.build(cfg, cl, frame)
    L = cfg["officialLength"]
    n = len(pts)
    step = L / n
    rule = corners.rule_for(cfg)
    detected, _ = corners.detect(kappa, step / quality["scale"], rule)
    lap = authored.Lap(L, n, match_corners(cfg, detected, step))
    lap.scale = quality["scale"]
    log("centreline: %d samples, OSM %.1f m, smoothed %.1f m (%.3f %%), scale %.6f" % (
        n, quality["osmLength"], quality["smoothedLength"], quality["lengthChangePct"], quality["scale"]))
    # 6. Elevation.
    dem, dem_rec = inputs.dem_tile(lat0, lon0, offline)
    spans = bridge_spans(cfg, layout, frame, pts, step / quality["scale"])
    fixes = [(lap.resolve(c["from"]) / quality["scale"], lap.resolve(c["to"]) / quality["scale"]) for c in cfg["elevation"].get("corrections", [])]
    raw_h, h = elevation.profile(pts, frame, dem, cfg, step / quality["scale"], spans, fixes)
    datum = math.floor(min(h))
    log("elevation: %.1f to %.1f m, range %.1f m (published %.1f)" % (min(h), max(h), max(h) - min(h), cfg["elevation"]["publishedRange"]))
    # 7-8. Width and banking.
    if "lanes" in cfg["widths"]:
        widths = authored.lane_widths(lap, cfg, way_tags_lookup(cl, layout, L))
    else:
        widths = authored.periodic_keys(lap, cfg["widths"]["keys"])
    bank = authored.banking(lap, cfg)
    # 9. Pit lane, kerbs, run-off, barriers.
    pit = build_pit(cfg, layout, frame, lap, pts, h, None)
    lap.pit = {"entry_s": pit["entry_s"], "exit_s": pit["exit_s"]}
    pit_off = pit_offsets(lap, pit, pts, cfg["pit"]["side"])
    kerb = authored.kerbs(lap, cfg)
    # The garage-side wall runs where the pit lane is clear of the track by the wall's gap.
    pside = 0 if cfg["pit"]["side"] == "left" else 1
    sep = []
    for j, d in enumerate(pit["d_main"]):
        sj = pit["main_s"][j]
        i = lap.index(sj)
        edge = widths[i][pside] + authored.kerb_width(cfg, kerb[cfg["pit"]["side"]][i])
        sep.append(abs(d) - pit["widths"][j][1 - pside] - edge >= 2.0)
    pstep = pit["length"] / (len(sep) - 1)
    first = sep.index(True)
    last = len(sep) - 1 - sep[::-1].index(True)
    pit["wall"] = [first * pstep, last * pstep]
    gravel_polys, barrier_lines = osmfeatures.load(feats, frame)
    sides, zone_report = zones(cfg, lap, pts, kappa, widths, kerb, gravel_polys, barrier_lines, pit_off)
    log("zones: %s" % json.dumps(zone_report))
    # 10. Timing and rules metadata.
    t = cfg["timing"]
    if "line" in cfg["timingLine"]["at"]:
        raise SystemExit("the timing line cannot be placed relative to itself")
    lap.timing_line = lap.resolve(cfg["timingLine"]["at"])
    sectors = [0.0] + [lap.resolve(r) for r in t["sectors"]]
    drs = []
    apexes = sorted((c["first_s"], num) for num, c in lap.corners.items())
    for z in t["drs"]:
        act = lap.resolve(z["activation"])
        # The zone runs to the start of the next corner, or of the corner the table names (a
        # flat-out kink inside a zone is not where it ends).
        end = lap.resolve(z["end"]) if "end" in z else min(apexes, key=lambda a: lap.forward(act, a[0]))[0]
        drs.append({"detection": lap.resolve(z["detection"]), "activation": act, "end": end})
    grid = authored.grid_slots(lap, cfg)

    data = {
        "format": FORMAT,
        "version": FORMAT_VERSION,
        "id": cfg["id"],
        "name": cfg["name"],
        "country": cfg["country"],
        "direction": cfg["direction"],
        "length": L,
        "sampleCount": n,
        "origin": {"lat": lat0, "lon": lon0, "datum": datum},
        "environment": environment(cfg, lat0, lon0, h),
        "source": {
            "pipelineVersion": PIPELINE_VERSION,
            "scale": quality["scale"],
            "osmLength": quality["osmLength"],
            "smoothedLength": quality["smoothedLength"],
            "osm": {
                "relation": cfg["osm"]["relation"],
                "pitWay": cfg["osm"]["pitWay"],
                "layout": layout_rec,
                "features": feats_rec,
            },
            "dem": {
                "tile": dem_rec["file"],
                "record": dem_rec,
                "filter": "opening %s m, moving average %s m, Gaussian sigma %s m" % (
                    cfg["elevation"].get("openWindow") or 0, cfg["elevation"]["average"], cfg["elevation"]["gradeSigma"]),
                **({"bridges": [
                    {"way": b["way"], "from": lap.wrap(sp[0] * quality["scale"]), "to": lap.wrap(sp[1] * quality["scale"]), "crown": b["crown"]}
                    for b, sp in zip(cfg["elevation"]["bridges"], spans)
                ]} if cfg["elevation"].get("bridges") else {}),
                **({"corrections": [
                    {"from": lap.resolve(c["from"]), "to": lap.resolve(c["to"]), "note": c["note"]}
                    for c in cfg["elevation"]["corrections"]
                ]} if cfg["elevation"].get("corrections") else {}),
            },
            "cornerRule": rule,
            "licence": "ODbL-1.0",
            "attribution": [OSM_ATTRIBUTION, DEM_ATTRIBUTION, DEM_LIABILITY],
            "estimates": "Widths, banking, kerbs, run-off kinds nearest the track, barrier types and offsets not mapped in OpenStreetMap, pit-lane widths, limit lines, boxes and grid slots are authored estimates.",
        },
        "centreline": {
            "x": [p[0] for p in pts],
            "y": [v - datum for v in h],
            "z": [p[1] for p in pts],
            "bank": bank,
            "halfWidthLeft": [w[0] for w in widths],
            "halfWidthRight": [w[1] for w in widths],
        },
        "lineWidth": cfg["runoff"]["lineWidth"],
        "kerbProfiles": [
            {"name": p["name"], "points": p["points"], "high": p["high"], "taper": p["taper"]} for p in cfg["kerbProfiles"]
        ],
        "sides": sides,
        "corners": [
            {"number": num, "name": c["name"], "direction": c["direction"], "s": c["apex_s"], "start": c["first_s"], "end": c["last_s"]}
            for num, c in sorted(lap.corners.items())
        ],
        "timing": {"sectors": sectors, "speedTrap": lap.resolve(t["speedTrap"]), "drs": drs},
        "timingLine": {
            "s": lap.timing_line,
            "uncertainty": cfg["timingLine"]["uncertainty"],
            "source": cfg["timingLine"]["source"],
        },
        "grid": grid,
        "pit": {
            "side": cfg["pit"]["side"],
            "entryS": pit["entry_s"],
            "exitS": pit["exit_s"],
            "length": pit["length"],
            "speedLimit": cfg["pit"]["speedLimitKmh"] / 3.6,
            "limitStart": pit["limit_start"],
            "limitEnd": pit["limit_end"],
            "x": [p[0] for p in pit["pts"]],
            "y": [v - datum for v in pit["y"]],
            "z": [p[1] for p in pit["pts"]],
            "halfWidthLeft": [w[0] for w in pit["widths"]],
            "halfWidthRight": [w[1] for w in pit["widths"]],
            "boxes": pit["boxes"],
            "garageWall": pit["wall"],
        },
    }
    text = dumps(data)
    digest = hashlib.sha256(text.encode()).hexdigest()
    if "--check" in argv:
        with open(out_path, "rb") as f:
            same = f.read() == text.encode()
        print("%s %s %s" % ("same" if same else "DIFFERENT", digest, out_path))
        return 0 if same else 1
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w") as f:
        f.write(text)
    log("corners: " + ", ".join("T%d %s %.0f m (%.0f deg)" % (k, c["direction"][0].upper(), c["apex_s"], c["turn_deg"]) for k, c in sorted(lap.corners.items())))
    log("pit: entry %.1f m, exit %.1f m, length %.1f m (OSM way %.1f m)" % (pit["entry_s"], pit["exit_s"], pit["length"], pit["osm_length"]))
    print("%s  %s (%d bytes)" % (digest, os.path.relpath(out_path, ROOT), len(text)))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
