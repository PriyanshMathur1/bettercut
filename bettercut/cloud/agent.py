"""The AI editor, on the user's own model.

Any provider LiteLLM supports, through one tool-calling loop. The model never writes the spec as free text: it
reads what it needs with tools and changes the reel only with `patch_spec` (RFC 6902 JSON Patch), which is
applied to a copy and rejected if the result is invalid. A run that changes anything becomes one new spec
version, so it is always one Undo away.
"""
from __future__ import annotations

import copy
import json
import re
import time
from pathlib import Path
from typing import Callable

import jsonpatch

from .. import catalog as cat
from ..spec import blocking, list_looks
from ..timeline import place_segments, speed_of
from ..timeline import to_output as source_to_output

SKILL = Path(__file__).resolve().parent.parent / "SKILL.md"

PROVIDERS = {
    "anthropic": {"prefix": "anthropic/", "label": "Anthropic (Claude)", "example": "claude-sonnet-5-5"},
    "openai": {"prefix": "openai/", "label": "OpenAI", "example": "gpt-5"},
    "gemini": {"prefix": "gemini/", "label": "Google Gemini", "example": "gemini-2.5-pro"},
    "openrouter": {"prefix": "openrouter/", "label": "OpenRouter", "example": "anthropic/claude-sonnet-5-5"},
    "openai_compatible": {"prefix": "openai/", "label": "OpenAI-compatible URL", "example": "llama-3.3-70b"},
}

# A completion function takes (messages, tools) and returns
# {"content": str, "tool_calls": [{"id", "name", "arguments"}], "tokens_in": int, "tokens_out": int}
Complete = Callable[[list[dict], list[dict]], dict]


def _litellm():
    import os

    os.environ.setdefault("LITELLM_LOCAL_MODEL_COST_MAP", "True")  # use the bundled price list: no call to GitHub on import
    import litellm

    litellm.telemetry = False
    litellm.drop_params = True  # ignore options a provider doesn't support instead of failing
    return litellm


def litellm_complete(provider: str, model: str, api_key: str, api_base: str = "", timeout: float = 120) -> Complete:
    litellm = _litellm()

    if provider not in PROVIDERS:
        raise ValueError(f"unknown provider {provider}")
    if provider == "openai_compatible" and not api_base:
        raise ValueError("an OpenAI-compatible connection needs a base URL")
    name = PROVIDERS[provider]["prefix"] + model

    def complete(messages: list[dict], tools: list[dict]) -> dict:
        kw = {"model": name, "messages": messages, "api_key": api_key, "timeout": timeout, "max_tokens": 4096}
        if api_base:
            kw["api_base"] = api_base
        if tools:
            kw["tools"] = tools
            kw["tool_choice"] = "auto"
        r = litellm.completion(**kw)
        msg = r.choices[0].message
        calls = []
        for tc in getattr(msg, "tool_calls", None) or []:
            calls.append({"id": tc.id, "name": tc.function.name, "arguments": tc.function.arguments or "{}"})
        usage = getattr(r, "usage", None)
        return {
            "content": msg.content or "",
            "tool_calls": calls,
            "tokens_in": getattr(usage, "prompt_tokens", 0) or 0,
            "tokens_out": getattr(usage, "completion_tokens", 0) or 0,
        }

    return complete


def test_connection(complete: Complete, provider: str = "", model: str = "") -> dict:
    """Can this model call tools? (Required: the editor only edits through tools.)"""
    tool = {"type": "function", "function": {"name": "set_caption_scale", "description": "Set the caption size.",
                                             "parameters": {"type": "object", "properties": {"scale": {"type": "number"}}, "required": ["scale"]}}}
    t = time.time()
    try:
        r = complete([{"role": "user", "content": "Make the captions 20% bigger than 1.0. Use the tool."}], [tool])
    except Exception as e:  # bad key, wrong model name, network
        return {"ok": False, "tools": False, "error": _clean_error(e)}
    calls = [c for c in r["tool_calls"] if c["name"] == "set_caption_scale"]
    vision = False
    try:
        litellm = _litellm()
        vision = bool(litellm.supports_vision(model=PROVIDERS.get(provider, {}).get("prefix", "") + model))
    except Exception:
        pass
    ok = bool(calls)
    return {"ok": ok, "tools": ok, "vision": vision, "latency": round(time.time() - t, 2),
            "error": "" if ok else "This model answered but didn't use the editing tool. Pick a model with tool calling."}


