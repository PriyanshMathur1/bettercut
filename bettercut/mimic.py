"""Mimic: measure a reference reel and turn it into a reusable Look.

Measures cut rhythm (shot lengths, cuts per minute), colour (brightness, saturation, warmth,
contrast, palette), speech pace and on-screen layout, then maps them onto BetterCut's styles.
Writes analysis.json, a contact sheet for Claude to read the caption/typography style from,
and a look file in ~/.bettercut/looks/. It learns how the reference is edited; it never copies
the reference's footage, text or assets.
"""
from __future__ import annotations

import json
import re
import shutil
import statistics
import subprocess
from pathlib import Path

from . import media
from .spec import USER_LOOKS


def fetch(ref: str, work: Path) -> Path:
    """Local file, or a URL downloaded with yt-dlp."""
    p = Path(ref).expanduser()
    if p.exists():
        return p
    if not re.match(r"https?://", ref):
        raise FileNotFoundError(ref)
    ytdlp = shutil.which("yt-dlp")
    if not ytdlp:
        raise RuntimeError("yt-dlp is not installed (brew install yt-dlp), or pass a downloaded file instead")
    work.mkdir(parents=True, exist_ok=True)
    out = work / "reference.%(ext)s"
    subprocess.run([ytdlp, "-f", "mp4/bestvideo*+bestaudio/best", "--merge-output-format", "mp4", "-o", str(out), ref], check=True)
    return next(work.glob("reference.*"))


def scene_cuts(path: Path, threshold: float = 0.3) -> list[float]:
    p = subprocess.run(
        ["ffmpeg", "-hide_banner", "-i", str(path), "-vf", f"select='gt(scene,{threshold})',showinfo", "-an", "-f", "null", "-"],
        capture_output=True, text=True,
    )
    return [float(m.group(1)) for m in re.finditer(r"pts_time:([\d.]+)", p.stderr)]


def jump_cuts_and_zooms(path: Path, fps: float = 12.0) -> dict:
    """Cuts that scene detection misses (jump cuts on a static background) and punch-in zooms.

    Frame difference on small grey frames finds cuts (spikes far above the clip's median motion); at each cut,
    ORB features + a similarity transform between the frames before/after estimate the scale change."""
    import cv2

    p = subprocess.run(
        ["ffmpeg", "-loglevel", "error", "-i", str(path), "-vf", f"fps={fps},scale=160:-2,format=gray", "-f", "rawvideo", "-"],
        capture_output=True,
    )
    info = media.probe(path)
    w = 160
    h = int(round(info["height"] * 160 / max(info["width"], 1) / 2) * 2) or 284
    n = len(p.stdout) // (w * h)
    if n < 3:
        return {"cuts": [], "zooms": []}
    frames = [__import__("numpy").frombuffer(p.stdout[i * w * h : (i + 1) * w * h], dtype="uint8").reshape(h, w) for i in range(n)]
    import numpy as np

    diffs = np.array([np.mean(cv2.absdiff(frames[i], frames[i - 1])) for i in range(1, n)])
    base = float(np.median(diffs)) + 1e-3
    cuts, zooms = [], []
    orb = cv2.ORB_create(400)
    for i, d in enumerate(diffs, start=1):
        if d > max(base * 3.5, 6.0) and (not cuts or i / fps - cuts[-1] > 0.25):
            t = round(i / fps, 3)
            cuts.append(t)
            k1, d1 = orb.detectAndCompute(frames[i - 1], None)
            k2, d2 = orb.detectAndCompute(frames[i], None)
            if d1 is not None and d2 is not None and len(k1) > 10 and len(k2) > 10:
                m = cv2.BFMatcher(cv2.NORM_HAMMING, crossCheck=True).match(d1, d2)
                if len(m) >= 8:
                    a = np.float32([k1[x.queryIdx].pt for x in m])
                    b = np.float32([k2[x.trainIdx].pt for x in m])
                    M, inl = cv2.estimateAffinePartial2D(a, b)
                    if M is not None and inl is not None and inl.sum() >= 8:
                        scale = float(np.hypot(M[0, 0], M[1, 0]))
                        if abs(scale - 1) > 0.05:
                            zooms.append({"at": t, "scale": round(scale, 3)})
    return {"cuts": cuts, "zooms": zooms}


