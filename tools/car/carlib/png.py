"""Deterministic PNG writer (8-bit RGB or grey), so texture files hash the same on every build."""

import struct
import zlib

import numpy as np


def _chunk(tag, data):
    return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)


def write(path, img, bottom_up=True):
    """img: float array (h, w, c) in [0, 1] with c in (1, 3). bottom_up: row 0 is the bottom
    (Blender's convention); PNG stores the top row first."""
    a = np.clip(np.round(np.asarray(img) * 255.0), 0, 255).astype(np.uint8)
    if a.ndim == 2:
        a = a[..., None]
    if bottom_up:
        a = a[::-1]
    h, w, c = a.shape
    colour_type = {1: 0, 3: 2, 4: 6}[c]
    # Paeth-free 'Up' filter on every row: simple and compresses masks and ramps well
    rows = a.reshape(h, w * c).astype(np.int16)
    up = np.vstack([rows[:1] * 0, rows[:-1]])
    filt = ((rows - up) % 256).astype(np.uint8)
    raw = np.hstack([np.full((h, 1), 2, dtype=np.uint8), filt]).tobytes()
    data = b"\x89PNG\r\n\x1a\n"
    data += _chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, colour_type, 0, 0, 0))
    data += _chunk(b"IDAT", zlib.compress(raw, 9))
    data += _chunk(b"IEND", b"")
    with open(path, "wb") as fh:
        fh.write(data)
