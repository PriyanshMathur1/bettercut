"""Edit reels on this computer from Claude (Desktop or Code) or any MCP client, on your own subscription.

The local editor serves MCP at http://127.0.0.1:<port>/mcp, and `python -m bettercut mcp` bridges it to clients
that start a command instead (Claude Desktop). Claude reads and changes the same reels, undo history and jobs as
the browser editor, and the editor shows each change as it lands.

Only this computer can reach it: the server listens on 127.0.0.1, and /mcp also refuses requests whose Host or
Origin isn't this computer, so a web page can't drive it through your browser.

The editing tools are the hosted connector's (`cloud.agent.Session`): read the spec, find words, convert
times, and change the reel with a JSON Patch. On this computer Claude can also start reels from files on disk,
add clips and camera angles, zoom on clicks, cut to the speaker, and render.
"""
from __future__ import annotations

import json
import time
from pathlib import Path
from urllib.parse import urlparse

from .cloud import agent

SUPPORTED = ("2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05")
ASPECTS = ("9x16", "4x5", "1x1", "16x9")
QUALITIES = ("draft", "high", "max", "master")
LOCAL_HOSTS = {"127.0.0.1", "localhost", "::1", "[::1]"}

INSTRUCTIONS = (
    "BetterCut edits short videos (reels) on this computer. Each reel is one JSON spec; change it only with patch_spec, "
    "and the creator watches the change appear in their browser editor. Start with list_reels, call get_guide once "
    "before your first edit, read only what you need with get_spec / find_words, then patch_spec. Make exactly the "
    "changes asked for. To start a reel from video files on this computer use make_reel with their full paths; long "
    "work (making, rendering) is a job: poll job_status. undo reverts your latest patch."
)


class Refused(Exception):
    """A tool call that can't be done; the message goes back to the model."""


def _tool(name: str, description: str, props: dict, required: list[str], read_only: bool = False) -> dict:
    return {"name": name, "description": description, "inputSchema": {"type": "object", "properties": props, "required": required},
            "annotations": {"readOnlyHint": read_only}}


REEL = {"reel": {"type": "string", "description": "Reel id, from list_reels"}}
FILES = {"type": "array", "items": {"type": "string"}, "description": "Full paths of video files on this computer"}


def _from_agent(name: str, read_only: bool, reel: bool = True) -> dict:
    f = next(t["function"] for t in agent.TOOLS if t["function"]["name"] == name)
    p = f["parameters"]
    return _tool(name, f["description"], {**(REEL if reel else {}), **p["properties"]}, [*(["reel"] if reel else []), *p["required"]], read_only)


TOOLS = [
    _tool("list_reels", "The reels on this computer (id, whether ready, length, renders) with a link to open each in the browser editor.", {}, [], True),
    _tool("get_guide", "How the reel spec works: every field, allowed values and editing rules. Read once before your first edit.", {}, [], True),
    _from_agent("get_spec", True),
    _from_agent("find_words", True),
    _from_agent("time_map", True),
    _from_agent("list_options", True, reel=False),
    _from_agent("patch_spec", False),
    _tool("undo", "Revert your most recent patch_spec on this reel. Only works while it is the latest change (never undoes the creator's own edits).", dict(REEL), ["reel"]),
    _tool("make_reel", "Start a new reel from video files on this computer: they are joined, transcribed, and the retakes, fillers and "
          "pauses are cut. shape: auto (the first clip's), 9x16, 4x5, 1x1 or 16x9. screen: true for screen recordings (zooms in "
          "where things happen). Returns a job; poll job_status, then the reel id is in its result.",
          {"clips": FILES, "name": {"type": "string"}, "shape": {"type": "string", "enum": ["auto", "9x16", "4x5", "1x1", "16x9"]},
           "look": {"type": "string", "description": "A look id from list_options('looks')"}, "screen": {"type": "boolean"}}, ["clips"]),
    _tool("add_clips", "Add more video files to the end of a reel (only the new footage is transcribed; edits are kept). Returns a job.",
          {**REEL, "clips": FILES}, ["reel", "clips"]),
    _tool("add_angles", "Add other cameras that filmed the same moment. They are lined up by sound, then the reel cuts to whoever is "
          "talking (auto=false keeps the current camera cuts). Returns a job.", {**REEL, "clips": FILES, "auto": {"type": "boolean"}}, ["reel", "clips"]),
    _tool("cut_to_speaker", "Switch cameras to whoever is talking, all the way through (replaces the camera cuts). Needs angles. Returns a job.", dict(REEL), ["reel"]),
    _tool("zoom_on_clicks", "Screen recordings: zoom in wherever something changes on screen (replaces the zooms). Returns a job.", dict(REEL), ["reel"]),
    _tool("render", "Render the reel to a video file. quality: draft (fast check), high, max, or master (ProRes). aspects: any of "
          "9x16, 4x5, 1x1, 16x9 (default: the reel's own shape). uhd: twice the size (4K). Returns a job; poll job_status.",
          {**REEL, "quality": {"type": "string", "enum": list(QUALITIES)}, "aspects": {"type": "array", "items": {"type": "string", "enum": list(ASPECTS)}},
           "uhd": {"type": "boolean"}}, ["reel"]),
    _tool("job_status", "Progress of a job (making, adding, rendering). When done, gives the result: the reel id, or the rendered files' paths.",
          {"job": {"type": "string"}}, ["job"], True),
]
NAMES = {t["name"] for t in TOOLS}