def shot_stats(cuts: list[float], duration: float) -> dict:
    bounds = [0.0] + [c for c in cuts if 0.15 < c < duration - 0.15] + [duration]
    shots = [b - a for a, b in zip(bounds, bounds[1:]) if b - a > 0.05]
    return {
        "shots": len(shots),
        "avgShot": round(statistics.mean(shots), 2) if shots else duration,
        "medianShot": round(statistics.median(shots), 2) if shots else duration,
        "cutsPerMin": round(len(shots) / max(duration, 1) * 60, 1),
    }


def colour_stats(path: Path, duration: float, n: int = 12) -> dict:
    """Mean brightness / saturation / warmth / contrast and a 5-colour palette from sampled frames."""
    from PIL import Image, ImageStat

    tmp = path.parent / ".mimic_frames"
    tmp.mkdir(exist_ok=True)
    frames = []
    for i in range(n):
        t = duration * (i + 0.5) / n
        f = tmp / f"{i:02d}.png"
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-ss", f"{t:.2f}", "-i", str(path), "-frames:v", "1", "-vf", "scale=96:-2", str(f)], check=False)
        if f.exists():
            frames.append(Image.open(f).convert("RGB"))
    shutil.rmtree(tmp, ignore_errors=True)
    if not frames:
        return {}
    bright, sat, warm, contrast = [], [], [], []
    for im in frames:
        hsv = im.convert("HSV")
        hs = ImageStat.Stat(hsv)
        rs = ImageStat.Stat(im)
        bright.append(hs.mean[2] / 255)
        sat.append(hs.mean[1] / 255)
        warm.append((rs.mean[0] - rs.mean[2]) / 255)
        contrast.append(ImageStat.Stat(im.convert("L")).stddev[0] / 128)
    strip = Image.new("RGB", (frames[0].width * len(frames), frames[0].height))
    for i, im in enumerate(frames):
        strip.paste(im, (i * frames[0].width, 0))
    pal = strip.quantize(colors=6, method=Image.Quantize.MEDIANCUT).getpalette()[:18]
    palette = ["#%02X%02X%02X" % tuple(pal[i : i + 3]) for i in range(0, 18, 3)]
    return {
        "brightness": round(statistics.mean(bright), 3),
        "saturation": round(statistics.mean(sat), 3),
        "warmth": round(statistics.mean(warm), 3),
        "contrast": round(statistics.mean(contrast), 3),
        "palette": palette,
    }


def _sat(hex_: str) -> float:
    r, g, b = (int(hex_[i : i + 2], 16) / 255 for i in (1, 3, 5))
    mx, mn = max(r, g, b), min(r, g, b)
    return 0 if mx == 0 else (mx - mn) / mx * (0.4 + 0.6 * mx)


