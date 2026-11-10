"""Edit decisions from a word-level transcript. Pure functions, no I/O.

- pick_takes:    when a line is repeated, keep the last complete take (people repeat until it lands)
- mark_fillers:  um / uh / erm and stutters ("I I think")
- build_segments: keep speech, cut dead air longer than `max_gap`, pad cut points so words aren't clipped
"""
from __future__ import annotations

import re
from difflib import SequenceMatcher
from typing import Iterable

FILLERS = {"um", "uh", "uhm", "umm", "erm", "er", "ah", "hmm", "mm", "mhm"}
_PUNCT = re.compile(r"[^\w']+")


def norm(text: str) -> str:
    return _PUNCT.sub("", text.lower())


def sentences(words: list[dict], pause: float = 0.7) -> list[list[int]]:
    """Split word indices into lines: sentence punctuation or a pause longer than `pause`."""
    out: list[list[int]] = []
    cur: list[int] = []
    for i, w in enumerate(words):
        if cur and w["start"] - words[cur[-1]]["end"] > pause:
            out.append(cur)
            cur = []
        cur.append(i)
        if re.search(r"[.!?]$", w["text"].strip()):
            out.append(cur)
            cur = []
    if cur:
        out.append(cur)
    return out


def _tokens(words: list[dict], idx: Iterable[int]) -> list[str]:
    return [t for t in (norm(words[i]["text"]) for i in idx) if t and t not in FILLERS]


def similarity(a: list[str], b: list[str]) -> float:
    if not a or not b:
        return 0.0
    return SequenceMatcher(None, a, b).ratio()


def pick_takes(words: list[dict], lookahead: int = 3, threshold: float = 0.6) -> list[dict]:
    """Mark earlier takes of repeated lines as cut. Returns a new word list.

    A line is a retake of a later line when the token sequences are similar, or when it is a
    false start (shorter line whose tokens open the later line).
    """
    words = [dict(w) for w in words]
    lines = sentences(words)
    toks = [_tokens(words, ln) for ln in lines]
    for i, ln in enumerate(lines):
        if not toks[i]:
            continue
        for j in range(i + 1, min(len(lines), i + 1 + lookahead)):
            a, b = toks[i], toks[j]
            if not b:
                continue
            false_start = len(a) < len(b) and len(a) >= 1 and b[: len(a)] == a
            retake = similarity(a, b) >= threshold and len(a) >= 2
            if false_start or retake:
                for k in ln:
                    words[k]["cut"] = True
                    words[k]["cutReason"] = "retake"
                break
    return words


def mark_fillers(words: list[dict]) -> list[dict]:
    words = [dict(w) for w in words]
    prev = None
    for w in words:
        n = norm(w["text"])
        if n in FILLERS:
            w["cut"] = True
            w.setdefault("cutReason", "filler")
        elif prev is not None and n and not n.isdigit() and n == norm(prev["text"]) and not prev.get("cut") and len(n) <= 4:
            # stutter: drop the first of two identical short words in a row
            prev["cut"] = True
            prev.setdefault("cutReason", "stutter")
        prev = w
    return words


def build_segments(
    words: list[dict],
    duration: float,
    max_gap: float = 0.35,
    pad_in: float = 0.06,
    pad_out: float = 0.1,
    silences: list[tuple[float, float]] | None = None,
    respect_cuts: bool = False,
) -> list[dict]:
    """Segments of speech. Gaps between words longer than `max_gap` are cut.

    By default cut-marked words still shape the segments: the renderer removes them through
    their `cut` flag, so un-cutting a word in the editor brings it straight back.

    `silences` (from ffmpeg silencedetect) refine where a segment ends: whisper word ends can
    run long, so a segment ends at the start of the silence that follows its last word.
    """
    kept = [w for w in words if not (respect_cuts and w.get("cut"))]
    if not kept:
        return []
    segs: list[dict] = []
    s_start = kept[0]["start"]
    last_end = kept[0]["end"]
    for w in kept[1:]:
        if w["start"] - last_end > max_gap:
            segs.append({"start": s_start, "end": last_end})
            s_start = w["start"]
        last_end = max(last_end, w["end"])
    segs.append({"start": s_start, "end": last_end})

    out = []
    for i, s in enumerate(segs):
        start = max(0.0, s["start"] - pad_in)
        end = min(duration, s["end"] + pad_out)
        if silences:
            for a, b in silences:
                if s["end"] - 0.05 <= a <= end:
                    end = min(end, a + 0.04)
                    break
        if out and start < out[-1]["end"]:
            start = out[-1]["end"]
        if end - start >= 0.12:
            out.append({"id": f"s{len(out) + 1}", "start": round(start, 3), "end": round(end, 3)})
    return out


def speech_stats(words: list[dict]) -> dict:
    kept = [w for w in words if not w.get("cut")]
    if len(kept) < 2:
        return {"words": len(kept), "wps": 0.0}
    span = kept[-1]["end"] - kept[0]["start"]
    return {"words": len(kept), "wps": round(len(kept) / max(span, 0.1), 2)}
