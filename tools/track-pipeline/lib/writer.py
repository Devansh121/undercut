"""Deterministic JSON for the committed track file.

Numbers are rounded per key (millimetres for coordinates), arrays of numbers go on one line, and
key order is the order the builder inserted them, so the same inputs always give the same bytes.
"""
import json
import math

DECIMALS = {
    "x": 3, "y": 3, "z": 3,
    "bank": 5,
    "halfWidthLeft": 3, "halfWidthRight": 3,
    "split": 2, "barrier": 2,
    "scale": 9,
    "lat": 7, "lon": 7,
    "speedLimit": 4,
}
DEFAULT_DECIMALS = 3


def num(v, nd):
    if isinstance(v, bool) or v is None:
        return json.dumps(v)
    if isinstance(v, int):
        return str(v)
    if not math.isfinite(v):
        raise ValueError("non-finite number in track data")
    s = "%.*f" % (nd, v)
    if "." in s:
        s = s.rstrip("0").rstrip(".")
    if s in ("-0", ""):
        s = "0"
    return s


def _scalar(v):
    return v is None or isinstance(v, (bool, int, float, str))


def _enc(v, nd, indent):
    pad = "  " * indent
    if isinstance(v, dict):
        if not v:
            return "{}"
        items = []
        for k, x in v.items():
            items.append("%s  %s: %s" % (pad, json.dumps(k), _enc(x, DECIMALS.get(k, nd), indent + 1)))
        return "{\n" + ",\n".join(items) + "\n" + pad + "}"
    if isinstance(v, (list, tuple)):
        if all(_scalar(x) for x in v):
            return "[" + ",".join(_enc(x, nd, indent) for x in v) + "]"
        if all(isinstance(x, (list, tuple)) and all(_scalar(y) for y in x) for x in v):
            return "[" + ",".join(_enc(x, nd, indent) for x in v) + "]"
        return "[\n" + ",\n".join(pad + "  " + _enc(x, nd, indent + 1) for x in v) + "\n" + pad + "]"
    if isinstance(v, str):
        return json.dumps(v, ensure_ascii=False)
    return num(v, nd)


def dumps(data):
    return _enc(data, DEFAULT_DECIMALS, 0) + "\n"
