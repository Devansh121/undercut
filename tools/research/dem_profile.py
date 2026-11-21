#!/usr/bin/env python3
"""Sample a Copernicus GLO-30 DEM tile along a circuit centreline.

Standard library only. Reads the tiled, DEFLATE-compressed float32 Cloud
Optimised GeoTIFFs published in the public, no-login AWS bucket
`copernicus-dem-30m` (predictor 1, 2 or 3 are supported), samples the DEM
bilinearly at every centreline point, and prints an elevation summary.

Usage:
  python3 tools/research/dem_profile.py fetch <lat> <lon> [--dir DIR]
      Download the 1x1 degree tile containing (lat, lon) into DIR
      (default ~/.cache/undercut/dem). Tiles are ~30 MB; never commit them.
  python3 tools/research/dem_profile.py profile <centreline.csv> <tile.tif|tile.hgt.gz>
      [--segments segments.csv] [--step M] [--open M] [--out profile.csv]
      Sample along lat,lon,s_m rows from osm_circuit.py, resampled every
      --step metres (default 10). Prints min/max/gain and, if a segments
      file is given, the elevation at the start and end of each named way.
      --open M adds a variant with a 1-D morphological opening of width M
      metres before smoothing, to strip canopy/buildings from a surface model.

DEM attribution (required wherever derived heights are shipped):
  "Produced using Copernicus WorldDEM-30 (c) DLR e.V. 2010-2014 and
   (c) Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS
   by the European Union and ESA; all rights reserved"
"""
import csv
import itertools
import math
import os
import struct
import sys
import urllib.request
import zlib

BUCKET = "https://copernicus-dem-30m.s3.amazonaws.com"


def tile_name(lat, lon):
    ns = "N" if lat >= 0 else "S"
    ew = "E" if lon >= 0 else "W"
    la = int(math.floor(lat))
    lo = int(math.floor(lon))
    return "Copernicus_DSM_COG_10_%s%02d_00_%s%03d_00_DEM" % (ns, abs(la), ew, abs(lo))


def fetch(lat, lon, d):
    os.makedirs(d, exist_ok=True)
    name = tile_name(lat, lon)
    path = os.path.join(d, name + ".tif")
    if not os.path.exists(path):
        url = "%s/%s/%s.tif" % (BUCKET, name, name)
        sys.stderr.write("GET %s\n" % url)
        urllib.request.urlretrieve(url, path + ".part")
        os.replace(path + ".part", path)
    return path


TYPES = {1: ("B", 1), 2: ("c", 1), 3: ("H", 2), 4: ("I", 4), 11: ("f", 4), 12: ("d", 8), 16: ("Q", 8)}


