"""Plane-curve helpers for closed and open polylines in the (x, z) plane."""
import math


def seg_lengths(pts, closed):
    n = len(pts)
    m = n if closed else n - 1
    return [math.dist(pts[i], pts[(i + 1) % n]) for i in range(m)]


def cumulative(pts, closed):
    s = [0.0]
    for L in seg_lengths(pts, closed):
        s.append(s[-1] + L)
    return s  # closed: len n + 1, last entry is the loop length


def densify(pts, closed, step):
    """Inserts points so no segment is longer than `step`; keeps the originals."""
    out = []
    n = len(pts)
    m = n if closed else n - 1
    for i in range(m):
        a, b = pts[i], pts[(i + 1) % n]
        k = max(1, int(math.ceil(math.dist(a, b) / step)))
        for j in range(k):
            t = j / k
            out.append((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t))
    if not closed:
        out.append(pts[-1])
    return out


def point_at(pts, s_cum, closed, s):
    """Point at arc length s on a polyline with cumulative lengths s_cum (wraps when closed)."""
    n = len(pts)
    total = s_cum[-1]
    if closed:
        s %= total
    else:
        s = max(0.0, min(total, s))
    lo, hi = 0, len(s_cum) - 1
    while hi - lo > 1:
        mid = (lo + hi) // 2
        if s_cum[mid] <= s:
            lo = mid
        else:
            hi = mid
    a, b = pts[lo % n], pts[(lo + 1) % n]
    L = s_cum[lo + 1] - s_cum[lo]
    t = 0.0 if L == 0 else (s - s_cum[lo]) / L
    return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)


def fillet(pts, closed, radius, step, min_turn_deg=10.0):
    """Rounds sharp vertices of a closed polyline with circular arcs of `radius`.

    Road centrelines meet at junction vertices that no smoothing of reasonable width turns into a
    drivable radius. Each vertex turning more than `min_turn_deg` is replaced by an arc tangent to
    the two legs through the points a tangent length radius * tan(turn / 2) before and after it
    along the polyline, so short segments next to the vertex do not limit the arc. The tangent
    length is capped at half the distance to the neighbouring sharp vertex, so arcs never overlap;
    where the cap bites the arc is tighter. Arcs are sampled every `step` metres or closer."""
    assert closed
    n = len(pts)
    s = cumulative(pts, True)
    total = s[-1]
    turns = []
    for i in range(n):
        a, b, c = pts[(i - 1) % n], pts[i], pts[(i + 1) % n]
        h0 = math.atan2(b[1] - a[1], b[0] - a[0])
        h1 = math.atan2(c[1] - b[1], c[0] - b[0])
        turns.append(_wrapdiff(h1, h0))
    sharp = [i for i in range(n) if abs(turns[i]) > math.radians(min_turn_deg)]
    if not sharp:
        return list(pts)
    arcs = []
    for k, i in enumerate(sharp):
        prev_s = s[sharp[k - 1]] if k > 0 else s[sharp[-1]] - total
        next_s = s[sharp[k + 1]] if k + 1 < len(sharp) else s[sharp[0]] + total
        if len(sharp) == 1:
            prev_s, next_s = s[i] - total / 2, s[i] + total / 2
        th = abs(turns[i])
        t = min(radius * math.tan(th / 2), 0.5 * (s[i] - prev_s), 0.5 * (next_s - s[i]))
        b = pts[i]
        p0 = point_at(pts, s, True, s[i] - t)
        p2 = point_at(pts, s, True, s[i] + t)
        l0, l1 = math.dist(p0, b), math.dist(b, p2)
        if l0 < 1e-6 or l1 < 1e-6:
            continue
        u0 = ((b[0] - p0[0]) / l0, (b[1] - p0[1]) / l0)
        u1 = ((p2[0] - b[0]) / l1, (p2[1] - b[1]) / l1)
        turn = math.atan2(u0[0] * u1[1] - u0[1] * u1[0], u0[0] * u1[0] + u0[1] * u1[1])
        tl = min(l0, l1)
        if abs(turn) < 1e-9:
            continue
        r = tl / math.tan(abs(turn) / 2)
        q0 = (b[0] - u0[0] * tl, b[1] - u0[1] * tl)
        sgn = 1 if turn > 0 else -1
        cx, cz = q0[0] - u0[1] * sgn * r, q0[1] + u0[0] * sgn * r
        m = max(1, int(math.ceil(r * abs(turn) / step)))
        a0 = math.atan2(q0[1] - cz, q0[0] - cx)
        arc = [(cx + r * math.cos(a0 + turn * j / m), cz + r * math.sin(a0 + turn * j / m)) for j in range(m + 1)]
        arcs.append((s[i] - t, s[i] + t, [p0] + arc + [p2]))
    # Rebuild: polyline vertices outside every arc's span, arcs in their place.
    out = []
    spans = sorted(arcs, key=lambda x: x[0])

    def inside(v):
        for a0, a1, _ in spans:
            for off in (-total, 0.0, total):
                if a0 + off <= v <= a1 + off:
                    return True
        return False

    events = [(s[i], "v", pts[i]) for i in range(n) if not inside(s[i])]
    events += [((a0 % total), "a", arc) for a0, a1, arc in spans]
    events.sort(key=lambda e: e[0])
    for _, kind, item in events:
        if kind == "v":
            out.append(item)
        else:
            out.extend(item)
    # Drop consecutive duplicates.
    clean = [out[0]]
    for p in out[1:]:
        if math.dist(p, clean[-1]) > 1e-6:
            clean.append(p)
    if math.dist(clean[0], clean[-1]) < 1e-6:
        clean.pop()
    return clean


