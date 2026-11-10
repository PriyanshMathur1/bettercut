"""BetterCut as an MCP connector: edit reels from Claude, ChatGPT or any MCP client, with no API key.

The direction is reversed from `agent.py`. There, BetterCut calls the user's model with their key. Here the
user's own AI app (on their normal subscription) calls BetterCut's editing tools over MCP, and the browser
editor shows each change as it lands.

Transport: MCP Streamable HTTP, stateless, JSON responses (no SSE needed: every tool answers at once and long
work, like a render, is a job the client polls with `job_status`).

Auth: a personal connector link, `<site>/mcp/<token>`. The token is the secret: it is shown in Settings >
Connect, can be regenerated or switched off there, and is stored hashed (plus encrypted, so Settings can show
the link again). In AUTH_MODE=dev the bare `/mcp` also works for the single local user.
"""
from __future__ import annotations

import hashlib
import json
import re
import secrets
import time

from sqlalchemy import func, select

from . import agent, db, guard, jobs, memory, storage, vault
from .config import settings

SUPPORTED = ("2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05")
ASPECTS = ("9x16", "4x5", "1x1", "16x9")
QUALITIES = ("draft", "high")  # max/master stay in the editor: they are slow on the free server

INSTRUCTIONS = (
    "BetterCut edits vertical video reels. Each reel is one JSON spec; you change it only with patch_spec, and the "
    "creator watches the change appear in their browser editor. Start with list_reels, call get_guide once before "
    "your first edit, read only what you need with get_spec / find_words, then patch_spec. Make exactly the "
    "changes asked for. Every patch is one Undo step (undo reverts your latest one). Offer a draft render when the "
    "creator wants to see the result as a file."
)


# ---- connector links -------------------------------------------------------------------

def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def create(user_id: str) -> str:
    """Make (or replace) the user's connector link. Returns the token."""
    token = secrets.token_urlsafe(32)
    with db.session() as s:
        for old in s.scalars(select(db.Connector).where(db.Connector.user_id == user_id)):
            s.delete(old)
        s.flush()
        s.add(db.Connector(user_id=user_id, token_hash=_hash(token), token_enc=vault.encrypt(token, user_id)))
    return token


def revoke(user_id: str) -> None:
    with db.session() as s:
        for old in s.scalars(select(db.Connector).where(db.Connector.user_id == user_id)):
            s.delete(old)


def current(user_id: str) -> dict | None:
    with db.session() as s:
        c = s.scalars(select(db.Connector).where(db.Connector.user_id == user_id)).first()
        if c is None:
            return None
        return {"token": vault.decrypt(c.token_enc, user_id), "created": c.created, "lastUsed": c.last_used}


def user_for(token: str) -> str | None:
    if not re.fullmatch(r"[A-Za-z0-9_-]{20,100}", token or ""):
        return None
    with db.session() as s:
        c = s.scalars(select(db.Connector).where(db.Connector.token_hash == _hash(token))).first()
        if c is None:
            return None
        if time.time() - (c.last_used or 0) > 60:
            c.last_used = time.time()
        return c.user_id


# ---- tools -----------------------------------------------------------------------------

REEL = {"reel": {"type": "string", "description": "Reel id, from list_reels"}}


def _tool(name: str, description: str, props: dict, required: list[str], read_only: bool = False) -> dict:
    return {"name": name, "description": description, "inputSchema": {"type": "object", "properties": props, "required": required},
            "annotations": {"readOnlyHint": read_only}}


def _from_agent(name: str, read_only: bool, reel: bool = True) -> dict:
    f = next(t["function"] for t in agent.TOOLS if t["function"]["name"] == name)
    p = f["parameters"]
    return _tool(name, f["description"], {**(REEL if reel else {}), **p["properties"]}, [*(["reel"] if reel else []), *p["required"]], read_only)