def _videos(paths, video_ext) -> list[str]:
    if not isinstance(paths, list) or not paths:
        raise Refused("clips must be a list of full file paths")
    out = []
    for p in paths:
        f = Path(str(p)).expanduser()
        if not f.is_absolute():
            raise Refused(f"use the full path: {p}")
        if not f.is_file():
            raise Refused(f"no such file: {f}")
        if f.suffix.lower() not in video_ext:
            raise Refused(f"not a video file BetterCut reads: {f.name}")
        out.append(str(f.resolve()))
    return out


def _guide() -> str:
    return (
        "You are editing a reel in BetterCut on the creator's computer. The whole edit is one JSON spec. Read only what you "
        "need, change it only with patch_spec, and keep on-screen text faithful to what was said. Notes from the creator use "
        "OUTPUT seconds (what they see in the preview); words, segments and overlays use SOURCE seconds: convert with "
        "time_map. Media fields (music, layers, b-roll) take full paths of files on this computer.\n\n"
        "## Spec reference\n" + agent.reference()
    )


def call(name: str, args: dict, base: str) -> str:
    """Run one tool. Raises Refused with a message the model can act on."""
    from . import pipeline
    from . import server as srv
    from .media import VIDEO_EXT

    if name not in NAMES:
        raise Refused(f"no tool named {name}")
    args = dict(args or {})

    if name == "list_reels":
        out = []
        for row in srv.list_projects():
            proj = srv.PROJECTS / row["id"]
            item = {"id": row["id"], "ready": row["ready"], "renders": row["renders"], "editor": f"{base}/?reel={row['id']}"}
            if row["ready"]:
                sp = pipeline.load(proj)
                item.update({"title": sp.get("title") or row["id"], "words": len(sp.get("words") or []),
                             "sourceSeconds": round((sp.get("source") or {}).get("duration", 0), 1)})
            out.append(item)
        return json.dumps({"reels": out, "newReel": "make_reel with full paths of video files"}, ensure_ascii=False)

    if name == "get_guide":
        return _guide()

    if name == "list_options":
        return agent.Session({}, lambda k, t, v: None).call(name, args)

    if name == "job_status":
        j = srv.JOBS.get(str(args.get("job", "")))
        if j is None:
            raise Refused("no such job (jobs are forgotten when the editor restarts)")
        out = {"kind": j["kind"], "status": j["status"], "progress": round(j.get("progress") or 0, 2), "log": j["log"][-5:]}
        if j["status"] == "done":
            res = j.get("result") or {}
            out["result"] = res
            if j["kind"] == "render" and j.get("project"):
                out["files"] = [str(srv.PROJECTS / j["project"] / "renders" / n) for n in res.get("renders", [])]
            if res.get("project"):
                out["editor"] = f"{base}/?reel={res['project']}"
        return json.dumps(out, ensure_ascii=False)

    if name == "make_reel":
        clips = _videos(args.get("clips"), VIDEO_EXT)
        shape = str(args.get("shape") or "auto")
        if shape not in ("auto", *ASPECTS):
            raise Refused("shape must be auto, 9x16, 4x5, 1x1 or 16x9")
        pid, jid = srv.make_project(clips, name=str(args.get("name") or Path(clips[0]).stem), look=str(args.get("look") or "bold-pop"),
                                    shape=shape, zoom=bool(args.get("screen")))
        return json.dumps({"job": jid, "reel": pid, "editor": f"{base}/?reel={pid}", "note": "poll job_status until done"})

    reel = str(args.pop("reel", "") or "")
    try:
        proj = srv._proj(reel)
    except Exception:
        raise Refused("no such reel: call list_reels for the ids")
    if not (proj / "spec.json").exists():
        raise Refused("this reel is still being made: poll its job, or try again in a minute")

    if name == "render":
        quality = str(args.get("quality") or "draft")
        if quality not in QUALITIES:
            raise Refused("quality must be draft, high, max or master")
        aspects = [a for a in (args.get("aspects") or []) if a in ASPECTS] or None
        return json.dumps({"job": srv.start_render_job(reel, quality, aspects, bool(args.get("uhd")))})

    if name == "add_clips":
        return json.dumps({"job": srv.add_clips_job(reel, _videos(args.get("clips"), VIDEO_EXT))})
    if name == "add_angles":
        return json.dumps({"job": srv.add_angles_job(reel, _videos(args.get("clips"), VIDEO_EXT), auto=args.get("auto", True) is not False)})
    if name == "cut_to_speaker":
        if not pipeline.load(proj).get("angles"):
            raise Refused("this reel has no other camera angles: add_angles first")
        return json.dumps({"job": srv.auto_cams(reel)["job"]})
    if name == "zoom_on_clicks":
        return json.dumps({"job": srv.auto_zooms(reel)["job"]})

    if name == "undo":
        head = srv.head_of(proj)
        if head.get("author") != "agent" or head.get("version") != srv.version_of(proj):
            raise Refused("nothing to undo: the latest change on this reel was not made through this connection")
        srv.undo(reel)
        srv.mark(proj, "agent", "Undid the last change from Claude")
        return "ok: reverted the last change"

    # reads and patches on the current spec
    spec = pipeline.load(proj)
    started = srv.version_of(proj)
    ses = agent.Session(spec, lambda k, t, v: None)
    out = ses.call(name, args)
    if name == "patch_spec" and out == "ok" and ses.spec != ses.original:
        if srv.version_of(proj) != started:
            raise Refused("the reel changed while you were editing (the creator edited it in the browser): read it again and retry")
        srv.save_spec(proj, ses.spec, "agent", ses.changes[-1] if ses.changes else "Edited from Claude")
        return "ok: applied, and visible in the creator's editor"
    return out


