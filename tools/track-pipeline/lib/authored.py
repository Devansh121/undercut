"""Steps 7-10: turn the authored tables in circuits/<id>.json into per-sample data.

Positions in the tables are references, resolved here to s on the scaled lap:
  {"s": 12}                        12 m after the start/finish line
  {"corner": 4, "offset": -233}    233 m before the apex of turn 4
  {"pit": "entry", "offset": 40}   40 m after the point where the pit lane leaves the lap
  {"corner": 7, "at": "start"}     where turn 7's curvature region begins ("end": where it ends)
  {"line": "timing", "offset": 12} 12 m after the timing (control) line, which sources call the
                                   finish line; s = 0 is the start line
"""
import math

from . import geom


class Lap:
    def __init__(self, length, count, corners, pit=None):
        self.length = length
        self.count = count
        self.step = length / count
        self.corners = corners  # number -> dict(apex_s, first_s, last_s, sign)
        self.pit = pit  # dict(entry_s, exit_s) once known
        self.timing_line = None  # s of the timing line once known

    def wrap(self, s):
        return s % self.length

    def resolve(self, ref):
        if "s" in ref:
            return self.wrap(ref["s"] + ref.get("offset", 0.0))
        if "corner" in ref:
            key = {"apex": "apex_s", "start": "first_s", "end": "last_s"}[ref.get("at", "apex")]
            return self.wrap(self.corners[ref["corner"]][key] + ref.get("offset", 0.0))
        if "line" in ref:
            if ref["line"] != "timing" or self.timing_line is None:
                raise SystemExit("unknown or unresolved line reference %r" % (ref,))
            return self.wrap(self.timing_line + ref.get("offset", 0.0))
        if "pit" in ref:
            key = {"entry": "entry_s", "exit": "exit_s"}[ref["pit"]]
            return self.wrap(self.pit[key] + ref.get("offset", 0.0))
        raise SystemExit("unknown reference %r" % (ref,))

    def index(self, s):
        return int(round(self.wrap(s) / self.step)) % self.count

    def span(self, a, b):
        """Sample indices from s=a forward to s=b (wrapping), inclusive."""
        i, j = self.index(a), self.index(b)
        n = (j - i) % self.count
        return [(i + k) % self.count for k in range(n + 1)]

    def forward(self, a, b):
        return (b - a) % self.length


def periodic_keys(lap, keys):
    """Linear interpolation of [(s, value...)] keys around the lap."""
    ks = sorted((lap.resolve(k[0]), k[1:]) for k in keys)
    out = []
    for i in range(lap.count):
        s = i * lap.step
        j = 0
        while j < len(ks) and ks[j][0] <= s:
            j += 1
        a = ks[j - 1] if j > 0 else (ks[-1][0] - lap.length, ks[-1][1])
        b = ks[j] if j < len(ks) else (ks[0][0] + lap.length, ks[0][1])
        t = 0.0 if b[0] == a[0] else (s - a[0]) / (b[0] - a[0])
        out.append(tuple(av + (bv - av) * t for av, bv in zip(a[1], b[1])))
    return out


def smoothstep(t):
    t = max(0.0, min(1.0, t))
    return t * t * (3 - 2 * t)


def banking(lap, cfg):
    """Per-sample bank angle (rad): each corner's value over its curvature region, ramped in and out."""
    b = cfg["banking"]
    ramp = b["ramp"]
    out = [0.0] * lap.count
    for item in b["corners"]:
        c = lap.corners[item["corner"]]
        v = math.radians(item["deg"])
        first, last = c["first_s"], c["last_s"]
        span = lap.forward(first, last)
        for i in lap.span(first - ramp, last + ramp):
            u = lap.forward(first - ramp, i * lap.step)
            w = smoothstep(u / ramp) * smoothstep((span + 2 * ramp - u) / ramp)
            out[i] += v * w
    return out


def side_of(lap, item):
    """Maps inside/outside of a corner to left/right."""
    side = item["side"]
    if side in ("left", "right"):
        return side
    sign = lap.corners[item["corner"]]["sign"]  # +1 left-hander
    inside = "left" if sign > 0 else "right"
    return inside if side == "inside" else ("right" if inside == "left" else "left")


