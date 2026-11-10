"""Per-user memory. Three kinds, all visible and editable in Settings > Memory:

- spelling:   names and jargon ("Diners Club", "SmartBuy"). Fed to Whisper's prompt and the name fixer, so
              new reels spell them right from the start.
- preference: a partial spec merged into every new reel ({"captions": {"scale": 1.15}}).
- style:      free-text guidance for the AI editor ("hooks are questions", "no emoji").

The AI can only *propose* memories (status "proposed"); the user keeps or dismisses them.
"""
from __future__ import annotations

from sqlalchemy import select

from ..spec import merge
from . import db

KINDS = ("spelling", "preference", "style")
MAX_PROMPT_ITEMS = 60


def active(user_id: str) -> list[db.Memory]:
    with db.session() as s:
        return list(s.scalars(select(db.Memory).where(db.Memory.user_id == user_id, db.Memory.status == "active").order_by(db.Memory.created)))


def spellings(mems: list[db.Memory]) -> list[str]:
    out: list[str] = []
    for m in mems:
        if m.kind == "spelling":
            out += [p.strip() for p in m.text.split(",") if p.strip()]
    return out


def preferences(mems: list[db.Memory]) -> dict:
    patch: dict = {}
    for m in mems:
        if m.kind == "preference" and isinstance(m.value, dict):
            patch = merge(patch, m.value)
    return patch


def apply_preferences(spec: dict, mems: list[db.Memory]) -> dict:
    p = preferences(mems)
    return merge(spec, p) if p else spec


def prompt_block(mems: list[db.Memory]) -> str:
    if not mems:
        return "No saved preferences yet."
    lines = []
    for m in mems[-MAX_PROMPT_ITEMS:]:
        extra = f" (applied as {m.value})" if m.kind == "preference" and m.value else ""
        lines.append(f"- [{m.kind}] {m.text}{extra}")
    return "\n".join(lines)


def propose(user_id: str, kind: str, text: str, value: dict | None = None) -> str | None:
    """Agent suggestion; skipped when an identical memory already exists."""
    kind = kind if kind in KINDS else "style"
    text = text.strip()[:500]
    if not text:
        return None
    with db.session() as s:
        dup = s.scalars(select(db.Memory).where(db.Memory.user_id == user_id, db.Memory.text == text)).first()
        if dup:
            return None
        m = db.Memory(user_id=user_id, kind=kind, text=text, value=value, status="proposed", source="agent")
        s.add(m)
        s.flush()
        return m.id
