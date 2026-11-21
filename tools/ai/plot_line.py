#!/usr/bin/env python3
"""The racing line over the track plan, coloured by the target speed, for looking at it.

Usage:
  python3 tools/ai/plot_line.py <circuit> [--trim low] [--out DIR] [--svg]
  npm run ai:plot -- <circuit>

Reads packages/track/data/<circuit>.json and packages/ai/data/<circuit>-<trim>.line.json and
writes PNG images to docs/evidence/m1-ai/: the whole plan, close-ups of the corner groups, and
the speed profile along the lap (with the driven lap from artifacts/telemetry/lap-<circuit>.csv
when `npm run telemetry -- lap` has written it). Reuses the track plot's drawing code, so the
plan looks the same as docs/evidence/m1-track.
"""
import csv
import json
import os
import sys

sys.dont_write_bytecode = True

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "tools", "track-pipeline"))

import plot  # noqa: E402

# Sequential speed scale, slow to fast: deep blue, teal, yellow, orange, red.
STOPS = [(0.0, (40, 70, 200)), (0.3, (40, 170, 190)), (0.55, (240, 220, 60)), (0.8, (250, 140, 40)), (1.0, (220, 40, 40))]
V_LO, V_HI = 60.0, 350.0  # km/h


def colour(v_kmh):
    t = min(1.0, max(0.0, (v_kmh - V_LO) / (V_HI - V_LO)))
    for (a, ca), (b, cb) in zip(STOPS, STOPS[1:]):
        if t <= b:
            f = (t - a) / (b - a)
            c = tuple(int(round(ca[k] + (cb[k] - ca[k]) * f)) for k in range(3))
            return "#%02x%02x%02x" % c
    return "#%02x%02x%02x" % STOPS[-1][1]


def draw_line(tr, svg, offsets, speeds, i0, i1, width):
    """The line as short polylines, one colour per 10 km/h band."""
    run = []
    cur = None
    for j in range(i0, i1 + 2):
        k = j % tr.n
        col = colour(round(speeds[k] / 10) * 10) if j <= i1 else None
        pt = tr.at(k, offsets[k])
        if col != cur:
            if len(run) > 1:
                svg.line(run, cur, width)
            run = run[-1:]
            cur = col
        if j <= i1:
            run.append(pt)
    if len(run) > 1 and cur:
        svg.line(run, cur, width)


def speed_legend(svg_text, title_extra=""):
    """Add a speed colour bar under the header."""
    parts = []
    x = 12
    for v in range(60, 360, 30):
        parts.append('<rect x="%d" y="38" width="30" height="14" fill="%s"/>' % (x, colour(v)))
        parts.append('<text x="%d" y="64" font-family="DejaVu Sans" font-size="11" fill="#f4f4f0">%d</text>' % (x, v))
        x += 30
    parts.append('<text x="%d" y="50" font-family="DejaVu Sans" font-size="13" fill="#f4f4f0">km/h target speed%s</text>' % (x + 10, title_extra))
    return svg_text.replace("</svg>", "\n".join(parts) + "\n</svg>")


def driven_lap(cid):
    path = os.path.join(ROOT, "artifacts", "telemetry", "lap-%s.csv" % cid)
    if not os.path.exists(path):
        return None
    pts = []
    with open(path) as f:
        for row in csv.DictReader(f):
            if row["lap"] == "0":
                pts.append((float(row["s"]), float(row["speed_kmh"])))
    return pts or None


