"""Python twin of composer/src/reel/timeline.ts (segment placement only).

Keep the two in step: tests/bettercut/test_timeline.py uses the same vectors as
composer/tests/reel/timeline.test.ts.
"""
from __future__ import annotations

EPS = 1e-6


def sort_and_merge(spans: list[dict], min_length: float = 0.04) -> list[dict]:
    out: list[dict] = []
    for s in sorted((dict(x) for x in spans if x["end"] - x["start"] > EPS), key=lambda x: x["start"]):
        if out and s["start"] <= out[-1]["end"] + EPS:
            out[-1]["end"] = max(out[-1]["end"], s["end"])
        else:
            out.append(s)
    return [s for s in out if s["end"] - s["start"] >= min_length]


def subtract_spans(segments: list[dict], cuts: list[dict]) -> list[dict]:
    merged = sort_and_merge(cuts, 0)
    out = []
    for seg in segments:
        pieces = [{"start": seg["start"], "end": seg["end"]}]
        for c in merged:
            nxt = []
            for p in pieces:
                if c["end"] <= p["start"] or c["start"] >= p["end"]:
                    nxt.append(p)
                    continue
                if c["start"] > p["start"]:
                    nxt.append({"start": p["start"], "end": c["start"]})
                if c["end"] < p["end"]:
                    nxt.append({"start": c["end"], "end": p["end"]})
            pieces = nxt
        pieces = [p for p in pieces if p["end"] - p["start"] >= 0.04]
        for i, p in enumerate(pieces):
            sid = seg.get("id")
            piece = {**seg, "start": p["start"], "end": p["end"], **({"id": f"{sid}.{i}"} if sid is not None and len(pieces) > 1 else {})}
            if i < len(pieces) - 1:
                piece.pop("hold", None)  # a freeze frame belongs to the end of the shot
            if i > 0:
                piece.pop("join", None)  # a seamless join belongs to its start
                piece.pop("transition", None)  # so does the transition into the shot
            out.append(piece)
    return out


def cut_word_spans(words: list[dict]) -> list[dict]:
    spans = []
    for i, w in enumerate(words):
        if not w.get("cut"):
            continue
        nxt = words[i + 1] if i + 1 < len(words) else None
        prev = words[i - 1] if i > 0 else None
        start = max(prev["end"], w["start"] - 0.02) if prev and not prev.get("cut") else w["start"]
        end = max(w["end"], min(nxt["start"], w["end"] + 0.5) - 0.03) if nxt else w["end"]
        spans.append({"start": start, "end": max(end, start)})
    return sort_and_merge(spans, 0)


def speed_of(seg: dict) -> float:
    v = seg.get("speed") or 1
    return min(4.0, max(0.25, v)) if v > 0 else 1.0


def hold_of(seg: dict) -> float:
    v = seg.get("hold") or 0
    return min(10.0, v) if v > 0 else 0.0


def place_segments(spec: dict) -> list[dict]:
    """Shots on the output timeline, in listed order (the editor can reorder them)."""
    kept = subtract_spans(spec.get("segments", []), cut_word_spans(spec.get("words", [])))
    t = 0.0
    shot = -1
    out = []
    for i, s in enumerate(kept):
        if not (s.get("join") and i > 0):
            shot += 1
        d = (s["end"] - s["start"]) / speed_of(s) + hold_of(s)
        out.append({**s, "index": i, "shot": shot, "outStart": t, "outEnd": t + d})
        t += d
    return out


def to_output(placed: list[dict], t: float) -> float | None:
    for s in placed:
        if s["start"] - EPS <= t <= s["end"] + EPS:
            return s["outStart"] + min(max(t - s["start"], 0), s["end"] - s["start"]) / speed_of(s)
    return None


def output_words(spec: dict) -> list[dict]:
    """Kept words with output times (for SRT/VTT export)."""
    placed = place_segments(spec)
    out = []
    for w in spec.get("words", []):
        if w.get("cut"):
            continue
        a, b = to_output(placed, w["start"]), to_output(placed, w["end"])
        if a is None or b is None:
            continue
        out.append({**w, "outStart": a, "outEnd": max(b, a + 0.05)})
    return sorted(out, key=lambda w: w["outStart"])  # output order (shots may be reordered)


def total_duration(spec: dict) -> float:
    placed = place_segments(spec)
    body = placed[-1]["outEnd"] if placed else 0.0
    ec = spec.get("endCard") or {}
    return body + (ec.get("duration", 0) if ec.get("enabled") else 0)
