#!/usr/bin/env python3
"""Fetch, resize and compress the environment textures and skies (npm run assets:build).

Inputs are in tools/assets/textures.config.json. Originals are downloaded once into
~/.cache/undercut/assets-src/ (never committed) and pinned by sha256 in
tools/assets/textures.lock.json; a changed upstream file stops the build. Outputs go to
apps/web/public/assets/{tex,env}/ with an index (apps/web/public/assets/index.json) that the game's
loader and the budget check read, and every output gets an entry in assets/MANIFEST.json.

    python3 tools/assets/build_textures.py           build what is missing or stale
    python3 tools/assets/build_textures.py --force   rebuild every output

Skies: the HDRI's sun is measured (direction, illuminance, size) and painted out, so the sky can
light the scene through the prefiltered environment without counting the sun twice; the game
draws the sun as a directional light and an analytic disc. The sun-free sky is stored as 8-bit
sRGB WebP of radiance / scale, with a triangular dither of one code value against banding.

Determinism: Pillow resizes with Lanczos and libwebp encodes with method 6; the same Pillow and
libwebp give the same bytes. The manifest's sha256 records what was shipped.
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import math
import os
import sys
import urllib.request
import zipfile
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
CONFIG = ROOT / "tools/assets/textures.config.json"
LOCK = ROOT / "tools/assets/textures.lock.json"
MANIFEST = ROOT / "assets/MANIFEST.json"
UA = {"User-Agent": "undercut-asset-build/1.0"}
PH_MAPS = {"diff": "diff", "nor": "nor_gl", "arm": "arm"}
TOOL = "tools/assets/build_textures.py"


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def fetch(url: str, dest: Path, lock: dict) -> bytes:
    if dest.exists():
        data = dest.read_bytes()
    else:
        print(f"  download {url}")
        req = urllib.request.Request(url, headers=UA)
        with urllib.request.urlopen(req, timeout=300) as r:
            data = r.read()
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(data)
    digest = sha256(data)
    pinned = lock.get(url)
    if pinned is None:
        lock[url] = digest
    elif pinned != digest:
        raise SystemExit(f"{url}: upstream file changed (sha256 {digest}, pinned {pinned})")
    return data


def ph_info(asset: str, cache: Path) -> dict:
    dest = cache / "polyhaven" / f"{asset}.info.json"
    if not dest.exists():
        req = urllib.request.Request(f"https://api.polyhaven.com/info/{asset}", headers=UA)
        with urllib.request.urlopen(req, timeout=60) as r:
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(r.read())
    return json.loads(dest.read_text())


def save_webp(img: Image.Image, path: Path, quality: int) -> bytes:
    buf = io.BytesIO()
    img.save(buf, "WEBP", quality=quality, method=6, exact=False)
    data = buf.getvalue()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    return data


def resize(img: Image.Image, size: int) -> Image.Image:
    if img.width == size:
        return img.copy()
    h = round(img.height * size / img.width)
    return img.resize((size, h), Image.Resampling.LANCZOS)


def renormalise(img: Image.Image) -> Image.Image:
    """Resampling shortens normals; put them back to unit length (OpenGL convention kept)."""
    a = np.asarray(img.convert("RGB"), dtype=np.float32) / 127.5 - 1.0
    a /= np.maximum(np.linalg.norm(a, axis=2, keepdims=True), 1e-6)
    return Image.fromarray(np.clip((a + 1.0) * 127.5 + 0.5, 0, 255).astype(np.uint8))


# --- textures ---------------------------------------------------------------------------------


def texture_sources(t: dict, cache: Path, lock: dict) -> tuple[dict[str, Image.Image], dict]:
    """The three source maps (diff, nor, arm) as images, and the URL each came from."""
    images: dict[str, Image.Image] = {}
    urls: dict[str, str] = {}
    if t["source"] == "polyhaven":
        a = t["asset"]
        for key, name in PH_MAPS.items():
            url = f"https://dl.polyhaven.org/file/ph-assets/Textures/jpg/2k/{a}/{a}_{name}_2k.jpg"
            data = fetch(url, cache / "polyhaven" / f"{a}_{name}_2k.jpg", lock)
            images[key] = Image.open(io.BytesIO(data)).convert("RGB")
            urls[key] = url
    elif t["source"] == "ambientcg":
        a = t["asset"]
        url = f"https://ambientcg.com/get?file={a}_1K-JPG.zip"
        data = fetch(url, cache / "ambientcg" / f"{a}_1K-JPG.zip", lock)
        z = zipfile.ZipFile(io.BytesIO(data))

        def member(suffix: str) -> Image.Image | None:
            for n in z.namelist():
                if n.endswith(suffix):
                    return Image.open(io.BytesIO(z.read(n))).convert("L" if "Normal" not in suffix and "Color" not in suffix else "RGB")
            return None

        colour = member("_Color.jpg")
        normal = member("_NormalGL.jpg")
        rough = member("_Roughness.jpg")
        ao = member("_AmbientOcclusion.jpg")
        if colour is None or normal is None or rough is None:
            raise SystemExit(f"{url}: missing maps in {z.namelist()}")
        size = colour.size
        ao = ao or Image.new("L", size, 255)
        # Pack ambient occlusion, roughness and metalness (0) as glTF wants.
        arm = Image.merge("RGB", (ao.resize(size), rough.resize(size), Image.new("L", size, 0)))
        images = {"diff": colour, "nor": normal, "arm": arm}
        urls = {k: url for k in images}
    else:
        raise SystemExit(f"unknown source {t['source']}")
    return images, urls


def build_texture(t: dict, cache: Path, out: Path, lock: dict, force: bool, entries: list, index: dict) -> None:
    print(f"texture {t['id']}")
    sources = None
    files: dict[str, dict[str, str]] = {"hi": {}, "lo": {}}
    for tier, size in zip(("hi", "lo"), t["sizes"]):
        for key in ("diff", "nor", "arm"):
            rel = f"tex/{t['id']}/{key}_{size}.webp"
            path = out / rel
            files[tier][key] = rel
            if path.exists() and not force:
                data = path.read_bytes()
                urls = None
            else:
                if sources is None:
                    sources = texture_sources(t, cache, lock)
                images, urls = sources
                img = resize(images[key], size)
                if key == "nor":
                    img = renormalise(img)
                data = save_webp(img, path, t["quality"][key])
            src_url = (sources[1][key] if sources else None) or _source_url(t, key)
            entries.append(
                {
                    "file": f"apps/web/public/assets/{rel}",
                    "source_url": src_url,
                    "author": t["author"],
                    "licence": "CC0-1.0",
                    "changes": f"{'Packed ambient occlusion, roughness and zero metalness into RGB, ' if t['source'] == 'ambientcg' and key == 'arm' else ''}resized to {size} px with Lanczos{', normals renormalised' if key == 'nor' else ''}, encoded as WebP quality {t['quality'][key]} by {TOOL}",
                    "sha256": sha256(data),
                }
            )
            index["files"][rel] = len(data)
    index["textures"][t["id"]] = {"sizeM": t["sizeM"], "hi": files["hi"], "lo": files["lo"]}


def _source_url(t: dict, key: str) -> str:
    if t["source"] == "polyhaven":
        a = t["asset"]
        return f"https://dl.polyhaven.org/file/ph-assets/Textures/jpg/2k/{a}/{a}_{PH_MAPS[key]}_2k.jpg"
    return f"https://ambientcg.com/get?file={t['asset']}_1K-JPG.zip"


# --- skies ------------------------------------------------------------------------------------


def read_hdr(data: bytes) -> np.ndarray:
    """Radiance RGBE (.hdr) reader for the new-style RLE files Poly Haven ships. Returns HxWx3."""
    pos = 0
    while True:
        end = data.index(b"\n", pos)
        line = data[pos:end]
        pos = end + 1
        if line == b"":
            break
    end = data.index(b"\n", pos)
    dims = data[pos:end].split()
    pos = end + 1
    if dims[0] != b"-Y" or dims[2] != b"+X":
        raise SystemExit(f"unsupported HDR orientation {dims}")
    h, w = int(dims[1]), int(dims[3])
    buf = np.frombuffer(data, dtype=np.uint8, offset=pos)
    out = np.empty((h, w, 4), dtype=np.uint8)
    p = 0
    for y in range(h):
        if buf[p] != 2 or buf[p + 1] != 2:
            raise SystemExit("flat (non-RLE) HDR scanlines are not supported")
        p += 4
        for c in range(4):
            x = 0
            row = out[y, :, c]
            while x < w:
                n = int(buf[p])
                p += 1
                if n > 128:
                    n -= 128
                    row[x : x + n] = buf[p]
                    p += 1
                else:
                    row[x : x + n] = buf[p : p + n]
                    p += n
                x += n
    e = out[:, :, 3].astype(np.int32)
    scale = np.where(e > 0, np.ldexp(1.0, e - 136), 0.0).astype(np.float32)
    return out[:, :, :3].astype(np.float32) * scale[:, :, None]


def luminance(rgb: np.ndarray) -> np.ndarray:
    return rgb[..., 0] * 0.2126 + rgb[..., 1] * 0.7152 + rgb[..., 2] * 0.0722


def directions(h: int, w: int) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Unit directions per pixel in three.js equirect convention (u = atan2(z, x)/2pi + 0.5,
    v = asin(y)/pi + 0.5, image row 0 at v = 1), and each pixel's solid angle."""
    u = (np.arange(w) + 0.5) / w
    v = 1.0 - (np.arange(h) + 0.5) / h
    theta = (u - 0.5) * 2 * math.pi
    el = (v - 0.5) * math.pi
    ce = np.cos(el)[:, None]
    x = ce * np.cos(theta)[None, :]
    z = ce * np.sin(theta)[None, :]
    y = np.repeat(np.sin(el)[:, None], w, axis=1)
    d_omega = (2 * math.pi / w) * (math.pi / h) * np.cos(el)
    return np.stack([x, y, z], axis=-1), np.repeat(d_omega[:, None], w, axis=1), el


