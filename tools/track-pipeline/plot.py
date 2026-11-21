#!/usr/bin/env python3
"""Top-down plan and profiles of a committed track file, for looking at it.

Usage:
  python3 tools/track-pipeline/plot.py <circuit> [--out DIR] [--svg]
  npm run track:plot -- <circuit>

Reads packages/track/data/<circuit>.json and writes PNG images to docs/evidence/m1-track/ (SVG
too with --svg): the whole plan, close-ups of the corner groups, the pit lane and grid, and the
elevation and curvature profiles. PNG conversion uses ImageMagick `convert` when it is installed.
Lateral offsets use the same frame as packages/track: positions linear between samples,
left normals from central differences.
"""
import json
import math
import os
import shutil
import subprocess
import sys

sys.dont_write_bytecode = True  # keep __pycache__ out of tools/

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, HERE)

from lib import corners as corner_rule  # noqa: E402
from lib import geom  # noqa: E402

KIND_FILL = {
    "asphalt": "#62666d",
    "grass": "#4f7a3f",
    "gravel": "#cdb98a",
    "paint": "#f4f4f0",
}
BARRIER = {"armco": "#9fd8ff", "concrete": "#f2f2f2", "tyres": "#ff5a36", "fence": "#ffd23f"}
ROAD = "#2f3237"
BG = "#1b201d"
TEXT = "#f4f4f0"
HEAD = 64


class Track:
    def __init__(self, data):
        self.d = data
        c = data["centreline"]
        self.n = data["sampleCount"]
        self.L = data["length"]
        self.step = self.L / self.n
        self.pts = list(zip(c["x"], c["z"]))
        self.normals = self._normals(self.pts, True)
        self.hl, self.hr = c["halfWidthLeft"], c["halfWidthRight"]
        p = data["pit"]
        self.pit = list(zip(p["x"], p["z"]))
        self.pit_normals = self._normals(self.pit, False)
        self.side = {}
        for side in ("left", "right"):
            sd = data["sides"][side]
            self.side[side] = {k: self._unrun(sd[k]) for k in ("kerb", "inner", "outer", "barrierType")}
            self.side[side]["split"] = sd["split"]
            self.side[side]["barrier"] = sd["barrier"]
        self.kerb_w = {k["name"]: k["points"][-1][0] for k in data["kerbProfiles"]}

    def _unrun(self, runs):
        out = [None] * self.n
        for j, (i, v) in enumerate(runs):
            end = runs[j + 1][0] if j + 1 < len(runs) else self.n
            for k in range(i, end):
                out[k] = v
        return out

    @staticmethod
    def _normals(pts, closed):
        n = len(pts)
        out = []
        for i in range(n):
            if closed:
                a, b = pts[(i - 1) % n], pts[(i + 1) % n]
            else:
                a, b = pts[max(i - 1, 0)], pts[min(i + 1, n - 1)]
            tx, tz = b[0] - a[0], b[1] - a[1]
            L = math.hypot(tx, tz)
            out.append((tz / L, -tx / L))
        return out

    def at(self, i, d):
        i %= self.n
        c, nn = self.pts[i], self.normals[i]
        return c[0] + nn[0] * d, c[1] + nn[1] * d

    def at_s(self, s, d):
        u = (s % self.L) / self.step
        i = int(math.floor(u))
        t = u - i
        a, b = self.at(i, d), self.at(i + 1, d)
        return a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t

    def pit_at(self, j, d):
        c, nn = self.pit[j], self.pit_normals[j]
        return c[0] + nn[0] * d, c[1] + nn[1] * d

    def edge(self, side, i):
        return self.hl[i % self.n] if side == "left" else self.hr[i % self.n]