# ---- JSON-RPC --------------------------------------------------------------------------

def _result(mid, result: dict) -> dict:
    return {"jsonrpc": "2.0", "id": mid, "result": result}


def _error(mid, code: int, message: str) -> dict:
    return {"jsonrpc": "2.0", "id": mid, "error": {"code": code, "message": message}}


def handle(msg, base: str) -> dict | None:
    """One JSON-RPC message in, one response out (None for notifications)."""
    if not isinstance(msg, dict) or msg.get("jsonrpc") != "2.0" or not isinstance(msg.get("method"), str):
        return _error(msg.get("id") if isinstance(msg, dict) else None, -32600, "invalid request")
    mid, method, params = msg.get("id"), msg["method"], msg.get("params") or {}
    if "id" not in msg:
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
            text, bad = call(str(name), args, base), False
        except Refused as e:
            text, bad = f"error: {e}", True
        except Exception as e:  # a bug or a failed step: tell the model plainly instead of dropping the call
            text, bad = f"error: {type(e).__name__}: {e}", True
        bad = bad or text.startswith("error:")
        return _result(mid, {"content": [{"type": "text", "text": text}], "isError": bad})
    if method in ("resources/list", "prompts/list"):
        return _result(mid, {method.split("/")[0]: []})
    return _error(mid, -32601, f"method not found: {method}")