def build_sky(s: dict, cache: Path, out: Path, lock: dict, force: bool, entries: list, index: dict) -> None:
    print(f"sky {s['id']}")
    files = {tier: f"env/{s['id']}/sky_{size}.webp" for tier, size in zip(("hi", "lo"), s["sizes"])}
    meta_path = cache / "skies" / f"{s['id']}.json"
    url = f"https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/4k/{s['asset']}_4k.hdr"
    stale = force or not meta_path.exists() or any(not (out / f).exists() for f in files.values())
    if stale:
        data = fetch(url, cache / "polyhaven" / f"{s['asset']}_4k.hdr", lock)
        rgb = read_hdr(data)
        h, w, _ = rgb.shape
        dirs, d_omega, el = directions(h, w)
        lum = luminance(rgb)
        upper = el[:, None].repeat(w, axis=1) > 0
        peak = float(lum.max())
        # The sun: the connected bright core around the brightest pixel.
        py, px = np.unravel_index(int(np.argmax(lum)), lum.shape)
        sun_dir = dirs[py, px]
        cosang = np.tensordot(dirs, sun_dir, axes=([2], [0]))
        near = cosang > math.cos(math.radians(6))
        background = float(np.median(lum[near & (cosang < math.cos(math.radians(4)))])) if near.any() else 0.0
        core = near & (lum > max(background * 8, peak * 0.002))
        has_sun = peak > 50 * max(1e-6, float(np.percentile(lum[upper], 99)))
        if has_sun and core.any():
            w_l = (lum * d_omega * core)[..., None]
            centroid = (dirs * w_l).sum(axis=(0, 1))
            sun_dir = centroid / np.linalg.norm(centroid)
            sun_rgb_irr = (rgb * (d_omega * core)[..., None]).sum(axis=(0, 1))
            sun_solid = float((d_omega * core).sum())
            # Paint the sun out: replace the core by the surrounding ring's mean colour.
            # The ring just outside the core (0.4 degrees wide) is the aureole the core sits in.
            r_core = math.degrees(math.acos(float(np.clip(cosang[core].min(), -1, 1))))
            ring = ~core & (cosang > math.cos(math.radians(r_core + 0.4)))
            fill = rgb[ring].mean(axis=0) if ring.any() else np.zeros(3)
            rgb = rgb.copy()
            rgb[core] = fill
        else:
            sun_rgb_irr = np.zeros(3)
            sun_solid = 0.0
        sun_el = math.degrees(math.asin(float(sun_dir[1])))
        sun_az_u = (math.atan2(float(sun_dir[2]), float(sun_dir[0])) / (2 * math.pi) + 0.5) % 1.0
        # Irradiance of the sky (sun removed) on a horizontal plane, and its brightness scale.
        cos_up = np.clip(dirs[..., 1], 0, None)
        sky_irr = (rgb * (d_omega * cos_up)[..., None]).sum(axis=(0, 1))
        lum2 = luminance(rgb)
        scale = float(np.percentile(lum2[upper], 99.9)) * 1.15
        meta = {
            "scale": round(scale, 5),
            "sun": {
                "present": bool(has_sun),
                "elevationDeg": round(sun_el, 3),
                "u": round(sun_az_u, 5),
                "irradiance": [round(float(c), 4) for c in sun_rgb_irr],
                "solidAngleSr": round(sun_solid, 7),
            },
            "skyIrradiance": [round(float(c), 4) for c in sky_irr],
            "peak": round(peak, 2),
        }
        rng = np.random.default_rng(1)
        for tier, size in zip(("hi", "lo"), s["sizes"]):
            hh = size // 2
            img = rgb
            if w != size:
                # Linear-light downsample: area average through Pillow on float32 channels.
                chans = [Image.fromarray(np.ascontiguousarray(rgb[..., c])).resize((size, hh), Image.Resampling.BOX) for c in range(3)]
                img = np.stack([np.asarray(c) for c in chans], axis=-1)
            v = np.clip(img / scale, 0, 1)
            srgb = np.where(v <= 0.0031308, v * 12.92, 1.055 * np.power(v, 1 / 2.4) - 0.055)
            dither = (rng.random(srgb.shape) - rng.random(srgb.shape)) / 255.0
            q = np.clip(np.round((srgb + dither) * 255.0), 0, 255).astype(np.uint8)
            save_webp(Image.fromarray(q), out / files[tier], s["quality"])
        meta_path.parent.mkdir(parents=True, exist_ok=True)
        meta_path.write_text(json.dumps(meta, indent=2))
    meta = json.loads(meta_path.read_text())
    for tier, size in zip(("hi", "lo"), s["sizes"]):
        data = (out / files[tier]).read_bytes()
        entries.append(
            {
                "file": f"apps/web/public/assets/{files[tier]}",
                "source_url": url,
                "author": s["author"],
                "licence": "CC0-1.0",
                "changes": f"4k HDR read, sun measured and painted out, area-downsampled to {size} x {size // 2}, divided by {meta['scale']}, sRGB-encoded with a one-code-value triangular dither, WebP quality {s['quality']}, by {TOOL}",
                "sha256": sha256(data),
            }
        )
        index["files"][files[tier]] = len(data)
    index["skies"][s["id"]] = {"hi": files["hi"], "lo": files["lo"], **meta}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()
    cfg = json.loads(CONFIG.read_text())
    cache = Path(os.path.expanduser(cfg["cache"]))
    out = ROOT / cfg["out"]
    lock = json.loads(LOCK.read_text()) if LOCK.exists() else {}
    entries: list[dict] = []
    index: dict = {
        "$comment": f"Generated by {TOOL}; do not edit. Paths are relative to assets/. bytes per file is what the loader's progress bar and tools/budget count.",
        "files": {},
        "textures": {},
        "skies": {},
    }
    for t in cfg["textures"]:
        build_texture(t, cache, out, lock, args.force, entries, index)
    for s in cfg["skies"]:
        build_sky(s, cache, out, lock, args.force, entries, index)
    index["files"] = dict(sorted(index["files"].items()))
    index_rel = "index.json"
    index_bytes = (json.dumps(index, indent=2) + "\n").encode()
    (out / index_rel).write_bytes(index_bytes)
    entries.append(
        {
            "file": f"apps/web/public/assets/{index_rel}",
            "source_url": f"{TOOL} (this repository)",
            "author": "UNDERCUT contributors",
            "licence": "MIT",
            "changes": "Generated index of the environment textures and skies",
            "sha256": sha256(index_bytes),
        }
    )
    LOCK.write_text(json.dumps(dict(sorted(lock.items())), indent=2) + "\n")
    # Manifest: replace this tool's entries, keep everyone else's.
    manifest = json.loads(MANIFEST.read_text())
    ours = {e["file"] for e in entries}
    kept = [
        e
        for e in manifest
        if e["file"] not in ours
        and not e["file"].startswith(("apps/web/public/assets/tex/", "apps/web/public/assets/env/"))
    ]
    MANIFEST.write_text(json.dumps(kept + sorted(entries, key=lambda e: e["file"]), indent=2, ensure_ascii=False) + "\n")
    total = sum(index["files"].values())
    print(f"{len(index['files'])} files, {total / 1048576:.2f} MiB")


if __name__ == "__main__":
    sys.exit(main())
