"""Local metric frame on the WGS84 ellipsoid.

World frame (AGENTS.md): +X east, +Y up, +Z south. A point's (x, z) is its east/north offset
from the origin in the tangent plane at the origin, with z = -north.
"""
import math

A = 6378137.0
F = 1 / 298.257223563
E2 = F * (2 - F)


def _ecef(lat, lon, h=0.0):
    la, lo = math.radians(lat), math.radians(lon)
    n = A / math.sqrt(1 - E2 * math.sin(la) ** 2)
    return ((n + h) * math.cos(la) * math.cos(lo), (n + h) * math.cos(la) * math.sin(lo), (n * (1 - E2) + h) * math.sin(la))


class LocalFrame:
    """East-north tangent plane at (lat0, lon0), height 0 on the ellipsoid."""

    def __init__(self, lat0, lon0):
        self.lat0, self.lon0 = lat0, lon0
        la, lo = math.radians(lat0), math.radians(lon0)
        self.o = _ecef(lat0, lon0)
        self.e = (-math.sin(lo), math.cos(lo), 0.0)
        self.n = (-math.sin(la) * math.cos(lo), -math.sin(la) * math.sin(lo), math.cos(la))
        # Radii of curvature at the origin, for the inverse's first guess.
        s = math.sin(la)
        self.rm = A * (1 - E2) / (1 - E2 * s * s) ** 1.5
        self.rn = A / math.sqrt(1 - E2 * s * s)

    def to_xz(self, lat, lon):
        p = _ecef(lat, lon)
        d = (p[0] - self.o[0], p[1] - self.o[1], p[2] - self.o[2])
        east = d[0] * self.e[0] + d[1] * self.e[1] + d[2] * self.e[2]
        north = d[0] * self.n[0] + d[1] * self.n[1] + d[2] * self.n[2]
        return east, -north

    def to_latlon(self, x, z):
        """Inverse of to_xz by Newton iteration; sub-millimetre within a few kilometres."""
        lat = self.lat0 + math.degrees(-z / self.rm)
        lon = self.lon0 + math.degrees(x / (self.rn * math.cos(math.radians(self.lat0))))
        for _ in range(4):
            ex, ez = self.to_xz(lat, lon)
            lat += math.degrees(-(z - ez) / self.rm)
            lon += math.degrees((x - ex) / (self.rn * math.cos(math.radians(lat))))
        return lat, lon