class Svg:
    def __init__(self, x0, z0, x1, z1, scale, title):
        self.x0, self.z0, self.scale = x0, z0, scale
        # Keep room for the two header rows.
        if (x1 - x0) * scale < 1100:
            grow = (1100 / scale - (x1 - x0)) / 2
            x0, x1 = x0 - grow, x1 + grow
            self.x0 = x0
        self.w = int((x1 - x0) * scale)
        self.h = int((z1 - z0) * scale)
        self.out = [
            '<svg xmlns="http://www.w3.org/2000/svg" width="%d" height="%d" viewBox="0 0 %d %d">' % (self.w, self.h + HEAD, self.w, self.h + HEAD),
            '<rect width="100%%" height="100%%" fill="%s"/>' % BG,
        ]
        self.title = title

    def p(self, x, z):
        return "%.1f,%.1f" % ((x - self.x0) * self.scale, (z - self.z0) * self.scale + HEAD)

    def poly(self, pts, fill, stroke="none", sw=0):
        self.out.append('<polygon points="%s" fill="%s" stroke="%s" stroke-width="%s"/>' % (" ".join(self.p(*q) for q in pts), fill, stroke, sw))

    def line(self, pts, stroke, sw, dash=None, opacity=1):
        da = ' stroke-dasharray="%s"' % dash if dash else ""
        self.out.append('<polyline points="%s" fill="none" stroke="%s" stroke-width="%s" stroke-linejoin="round" opacity="%s"%s/>' % (" ".join(self.p(*q) for q in pts), stroke, sw, opacity, da))

    def text(self, x, z, s, size=14, fill=TEXT, anchor="middle", weight="bold"):
        self.out.append('<text x="%.1f" y="%.1f" font-family="DejaVu Sans" font-size="%d" font-weight="%s" fill="%s" text-anchor="%s" dominant-baseline="middle">%s</text>' % (
            (x - self.x0) * self.scale, (z - self.z0) * self.scale + HEAD, size, weight, fill, anchor, s))

    def circle(self, x, z, r, fill, stroke="none"):
        self.out.append('<circle cx="%.1f" cy="%.1f" r="%.1f" fill="%s" stroke="%s" stroke-width="1.5"/>' % ((x - self.x0) * self.scale, (z - self.z0) * self.scale + HEAD, r, fill, stroke))

    def finish(self, legend):
        self.out.append('<rect width="100%%" height="%d" fill="%s"/>' % (HEAD, "#111412"))
        self.out.append('<text x="12" y="24" font-family="DejaVu Sans" font-size="16" font-weight="bold" fill="%s">%s</text>' % (TEXT, self.title))
        x = 12
        for label, col in legend:
            self.out.append('<rect x="%d" y="38" width="14" height="14" fill="%s"/>' % (x, col))
            self.out.append('<text x="%d" y="50" font-family="DejaVu Sans" font-size="13" fill="%s">%s</text>' % (x + 20, TEXT, label))
            x += 20 + 8 * len(label) + 18
        self.out.append("</svg>")
        return "\n".join(self.out)


def band_runs(tr, side, inner_of, outer_of, kind_of, i0, i1):
    """Polygons for consecutive samples sharing a kind between two lateral offsets."""
    sgn = 1 if side == "left" else -1
    out = []
    start = i0
    cur = kind_of(i0)
    for i in range(i0 + 1, i1 + 2):
        k = kind_of(i) if i <= i1 else None
        if k != cur or i > i1:
            if cur is not None:
                idx = range(start, min(i, i1) + 1)
                a = [tr.at(j, sgn * inner_of(j)) for j in idx]
                b = [tr.at(j, sgn * outer_of(j)) for j in idx]
                if len(a) > 1:
                    out.append((cur, a + b[::-1]))
            start, cur = i - 1 if i - 1 >= start else i, k
    return out


