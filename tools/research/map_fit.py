#!/usr/bin/env python3
"""Fit a circuit map's drawn track to a committed centreline and read marks off it.

Standard library only. Measures positions a map draws but does not give as distances, such as
the timing (control) line. Used for docs/track-data.md section 5.2; the maps are not committed.

Usage:
  pdftocairo -svg -f <page> -l <page> map.pdf map.svg
  python3 tools/research/map_fit.py <track.json> <map.svg> <track-fill> [--rotate DEG] \\
      [--mark NAME:X:Y ...]

  <track-fill>  the fill colour of the drawn track, as written in the SVG style (for example
                "85.899353%"); every vertex of every path with that fill is a track point.
  --rotate DEG  first guess of the map's rotation (default: try every 10 degrees).
  --mark NAME:X:Y  a mark's position in page points (for example the centroid of a tick's dark
                pixels in a 400 dpi render, times 72 / 400); the script reports the s it
                projects to and how far off the centreline it is.

The fit is a similarity transform (scale, rotation, shift) from the centreline to the map,
found by iterating closest points (each centreline sample to its nearest track point, the worst
10 % dropped) and a least-squares update. It reports the scale, the rotation, and the median and
90th-percentile miss in metres.
"""
import json
import math
import re
import sys
import xml.etree.ElementTree as ET

NS = "{http://www.w3.org/2000/svg}"
XL = "{http://www.w3.org/1999/xlink}"


def _mul(A, B):
    a, b, c, d, e, f = A
    g, h, i, j, k, l = B
    return (a * g + c * h, b * g + d * h, a * i + c * j, b * i + d * j, a * k + c * l + e, b * k + d * l + f)


def _mat(t):
    out = (1, 0, 0, 1, 0, 0)
    for kind, args in re.findall(r"(matrix|translate|scale)\(([^)]*)\)", t or ""):
        v = [float(x) for x in re.split(r"[ ,]+", args.strip())]
        if kind == "matrix":
            m = tuple(v)
        elif kind == "translate":
            m = (1, 0, 0, 1, v[0], v[1] if len(v) > 1 else 0)
        else:
            m = (v[0], 0, 0, v[1] if len(v) > 1 else v[0], 0, 0)
        out = _mul(out, m)
    return out


def _points(d):
    toks = re.findall(r"[MLCZmlcz]|-?[\d.]+(?:e-?\d+)?", d)
    out, cmd, i = [], None, 0
    while i < len(toks):
        if toks[i] in "MLCZmlcz":
            cmd = toks[i]
            i += 1
        if cmd in "Zz":
            continue
        n = 2 if cmd in "MLml" else 6
        vals = [float(x) for x in toks[i:i + n]]
        i += n
        if len(vals) < n:
            break
        out.append((vals[-2], vals[-1]))
    return out


def paths(svg):
    """[(style, [(x, y) in page points])] for every path, transforms applied."""
    root = ET.parse(svg).getroot()
    acc = []

    def walk(el, M):
        M = _mul(M, _mat(el.get("transform")))
        if el.tag == NS + "path":
            acc.append((el.get("style", ""), [(M[0] * x + M[2] * y + M[4], M[1] * x + M[3] * y + M[5]) for x, y in _points(el.get("d", ""))]))
        for ch in el:
            if ch.tag != NS + "defs":
                walk(ch, M)

    walk(root, (1, 0, 0, 1, 0, 0))
    return acc