def _clean_error(e: Exception) -> str:
    s = str(e)
    s = re.sub(r"(sk|key|AIza)[-_A-Za-z0-9]{8,}", "[key]", s)  # never echo a key back
    return s[:300]


# ---- tools ---------------------------------------------------------------------------

def _fn(name: str, description: str, props: dict, required: list[str]) -> dict:
    return {"type": "function", "function": {"name": name, "description": description,
                                             "parameters": {"type": "object", "properties": props, "required": required}}}


TOOLS = [
    _fn("get_spec", "Read part of the reel spec. section = 'overview' (everything except the long lists), a top-level key "
        "(captions, format, hook, motion, grade, audio, brand, overlays, broll, endCard, segments), 'words', or 'sentences' "
        "(the spoken sentences with their source times: use these as the lines when translating captions). For 'words', "
        "pass from_output/to_output (seconds) to get only that stretch.",
        {"section": {"type": "string"}, "from_output": {"type": "number"}, "to_output": {"type": "number"}}, ["section"]),
    _fn("find_words", "Find where a phrase is spoken. Returns word indexes with source and output times.",
        {"text": {"type": "string"}}, ["text"]),
    _fn("time_map", "Convert a time. Notes use OUTPUT seconds (the preview); words, segments and overlays use SOURCE seconds.",
        {"output_seconds": {"type": "number"}, "source_seconds": {"type": "number"}}, []),
    _fn("list_options", "Allowed values: looks, captionStyles, formats, effects, titles, endCards, grades, overlays, sfx, fonts, luts.",
        {"kind": {"type": "string"}}, ["kind"]),
    _fn("patch_spec", "Change the reel with an RFC 6902 JSON Patch (ops: add, remove, replace, move, copy, test; paths like "
        "/captions/scale or /words/12/cut or /overlays/-). Applied to a copy and rejected if invalid. Say why in 'why'.",
        {"ops": {"type": "array", "items": {"type": "object"}}, "why": {"type": "string"}}, ["ops", "why"]),
    _fn("remember", "Suggest saving a lasting preference for this creator's future reels (they approve it). Use only for "
        "things they clearly want every time, e.g. a repeated correction. kind: spelling, preference or style. For "
        "'preference', also pass value: the partial spec to apply to new reels.",
        {"kind": {"type": "string"}, "text": {"type": "string"}, "value": {"type": "object"}}, ["kind", "text"]),
    _fn("done", "Finish. summary: one short line per note saying what changed (or why it couldn't).",
        {"summary": {"type": "string"}}, ["summary"]),
]


def sentences(words: list[dict], max_words: int = 18) -> list[dict]:
    """Kept words grouped into sentences (same rules as composer/src/reel/translate.ts)."""
    out: list[dict] = []
    cur: list[dict] = []

    def flush() -> None:
        if cur:
            out.append({"start": cur[0]["start"], "end": cur[-1]["end"], "text": " ".join(w["text"] for w in cur)})
            cur.clear()

    for w in words:
        if w.get("cut"):
            continue
        if cur and w["start"] - cur[-1]["end"] > 1.2:
            flush()
        cur.append(w)
        if re.search(r"[.!?…][\"')\]]?$", w["text"]) or len(cur) >= max_words:
            flush()
    flush()
    return out


def to_source(placed: list[dict], t: float) -> tuple[float, int] | None:
    for s in placed:
        if s["outStart"] <= t <= s["outEnd"] + 1e-6:
            return min(s["end"], s["start"] + (t - s["outStart"]) * speed_of(s)), s["index"]
    if placed and t > placed[-1]["outEnd"]:
        s = placed[-1]
        return s["end"], s["index"]
    return None


def _json(v, limit: int = 12000) -> str:
    s = json.dumps(v, ensure_ascii=False)
    return s if len(s) <= limit else s[:limit] + f"... [truncated, {len(s)} chars; ask for a narrower section]"


