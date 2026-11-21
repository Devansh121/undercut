"""Corner detection from curvature peaks. packages/track/validation repeats this rule in TypeScript."""
import math

from . import geom

# Parameters of the rule (kept equal to CORNER_RULE in packages/track/src/corners.ts).
SMOOTH_SIGMA_M = 8.0
ENTER_CURVATURE = 1 / 400.0
EXIT_CURVATURE = 1 / 800.0
MERGE_GAP_M = 150.0
MIN_TURN_DEG = 20.0


def detect(kappa, step):
    """Returns [(apex_index, sign, first_index, last_index, turn_deg)] in lap order."""
    n = len(kappa)
    ks = geom.smooth_closed(kappa, SMOOTH_SIGMA_M / step)
    # Start the scan at the quietest sample so no region straddles the scan start.
    start = min(range(n), key=lambda i: abs(ks[i]))
    regions = []
    cur = None
    for j in range(n + 1):
        i = (start + j) % n
        k = ks[i]
        if cur is not None:
            if abs(k) < EXIT_CURVATURE or (k > 0) != (cur[2] > 0) or j == n:
                regions.append(cur)
                cur = None
            else:
                cur[1] = j
        if cur is None and j < n and abs(k) > ENTER_CURVATURE:
            cur = [j, j, 1 if k > 0 else -1]
    merged = []
    for r in regions:
        if merged and merged[-1][2] == r[2] and (r[0] - merged[-1][1]) * step < MERGE_GAP_M:
            merged[-1][1] = r[1]
        else:
            merged.append(list(r))
    out = []
    for a, b, sign in merged:
        idx = [(start + j) % n for j in range(a, b + 1)]
        turn = math.degrees(abs(sum(kappa[i] for i in idx) * step))
        if turn < MIN_TURN_DEG:
            continue
        apex = max(idx, key=lambda i: abs(ks[i]))
        out.append((apex, sign, idx[0], idx[-1], turn))
    out.sort(key=lambda c: c[0])
    return out, ks