TOOLS = [
    _tool("list_reels", "The creator's reels (id, title, length) with a link to open each in the browser editor, plus what "
          "they want every time (their saved memory).", {}, [], True),
    _tool("get_guide", "How the reel spec works: every field, allowed values and editing rules. Read once before your first edit.", {}, [], True),
    _from_agent("get_spec", True),
    _from_agent("find_words", True),
    _from_agent("time_map", True),
    _from_agent("list_options", True, reel=False),
    _from_agent("patch_spec", False),
    _tool("undo", "Revert your most recent patch_spec on this reel. Only undoes changes made through this connector, never the "
          "creator's own edits.", dict(REEL), ["reel"]),
    _from_agent("remember", False, reel=False),
    _tool("render", "Start rendering the reel to MP4. quality: draft (fast preview) or high. aspects: any of 9x16, 4x5, 1x1, 16x9. "
          "Returns a job id; poll job_status.",
          {**REEL, "quality": {"type": "string", "enum": list(QUALITIES)}, "aspects": {"type": "array", "items": {"type": "string", "enum": list(ASPECTS)}}},
          ["reel"]),
    _tool("job_status", "Progress of a render job. When it is done, returns download links for the files.", {"job": {"type": "string"}}, ["job"], True),
]
NAMES = {t["name"] for t in TOOLS}


class Refused(Exception):
    """A tool call that can't be done; the message goes back to the model."""


def _spec_of(user_id: str, reel: str) -> tuple[dict, db.SpecVersion]:
    with db.session() as s:
        p = s.get(db.Project, reel) if re.fullmatch(r"[0-9a-f]{32}", str(reel or "")) else None
        if p is None or p.user_id != user_id:
            raise Refused("no such reel: call list_reels for the ids")
        v = db.latest_spec(s, p.id)
        if v is None:
            raise Refused("this reel is still being prepared (transcribing and cutting): try again in a minute")
        return json.loads(json.dumps(v.spec)), v


def _abs(base: str, url: str) -> str:
    return base.rstrip("/") + url if url.startswith("/") else url


def _guide(user_id: str) -> str:
    return (
        "You are editing a reel in BetterCut, a vertical-video editor. The whole edit is one JSON spec. Read only what "
        "you need, change it only with patch_spec, and keep on-screen text faithful to what was said. Notes from the "
        "creator use OUTPUT seconds (what they see in the preview); words, segments and overlays use SOURCE seconds: "
        "convert with time_map. If the creator corrects the same kind of thing that should apply to future reels, "
        "suggest it with remember (they approve it).\n\n"
        "## What this creator wants every time (their saved memory)\n"
        f"{memory.prompt_block(memory.active(user_id))}\n\n"
        "## Spec reference\n"
        f"{agent.reference()}"
    )


