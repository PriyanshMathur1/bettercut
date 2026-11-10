"""Reverse playback for single shots.

A browser or renderer can't play a file backwards, so a shot marked `reverse: true` gets its own small file
with that stretch of footage reversed (`assets/rev-<key>.mp4`). The shot records which stretch the file
covers, so trimming the shot inwards keeps working without making the file again.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

from . import media


def base_of(spec: dict) -> str:
    """The footage a reversed shot is cut from: the graded file when there is one."""
    return spec["source"].get("graded") or spec["source"]["src"]


def covers(seg: dict, base: str) -> bool:
    r = seg.get("reversed")
    return bool(r and r.get("of") == base and Path(r.get("src", "")).exists()
                and r["start"] <= seg["start"] + 1e-3 and r["end"] >= seg["end"] - 1e-3)


def is_current(spec: dict) -> bool:
    base = base_of(spec)
    return all(covers(s, base) if s.get("reverse") else "reversed" not in s for s in spec.get("segments", []))


def bake(spec: dict, project: Path, log=print) -> dict:
    """Make the reversed file for every shot marked `reverse` (and forget files no longer needed)."""
    spec = json.loads(json.dumps(spec))
    base = base_of(spec)
    for seg in spec.get("segments", []):
        if not seg.get("reverse"):
            seg.pop("reversed", None)
            continue
        if covers(seg, base):
            continue
        key = hashlib.sha1(json.dumps([base, Path(base).stat().st_mtime_ns if Path(base).exists() else 0, seg["start"], seg["end"]]).encode()).hexdigest()[:12]
        out = project / "assets" / f"rev-{key}.mp4"
        if not out.exists():
            log(f"reversing {seg['end'] - seg['start']:.1f}s of footage")
            media.reverse_span(Path(base), seg["start"], seg["end"], out)
        seg["reversed"] = {"src": str(out), "start": seg["start"], "end": seg["end"], "of": base}
    return spec
