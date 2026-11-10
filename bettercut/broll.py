"""Auto b-roll: stock clips for the reel's punch words from Pexels (free licence, needs PEXELS_API_KEY,
https://www.pexels.com/api/). Clips land in assets/broll/ and are added to spec.broll as cutaways."""
from __future__ import annotations

import json
import os
import urllib.parse
import urllib.request
from pathlib import Path

from .enrich import STOP
from .autocut import norm


def api_key() -> str | None:
    key = os.environ.get("PEXELS_API_KEY")
    if key:
        return key
    env = Path(__file__).resolve().parent.parent / ".env"
    if env.exists():
        for line in env.read_text(encoding="utf-8").splitlines():
            if line.startswith("PEXELS_API_KEY=") and line.split("=", 1)[1].strip():
                return line.split("=", 1)[1].strip().strip('"')
    return None


def keywords(spec: dict, limit: int = 4, min_gap: float = 3.0) -> list[dict]:
    """Punch words worth illustrating, spaced out in time (source seconds)."""
    out, last = [], -99.0
    for w in spec.get("words", []):
        n = norm(w["text"])
        if not w.get("emphasis") or w.get("cut") or n in STOP or len(n) < 4 or any(ch.isdigit() for ch in n):
            continue
        if w["start"] - last < min_gap:
            continue
        out.append({"word": n, "start": w["start"]})
        last = w["start"]
        if len(out) >= limit:
            break
    return out


def search(query: str, key: str, portrait: bool = True) -> str | None:
    q = urllib.parse.urlencode({"query": query, "per_page": 5, "orientation": "portrait" if portrait else "landscape", "size": "medium"})
    req = urllib.request.Request(f"https://api.pexels.com/videos/search?{q}", headers={"Authorization": key, "User-Agent": "bettercut"})
    with urllib.request.urlopen(req, timeout=30) as r:
        data = json.loads(r.read())
    for v in data.get("videos", []):
        files = sorted((f for f in v.get("video_files", []) if f.get("file_type") == "video/mp4" and (f.get("height") or 0) >= 720), key=lambda f: f.get("height") or 0)
        if files:
            return files[0]["link"]
    return None


def add_broll(spec: dict, project: Path, mode: str = "card", seconds: float = 1.8, log=print) -> dict:
    key = api_key()
    if not key:
        raise RuntimeError("Set PEXELS_API_KEY (free at pexels.com/api) to fetch b-roll automatically")
    d = project / "assets" / "broll"
    d.mkdir(parents=True, exist_ok=True)
    spec = json.loads(json.dumps(spec))
    for kw in keywords(spec):
        link = search(kw["word"], key)
        if not link:
            log(f"no stock clip for '{kw['word']}'")
            continue
        dst = d / f"{kw['word']}.mp4"
        if not dst.exists():
            urllib.request.urlretrieve(link, dst)
        spec.setdefault("broll", []).append({"src": str(dst), "start": round(kw["start"], 2), "end": round(kw["start"] + seconds, 2), "mode": mode})
        log(f"b-roll for '{kw['word']}' at {kw['start']:.1f}s")
    return spec
