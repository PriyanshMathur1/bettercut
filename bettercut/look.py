"""Let the AI see the footage: frames from a reel as one labelled contact sheet.

Without a transcript (a travel montage, scenery, a demo with no voice) the AI can't tell a waterfall from a
blurry pan by reading the spec. `sheet` grabs frames at chosen SOURCE times, labels each with its time and clip,
and returns one JPEG small enough to send back over MCP.
"""
from __future__ import annotations

import io
import subprocess
from pathlib import Path

MAX_FRAMES = 24


def scan_times(clips: list[dict], per_clip: int = 3, duration: float | None = None) -> list[float]:
    """Evenly spread times inside each clip (never on its first or last frames, which are often a hand
    pressing record), at most MAX_FRAMES in all."""
    if not clips and duration:
        clips = [{"start": 0.0, "seconds": duration}]
    per = max(1, min(per_clip, MAX_FRAMES // max(1, len(clips))))
    out = []
    for c in clips:
        a, n = float(c["start"]), float(c["seconds"])
        if n <= 0:
            continue
        for i in range(per):
            out.append(round(a + n * (i + 1) / (per + 1), 2))
    return out[:MAX_FRAMES]


def clip_of(clips: list[dict], t: float) -> str:
    for c in clips:
        if c["start"] <= t < c["start"] + c["seconds"]:
            return str(c.get("name") or "")
    return ""


def frame(src: Path, t: float, width: int):
    """The frame at t; at the very end of a file there may be none, so step back a little."""
    from PIL import Image

    for back in (0.0, 0.2, 0.5, 1.0):
        raw = subprocess.run(
            ["ffmpeg", "-loglevel", "error", "-ss", f"{max(0.0, t - back):.3f}", "-i", str(src), "-frames:v", "1", "-vf", f"scale={width}:-2",
             "-f", "image2pipe", "-vcodec", "png", "-"],
            capture_output=True, check=True,
        ).stdout
        if raw:
            return Image.open(io.BytesIO(raw)).convert("RGB")
    raise RuntimeError(f"no frame at {t:.2f} s")


def sheet(src: Path, times: list[float], clips: list[dict] | None = None, width: int = 240, cols: int = 4) -> tuple[bytes, list[dict]]:
    """One JPEG grid of frames at `times` (SOURCE seconds), each labelled "#n  12.5s  clip". Returns the
    image and the legend (n, time, clip) in the same order."""
    from PIL import Image, ImageDraw, ImageFont

    times = [float(t) for t in times][:MAX_FRAMES]
    if not times:
        raise ValueError("no times to look at")
    tiles = [frame(src, t, width) for t in times]
    h = max(im.height for im in tiles)
    cols = max(1, min(cols, len(tiles)))
    rows = (len(tiles) + cols - 1) // cols
    gap = 4
    out = Image.new("RGB", (cols * width + (cols - 1) * gap, rows * h + (rows - 1) * gap), (16, 16, 18))
    try:
        font = ImageFont.load_default(size=max(12, width // 16))
    except TypeError:  # older Pillow
        font = ImageFont.load_default()
    legend = []
    for i, (t, im) in enumerate(zip(times, tiles)):
        x, y = (i % cols) * (width + gap), (i // cols) * (h + gap)
        out.paste(im, (x, y))
        name = clip_of(clips or [], t)
        label = f"#{i + 1}  {t:.1f}s" + (f"  {Path(name).stem}" if name else "")
        d = ImageDraw.Draw(out)
        box = d.textbbox((x + 5, y + 5), label, font=font)
        d.rectangle((box[0] - 3, box[1] - 2, box[2] + 3, box[3] + 2), fill=(0, 0, 0))
        d.text((x + 5, y + 5), label, fill=(255, 211, 77), font=font)
        legend.append({"n": i + 1, "at": round(t, 2), "clip": name})
    buf = io.BytesIO()
    out.save(buf, "JPEG", quality=78)
    return buf.getvalue(), legend
