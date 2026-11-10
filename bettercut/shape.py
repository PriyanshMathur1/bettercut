"""The shape (aspect ratio) and frame rate of a project.

A project keeps the shape and frame rate of its footage: landscape clips make a landscape project,
24 fps footage stays 24 fps. Any project can still be rendered to the other shapes.
"""
from __future__ import annotations

# shape id -> frame size in pixels
SHAPES: dict[str, tuple[int, int]] = {
    "9x16": (1080, 1920),
    "4x5": (1080, 1350),
    "1x1": (1080, 1080),
    "16x9": (1920, 1080),
}
AUTO = "auto"
# frame rates a project can have; footage at any other rate is converted to the nearest
RATES = (24, 25, 30, 50, 60)


def nearest(width: int, height: int) -> str:
    """The standard shape closest to a picture of this size (9x16 if the size is unknown)."""
    if width <= 0 or height <= 0:
        return "9x16"
    ratio = width / height
    return min(SHAPES, key=lambda s: abs(SHAPES[s][0] / SHAPES[s][1] - ratio))


def pick_rate(fps: float) -> int:
    """The project frame rate for footage at `fps`: 23.976 -> 24, 29.97 -> 30, 59.94 -> 60."""
    if not fps or fps <= 0:
        return 30
    return min(RATES, key=lambda r: (abs(r - fps), r))


def resolve(shape: str | None, fps: float | str | None, clip: dict) -> tuple[str, int, int, int]:
    """Decide a new project's shape and frame rate. `clip` is the first clip's probe (width, height, fps).

    `shape` is a shape id or "auto" (follow the clip); `fps` is a rate or "auto" (follow the clip).
    Returns (shape id, width, height, fps).
    """
    sid = nearest(clip.get("width", 0), clip.get("height", 0)) if shape in (None, "", AUTO) else shape
    if sid not in SHAPES:
        raise ValueError(f"unknown shape '{shape}': use auto, " + ", ".join(SHAPES))
    rate = pick_rate(clip.get("fps", 30)) if fps in (None, "", AUTO) else pick_rate(float(fps))
    w, h = SHAPES[sid]
    return sid, w, h, rate


def native(spec: dict) -> str:
    """The shape a project was made in. Reels made before shapes existed are 9x16."""
    return nearest(int(spec.get("width") or 1080), int(spec.get("height") or 1920))


def aspects_for(spec: dict, asked: list[str] | None) -> list[str]:
    """The shapes to render: the ones asked for ("native" means the project's own), else the project's own."""
    own = native(spec)
    out: list[str] = []
    for a in asked or []:
        a = own if a == "native" else a
        if a in SHAPES and a not in out:
            out.append(a)
    return out or [own]


def tag(spec: dict, aspect: str) -> str:
    """File-name suffix for a render: none for the project's own shape, "-16x9" and so on for the others."""
    return "" if aspect == native(spec) else f"-{aspect}"