def speed_svg(tr, title, plan_kmh, driven, marks):
    W, H, pad = 1600, 460, 60
    lo, hi = 0.0, 360.0

    def X(s):
        return pad + (W - 2 * pad) * s / tr.L

    def Y(v):
        return H - pad - (H - 2 * pad) * (v - lo) / (hi - lo)

    out = ['<svg xmlns="http://www.w3.org/2000/svg" width="%d" height="%d">' % (W, H), '<rect width="100%%" height="100%%" fill="%s"/>' % plot.BG]
    out.append('<text x="%d" y="30" font-family="DejaVu Sans" font-size="18" font-weight="bold" fill="%s">%s</text>' % (pad, plot.TEXT, title))
    for v in range(0, 361, 60):
        out.append('<line x1="%d" x2="%d" y1="%.1f" y2="%.1f" stroke="#3a423d"/>' % (pad, W - pad, Y(v), Y(v)))
        out.append('<text x="%d" y="%.1f" font-family="DejaVu Sans" font-size="12" fill="#aab3ad" text-anchor="end">%d</text>' % (pad - 6, Y(v) + 4, v))
    for s in range(0, int(tr.L) + 1, 500):
        out.append('<line x1="%.1f" x2="%.1f" y1="%d" y2="%d" stroke="#3a423d"/>' % (X(s), X(s), pad, H - pad))
        out.append('<text x="%.1f" y="%d" font-family="DejaVu Sans" font-size="12" fill="#aab3ad" text-anchor="middle">%d</text>' % (X(s), H - pad + 18, s))
    out.append('<text x="%d" y="%d" font-family="DejaVu Sans" font-size="12" fill="#aab3ad" text-anchor="end">s (m)</text>' % (W - pad, H - pad + 36))
    out.append('<text x="%d" y="%d" font-family="DejaVu Sans" font-size="12" fill="#aab3ad">km/h</text>' % (pad, pad - 10))
    pts = " ".join("%.1f,%.1f" % (X(i * tr.step), Y(v)) for i, v in enumerate(plan_kmh))
    out.append('<polyline points="%s" fill="none" stroke="#3ad6ff" stroke-width="1.6"/>' % pts)
    legend = [("planned (speed profile)", "#3ad6ff")]
    if driven:
        pts = " ".join("%.1f,%.1f" % (X(s), Y(v)) for s, v in driven)
        out.append('<polyline points="%s" fill="none" stroke="#ff9f1c" stroke-width="1.2"/>' % pts)
        legend.append(("driven by the reference driver", "#ff9f1c"))
    # Legend in the empty band near 0 km/h.
    x = pad + 20
    y = H - pad - 16
    for label, col in legend:
        out.append('<rect x="%d" y="%d" width="14" height="4" fill="%s"/>' % (x, y - 6, col))
        out.append('<text x="%d" y="%d" font-family="DejaVu Sans" font-size="13" fill="%s">%s</text>' % (x + 20, y, plot.TEXT, label))
        x += 270
    for s, label in marks:
        out.append('<line x1="%.1f" x2="%.1f" y1="%d" y2="%d" stroke="#ffd23f" stroke-dasharray="3 4"/>' % (X(s), X(s), pad, H - pad))
        out.append('<text x="%.1f" y="%d" font-family="DejaVu Sans" font-size="12" font-weight="bold" fill="#ffd23f" text-anchor="middle">%s</text>' % (X(s), pad - 2, label))
    out.append("</svg>")
    return "\n".join(out)


def main(argv):
    if len(argv) < 2:
        print(__doc__)
        return 2
    cid = argv[1]
    trim = argv[argv.index("--trim") + 1] if "--trim" in argv else "low"
    out_dir = argv[argv.index("--out") + 1] if "--out" in argv else os.path.join(ROOT, "docs", "evidence", "m1-ai")
    keep_svg = "--svg" in argv
    os.makedirs(out_dir, exist_ok=True)
    with open(os.path.join(ROOT, "packages", "track", "data", cid + ".json")) as f:
        data = json.load(f)
    with open(os.path.join(ROOT, "packages", "ai", "data", "%s-%s.line.json" % (cid, trim))) as f:
        line = json.load(f)
    tr = plot.Track(data)
    if line["count"] != tr.n:
        raise SystemExit("line has %d samples, track %d" % (line["count"], tr.n))
    offsets = [u / 1e4 for u in line["offsetTenthMm"]]
    speeds = [c / 100 * 3.6 for c in line["speedCms"]]
    name = data["name"]
    lap = line["lapTime"]

    x0, z0, x1, z1 = plot.bounds(tr.pts + tr.pit, 120)
    svg = plot.Svg(x0, z0, x1, z1, 0.75, "%s, %s trim: racing line coloured by target speed; planned lap %.3f s" % (name, trim, lap))
    plot.draw_plan(tr, svg, 0, tr.n, False)
    draw_line(tr, svg, offsets, speeds, 0, tr.n, 3)
    plot.write(speed_legend(svg.finish([])), os.path.join(out_dir, "%s-%s-line" % (cid, trim)), keep_svg)

    cs = data["corners"]
    used = set()
    for c in cs:
        if c["number"] in used:
            continue
        grp = [x for x in cs if x["name"] == c["name"]]
        if c["name"].startswith("Lesmo"):
            grp = [x for x in cs if x["name"].startswith("Lesmo")]
        used.update(x["number"] for x in grp)
        label = "T%d" % grp[0]["number"] if len(grp) == 1 else "T%d-%d" % (grp[0]["number"], grp[-1]["number"])
        a, b = grp[0]["start"] - 150, grp[-1]["end"] + 150
        i0, i1 = int(a / tr.step), int(b / tr.step)
        win = [tr.at(j, 0) for j in range(i0, i1 + 1)]
        bx0, bz0, bx1, bz1 = plot.bounds(win, 60)
        scale = min(4.0, 1500 / max(bx1 - bx0, bz1 - bz0))
        lo = min(speeds[j % tr.n] for j in range(i0, i1 + 1))
        svg = plot.Svg(bx0, bz0, bx1, bz1, scale, "%s %s: racing line, minimum target speed %.0f km/h" % (name, label.replace("-", " to "), lo))
        plot.draw_plan(tr, svg, i0, i1, True)
        draw_line(tr, svg, offsets, speeds, i0, i1, 4)
        plot.write(speed_legend(svg.finish([])), os.path.join(out_dir, "%s-%s-line-%s" % (cid, trim, label.lower())), keep_svg)

    marks = [(c["s"], "T%d" % c["number"]) for c in cs]
    plot.write(speed_svg(tr, "%s, %s trim: target speed along the lap (planned %.3f s)" % (name, trim, lap), speeds, driven_lap(cid), marks), os.path.join(out_dir, "%s-%s-speed" % (cid, trim)), keep_svg)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