def call(user_id: str, name: str, args: dict, base: str) -> str:
    """Run one tool for this user. Raises Refused with a message the model can act on."""
    if name not in NAMES:
        raise Refused(f"no tool named {name}")

    if name == "list_reels":
        with db.session() as s:
            rows = list(s.scalars(select(db.Project).where(db.Project.user_id == user_id).order_by(db.Project.updated.desc())))
            out = []
            for p in rows:
                v = db.latest_spec(s, p.id)
                sp = v.spec if v else {}
                out.append({"id": p.id, "title": p.title, "status": p.status, "words": len(sp.get("words", [])),
                            "sourceSeconds": round((sp.get("source") or {}).get("duration", 0), 1), "editor": f"{base.rstrip('/')}/?reel={p.id}"})
        return json.dumps({"reels": out, "creatorMemory": memory.prompt_block(memory.active(user_id)),
                           "newReel": f"Upload footage in the browser editor: {base.rstrip('/')}/"}, ensure_ascii=False)

    if name == "get_guide":
        return _guide(user_id)

    if name == "list_options":
        return agent.Session({}, lambda k, t, v: None).call(name, args)

    if name == "remember":
        ses = agent.Session({}, lambda k, t, v: memory.propose(user_id, k, t, v))
        return ses.call(name, args)

    if name == "job_status":
        with db.session() as s:
            j = s.get(db.Job, str(args.get("job", "")))
            if j is None or j.user_id != user_id:
                raise Refused("no such job")
            out = {"status": "queued" if j.status == "queued" else j.status, "progress": round(j.progress, 2)}
            if j.status == "queued":
                out["position"] = s.scalar(select(func.count()).select_from(db.Job).where(
                    db.Job.status.in_(("queued", "running")), db.Job.created < j.created)) + 1
            if j.status == "error":
                out["error"] = (j.log or ["failed"])[-1]
            if j.status == "done" and j.kind == "render":
                st = storage.store()
                rs = s.scalars(select(db.Render).where(db.Render.project_id == j.project_id, db.Render.created >= (j.started or 0)).order_by(db.Render.id))
                out["files"] = [{"name": r.name, "aspect": r.aspect, "download": _abs(base, st.url(r.key, 24 * 3600))} for r in rs]
                out["note"] = "Download links last 24 hours."
        return json.dumps(out, ensure_ascii=False)

    reel = args.pop("reel", None) if isinstance(args, dict) else None
    spec, version = _spec_of(user_id, reel)

    if name == "undo":
        with db.session() as s:
            vs = list(s.scalars(select(db.SpecVersion).where(db.SpecVersion.project_id == reel).order_by(db.SpecVersion.id.desc()).limit(2)))
            if len(vs) < 2 or vs[0].author != "agent":
                raise Refused("nothing to undo: the latest change on this reel was not made through this connector")
            s.delete(vs[0])
            s.get(db.Project, reel).updated = time.time()
        return "ok: reverted the last change"

    if name == "render":
        cfg = settings()
        quality = args.get("quality") or "draft"
        aspects = [a for a in (args.get("aspects") or ["9x16"]) if a in ASPECTS] or ["9x16"]
        if quality not in QUALITIES:
            raise Refused("quality must be draft or high")
        with db.session() as s:
            today = s.scalar(select(func.count()).select_from(db.Job).where(db.Job.user_id == user_id, db.Job.kind == "render", db.Job.created > time.time() - 86400))
            if today >= cfg.renders_per_day:
                raise Refused(f"today's {cfg.renders_per_day} renders are used up: try again tomorrow")
            dup = s.scalars(select(db.Job).where(db.Job.project_id == reel, db.Job.kind == "render", db.Job.status.in_(("queued", "running")))).first()
            if dup:
                return json.dumps({"job": dup.id, "note": "a render of this reel is already running"})
        return json.dumps({"job": jobs.enqueue(user_id, reel, "render", {"quality": quality, "aspects": aspects})})

    # reads and patches on the latest spec
    ses = agent.Session(spec, lambda k, t, v: None, guard.spec_issues)
    out = ses.call(name, args)
    if name == "patch_spec" and out == "ok" and ses.spec != ses.original:
        with db.session() as s:
            moved = db.latest_spec(s, reel).id != version.id
        if moved:
            raise Refused("the reel changed while you were editing (the creator edited it in the browser): read it again and retry")
        jobs.add_version(reel, ses.spec, "agent", ses.changes[-1] if ses.changes else "Edited from your AI app")
        return "ok: applied, and visible in the creator's editor"
    return out


# ---- JSON-RPC --------------------------------------------------------------------------

def _result(mid, result: dict) -> dict:
    return {"jsonrpc": "2.0", "id": mid, "result": result}


def _error(mid, code: int, message: str) -> dict:
    return {"jsonrpc": "2.0", "id": mid, "error": {"code": code, "message": message}}


def handle(user_id: str, msg, base: str) -> dict | None:
    """One JSON-RPC message in, one response out (None for notifications)."""
    if not isinstance(msg, dict) or msg.get("jsonrpc") != "2.0" or not isinstance(msg.get("method"), str):
        return _error(msg.get("id") if isinstance(msg, dict) else None, -32600, "invalid request")
    mid, method, params = msg.get("id"), msg["method"], msg.get("params") or {}
    if "id" not in msg:  # a notification (e.g. notifications/initialized): nothing to answer
        return None
    if method == "initialize":
        want = params.get("protocolVersion")
        return _result(mid, {"protocolVersion": want if want in SUPPORTED else SUPPORTED[0], "capabilities": {"tools": {}},
                             "serverInfo": {"name": "bettercut", "title": "BetterCut", "version": "1.0.0"}, "instructions": INSTRUCTIONS})
    if method == "ping":
        return _result(mid, {})
    if method == "tools/list":
        return _result(mid, {"tools": TOOLS})
    if method == "tools/call":
        name, args = params.get("name"), params.get("arguments") or {}
        if not isinstance(args, dict):
            return _error(mid, -32602, "arguments must be an object")
        try:
            text, bad = call(user_id, str(name), dict(args), base), False
        except Refused as e:
            text, bad = f"error: {e}", True
        bad = bad or text.startswith("error:")
        return _result(mid, {"content": [{"type": "text", "text": text}], "isError": bad})
    if method in ("resources/list", "prompts/list"):
        return _result(mid, {method.split("/")[0]: []})
    return _error(mid, -32601, f"method not found: {method}")