def draw_plan(tr, svg, i0, i1, detail):
    data = tr.d
    for side in ("left", "right"):
        sd = tr.side[side]
        kw = lambda j, sd=sd: tr.kerb_w.get(sd["kerb"][j % tr.n], 0.0)
        edge = lambda j, side=side: tr.edge(side, j)
        kedge = lambda j, side=side, kw=kw: tr.edge(side, j) + kw(j)
        split = lambda j, sd=sd, kedge=kedge: max(kedge(j), min(sd["split"][j % tr.n], sd["barrier"][j % tr.n]))
        bar = lambda j, sd=sd: sd["barrier"][j % tr.n]
        # Verge beyond the barrier, so the run-off reads against the background.
        for kind, poly in band_runs(tr, side, bar, lambda j, bar=bar: bar(j) + 6, lambda j: "out", i0, i1):
            svg.poly(poly, "#29302b")
        for kind, poly in band_runs(tr, side, kedge, split, lambda j, sd=sd: sd["inner"][j % tr.n], i0, i1):
            svg.poly(poly, KIND_FILL[kind])
        for kind, poly in band_runs(tr, side, split, bar, lambda j, sd=sd: sd["outer"][j % tr.n], i0, i1):
            svg.poly(poly, KIND_FILL[kind])
        # Kerbs: alternate red and white every sample.
        def kerb_kind(j, sd=sd):
            k = sd["kerb"][j % tr.n]
            return None if k is None else ("#d8262e" if (j // (1 if detail else 3)) % 2 else "#f4f4f0")
        for col, poly in band_runs(tr, side, edge, kedge, kerb_kind, i0, i1):
            svg.poly(poly, col)
    # Pit lane surface.
    pl, pr = data["pit"]["halfWidthLeft"], data["pit"]["halfWidthRight"]
    np_ = len(tr.pit)
    a = [tr.pit_at(j, pl[j]) for j in range(np_)]
    b = [tr.pit_at(j, -pr[j]) for j in range(np_)]
    svg.poly(a + b[::-1], "#4a4e55")
    # Road.
    left = [tr.at(j, tr.hl[j % tr.n]) for j in range(i0, i1 + 1)]
    right = [tr.at(j, -tr.hr[j % tr.n]) for j in range(i0, i1 + 1)]
    svg.poly(left + right[::-1], ROAD)
    lw = max(1.0, data["lineWidth"] * svg.scale)
    svg.line(left, "#f4f4f0", lw)
    svg.line(right, "#f4f4f0", lw)
    svg.line([tr.at(j, 0) for j in range(i0, i1 + 1)], "#8b8f96", 1, dash="6 6", opacity=0.6)
    # Pit lane centre, limit lines and boxes.
    svg.line(tr.pit, "#c8ccd2", 1, dash="4 4")
    p = data["pit"]
    pstep = p["length"] / (np_ - 1)
    for s_p, col in ((p["limitStart"], "#ff9f1c"), (p["limitEnd"], "#ff9f1c")):
        j = int(round(s_p / pstep))
        svg.line([tr.pit_at(j, pl[j]), tr.pit_at(j, -pr[j])], col, 3 if detail else 2)
    for bx in p["boxes"]:
        j = int(round(bx["s"] / pstep))
        c = tr.pit_at(j, bx["d"])
        svg.circle(c[0], c[1], 4 if detail else 2, "#ffd23f")
    # Barriers, split where the offset jumps.
    for side in ("left", "right"):
        sd = tr.side[side]
        sgn = 1 if side == "left" else -1
        run = []
        cur = None
        for j in range(i0, i1 + 2):
            t = sd["barrierType"][j % tr.n] if j <= i1 else None
            jump = run and j <= i1 and abs(sd["barrier"][j % tr.n] - sd["barrier"][(j - 1) % tr.n]) > 2
            if t != cur or jump:
                if len(run) > 1:
                    svg.line(run, BARRIER[cur], 3 if detail else 2)
                run = run[-1:] if (t == cur or (cur and t)) and not jump else []
                cur = t
            if j <= i1:
                run.append(tr.at(j, sgn * sd["barrier"][j % tr.n]))
    # Pit-lane garage line.
    w0, w1 = (int(round(v / pstep)) for v in p["garageWall"])
    svg.line([tr.pit_at(j, -pr[j] - 0.5) for j in range(w0, w1 + 1)], BARRIER["concrete"], 2)
    # Timing lines.
    t = data["timing"]
    lines = [(0, "#ffffff", "S/F")]
    lines += [(s, "#ffd23f", "S%d" % (k + 1)) for k, s in enumerate(t["sectors"][1:], 1)]
    lines += [(t["speedTrap"], "#ff9f1c", "TRAP")]
    for k, z in enumerate(t["drs"], 1):
        lines.append((z["detection"], "#3ad6ff", "D%d det" % k))
        lines.append((z["activation"], "#3dff8a", "D%d act" % k))
    for s, col, label in lines:
        i = s / tr.step
        if not (i0 <= i <= i1 or i0 <= i + tr.n <= i1):
            continue
        a, b = tr.at_s(s, tr.hl[int(i) % tr.n] + 4), tr.at_s(s, -tr.hr[int(i) % tr.n] - 4)
        svg.line([a, b], col, 3 if detail else 2)
        q = tr.at_s(s, tr.hl[int(i) % tr.n] + (12 if detail else 30))
        svg.text(q[0], q[1], label, 12, col)
    # DRS zones as a band on the centreline.
    for z in t["drs"]:
        j0 = int(z["activation"] / tr.step)
        j1 = int(z["end"] / tr.step)
        if j1 < j0:
            j1 += tr.n
        seg = [tr.at(j, 0) for j in range(max(j0, i0), min(j1, i1) + 1)]
        if len(seg) > 1:
            svg.line(seg, "#3dff8a", 2, opacity=0.8)
    # Grid slots.
    for k, g in enumerate(data["grid"]):
        c = tr.at_s(g["s"], g["d"])
        f = tr.at_s(g["s"] + 2.5, g["d"])
        b = tr.at_s(g["s"] - 2.5, g["d"])
        svg.line([b, f], "#ffffff", 4 if detail else 2)
        if detail:
            svg.text(c[0] + 0, c[1], str(k + 1), 10, "#ffd23f")
    # Corner numbers.
    for c in data["corners"]:
        i = c["s"] / tr.step
        if not (i0 <= i <= i1):
            continue
        sgn = -1 if c["direction"] == "left" else 1  # label on the outside
        off = (tr.hl if sgn > 0 else tr.hr)[int(i)] + (28 if detail else 70)
        q = tr.at_s(c["s"], sgn * off)
        svg.circle(q[0], q[1], 13 if detail else 12, "#111412", "#ffd23f")
        svg.text(q[0], q[1] + 0.5 / svg.scale, str(c["number"]), 13 if detail else 12, "#ffd23f")


LEGEND = [
    ("road", ROAD), ("asphalt run-off", KIND_FILL["asphalt"]), ("grass", KIND_FILL["grass"]),
    ("gravel", KIND_FILL["gravel"]), ("kerb", "#d8262e"), ("pit lane", "#4a4e55"),
    ("armco", BARRIER["armco"]), ("concrete", BARRIER["concrete"]), ("tyres", BARRIER["tyres"]),
]


def bounds(pts, margin):
    xs = [p[0] for p in pts]
    zs = [p[1] for p in pts]
    return min(xs) - margin, min(zs) - margin, max(xs) + margin, max(zs) + margin


def profile_svg(tr, title, values, unit, fmt, marks, zero=False, band=None):
    W, H, pad = 1600, 420, 60
    lo, hi = min(values), max(values)
    if zero:
        m = max(abs(lo), abs(hi))
        lo, hi = -m, m
    span = hi - lo or 1
    def X(s):
        return pad + (W - 2 * pad) * s / tr.L
    def Y(v):
        return H - pad - (H - 2 * pad) * (v - lo) / span
    out = ['<svg xmlns="http://www.w3.org/2000/svg" width="%d" height="%d">' % (W, H), '<rect width="100%%" height="100%%" fill="%s"/>' % BG]
    out.append('<text x="%d" y="30" font-family="DejaVu Sans" font-size="18" font-weight="bold" fill="%s">%s</text>' % (pad, TEXT, title))
    for k in range(6):
        v = lo + span * k / 5
        out.append('<line x1="%d" x2="%d" y1="%.1f" y2="%.1f" stroke="#3a423d"/>' % (pad, W - pad, Y(v), Y(v)))
        out.append('<text x="%d" y="%.1f" font-family="DejaVu Sans" font-size="12" fill="#aab3ad" text-anchor="end">%s</text>' % (pad - 6, Y(v) + 4, fmt(v)))
    for s in range(0, int(tr.L) + 1, 500):
        out.append('<line x1="%.1f" x2="%.1f" y1="%d" y2="%d" stroke="#3a423d"/>' % (X(s), X(s), pad, H - pad))
        out.append('<text x="%.1f" y="%d" font-family="DejaVu Sans" font-size="12" fill="#aab3ad" text-anchor="middle">%d</text>' % (X(s), H - pad + 18, s))
    out.append('<text x="%d" y="%d" font-family="DejaVu Sans" font-size="12" fill="#aab3ad" text-anchor="end">s (m)</text>' % (W - pad, H - pad + 36))
    out.append('<text x="%d" y="%d" font-family="DejaVu Sans" font-size="12" fill="#aab3ad">%s</text>' % (pad, pad - 10, unit))
    if band:
        for a, b, col in band:
            out.append('<rect x="%.1f" y="%d" width="%.1f" height="%d" fill="%s"/>' % (X(a), pad, X(b) - X(a), H - 2 * pad, col))
    pts = " ".join("%.1f,%.1f" % (X(i * tr.step), Y(v)) for i, v in enumerate(values))
    out.append('<polyline points="%s" fill="none" stroke="#3ad6ff" stroke-width="1.6"/>' % pts)
    for s, label in marks:
        out.append('<line x1="%.1f" x2="%.1f" y1="%d" y2="%d" stroke="#ffd23f" stroke-dasharray="3 4"/>' % (X(s), X(s), pad, H - pad))
        out.append('<text x="%.1f" y="%d" font-family="DejaVu Sans" font-size="12" font-weight="bold" fill="#ffd23f" text-anchor="middle">%s</text>' % (X(s), pad - 2 + 0, label))
    out.append("</svg>")
    return "\n".join(out)


def write(svg_text, path, keep_svg):
    svg_path = path + ".svg"
    with open(svg_path, "w") as f:
        f.write(svg_text)
    if shutil.which("convert"):
        subprocess.run(["convert", "-density", "96", svg_path, "-depth", "8", "-colors", "256", "+dither", "-strip", "-define", "png:exclude-chunks=date,time", "-define", "png:compression-level=9", "PNG8:" + path + ".png"], check=True)
        if not keep_svg:
            os.remove(svg_path)
        print(os.path.relpath(path + ".png", ROOT))
    else:
        print(os.path.relpath(svg_path, ROOT) + " (install ImageMagick for PNG)")


def main(argv):
    if len(argv) < 2:
        print(__doc__)
        return 2
    cid = argv[1]
    out_dir = argv[argv.index("--out") + 1] if "--out" in argv else os.path.join(ROOT, "docs", "evidence", "m1-track")
    keep_svg = "--svg" in argv
    os.makedirs(out_dir, exist_ok=True)
    with open(os.path.join(ROOT, "packages", "track", "data", cid + ".json")) as f:
        data = json.load(f)
    tr = Track(data)
    name = data["name"]

    # Whole plan.
    x0, z0, x1, z1 = bounds(tr.pts + tr.pit, 120)
    svg = Svg(x0, z0, x1, z1, 0.75, "%s: plan, %.0f m, clockwise from the start/finish line (north up)" % (name, tr.L))
    draw_plan(tr, svg, 0, tr.n, False)
    write(svg.finish(LEGEND), os.path.join(out_dir, cid + "-plan"), keep_svg)

    # Close-ups: corner groups, then the pit lane and grid.
    groups = []
    cs = data["corners"]
    used = set()
    for c in cs:
        if c["number"] in used:
            continue
        grp = [x for x in cs if x["name"] == c["name"]]
        used.update(x["number"] for x in grp)
        groups.append(("T" + "-".join(str(x["number"]) for x in (grp[0], grp[-1])) if len(grp) > 1 else "T%d" % grp[0]["number"], grp[0]["start"] - 120, grp[-1]["end"] + 120))
    groups.append(("pit-entry", data["pit"]["entryS"] - 80, data["pit"]["entryS"] + 260))
    groups.append(("pit-grid", data["pit"]["exitS"] - 380 + tr.L, data["pit"]["exitS"] + 80 + tr.L))
    for label, a, b in groups:
        i0, i1 = int(a / tr.step), int(b / tr.step)
        if i1 < i0:
            i1 += tr.n
        win = [tr.at(j, 0) for j in range(i0, i1 + 1)]
        x0, z0, x1, z1 = bounds(win, 60)
        scale = min(4.0, 1500 / max(x1 - x0, z1 - z0))
        svg = Svg(x0, z0, x1, z1, scale, "%s %s: s %.0f to %.0f m, %.1f px per m" % (name, {"pit-entry": "pit entry", "pit-grid": "grid, pit boxes and pit exit"}.get(label, label.replace("-", " to ")), a % tr.L, b % tr.L, scale))
        draw_plan(tr, svg, i0, i1, True)
        write(svg.finish(LEGEND), os.path.join(out_dir, "%s-%s" % (cid, label.lower())), keep_svg)

    # Profiles.
    y = data["centreline"]["y"]
    datum = data["origin"]["datum"]
    marks = [(c["s"], "T%d" % c["number"]) for c in cs]
    hs = [v + datum for v in y]
    lo, hi = min(hs), max(hs)
    title = "%s: elevation above EGM2008 (filtered Copernicus GLO-30), range %.1f m, low %.1f m at s %.0f, high %.1f m at s %.0f" % (
        name, hi - lo, lo, hs.index(lo) * tr.step, hi, hs.index(hi) * tr.step)
    write(profile_svg(tr, title, hs, "m", lambda v: "%.0f" % v, marks), os.path.join(out_dir, cid + "-elevation"), keep_svg)
    kappa = geom.curvature(tr.pts, True)
    geo_step = data["source"]["smoothedLength"] / tr.n
    found, ks = corner_rule.detect(kappa, geo_step)
    band = [(c[2] * tr.step, c[3] * tr.step, "#3d3a1e") for c in found]
    title = "%s: signed curvature (1/m, left positive), smoothed %.0f m; shaded: %d corners found by the curvature rule" % (name, corner_rule.SMOOTH_SIGMA_M, len(found))
    write(profile_svg(tr, title, ks, "1/m", lambda v: "%.3f" % v, marks, zero=True, band=band), os.path.join(out_dir, cid + "-curvature"), keep_svg)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