def choose_look(a: dict) -> dict:
    """Map measurements onto a Look patch. Pure: tested in tests/bettercut/test_mimic.py."""
    shots, col, pace = a.get("shots", {}), a.get("colour", {}), a.get("speech", {})
    cpm = shots.get("cutsPerMin", 10)
    b, s, w, c = col.get("brightness", 0.5), col.get("saturation", 0.4), col.get("warmth", 0), col.get("contrast", 0.4)

    if s < 0.06:
        grade = "noir" if c > 0.55 else "mono"
    elif b < 0.33:
        grade = "editorial-dark" if s < 0.35 else "moody"
    elif w > 0.12:
        grade = "golden" if s > 0.45 else "warm"
    elif w < -0.06:
        grade = "cool"
    elif s > 0.5 and c > 0.45:
        grade = "punchy"
    elif b > 0.68:
        grade = "high-key"
    else:
        grade = "clean"

    if cpm >= 30:
        auto, transition, camera, cap = "punchy", "punch-in", "none", "bold-pop"
    elif cpm >= 16:
        auto, transition, camera, cap = "alternate", "punch-in", "none", "kinetic-lower"
    elif cpm >= 7:
        auto, transition, camera, cap = "subtle", "zoom-blur", "none", "editorial-mix"
    else:
        auto, transition, camera, cap = "off", "blur-cross", "slow-push", "editorial-serif"
    if grade in ("editorial-dark", "moody", "noir") and cap == "kinetic-lower":
        cap = "editorial-quiet"

    zr = a.get("zoomRatio")
    if zr is not None:
        if zr >= 0.5:
            auto = "punchy" if cpm >= 20 else "alternate"
        elif zr >= 0.2:
            auto = "alternate" if auto == "off" else auto
        elif zr < 0.05 and cpm < 16:
            auto = "off"
    wps = pace.get("wps", 2.5)
    per_page = 2 if wps > 3.3 else 3 if wps > 2.4 else 4 if wps > 1.6 else 5

    palette = col.get("palette") or []
    accent = max(palette, key=_sat) if palette else None

    patch = {
        "captions": {"style": cap, "position": "lower", "wordsPerPage": per_page},
        "motion": {"autoZoom": auto, "cutTransition": transition, "camera": camera},
        "grade": {"preset": grade, "vignette": 0.45 if b < 0.4 else 0.2, "grain": 0},
        "audio": {"sfx": cpm >= 12},
        "progressBar": cpm >= 24,
    }
    if accent and _sat(accent) > 0.35:
        patch["brand"] = {"accent": accent}
    return patch


def analyse(ref: str, out_dir: Path, name: str | None = None, transcribe: bool = True) -> dict:
    out_dir.mkdir(parents=True, exist_ok=True)
    path = fetch(ref, out_dir)
    info = media.probe(path)
    dur = info["duration"]
    scene = scene_cuts(path)
    jz = jump_cuts_and_zooms(path)
    cuts = sorted(set(round(c, 2) for c in scene) | set(round(c, 2) for c in jz["cuts"]))
    merged: list[float] = []
    for c in cuts:
        if not merged or c - merged[-1] > 0.2:
            merged.append(c)
    analysis = {
        "reference": str(path), "probe": info, "cuts": merged, "shots": shot_stats(merged, dur), "colour": colour_stats(path, dur),
        "zooms": jz["zooms"], "zoomRatio": round(len(jz["zooms"]) / max(1, len(merged)), 2),
    }
    if transcribe and media.has_audio(path):
        try:
            words = media.transcribe(path, model_size="base", align=False)
            span = (words[-1]["end"] - words[0]["start"]) if len(words) > 1 else 0
            analysis["speech"] = {"words": len(words), "wps": round(len(words) / span, 2) if span else 0}
        except Exception as e:  # speech is optional for a style read
            analysis["speech"] = {"error": str(e)}
    sheet_times = [dur * (i + 0.5) / 12 for i in range(12)]
    sheet = media.contact_sheet(path, out_dir / "reference_sheet.jpg", sheet_times)
    analysis["sheet"] = str(sheet)
    patch = choose_look(analysis)
    slug = re.sub(r"[^a-z0-9]+", "-", (name or path.stem).lower()).strip("-")[:40] or "reference"
    look = {
        "id": f"mimic-{slug}",
        "name": f"Mimic: {name or path.stem}",
        "description": (
            f"From a reference: {analysis['shots']['cutsPerMin']} cuts/min, avg shot {analysis['shots']['avgShot']}s, "
            f"{patch['grade']['preset']} grade. Refine the caption style after looking at reference_sheet.jpg."
        ),
        "patch": patch,
        "analysis": {k: analysis[k] for k in ("shots", "colour") if k in analysis},
    }
    USER_LOOKS.mkdir(parents=True, exist_ok=True)
    look_path = USER_LOOKS / f"{look['id']}.json"
    look_path.write_text(json.dumps(look, indent=2), encoding="utf-8")
    analysis["look"] = look["id"]
    analysis["lookFile"] = str(look_path)
    (out_dir / "analysis.json").write_text(json.dumps(analysis, indent=2), encoding="utf-8")
    return analysis