class Grid:
    def __init__(self, pts, cell):
        self.cell = cell
        self.g = {}
        for p in pts:
            self.g.setdefault((int(p[0] // cell), int(p[1] // cell)), []).append(p)

    def nearest(self, q):
        cx, cy = int(q[0] // self.cell), int(q[1] // self.cell)
        best = None
        for r in range(0, 400):
            for i in range(cx - r, cx + r + 1):
                for j in range(cy - r, cy + r + 1):
                    if max(abs(i - cx), abs(j - cy)) != r:
                        continue
                    for p in self.g.get((i, j), ()):
                        d = (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2
                        if best is None or d < best[0]:
                            best = (d, p)
            if best is not None and math.sqrt(best[0]) < r * self.cell:
                break
        return best


def similarity(src, dst):
    """Least-squares a, b, tx, ty with dst = [[a, -b], [b, a]] src + t."""
    n = len(src)
    mx = sum(p[0] for p in src) / n
    my = sum(p[1] for p in src) / n
    ux = sum(q[0] for q in dst) / n
    uy = sum(q[1] for q in dst) / n
    sxx = sum((p[0] - mx) ** 2 + (p[1] - my) ** 2 for p in src)
    a = sum((p[0] - mx) * (q[0] - ux) + (p[1] - my) * (q[1] - uy) for p, q in zip(src, dst)) / sxx
    b = sum((p[0] - mx) * (q[1] - uy) - (p[1] - my) * (q[0] - ux) for p, q in zip(src, dst)) / sxx
    return a, b, ux - (a * mx - b * my), uy - (b * mx + a * my)


def apply(t, p):
    a, b, tx, ty = t
    return (a * p[0] - b * p[1] + tx, b * p[0] + a * p[1] + ty)


def fit(C, track, rot0):
    grid = Grid(track, 4.0)
    xs = [p[0] for p in track]
    ys = [p[1] for p in track]
    cx = sum(p[0] for p in C) / len(C)
    cz = sum(p[1] for p in C) / len(C)
    span_m = max(max(p[0] for p in C) - min(p[0] for p in C), max(p[1] for p in C) - min(p[1] for p in C))
    span_pt = max(max(xs) - min(xs), max(ys) - min(ys))
    k0 = span_pt / span_m
    best = None
    for rot in ([rot0] if rot0 is not None else range(0, 360, 10)):
        th = math.radians(rot)
        a, b = k0 * math.cos(th), k0 * math.sin(th)
        t = (a, b, (min(xs) + max(xs)) / 2 - (a * cx - b * cz), (min(ys) + max(ys)) / 2 - (b * cx + a * cz))
        for _ in range(40):
            pairs = []
            for p in C[::3]:
                q = apply(t, p)
                d2, m = grid.nearest(q)
                pairs.append((d2, p, m))
            pairs.sort(key=lambda x: x[0])
            keep = pairs[: int(0.9 * len(pairs))]
            t = similarity([x[1] for x in keep], [x[2] for x in keep])
        k = math.hypot(t[0], t[1])
        miss = sorted(math.sqrt(x[0]) / k for x in pairs)
        med = miss[len(miss) // 2]
        if best is None or med < best[1]:
            best = (t, med, miss[int(0.9 * len(miss))])
    return best


def project(C, step, q):
    best = None
    n = len(C)
    for i in range(n):
        A, B = C[i], C[(i + 1) % n]
        dx, dy = B[0] - A[0], B[1] - A[1]
        L2 = dx * dx + dy * dy
        u = max(0.0, min(1.0, ((q[0] - A[0]) * dx + (q[1] - A[1]) * dy) / L2))
        e = math.hypot(q[0] - A[0] - u * dx, q[1] - A[1] - u * dy)
        if best is None or e < best[0]:
            best = (e, (i + u) * step)
    return best[1], best[0]


def main(argv):
    if len(argv) < 4:
        print(__doc__)
        return 2
    data = json.load(open(argv[1]))
    c = data["centreline"]
    C = list(zip(c["x"], c["z"]))
    step = data["length"] / data["sampleCount"]
    acc = paths(argv[2])
    track = [p for st, P in acc if ("fill:rgb(%s" % argv[3]) in st for p in P]
    rot = float(argv[argv.index("--rotate") + 1]) if "--rotate" in argv else None
    t, med, p90 = fit(C, track, rot)
    k = math.hypot(t[0], t[1])
    print("fit: %.4f pt per m, rotation %.2f deg, median miss %.1f m, p90 %.1f m (%d track points)" % (
        k, math.degrees(math.atan2(t[1], t[0])), med, p90, len(track)))
    # Inverse transform: map point to world.
    a, b, tx, ty = t
    det = a * a + b * b

    def inv(q):
        x, y = q[0] - tx, q[1] - ty
        return ((a * x + b * y) / det, (-b * x + a * y) / det)

    for i, arg in enumerate(argv):
        if arg != "--mark":
            continue
        name, x, y = argv[i + 1].split(":")
        s, off = project(C, step, inv((float(x), float(y))))
        print("%s: (%s, %s) pt -> s %.1f m, %.1f m off the centreline" % (name, x, y, s, off))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