def local_request(host: str | None, origin: str | None) -> bool:
    """True when a request comes from this computer and not from a web page on another site."""
    h = urlparse(f"http://{host or ''}").hostname or ""
    if h not in LOCAL_HOSTS and f"[{h}]" not in LOCAL_HOSTS:
        return False
    if origin:
        o = urlparse(origin).hostname or ""
        return o in LOCAL_HOSTS or f"[{o}]" in LOCAL_HOSTS
    return True


# ---- stdio bridge (Claude Desktop starts a command) --------------------------------------

def _post(url: str, msg: dict, timeout: float = 600) -> dict | None:
    import urllib.request

    req = urllib.request.Request(url, data=json.dumps(msg).encode(), headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=timeout) as r:
        body = r.read()
    return json.loads(body) if body.strip() else None


def _healthy(port: int) -> bool | None:
    """True: BetterCut is answering on the port. False: something else is. None: nothing is."""
    import urllib.request

    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/health", timeout=2) as r:
            return json.loads(r.read() or b"{}").get("app") == "bettercut"
    except (OSError, ValueError):
        return None


def ensure_server(port: int, log) -> None:
    """Start the editor in the background if it isn't running, so Claude works even before you open it."""
    import os
    import subprocess
    import sys

    state = _healthy(port)
    if state:
        return
    if state is False:
        raise RuntimeError(f"port {port} is used by another app: run `python -m bettercut mcp --port <free port>`")
    out = Path(os.environ.get("BETTERCUT_PROJECTS", Path.home() / "bettercut-projects")).expanduser()
    out.mkdir(parents=True, exist_ok=True)
    logf = open(out / ".editor.log", "ab")
    subprocess.Popen([sys.executable, "-m", "bettercut", "ui", "--port", str(port)], stdout=logf, stderr=logf,
                     stdin=subprocess.DEVNULL, start_new_session=True, cwd=str(Path(__file__).resolve().parent.parent))
    for _ in range(60):
        time.sleep(0.5)
        if _healthy(port):
            log(f"started the BetterCut editor at http://127.0.0.1:{port}")
            return
    raise RuntimeError(f"the editor didn't start: see {out / '.editor.log'}")


def bridge(port: int) -> int:
    """MCP over stdin/stdout, passed to the editor's /mcp."""
    import sys

    def log(m: str) -> None:
        print(f"bettercut: {m}", file=sys.stderr, flush=True)

    url = f"http://127.0.0.1:{port}/mcp"
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except ValueError:
            print(json.dumps(_error(None, -32700, "parse error")), flush=True)
            continue
        try:
            ensure_server(port, log)
            reply = _post(url, msg)
        except Exception as e:
            reply = _error(msg.get("id") if isinstance(msg, dict) else None, -32603, f"BetterCut editor unavailable: {e}") if isinstance(msg, dict) and "id" in msg else None
        if reply is not None:
            print(json.dumps(reply, ensure_ascii=False), flush=True)
    return 0


def client_config(port: int) -> dict:
    """What to paste into Claude Desktop and run for Claude Code, with this computer's paths filled in."""
    import os
    import shutil
    import sys

    root = str(Path(__file__).resolve().parent.parent)
    node = shutil.which("node") or ""
    path = os.pathsep.join(p for p in [str(Path(node).parent) if node else "", "/opt/homebrew/opt/node@24/bin", "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"] if p)
    env = {"PYTHONPATH": root, "PATH": path}
    if os.environ.get("BETTERCUT_PROJECTS"):
        env["BETTERCUT_PROJECTS"] = os.environ["BETTERCUT_PROJECTS"]
    args = ["-m", "bettercut", "mcp", "--port", str(port)]
    return {
        "claude_desktop": {"mcpServers": {"bettercut": {"command": sys.executable, "args": args, "env": env}}},
        "claude_code": f"claude mcp add --transport http bettercut http://127.0.0.1:{port}/mcp",
        "claude_code_stdio": "claude mcp add bettercut " + " ".join(f"-e {k}={v!r}" for k, v in env.items()) + f" -- {sys.executable} " + " ".join(args),
    }