def resample(pts, closed, count, offset=0.0):
    """`count` points evenly spaced by arc length. Closed loops start at arc `offset`."""
    s = cumulative(pts, closed)
    total = s[-1]
    n = len(pts)
    step = total / count if closed else total / (count - 1)
    out = []
    k = 0
    for i in range(count):
        target = (offset + i * step) % total if closed else min(i * step, total)
        if closed and target < s[k]:
            k = 0
        while k < len(s) - 2 and s[k + 1] < target:
            k += 1
        a, b = pts[k], pts[(k + 1) % n]
        L = s[k + 1] - s[k]
        t = 0.0 if L == 0 else (target - s[k]) / L
        out.append((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t))
    return out


def gaussian_kernel(sigma_samples):
    half = int(math.ceil(3 * sigma_samples))
    w = [math.exp(-0.5 * (k / sigma_samples) ** 2) for k in range(-half, half + 1)]
    tot = sum(w)
    return [v / tot for v in w], half


def smooth_closed(values, sigma_samples):
    """Periodic Gaussian smoothing of a list of floats."""
    if sigma_samples <= 0:
        return list(values)
    w, half = gaussian_kernel(sigma_samples)
    n = len(values)
    return [sum(w[k + half] * values[(i + k) % n] for k in range(-half, half + 1)) for i in range(n)]


def smooth_open(values, sigma_samples):
    """Gaussian smoothing that keeps both end values fixed (reflected about the ends)."""
    if sigma_samples <= 0:
        return list(values)
    w, half = gaussian_kernel(sigma_samples)
    n = len(values)
    a, b = values[0], values[-1]

    def at(j):
        if j < 0:
            return 2 * a - values[-j]
        if j >= n:
            return 2 * b - values[2 * n - 2 - j]
        return values[j]

    return [sum(w[k + half] * at(i + k) for k in range(-half, half + 1)) for i in range(n)]


def smooth_points(pts, closed, sigma_samples):
    f = smooth_closed if closed else smooth_open
    xs = f([p[0] for p in pts], sigma_samples)
    zs = f([p[1] for p in pts], sigma_samples)
    return list(zip(xs, zs))


def headings(pts, closed):
    """Tangent angle atan2(dz, dx) at each point from central differences."""
    n = len(pts)
    out = []
    for i in range(n):
        if closed:
            a, b = pts[(i - 1) % n], pts[(i + 1) % n]
        else:
            a, b = pts[max(i - 1, 0)], pts[min(i + 1, n - 1)]
        out.append(math.atan2(b[1] - a[1], b[0] - a[0]))
    return out


def unwrap(angles):
    out = [angles[0]]
    for a in angles[1:]:
        d = a - out[-1]
        d = (d + math.pi) % (2 * math.pi) - math.pi
        out.append(out[-1] + d)
    return out


def curvature(pts, closed):
    """Signed curvature (1/m), positive turning left (toward +d).

    Heading is measured in the (x, z) plane with z south, so a left turn (anticlockwise seen
    from above, +Y) decreases atan2(dz, dx); curvature is the negative heading rate."""
    n = len(pts)
    h = unwrap(headings(pts, closed))
    s = cumulative(pts, closed)
    out = []
    for i in range(n):
        if closed:
            i0, i1 = (i - 1) % n, (i + 1) % n
            dh = h[i1] - h[i0] if 0 < i < n - 1 else _wrapdiff(h[i1], h[i0])
            ds = (s[i1] if i1 > i0 else s[i1] + s[-1]) - s[i0]
        else:
            i0, i1 = max(i - 1, 0), min(i + 1, n - 1)
            dh = h[i1] - h[i0]
            ds = s[i1] - s[i0]
        out.append(-dh / ds if ds > 0 else 0.0)
    return out


def _wrapdiff(a, b):
    return (a - b + math.pi) % (2 * math.pi) - math.pi


def signed_area(pts):
    """Shoelace area in (x, z). With z pointing south, a positive value is clockwise seen from above."""
    a = 0.0
    n = len(pts)
    for i in range(n):
        x1, z1 = pts[i]
        x2, z2 = pts[(i + 1) % n]
        a += x1 * z2 - x2 * z1
    return a / 2


def point_in_polygon(x, z, poly):
    inside = False
    n = len(poly)
    j = n - 1
    for i in range(n):
        xi, zi = poly[i]
        xj, zj = poly[j]
        if (zi > z) != (zj > z) and x < (xj - xi) * (z - zi) / (zj - zi) + xi:
            inside = not inside
        j = i
    return inside


def project_closed(p, pts, s, hint=None, window=None):
    """Nearest point on a closed polyline. Returns (s, signed lateral offset, index).

    `s` is cumulative() of the polyline; positive offset is to the left of travel."""
    n = len(pts)
    idx = range(n) if hint is None else [(hint + k) % n for k in range(-window, window + 1)]
    best = None
    for i in idx:
        a, b = pts[i], pts[(i + 1) % n]
        ex, ez = b[0] - a[0], b[1] - a[1]
        L2 = ex * ex + ez * ez
        t = 0.0 if L2 == 0 else max(0.0, min(1.0, ((p[0] - a[0]) * ex + (p[1] - a[1]) * ez) / L2))
        qx, qz = a[0] + ex * t, a[1] + ez * t
        d2 = (p[0] - qx) ** 2 + (p[1] - qz) ** 2
        if best is None or d2 < best[0]:
            L = math.sqrt(L2) or 1.0
            # Left normal of direction (ex, ez) in a +Y-up, +Z-south frame is (ez, -ex).
            side = ((p[0] - qx) * ez - (p[1] - qz) * ex) / L
            best = (d2, s[i] + t * (s[i + 1] - s[i]), math.copysign(math.sqrt(d2), side), i)
    return best[1], best[2], best[3]
