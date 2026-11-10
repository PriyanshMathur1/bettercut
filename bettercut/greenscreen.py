"""Green screen: footage shot against a flat colour becomes a cut-out.

The keyed footage is written as the reel's matte (VP9 with alpha), the same file the speaker cutout
produces, so every layout that uses a cutout (Green Screen, Behind The Head, Colour Pop...) works with it.
"""
from __future__ import annotations

import hashlib
import json
import subprocess
from pathlib import Path

DEFAULTS = {"color": "auto", "similarity": 0.28, "blend": 0.08}


def settings(spec: dict) -> dict | None:
    k = spec["source"].get("key")
    if not isinstance(k, dict):
        return None
    out = {**DEFAULTS, **k}
    out["similarity"] = min(0.6, max(0.02, float(out["similarity"])))
    out["blend"] = min(0.4, max(0.0, float(out["blend"])))
    return out


def signature(spec: dict) -> str:
    return hashlib.sha1(json.dumps([settings(spec), spec["source"]["src"]], sort_keys=True).encode()).hexdigest()[:12]


def detect_color(src: Path) -> str:
    """The backdrop colour: the median of the frame's border pixels, a third of the way into the clip."""
    import numpy as np
    from PIL import Image

    from . import media

    t = media.probe(src)["duration"] / 3
    raw = subprocess.run(
        ["ffmpeg", "-loglevel", "error", "-ss", f"{t:.3f}", "-i", str(src), "-frames:v", "1", "-vf", "scale=90:160", "-f", "image2pipe", "-vcodec", "png", "-"],
        capture_output=True, check=True,
    ).stdout
    import io

    a = np.asarray(Image.open(io.BytesIO(raw)).convert("RGB"), dtype=np.float64)
    border = np.concatenate([a[:6].reshape(-1, 3), a[:, :6].reshape(-1, 3), a[:, -6:].reshape(-1, 3)])  # top and sides: the floor is often not backdrop
    r, g, b = (int(round(v)) for v in np.median(border, axis=0))
    return f"#{r:02X}{g:02X}{b:02X}"


def key_matte(src: Path, out: Path, color: str, similarity: float, blend: float) -> Path:
    out.parent.mkdir(parents=True, exist_ok=True)
    hexc = "0x" + color.lstrip("#")
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-i", str(src), "-vf", f"chromakey={hexc}:{similarity:.3f}:{blend:.3f},format=yuva420p",
         "-an", "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-b:v", "0", "-crf", "28", "-row-mt", "1", str(out)],
        check=True,
    )
    return out


def is_current(spec: dict) -> bool:
    src = spec["source"]
    if settings(spec) is None:
        return "keyed" not in src
    return src.get("keyed") == signature(spec) and bool(src.get("matte")) and Path(src["matte"]).exists()


def bake(spec: dict, project: Path, log=print) -> dict:
    """Key the footage when the green-screen settings changed; drop the key's matte when it was switched off."""
    spec = json.loads(json.dumps(spec))
    src = spec["source"]
    k = settings(spec)
    if k is None:
        if src.pop("keyed", None):
            src.pop("matte", None)
            src.pop("gradedMatte", None)
        return spec
    color = detect_color(Path(src["src"])) if str(k["color"]).lower() == "auto" else k["color"]
    sig = signature(spec)
    out = project / "assets" / f"key-{sig}.webm"
    if not out.exists():
        log(f"keying out the {color} backdrop")
        key_matte(Path(src["src"]), out, color, k["similarity"], k["blend"])
    src["matte"] = str(out)
    src["keyed"] = sig
    src["keyColor"] = color
    # anything baked from the previous cut-out is stale now
    src.pop("gradedMatte", None)
    (spec.get("grade") or {}).pop("baked", None)
    return spec