class Session:
    """State of one agent run: the working spec and what happened."""

    def __init__(self, spec: dict, remember: Callable[[str, str, dict | None], str | None],
                 check: Callable[[dict], list[str]] = lambda spec: []):
        self.check = check
        self.spec = copy.deepcopy(spec)
        self.original = copy.deepcopy(spec)
        self.remember_fn = remember
        self.changes: list[str] = []
        self.proposals: list[str] = []
        self.summary = ""
        self.finished = False

    def call(self, name: str, args: dict) -> str:
        try:
            return getattr(self, "t_" + name)(**args)
        except AttributeError:
            return f"error: no tool named {name}"
        except TypeError as e:
            return f"error: bad arguments for {name}: {e}"

    def t_get_spec(self, section: str, from_output: float | None = None, to_output: float | None = None) -> str:
        sp = self.spec
        if section == "overview":
            ov = {k: v for k, v in sp.items() if k not in ("words", "segments")}
            ov["words"] = f"{len(sp.get('words', []))} words (use section='words')"
            ov["segments"] = f"{len(sp.get('segments', []))} kept shots (use section='segments')"
            return _json(ov)
        if section == "words":
            placed = place_segments(sp)
            rows = []
            for i, w in enumerate(sp.get("words", [])):
                o = source_to_output(placed, w["start"])
                if from_output is not None and (o is None or o < from_output - 0.01):
                    continue
                if to_output is not None and (o is None or o > to_output + 0.01):
                    continue
                rows.append({"i": i, **{k: w[k] for k in ("text", "start", "end") if k in w},
                             **{k: w[k] for k in ("cut", "emphasis", "emoji") if w.get(k)}, "out": round(o, 2) if o is not None else None})
            return _json(rows)
        if section == "segments":
            return _json([{k: s.get(k) for k in ("index", "start", "end", "outStart", "outEnd", "zoom", "speed", "cx", "cy") if s.get(k) is not None}
                          for s in place_segments(sp)])
        if section == "sentences":
            return _json(sentences(sp.get("words", [])))
        if section in sp:
            return _json(sp[section])
        return f"error: no section {section}. Top-level keys: {', '.join(sp.keys())}"

    def t_find_words(self, text: str) -> str:
        norm = lambda x: re.sub(r"[^\w']+", "", x.lower())  # noqa: E731
        want = [norm(t) for t in text.split() if norm(t)]
        words = self.spec.get("words", [])
        toks = [norm(w["text"]) for w in words]
        placed = place_segments(self.spec)
        hits = []
        for i in range(len(toks)):
            if want and toks[i:i + len(want)] == want:
                o = source_to_output(placed, words[i]["start"])
                hits.append({"first": i, "last": i + len(want) - 1, "source": words[i]["start"], "out": round(o, 2) if o is not None else None,
                             "cut": any(w.get("cut") for w in words[i:i + len(want)])})
        return _json(hits or f"no exact match for '{text}'. Read section='words' around the note's time instead.")

    def t_time_map(self, output_seconds: float | None = None, source_seconds: float | None = None) -> str:
        placed = place_segments(self.spec)
        if output_seconds is not None:
            r = to_source(placed, output_seconds)
            return _json({"source": round(r[0], 3), "segment": r[1]} if r else "outside the reel")
        if source_seconds is not None:
            o = source_to_output(placed, source_seconds)
            return _json({"output": round(o, 3)} if o is not None else "that moment is cut out of the reel")
        return "error: pass output_seconds or source_seconds"

    def t_list_options(self, kind: str) -> str:
        if kind == "looks":
            return _json([{"id": k, "name": v.get("name", k)} for k, v in list_looks().items()])
        if kind == "luts":
            from ..colour import LOOKS

            return _json(sorted(LOOKS))
        c = cat.catalog()
        if kind not in c:
            return f"error: kinds are {', '.join(sorted(list(c) + ['luts']))}"
        v = c[kind]
        return _json([x["id"] if isinstance(x, dict) and "id" in x else x for x in v])

    def t_patch_spec(self, ops: list, why: str = "") -> str:
        if not isinstance(ops, list) or not ops:
            return "error: ops must be a non-empty list"
        for op in ops:
            p = str(op.get("path", ""))
            if p.startswith("/source") or p in ("/version", ""):
                return "error: the source footage and spec version can't be changed"
        before = set(blocking(self.spec))
        try:
            new = jsonpatch.apply_patch(self.spec, ops, in_place=False)
        except (jsonpatch.JsonPatchException, jsonpatch.JsonPointerException) as e:
            return f"error: patch not applied: {e}"
        if not isinstance(new, dict) or new.get("version") != 1:
            return "error: patch would break the spec"
        added = [i for i in blocking(new) if i not in before] + self.check(new)
        if added:
            return "error: patch rejected, it would cause: " + "; ".join(added)
        self.spec = new
        self.changes.append(why or json.dumps(ops)[:200])
        return "ok"

    def t_remember(self, kind: str, text: str, value: dict | None = None) -> str:
        mid = self.remember_fn(kind, text, value)
        if mid:
            self.proposals.append(text)
            return "suggested to the creator (they approve it in Memory)"
        return "already saved or suggested"

    def t_done(self, summary: str) -> str:
        self.summary = summary
        self.finished = True
        return "ok"