class GeoTiff:
    def __init__(self, path):
        self.f = open(path, "rb")
        head = self.f.read(16)
        self.bo = "<" if head[:2] == b"II" else ">"
        magic = struct.unpack(self.bo + "H", head[2:4])[0]
        if magic != 42:
            raise ValueError("BigTIFF not supported")
        off = struct.unpack(self.bo + "I", head[4:8])[0]
        self.tags = self._ifd(off)
        t = self.tags
        self.w, self.h = t[256][0], t[257][0]
        self.tw, self.th = t[322][0], t[323][0]
        self.offsets, self.counts = t[324], t[325]
        self.compression = t[259][0]
        self.predictor = t.get(317, [1])[0]
        if t[258][0] != 32 or t.get(339, [3])[0] != 3:
            raise ValueError("expected float32 samples")
        sx, sy = t[33550][0], t[33550][1]
        tp = t[33922]
        # Pixel (i, j) has its corner at (tp[3] + (i - tp[0]) * sx, tp[4] - (j - tp[1]) * sy).
        self.x0 = tp[3] - tp[0] * sx
        self.y0 = tp[4] + tp[1] * sy
        self.sx, self.sy = sx, sy
        # GTRasterTypeGeoKey (1025): 1 = PixelIsArea (corner), 2 = PixelIsPoint (centre).
        keys = t.get(34735, [])
        self.pixel_is_point = False
        for k in range(4, len(keys), 4):
            if keys[k] == 1025 and keys[k + 3] == 2:
                self.pixel_is_point = True
        self.nodata = None
        if 42113 in t:
            try:
                self.nodata = float(t[42113].strip("\x00"))
            except ValueError:
                pass
        self.cache = {}

    def _ifd(self, off):
        f, bo = self.f, self.bo
        f.seek(off)
        n = struct.unpack(bo + "H", f.read(2))[0]
        entries = [struct.unpack(bo + "HHII", f.read(12)) for _ in range(n)]
        tags = {}
        for tag, typ, cnt, val in entries:
            code, size = TYPES.get(typ, ("B", 1))
            total = size * cnt
            if total <= 4:
                raw = struct.pack(bo + "I", val)[:total]
            else:
                f.seek(val)
                raw = f.read(total)
            if typ == 2:
                tags[tag] = raw.decode("latin-1")
            else:
                tags[tag] = list(struct.unpack(bo + code * cnt, raw))
        return tags

    def _tile(self, ti, tj):
        key = (ti, tj)
        if key in self.cache:
            return self.cache[key]
        across = (self.w + self.tw - 1) // self.tw
        idx = tj * across + ti
        self.f.seek(self.offsets[idx])
        raw = self.f.read(self.counts[idx])
        if self.compression == 8 or self.compression == 32946:
            raw = zlib.decompress(raw)
        elif self.compression != 1:
            raise ValueError("compression %d not supported" % self.compression)
        tw, th = self.tw, self.th
        vals = []
        if self.predictor == 3:
            rowbytes = tw * 4
            for r in range(th):
                row = raw[r * rowbytes:(r + 1) * rowbytes]
                row = bytes(itertools.accumulate(row, lambda a, b: (a + b) & 255))
                # Byte planes are stored most significant first.
                planes = [row[p * tw:(p + 1) * tw] for p in range(4)]
                inter = bytes(b for quad in zip(*planes) for b in quad)
                vals.append(struct.unpack(">%df" % tw, inter))
        else:
            fmt = self.bo + "%df" % tw
            for r in range(th):
                vals.append(struct.unpack(fmt, raw[r * tw * 4:(r + 1) * tw * 4]))
            if self.predictor == 2:
                raise ValueError("predictor 2 on float data not expected")
        self.cache[key] = vals
        return vals

    def pixel(self, i, j):
        i = min(max(i, 0), self.w - 1)
        j = min(max(j, 0), self.h - 1)
        t = self._tile(i // self.tw, j // self.th)
        return t[j % self.th][i % self.tw]

    def sample(self, lat, lon):
        """Bilinear sample at (lat, lon), treating values as pixel centres."""
        fx = (lon - self.x0) / self.sx
        fy = (self.y0 - lat) / self.sy
        if not self.pixel_is_point:
            fx -= 0.5
            fy -= 0.5
        i, j = int(math.floor(fx)), int(math.floor(fy))
        ax, ay = fx - i, fy - j
        z00, z10 = self.pixel(i, j), self.pixel(i + 1, j)
        z01, z11 = self.pixel(i, j + 1), self.pixel(i + 1, j + 1)
        return (z00 * (1 - ax) + z10 * ax) * (1 - ay) + (z01 * (1 - ax) + z11 * ax) * ay


class Hgt:
    """SRTM-style .hgt or .hgt.gz tile: square grid of big-endian int16,
    rows north to south, pixel centres on whole arc-second positions
    (e.g. the AWS Terrain Tiles `skadi` set, 3601 x 3601 at 1 arcsec)."""

    def __init__(self, path):
        import gzip
        raw = gzip.open(path).read() if path.endswith(".gz") else open(path, "rb").read()
        n = int(round(math.sqrt(len(raw) // 2)))
        self.n = n
        self.z = struct.unpack(">%dh" % (n * n), raw)
        base = os.path.basename(path)
        lat = int(base[1:3]) * (1 if base[0] == "N" else -1)
        lon = int(base[4:7]) * (1 if base[3] == "E" else -1)
        self.lat0, self.lon0 = lat + 1, lon  # north-west pixel centre
        self.d = 1.0 / (n - 1)
        self.w = self.h = n
        self.sx = self.sy = self.d
        self.predictor = 0

    def pixel(self, i, j):
        i = min(max(i, 0), self.n - 1)
        j = min(max(j, 0), self.n - 1)
        return float(self.z[j * self.n + i])

    def sample(self, lat, lon):
        fx = (lon - self.lon0) / self.d
        fy = (self.lat0 - lat) / self.d
        i, j = int(math.floor(fx)), int(math.floor(fy))
        ax, ay = fx - i, fy - j
        z00, z10 = self.pixel(i, j), self.pixel(i + 1, j)
        z01, z11 = self.pixel(i, j + 1), self.pixel(i + 1, j + 1)
        return (z00 * (1 - ax) + z10 * ax) * (1 - ay) + (z01 * (1 - ax) + z11 * ax) * ay


def resample(rows, step):
    pts = [(float(r["lat"]), float(r["lon"]), float(r["s_m"])) for r in rows]
    out = []
    total = pts[-1][2]
    s = 0.0
    k = 0
    while s <= total:
        while k < len(pts) - 2 and pts[k + 1][2] < s:
            k += 1
        a, b = pts[k], pts[k + 1]
        t = 0.0 if b[2] == a[2] else (s - a[2]) / (b[2] - a[2])
        out.append((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, s))
        s += step
    return out


def moving_average(z, n):
    if n <= 1:
        return list(z)
    half = n // 2
    m = len(z)
    # Closed loop: wrap around.
    return [sum(z[(i + k) % m] for k in range(-half, half + 1)) / (2 * half + 1) for i in range(m)]


def opening(z, n):
    """1-D morphological opening (running min then running max) on a closed
    loop. Removes positive bumps narrower than n samples: tree canopy and
    buildings in a surface model. Bare-ground dips survive."""
    m = len(z)
    half = n // 2
    lo = [min(z[(i + k) % m] for k in range(-half, half + 1)) for i in range(m)]
    return [max(lo[(i + k) % m] for k in range(-half, half + 1)) for i in range(m)]


def profile(argv):
    cl_path, tif_path = argv[0], argv[1]
    step = float(argv[argv.index("--step") + 1]) if "--step" in argv else 10.0
    seg_path = argv[argv.index("--segments") + 1] if "--segments" in argv else None
    out_path = argv[argv.index("--out") + 1] if "--out" in argv else None
    with open(cl_path) as f:
        rows = list(csv.DictReader(f))
    dem = Hgt(tif_path) if ".hgt" in tif_path else GeoTiff(tif_path)
    pts = resample(rows, step)
    z = [dem.sample(p[0], p[1]) for p in pts]
    print("DEM %s: %dx%d px, pixel %.2f x %.2f arcsec, predictor %d" % (
        os.path.basename(tif_path), dem.w, dem.h, dem.sx * 3600, dem.sy * 3600, dem.predictor))
    print("samples: %d every %.0f m over %.1f m" % (len(z), step, pts[-1][2]))
    variants = [("raw", z), ("smoothed 90 m", moving_average(z, int(round(90 / step)) | 1))]
    if "--open" in argv:
        w = float(argv[argv.index("--open") + 1])
        zo = moving_average(opening(z, int(round(w / step)) | 1), int(round(90 / step)) | 1)
        variants.append(("open %.0f+sm90" % w, zo))
    for label, zz in variants:
        lo, hi = min(zz), max(zz)
        gain = sum(max(0.0, zz[i + 1] - zz[i]) for i in range(len(zz) - 1))
        grads = [(zz[i + 1] - zz[i]) / step for i in range(len(zz) - 1)]
        print("%-14s min %.1f m at s=%.0f, max %.1f m at s=%.0f, range %.1f m, cumulative climb %.1f m, "
              "steepest up %.1f %%, steepest down %.1f %%" % (
                  label, lo, pts[zz.index(lo)][2], hi, pts[zz.index(hi)][2], hi - lo, gain,
                  100 * max(grads), 100 * min(grads)))
    zs = moving_average(z, int(round(90 / step)) | 1)
    if seg_path:
        with open(seg_path) as f:
            segs = list(csv.DictReader(f))
        print("%-26s %8s %8s %8s %8s %7s" % ("way", "s0", "s1", "z0", "z1", "dz"))
        for sg in segs:
            s0, s1 = float(sg["s_start"]), float(sg["s_end"])
            i0, i1 = int(round(s0 / step)) % len(zs), int(round(s1 / step)) % len(zs)
            print("%-26s %8.0f %8.0f %8.1f %8.1f %+7.1f" % (
                sg["name"][:26] or "-", s0, s1, zs[i0], zs[i1], zs[i1] - zs[i0]))
    if out_path:
        with open(out_path, "w") as f:
            f.write("s_m,lat,lon,z_raw_m,z_smooth_m\n")
            for p, a, b in zip(pts, z, zs):
                f.write("%.1f,%.7f,%.7f,%.2f,%.2f\n" % (p[2], p[0], p[1], a, b))


def main(argv):
    if len(argv) < 2:
        print(__doc__)
        return 2
    if argv[1] == "fetch":
        d = argv[argv.index("--dir") + 1] if "--dir" in argv else os.path.expanduser("~/.cache/undercut/dem")
        print(fetch(float(argv[2]), float(argv[3]), d))
    elif argv[1] == "profile":
        profile(argv[2:])
    else:
        print(__doc__)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
