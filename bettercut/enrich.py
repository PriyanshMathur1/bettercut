"""Automatic creative decisions on top of the transcript. Pure functions, no I/O.

- emphasis:  pick punch words (numbers, strong/long words, user keywords), spaced out in time
- emoji:     attach emoji to words with a clear meaning
- hook:      a short hook title from the first line
- fixes:     correct common mishearings of user-supplied names
"""
from __future__ import annotations

import re
from difflib import get_close_matches

from .autocut import norm, sentences

STOP = set(
    """a an the and or but if then so to of in on at for with from by as is are was were be been being it its
    this that these those i you he she we they me my your our their his her them us do does did done have has
    had not no yes just very really can could would should will shall may might must there here what which who
    whom whose when where why how all any some more most other such only own same than too also about into over
    after before again further once get got going gonna wanna like dont doesnt didnt im ive youre thats its""".split()
)

STRONG = {
    "never", "always", "free", "secret", "mistake", "mistakes", "stop", "best", "worst", "money", "fast", "faster",
    "easy", "hard", "everyone", "nobody", "wrong", "right", "huge", "insane", "crazy", "simple", "truth", "why",
    "rich", "broke", "million", "billion", "growth", "hack", "rule", "rules", "today", "now", "results",
}

EMOJI = {
    "money": "💰", "cash": "💵", "rich": "🤑", "broke": "💸", "invest": "📈", "investing": "📈", "growth": "📈",
    "stock": "📊", "stocks": "📊", "fire": "🔥", "hot": "🔥", "love": "❤️", "heart": "❤️", "idea": "💡", "ideas": "💡",
    "think": "🤔", "brain": "🧠", "time": "⏰", "fast": "⚡", "faster": "⚡", "quick": "⚡", "secret": "🤫",
    "mistake": "❌", "mistakes": "❌", "wrong": "❌", "right": "✅", "correct": "✅", "yes": "✅", "no": "🚫",
    "stop": "🛑", "warning": "⚠️", "goal": "🎯", "goals": "🎯", "target": "🎯", "win": "🏆", "best": "🏆",
    "phone": "📱", "app": "📱", "computer": "💻", "code": "💻", "ai": "🤖", "robot": "🤖", "world": "🌍",
    "travel": "✈️", "home": "🏠", "house": "🏠", "food": "🍔", "coffee": "☕", "book": "📚", "learn": "📚",
    "work": "💼", "job": "💼", "business": "💼", "rocket": "🚀", "launch": "🚀", "start": "🚀", "eyes": "👀",
    "look": "👀", "watch": "👀", "crazy": "🤯", "insane": "🤯", "mind": "🤯", "happy": "😄", "sad": "😢",
    "free": "🆓", "gift": "🎁", "magic": "✨", "new": "✨", "music": "🎵", "camera": "📸", "video": "🎬",
}

_NUM = re.compile(r"\d")


_CONTINUATION = re.compile(r"^(?:[.,]\d+|%|-\w[\w-]*)[^\w]*$")


def merge_split_tokens(words: list[dict]) -> list[dict]:
    """Rejoin pieces Whisper splits off a word: "3" ".3" "%" -> "3.3%", "10" ",000" -> "10,000",
    "add" "-on" -> "add-on". Otherwise the stutter cutter sees "3" ".3" as a repeat and the caption
    reads ".3%"."""
    out: list[dict] = []
    for w in words:
        text = w["text"]
        prev = out[-1] if out else None
        if (prev and _CONTINUATION.match(text) and not prev.get("cut")
                and w["start"] - prev["end"] < 0.35 and not re.search(r"[.!?]$", prev["text"])
                and (text[0] not in ".,%" or re.search(r"\d[%]?$", prev["text"]))):
            out[-1] = {**prev, "text": prev["text"] + text, "end": w["end"]}
            continue
        out.append(dict(w))
    return out


def fix_names(words: list[dict], names: list[str]) -> list[dict]:
    """Snap words that sound like a supplied name/keyword onto its spelling ("cloud" -> "Claude")."""
    if not names:
        return words
    lookup = {norm(n): n for n in names if norm(n)}
    out = []
    for w in words:
        n = norm(w["text"])
        m = get_close_matches(n, list(lookup), n=1, cutoff=0.75) if n and len(n) > 3 else []
        if m and m[0] != n:
            trail = re.search(r"[^\w']+$", w["text"])
            w = {**w, "text": lookup[m[0]] + (trail.group(0) if trail else "")}
        out.append(w)
    return out


def score_word(text: str, keywords: set[str]) -> float:
    n = norm(text)
    if not n or n in STOP:
        return 0.0
    s = 0.0
    if n in keywords:
        s += 5
    if _NUM.search(text):
        s += 4
    if n in STRONG:
        s += 3
    if text.strip().endswith("!"):
        s += 1.5
    s += min(len(n), 12) / 4
    return s


def pick_emphasis(words: list[dict], keywords: list[str] | None = None, min_spacing: float = 2.2, per_line: int = 1) -> list[dict]:
    """Mark punch words: at most `per_line` per line, at least `min_spacing` seconds apart."""
    keys = {norm(k) for k in (keywords or [])}
    words = [dict(w) for w in words]
    last_t = -999.0
    for line in sentences(words):
        cand = sorted(
            ((score_word(words[i]["text"], keys), i) for i in line if not words[i].get("cut")),
            reverse=True,
        )
        taken = 0
        for sc, i in cand:
            if taken >= per_line or sc < 2.5:
                break
            if words[i]["start"] - last_t < min_spacing:
                continue
            words[i]["emphasis"] = True
            last_t = words[i]["start"]
            taken += 1
    return words


def attach_emoji(words: list[dict], only_emphasis: bool = True) -> list[dict]:
    out = []
    for w in words:
        e = EMOJI.get(norm(w["text"]))
        if e and (w.get("emphasis") or not only_emphasis):
            w = {**w, "emoji": e}
        out.append(w)
    return out


def hook_text(words: list[dict], max_words: int = 7) -> str:
    """First kept line, trimmed to `max_words`, without trailing punctuation."""
    kept = [w for w in words if not w.get("cut")]
    for line in sentences(kept):
        toks = [kept[i]["text"] for i in line]
        if len(toks) >= 3:
            text = " ".join(toks[:max_words])
            return re.sub(r"[,.;:]+$", "", text)
    return ""
