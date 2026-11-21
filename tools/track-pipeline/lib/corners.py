"""Corner detection from curvature peaks. packages/track/validation repeats this rule in TypeScript."""
import math

from . import geom

# Parameters of the rule (kept equal to CORNER_RULE in packages/track/src/corners.ts). A circuit
# may override any of them in its `cornerRule` table; the track file records the values used.
DEFAULT_RULE = {
    "smoothSigma": 8.0,  # Gaussian smoothing of curvature before detection, metres
    "enter": 1 / 400.0,  # a corner starts above this |curvature| (1/m) ...
    "exit": 1 / 800.0,  # ... and ends below this one
    "mergeGap": 150.0,  # same-direction stretches closer than this merge into one corner, metres
    "minTurn": 20.0,  # stretches turning less than this are kinks, not corners, degrees
}
SMOOTH_SIGMA_M = DEFAULT_RULE["smoothSigma"]


def rule_for(cfg):
    """The circuit's rule: the defaults with its `cornerRule` overrides."""
    over = cfg.get("cornerRule", {})
    unknown = set(over) - set(DEFAULT_RULE) - {"note"}
    if unknown:
        raise SystemExit("unknown cornerRule keys: %s" % ", ".join(sorted(unknown)))
    rule = dict(DEFAULT_RULE)
    rule.update({k: float(v) for k, v in over.items() if k != "note"})
    return rule


def detect(kappa, step, rule=None):
    """Returns ([(apex_index, sign, first_index, last_index, turn_deg)] in lap order, smoothed curvature)."""
    r = rule or DEFAULT_RULE
    n = len(kappa)
    ks = geom.smooth_closed(kappa, r["smoothSigma"] / step)
    # Start the scan at the quietest sample so no region straddles the scan start.
    start = min(range(n), key=lambda i: abs(ks[i]))
    regions = []
    cur = None
    for j in range(n + 1):
        i = (start + j) % n
        k = ks[i]
        if cur is not None:
            if abs(k) < r["exit"] or (k > 0) != (cur[2] > 0) or j == n:
                regions.append(cur)
                cur = None
            else:
                cur[1] = j
        if cur is None and j < n and abs(k) > r["enter"]:
            cur = [j, j, 1 if k > 0 else -1]
    merged = []
    for reg in regions:
        if merged and merged[-1][2] == reg[2] and (reg[0] - merged[-1][1]) * step < r["mergeGap"]:
            merged[-1][1] = reg[1]
        else:
            merged.append(list(reg))
    out = []
    for a, b, sign in merged:
        idx = [(start + j) % n for j in range(a, b + 1)]
        turn = math.degrees(abs(sum(kappa[i] for i in idx) * step))
        if turn < r["minTurn"]:
            continue
        apex = max(idx, key=lambda i: abs(ks[i]))
        out.append((apex, sign, idx[0], idx[-1], turn))
    out.sort(key=lambda c: c[0])
    return out, ks