def kerbs(lap, cfg):
    names = [p["name"] for p in cfg["kerbProfiles"]]
    out = {"left": [None] * lap.count, "right": [None] * lap.count}
    for item in cfg["kerbs"]["items"]:
        if item["profile"] not in names:
            raise SystemExit("unknown kerb profile %s" % item["profile"])
        apex = lap.corners[item["corner"]]["apex_s"]
        side = side_of(lap, item)
        for i in lap.span(apex + item["from"], apex + item["to"]):
            out[side][i] = item["profile"]
    return out


def kerb_width(cfg, name):
    if name is None:
        return 0.0
    for p in cfg["kerbProfiles"]:
        if p["name"] == name:
            return p["points"][-1][0]
    raise SystemExit("unknown kerb profile %s" % name)


def runs(values):
    """Run-length encoding as [[first_index, value], ...]."""
    out = []
    for i, v in enumerate(values):
        if not out or out[-1][1] != v:
            out.append([i, v])
    return out


def clean_runs(flags, min_len):
    """Drops runs of True shorter than min_len samples (periodic)."""
    n = len(flags)
    out = list(flags)
    if all(flags) or not any(flags):
        return out
    start = next(i for i in range(n) if not flags[i])
    i = 0
    while i < n:
        j = (start + i) % n
        if flags[j]:
            k = i
            while k < n and flags[(start + k) % n]:
                k += 1
            if k - i < min_len:
                for m in range(i, k):
                    out[(start + m) % n] = False
            i = k
        else:
            i += 1
    return out


def merge_short_runs(values, min_len):
    """Periodic: a run of equal values shorter than min_len samples takes its predecessor's value."""
    v = list(values)
    n = len(v)
    if min_len <= 1 or len(set(v)) < 2:
        return v
    for _ in range(n):
        # Runs as (start, length), starting the scan at a run boundary.
        b = next(i for i in range(n) if v[i] != v[i - 1])
        runs = []
        i = 0
        while i < n:
            j = i
            while j < n and v[(b + j) % n] == v[(b + i) % n]:
                j += 1
            runs.append((i, j - i))
            i = j
        short = [r for r in runs if r[1] < min_len]
        if not short or len(runs) < 2:
            return v
        start, length = min(short, key=lambda r: (r[1], r[0]))
        prev = v[(b + start - 1) % n]
        for k in range(length):
            v[(b + start + k) % n] = prev
    return v


def slope_limit(values, max_step):
    """Raises values so neighbours differ by at most max_step (periodic), keeping the larger."""
    v = list(values)
    n = len(v)
    for _ in range(3):
        for i in range(2 * n):
            a, b = i % n, (i + 1) % n
            v[b] = max(v[b], v[a] - max_step)
        for i in range(2 * n, 0, -1):
            a, b = i % n, (i - 1) % n
            v[b] = max(v[b], v[a] - max_step)
    return v


def taper_down(values, max_step, fixed):
    """Lowers values so each rises at most max_step per sample away from a lower neighbour
    (periodic). Samples flagged in `fixed` are neither changed nor used as a source."""
    v = list(values)
    n = len(v)
    for _ in range(3):
        for i in range(2 * n):
            a, b = i % n, (i + 1) % n
            if not fixed[a] and not fixed[b]:
                v[b] = min(v[b], v[a] + max_step)
        for i in range(2 * n, 0, -1):
            a, b = i % n, (i - 1) % n
            if not fixed[a] and not fixed[b]:
                v[b] = min(v[b], v[a] + max_step)
    return v


def grid_slots(lap, cfg):
    g = cfg["grid"]
    pole_sign = 1 if g["poleSide"] == "left" else -1
    out = []
    for k in range(g["slots"]):
        s = lap.wrap(g["poleS"] - g["spacing"] * k)
        d = g["lateral"] * (pole_sign if k % 2 == 0 else -pole_sign)
        out.append({"s": s, "d": d})
    return out


