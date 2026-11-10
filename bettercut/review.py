"""Review links: share the latest render, and let people leave comments pinned to a moment and a spot.

A project's review lives in `review.json` next to its spec: the link's secret `token` and the comments.
Anyone with the link can watch the latest render and comment; only the editor can resolve or delete
comments, or stop sharing (which makes the old link stop working).

A comment is {id, name, text, at, x, y, version, created, done}: `at` is seconds into the render it was
left on (`version`, the render's file name), `x`, `y` the spot on the picture as fractions (or null for
the whole frame).
"""
from __future__ import annotations

import json
import secrets
import threading
import time
import uuid
from pathlib import Path

FILE = "review.json"
MAX_TEXT = 2000
MAX_NAME = 60
MAX_COMMENTS = 500
_LOCK = threading.Lock()


def _path(project: Path) -> Path:
    return project / FILE


def load(project: Path) -> dict:
    p = _path(project)
    if not p.exists():
        return {"token": None, "comments": []}
    try:
        data = json.loads(p.read_text())
    except (OSError, ValueError):
        return {"token": None, "comments": []}
    return {"token": data.get("token"), "comments": list(data.get("comments") or [])}


def _save(project: Path, data: dict) -> None:
    p = _path(project)
    tmp = p.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, indent=1))
    tmp.replace(p)


def share(project: Path) -> str:
    """The project's review token, made the first time it is shared."""
    with _LOCK:
        data = load(project)
        if not data["token"]:
            data["token"] = secrets.token_urlsafe(16)
            _save(project, data)
        return data["token"]


def unshare(project: Path) -> None:
    """Stop sharing: the old link stops working. Comments are kept; sharing again makes a new link."""
    with _LOCK:
        data = load(project)
        data["token"] = None
        _save(project, data)


def find(projects: Path, token: str) -> Path | None:
    """The project a review token belongs to."""
    if not token or len(token) > 64:
        return None
    for f in projects.glob(f"*/{FILE}"):
        try:
            if secrets.compare_digest(str(json.loads(f.read_text()).get("token") or ""), token):
                return f.parent
        except (OSError, ValueError):
            continue
    return None


def latest_render(project: Path) -> Path | None:
    """The newest full-size render (not the phone copy or a ProRes master)."""
    files = [f for f in (project / "renders").glob("*.mp4") if not f.stem.endswith("-phone")]
    return max(files, key=lambda f: f.stat().st_mtime) if files else None


def _spot(v) -> float | None:
    if v is None:
        return None
    v = float(v)
    if v != v:  # NaN
        return None
    return round(min(1.0, max(0.0, v)), 4)


def add_comment(project: Path, name: str, text: str, at: float, x=None, y=None, version: str = "") -> dict:
    name = " ".join(str(name or "").split())[:MAX_NAME] or "Reviewer"
    text = str(text or "").strip()[:MAX_TEXT]
    if not text:
        raise ValueError("write a comment first")
    at = float(at)
    if at != at or at < 0:
        raise ValueError("bad time")
    c = {"id": uuid.uuid4().hex[:10], "name": name, "text": text, "at": round(at, 3), "x": _spot(x), "y": _spot(y),
         "version": Path(str(version or "")).name, "created": int(time.time()), "done": False}
    if (c["x"] is None) != (c["y"] is None):
        c["x"] = c["y"] = None
    with _LOCK:
        data = load(project)
        if len(data["comments"]) >= MAX_COMMENTS:
            raise ValueError("this review has too many comments")
        data["comments"].append(c)
        _save(project, data)
    return c


def set_done(project: Path, cid: str, done: bool) -> dict:
    with _LOCK:
        data = load(project)
        for c in data["comments"]:
            if c["id"] == cid:
                c["done"] = bool(done)
                _save(project, data)
                return c
    raise KeyError(cid)


def delete_comment(project: Path, cid: str) -> None:
    with _LOCK:
        data = load(project)
        keep = [c for c in data["comments"] if c["id"] != cid]
        if len(keep) == len(data["comments"]):
            raise KeyError(cid)
        data["comments"] = keep
        _save(project, data)


def comments(project: Path) -> list[dict]:
    return sorted(load(project)["comments"], key=lambda c: (c.get("at", 0), c.get("created", 0)))
