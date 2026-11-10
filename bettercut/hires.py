"""4K renders from the full-size clips.

The editor works on footage assembled at the project's size (1080 wide for a vertical reel), which keeps the
preview light. A 4K render rebuilds that footage at twice the size from the original clips, with the exact same
cuts, crops and timing, and renders the reel at twice the scale, so text and graphics are drawn at 4K too.

When the clips themselves are smaller than 4K, the footage is scaled up (the text is still sharp); the render
log says so.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

SCALE = 2


def _clips(project: Path) -> tuple[list[dict], bool]:
    f = project / "work" / "clips.json"
    if not f.exists():
        return [], False
    data = json.loads(f.read_text(encoding="utf-8"))
    return list(data.get("clips") or []), bool(data.get("stabilize"))


def sharpness(clips: list[dict], width: int, height: int, sizes: dict[str, tuple[int, int]]) -> float:
    """How much real detail a 2x render gets from the clips: 2 means every clip has at least 4K's worth of
    pixels where the frame needs them, 1 means they are the project's size (a 4K render is then scaled up).
    The weakest clip decides it."""
    worst = float(SCALE)
    for c in clips:
        cw, ch = sizes.get(c["path"], (0, 0))
        if not cw or not ch:
            continue
        cover = max(width / cw, height / ch)  # how much the clip is scaled to fill the frame
        worst = min(worst, 1 / cover)
    return round(max(0.0, worst), 2)


def master_key(clips: list[dict], width: int, height: int, fps: float, stabilize: bool) -> str:
    stamp = []
    for c in clips:
        p = Path(c["path"])
        stamp.append([str(p), p.stat().st_mtime if p.exists() else None, c.get("start"), c.get("duration")])
    return hashlib.sha1(json.dumps([stamp, width, height, round(fps, 3), stabilize]).encode()).hexdigest()[:12]


def ensure_master(project: Path, spec: dict, log=print) -> Path:
    """The project's footage rebuilt at twice the size from its clips (made once, then reused)."""
    from . import media

    clips, stabilize = _clips(project)
    if not clips:
        raise RuntimeError("4K needs the original clips, and this reel has no record of them")
    missing = [c["path"] for c in clips if not Path(c["path"]).exists()]
    if missing:
        raise RuntimeError("4K needs the original clips, and these are gone: " + ", ".join(Path(m).name for m in missing))
    src = spec["source"]
    w, h = int(src.get("width") or spec.get("width") or 1080), int(src.get("height") or spec.get("height") or 1920)
    fps = float(src.get("fps") or spec.get("fps") or 30)
    W, H = w * SCALE, h * SCALE
    key = master_key(clips, W, H, fps, stabilize)
    out = project / "assets" / f"master-{key}.mp4"
    if not out.exists():
        sizes = {c["path"]: (lambda i: (i["width"], i["height"]))(media.probe(c["path"])) for c in clips}
        sharp = sharpness(clips, w, h, sizes)
        if sharp < SCALE:
            log(f"4K: your clips have about {sharp:.1f}x the detail of the edit (2x is full 4K); the footage is scaled up, text and graphics are still sharp")
        log(f"4K: rebuilding the footage at {W}x{H} from {len(clips)} clip(s)")
        tmp = out.with_name(out.stem + ".part.mp4")
        info = media.assemble([Path(c["path"]) for c in clips], tmp, width=W, height=H, fps=int(round(fps)), stabilize=stabilize)
        want = float(src.get("duration") or 0)
        if want and abs(info["duration"] - want) > max(0.1, 2 / fps):
            tmp.unlink(missing_ok=True)
            raise RuntimeError(f"4K footage came out {info['duration']:.2f}s long instead of {want:.2f}s, so its cuts wouldn't line up")
        tmp.replace(out)
        for old in (project / "assets").glob("master-*.mp4"):
            if old != out:
                old.unlink(missing_ok=True)
    return out


def spec_for_4k(spec: dict, project: Path, log=print) -> dict:
    """A copy of a prepared spec that plays the full-size footage (graded the same way when the reel has a grade).

    The cut-out, reversed shots and other cameras stay at the edit's size and are scaled up.
    """
    from . import colour

    master = ensure_master(project, spec, log)
    hi = json.loads(json.dumps(spec))
    src = hi["source"]
    keep = {k: src.get(k) for k in ("matte", "gradedMatte")}
    for k in ("graded", "gradedMatte", "matte"):
        src.pop(k, None)
    (hi.get("grade") or {}).pop("baked", None)
    src["src"] = str(master)
    if colour.needs_bake(hi):
        hi = colour.bake(hi, project, log=log, tidy=False)
    for k, v in keep.items():
        if v:
            hi["source"][k] = v
    return hi