def pit_widths(cfg, length, count):
    keys = []
    for s, l, r in cfg["pit"]["widths"]:
        keys.append((s if s >= 0 else length + s + 1, l, r))
    keys.sort()
    step = length / (count - 1)
    out = []
    for i in range(count):
        s = i * step
        j = 0
        while j < len(keys) - 1 and keys[j + 1][0] <= s:
            j += 1
        a = keys[j]
        b = keys[min(j + 1, len(keys) - 1)]
        t = 0.0 if b[0] == a[0] else max(0.0, min(1.0, (s - a[0]) / (b[0] - a[0])))
        out.append((a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t))
    return out


def local_max_curvature(kappa, sign, window):
    """Per sample, the largest curvature of the given sign within +/- window samples."""
    n = len(kappa)
    return [max(max(0.0, sign * kappa[(i + k) % n]) for k in range(-window, window + 1)) for i in range(n)]


def path_curvature(pts):
    """Curvature as packages/track's TrackPath computes it on a closed path: twice the turn
    between neighbouring chords over their summed length, positive turning left."""
    n = len(pts)
    out = []
    for i in range(n):
        a, p, b = pts[i - 1], pts[i], pts[(i + 1) % n]
        e0 = (p[0] - a[0], p[1] - a[1])
        e1 = (b[0] - p[0], b[1] - p[1])
        cross = e0[0] * e1[1] - e0[1] * e1[0]
        dot = e0[0] * e1[0] + e0[1] * e1[1]
        out.append(-math.atan2(cross, dot) * 2 / (math.hypot(*e0) + math.hypot(*e1)))
    return out


def frame_limit(kappa, sign, step):
    """How far out the (s, d) frame stays one-to-one on one side, as packages/track computes it
    (Track.frameLimit) from `path_curvature`: 0.95 of the tightest radius within 12 samples,
    growing by at most 0.5 m per metre away from it."""
    n = len(kappa)
    lim = []
    for i in range(n):
        kmax = max(max(0.0, sign * kappa[(i + w) % n]) for w in range(-12, 13))
        lim.append(0.95 / kmax if kmax > 0 else 1e6)
    rise = 0.5 * step
    for _ in range(2):
        for m in range(1, 2 * n):
            lim[m % n] = min(lim[m % n], lim[(m - 1) % n] + rise)
        for m in range(2 * n - 2, -1, -1):
            lim[m % n] = min(lim[m % n], lim[(m + 1) % n] + rise)
    return lim


def normals_from(pts):
    hs = geom.headings(pts, True)
    return [(math.sin(h), -math.cos(h)) for h in hs]


def lane_widths(lap, cfg, way_tags_at):
    """Half-widths from the OSM `lanes` tag of the road under each sample (street circuits).

    Each side gets half of lanes x laneWidth, clipped to [min, max] total, with `default` where a
    way has no lanes tag; the result is smoothed along the lap so it changes over tens of metres,
    not at way boundaries. `overrides` then set authored widths over ranges, ramped in and out."""
    w = cfg["widths"]["lanes"]
    raw = []
    for i in range(lap.count):
        tags = way_tags_at(i * lap.step)
        total = w["default"]
        lanes = tags.get("lanes", "")
        if lanes.isdigit():
            total = int(lanes) * w["laneWidth"]
        total = max(w["min"], min(w["max"], total))
        raw.append(total / 2)
    half = geom.smooth_closed(raw, w["smooth"] / lap.step)
    out = [[h, h] for h in half]
    ramp = w.get("ramp", 30.0)
    for item in cfg["widths"].get("overrides", []):
        a, b = lap.resolve(item["from"]), lap.resolve(item["to"])
        span = lap.forward(a, b)
        for i in lap.span(a - ramp, b + ramp):
            u = lap.forward(a - ramp, i * lap.step)
            t = smoothstep(u / ramp) * smoothstep((span + 2 * ramp - u) / ramp)
            out[i][0] += (item["left"] - out[i][0]) * t
            out[i][1] += (item["right"] - out[i][1]) * t
    return [tuple(x) for x in out]