def reference() -> str:
    """The spec reference from SKILL.md, without the CLI usage."""
    skill = SKILL.read_text(encoding="utf-8") if SKILL.exists() else ""
    skill = re.sub(r"^---.*?---\s*", "", skill, flags=re.S)
    return re.sub(r"```bash.*?```", "", skill, flags=re.S)


def system_prompt(memory_text: str) -> str:
    skill = reference()
    return (
        "You are the editor inside BetterCut, a vertical-video (reel) editor. The whole edit is one JSON spec. "
        "You apply the creator's notes to it with tools: read only what you need, change it only with patch_spec, "
        "then call done. Apply exactly the notes given, nothing else. Keep on-screen text faithful to what was said. "
        "If a note is ambiguous or impossible, make the safest reasonable change and say so in done. If the creator "
        "corrects the same kind of thing that should apply to future reels, you may suggest it with remember.\n\n"
        "## What this creator wants every time (their saved memory)\n"
        f"{memory_text}\n\n"
        "## Spec reference\n"
        f"{skill}"
    )


def notes_text(notes: list[dict]) -> str:
    return "\n".join(
        f"- at {n['at']:.1f}s of the preview: {n['text']}" if n.get("at") is not None else f"- (whole reel): {n['text']}" for n in notes
    )


def run(spec: dict, notes: list[dict], complete: Complete, memory_text: str = "",
        remember: Callable[[str, str, dict | None], str | None] = lambda k, t, v: None,
        max_steps: int = 12, log: Callable[[str], None] = print,
        check: Callable[[dict], list[str]] = lambda spec: []) -> dict:
    """Apply notes. Returns {spec, changed, summary, changes, proposals, steps, tokens_in, tokens_out}."""
    ses = Session(spec, remember, check)
    messages: list[dict] = [
        {"role": "system", "content": system_prompt(memory_text)},
        {"role": "user", "content": "Notes from the creator:\n" + notes_text(notes) +
         f"\n\nThe reel is {len(spec.get('words', []))} words long. Start with get_spec('overview') unless the notes are obvious."},
    ]
    steps: list[dict] = []
    tin = tout = 0
    for _ in range(max_steps):
        r = complete(messages, TOOLS)
        tin += r.get("tokens_in", 0)
        tout += r.get("tokens_out", 0)
        if r["content"].strip():
            log(r["content"].strip()[:500])
        if not r["tool_calls"]:
            ses.summary = ses.summary or r["content"].strip()
            break
        messages.append({"role": "assistant", "content": r["content"] or None, "tool_calls": [
            {"id": c["id"], "type": "function", "function": {"name": c["name"], "arguments": c["arguments"]}} for c in r["tool_calls"]]})
        for c in r["tool_calls"]:
            try:
                args = json.loads(c["arguments"] or "{}")
            except json.JSONDecodeError:
                args = None
            out = ses.call(c["name"], args) if isinstance(args, dict) else "error: arguments must be a JSON object"
            log(f"→ {c['name']} {json.dumps(args)[:140] if args else ''}" + (f"  ({out[:120]})" if out.startswith("error") else ""))
            steps.append({"tool": c["name"], "args": args, "result": out[:300]})
            messages.append({"role": "tool", "tool_call_id": c["id"], "content": out})
        if ses.finished:
            break
    else:
        ses.summary = ses.summary or "Stopped after the step limit; the changes so far were kept."
    return {
        "spec": ses.spec,
        "changed": ses.spec != ses.original,
        "summary": ses.summary or ("; ".join(ses.changes) if ses.changes else "No changes."),
        "changes": ses.changes,
        "proposals": ses.proposals,
        "steps": steps,
        "tokens_in": tin,
        "tokens_out": tout,
    }
