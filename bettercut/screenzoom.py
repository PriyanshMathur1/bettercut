"""Zooms for screen recordings: move in on the part of the screen where something just happened.

A recording made in the browser can't see the clicks themselves (the browser only sees the picture of the
screen), so the clicks are found from the picture: a click makes a small part of the screen change (a button
lights up, a menu opens, text appears) while the rest stays still. Each such change becomes a zoom on that
spot. A change across most of the screen (a new page, a scroll) ends the zoom, so the viewer sees the
whole new screen.

Zooms are stored in the spec as `zooms[] {start, end, x, y, zoom}`: SOURCE seconds, with the centre `x`, `y`
as fractions of the footage's box.
"""
from __future__ import annotations

import subprocess
from pathlib import Path

import numpy as np

FPS = 8  # frames a second looked at: clicks show up within a frame or two
WIDTH = 192  # analysis width in pixels: enough to tell a button from the rest of the screen
CHANGED = 24  # grey levels a pixel must move to count as changed (video noise stays well below)
MIN_SHARE = 0.002  # a change smaller than this share of the screen is the cursor moving, not a click
LOCAL = 0.25  # a change covering at most this share of the screen is "here"; more is a new screen
WHOLE = 0.5  # a change covering at least this share is a new page or a scroll
GROUP = 0.5  # changes this close in time are one event (an animation, a menu opening)


def frames(path: Path, fps: int = FPS, width: int = WIDTH) -> tuple[np.ndarray, float]:
    """The recording as small grey frames [n, h, w], and the frame rate used."""
    from .media import probe

    info = probe(path)
    w, h = info["width"] or 16, info["height"] or 9
    height = max(2, int(round(width * h / w / 2)) * 2)
    raw = subprocess.run(
        ["ffmpeg", "-loglevel", "error", "-i", str(path), "-vf", f"fps={fps},scale={width}:{height},format=gray", "-f", "rawvideo", "-"],
        capture_output=True, check=True,
    ).stdout
    n = len(raw) // (width * height)
    return np.frombuffer(raw[: n * width * height], dtype=np.uint8).reshape(n, height, width), float(fps)


def changes(stack: np.ndarray, fps: float) -> list[dict]:
    """Where the picture changed between frames: [{at, x, y, w, h, share}] (fractions of the frame).

    The box is the middle 90% of the changed pixels, so a cursor far away doesn't stretch it.
    """
    if len(stack) < 2:
        return []
    n, H, W = stack.shape
    out = []
    prev = stack[0].astype(np.int16)
    for i in range(1, n):
        cur = stack[i].astype(np.int16)
        diff = np.abs(cur - prev) > CHANGED
        prev = cur
        count = int(diff.sum())
        share = count / (H * W)
        if share < MIN_SHARE:
            continue
        ys, xs = np.nonzero(diff)
        x0, x1 = np.percentile(xs, [5, 95])
        y0, y1 = np.percentile(ys, [5, 95])
        out.append({
            "at": round(i / fps, 3), "x": float((x0 + x1 + 1) / 2 / W), "y": float((y0 + y1 + 1) / 2 / H),
            "w": float((x1 - x0 + 1) / W), "h": float((y1 - y0 + 1) / H), "share": share,
        })
    return out


def events(found: list[dict], gap: float = GROUP) -> list[dict]:
    """Changes close together in time become one event: its first and last change, the box around them all,
    and whether it was local (a click) or a whole new screen."""
    groups: list[list[dict]] = []
    for c in found:
        if groups and c["at"] - groups[-1][-1]["at"] <= gap:
            groups[-1].append(c)
        else:
            groups.append([c])
    out = []
    for g in groups:
        whole = max(c["share"] for c in g) >= WHOLE
        local = [c for c in g if c["w"] * c["h"] <= LOCAL]
        if whole or not local:
            out.append({"at": g[0]["at"], "kind": "screen"})
            continue
        x0 = min(c["x"] - c["w"] / 2 for c in local)
        x1 = max(c["x"] + c["w"] / 2 for c in local)
        y0 = min(c["y"] - c["h"] / 2 for c in local)
        y1 = max(c["y"] + c["h"] / 2 for c in local)
        out.append({"at": local[0]["at"], "last": local[-1]["at"], "kind": "click", "x": (x0 + x1) / 2, "y": (y0 + y1) / 2, "w": x1 - x0, "h": y1 - y0})
    return out


def plan(evs: list[dict], duration: float, hold: float = 2.5, lead: float = 0.3, min_zoom: float = 1.4,
         max_zoom: float = 2.2, near: float = 0.12, shortest: float = 1.0) -> list[dict]:
    """Zooms from events: each click zooms in a little before it and holds; another click nearby keeps the
    zoom going; a new screen ends it."""
    zooms: list[dict] = []
    for e in evs:
        if e["kind"] == "screen":
            if zooms and zooms[-1]["end"] > e["at"]:
                zooms[-1]["end"] = e["at"]
            continue
        size = max(e["w"], e["h"], 1e-3)
        z = min(max_zoom, max(min_zoom, 0.55 / size))  # the changed area fills about half the view
        start = max(0.0, e["at"] - lead)
        end = min(duration, e.get("last", e["at"]) + hold)  # held from the last change of the event
        last = zooms[-1] if zooms else None
        if last and start <= last["end"] and abs(e["x"] - last["x"]) <= near and abs(e["y"] - last["y"]) <= near:
            last["end"] = max(last["end"], end)  # same spot again: keep holding
            continue
        if last and start < last["end"]:
            last["end"] = start  # somewhere else: the renderer pans across from the last zoom
        zooms.append({"start": start, "end": end, "x": e["x"], "y": e["y"], "zoom": z})
    return [
        {"start": round(z["start"], 3), "end": round(z["end"], 3), "x": round(z["x"], 3), "y": round(z["y"], 3), "zoom": round(z["zoom"], 2)}
        for z in zooms if z["end"] - z["start"] >= shortest
    ]


def find_zooms(path: Path) -> list[dict]:
    stack, fps = frames(path)
    return plan(events(changes(stack, fps)), len(stack) / fps)


def auto_zoom(project: Path, log=print) -> dict:
    """Replace the reel's zooms with ones found from the footage."""
    from . import pipeline

    spec = pipeline.load(project)
    zooms = find_zooms(Path(spec["source"]["src"]))
    spec["zooms"] = zooms
    log(f"zoom on clicks: {len(zooms)} zoom{'' if len(zooms) == 1 else 's'}")
    pipeline.save(project, spec)
    return spec
