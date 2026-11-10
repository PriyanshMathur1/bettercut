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

from . import studio
from .cloud import agent

SUPPORTED = ("2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05")
ASPECTS = ("9x16", "4x5", "1x1", "16x9")
QUALITIES = ("draft", "high", "max", "master")
AUDIO_EXT = {".mp3", ".m4a", ".wav", ".aac", ".flac", ".ogg", ".aif", ".aiff"}
LOCAL_HOSTS = {"127.0.0.1", "localhost", "::1", "[::1]"}

INSTRUCTIONS = (
    "BetterCut edits short videos (reels) on this computer. Each reel is one JSON spec; change it only with patch_spec, "
    "and the creator watches the change appear in their browser editor. Start with list_reels, call get_guide once "
    "before your first edit, read only what you need with get_spec / find_words, then patch_spec. Make exactly the "
    "changes asked for. To start a reel from video files on this computer use make_reel with their full paths; long "
    "work (making, rendering) is a job: poll job_status. undo reverts your latest patch. For a whole video from a "
    "brief, use a pipeline (list_pipelines, start_pipeline): work one stage at a time and wait for the creator's "
    "approval between stages."
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
    _tool("list_pipelines", "Pipelines that take a video from brief to finished in stages, with the creator approving each stage: "
          "talking-head, screen-demo, multicam, clip-factory.", {}, [], True),
    _tool("start_pipeline", "Start a pipeline on a reel, or on new video files (it makes the reel first). Returns the first stage: "
          "do it, then finish_stage. Pass restart=true to start over on a reel that is already in a pipeline.",
          {"pipeline": {"type": "string"}, "brief": {"type": "string", "description": "What the creator wants, in their words"},
           "reel": {"type": "string"}, "clips": FILES, "restart": {"type": "boolean"}}, ["pipeline", "brief"]),
    _tool("pipeline_status", "Where the reel is in its pipeline, and what to do now: the stage's goal, guide, checklist, and any note "
          "from the creator. Check it before working and after the creator replies.", dict(REEL), ["reel"], True),
    _tool("finish_stage", "Say the current stage is done, with a short summary for the creator of what you did. If the stage needs "
          "approval it then waits for them; otherwise the next stage starts.", {**REEL, "summary": {"type": "string"}}, ["reel", "summary"]),
    _tool("approve_stage", "Record the creator's approval of the stage that is waiting, so the next one starts. Only when the creator "
          "has clearly approved it in this chat: put their words in note. Never approve on your own judgement.",
          {**REEL, "note": {"type": "string", "description": "The creator's words"}}, ["reel", "note"]),
    _tool("copy_reel", "Make a new reel from one stretch of a reel (SOURCE seconds): the clip factory's way to cut many clips from "
          "one long video. The footage is shared, so it's instant. Returns the new reel's id.",
          {**REEL, "start": {"type": "number"}, "end": {"type": "number"}, "name": {"type": "string"}}, ["reel", "start", "end"]),
    _tool("look", "See the footage: frames as one labelled image (#n, SOURCE seconds, clip). Pass times (SOURCE seconds, up to "
          "24) to look at exact moments, or nothing to scan every clip. Use it to pick shots when there are no words to go by "
          "(scenery, travel, b-roll) and to check a framing or zoom.",
          {**REEL, "times": {"type": "array", "items": {"type": "number"}}, "per_clip": {"type": "integer", "description": "Frames per clip when scanning (1-6)"}},
          ["reel"], True),
    _tool("add_music", "Put a music file from this computer under the reel (it is copied into the reel). Its beats are found at once "
          "and written to audio.beats (OUTPUT seconds), so you can place cuts on the beat.",
          {**REEL, "file": {"type": "string", "description": "Full path of an audio file (mp3, m4a, wav, aac, flac, ogg)"},
           "volume": {"type": "number", "description": "Music level 0..1 (default 0.8; ducks under speech)"}}, ["reel", "file"]),
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


def _pipeline(pid) -> dict:
    try:
        return studio.get(str(pid or ""))
    except studio.StageError as e:
        raise Refused(str(e))


def _stage_call(fn):
    try:
        return fn()
    except studio.StageError as e:
        raise Refused(str(e))


def prompts() -> list[dict]:
    """One ready-made prompt per pipeline, for clients that show a prompt menu (Claude Desktop)."""
    return [{"name": p["id"], "title": p["name"], "description": p["for"],
             "arguments": [{"name": "brief", "description": "What you want: audience, length, tone, call to action", "required": True},
                           {"name": "clips", "description": "Full paths of the video files, separated by commas (or leave empty and give a reel)"},
                           {"name": "reel", "description": "An existing reel's id instead of new files"}]} for p in studio.pipelines()]


def prompt_text(pid: str, args: dict) -> str:
    p = _pipeline(pid)
    clips = [c.strip() for c in str(args.get("clips") or "").split(",") if c.strip()]
    where = (f"the reel '{args['reel']}'" if args.get("reel") else
             f"these video files: {', '.join(clips)}" if clips else "a reel I'll name (ask me which, using list_reels)")
    return (f"Make me a {p['name'].lower()} with BetterCut's {p['id']} pipeline, from {where}.\n\nMy brief: {args.get('brief') or '(ask me)'}\n\n"
            "Call start_pipeline, then work one stage at a time: follow the stage's guide, check its checklist, and call finish_stage "
            "with a short summary. When a stage needs my approval, stop and show me what you did; continue only after I approve "
            "(record it with approve_stage, quoting me) or redo what I ask.")


def call(name: str, args: dict, base: str) -> str | dict:
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

    if name == "list_pipelines":
        return json.dumps([{"id": p["id"], "name": p["name"], "for": p["for"], "stages": [s["name"] for s in p["stages"]]} for p in studio.pipelines()],
                          ensure_ascii=False)

    if name == "start_pipeline" and not args.get("reel"):
        if not args.get("clips"):
            raise Refused("pass the reel to work on, or clips (full paths) to make a new reel from")
        p = _pipeline(args.get("pipeline"))
        clips = _videos(args.get("clips"), VIDEO_EXT)
        pid, jid = srv.make_project(clips, name=Path(clips[0]).stem, zoom=p["id"] == "screen-demo")
        st = _stage_call(lambda: studio.start(srv.PROJECTS / pid, p["id"], str(args.get("brief") or "")))
        return json.dumps({"reel": pid, "job": jid, "editor": f"{base}/?reel={pid}", "note": "the reel is being made: poll job_status, then do the first stage",
                           "now": studio.view(srv.PROJECTS / pid)["now"], "stages": [x["name"] for x in st["stages"]]}, ensure_ascii=False)

    reel = str(args.pop("reel", "") or "")
    try:
        proj = srv._proj(reel)
    except Exception:
        raise Refused("no such reel: call list_reels for the ids")

    if name == "start_pipeline":
        p = _pipeline(args.get("pipeline"))
        _stage_call(lambda: studio.start(proj, p["id"], str(args.get("brief") or ""), restart=bool(args.get("restart"))))
        return json.dumps({"reel": reel, "editor": f"{base}/?reel={reel}", **studio.view(proj)}, ensure_ascii=False)
    if name == "pipeline_status":
        v = studio.view(proj)
        if v is None:
            raise Refused("this reel isn't in a pipeline: start_pipeline first")
        return json.dumps(v, ensure_ascii=False)
    if name == "finish_stage":
        _stage_call(lambda: studio.finish_stage(proj, str(args.get("summary") or "")))
        return json.dumps(studio.view(proj)["now"], ensure_ascii=False)
    if name == "approve_stage":
        if not str(args.get("note") or "").strip():
            raise Refused("put the creator's own words of approval in note")
        _stage_call(lambda: studio.approve(proj, "Approved in chat: " + str(args["note"])))
        return json.dumps(studio.view(proj)["now"], ensure_ascii=False)

    if not (proj / "spec.json").exists():
        raise Refused("this reel is still being made: poll its job, or try again in a minute")

    if name == "copy_reel":
        try:
            a, b = float(args.get("start")), float(args.get("end"))
        except (TypeError, ValueError):
            raise Refused("start and end must be numbers (source seconds)")
        title = str(args.get("name") or "")
        pid, dst = srv.new_project(title or f"{reel}-{a:.0f}-{b:.0f}")
        try:
            spec = _stage_call(lambda: studio.copy_reel(proj, dst, a, b, title))
        except Refused:
            import shutil as _sh

            _sh.rmtree(dst, ignore_errors=True)
            raise
        return json.dumps({"reel": pid, "editor": f"{base}/?reel={pid}", "shots": len(spec["segments"])}, ensure_ascii=False)

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

    if name == "look":
        import base64

        from . import look

        clips = pipeline.clip_list(proj)
        spec = pipeline.load(proj)
        times = args.get("times")
        if times:
            if not isinstance(times, list) or not all(isinstance(t, (int, float)) for t in times):
                raise Refused("times must be a list of numbers (SOURCE seconds)")
            dur = float((spec.get("source") or {}).get("duration") or 0)
            times = [min(max(0.0, float(t)), max(0.0, dur - 0.1)) for t in times]
        else:
            per = min(6, max(1, int(args.get("per_clip") or 3)))
            times = look.scan_times(clips, per, (spec.get("source") or {}).get("duration"))
        img, legend = look.sheet(Path(spec["source"]["src"]), times, clips)
        return {"content": [{"type": "image", "data": base64.b64encode(img).decode(), "mimeType": "image/jpeg"},
                            {"type": "text", "text": json.dumps({"frames": legend, "note": "times are SOURCE seconds"}, ensure_ascii=False)}]}

    if name == "add_music":
        import shutil

        from . import render

        f = Path(str(args.get("file") or "")).expanduser()
        if not f.is_absolute() or not f.is_file():
            raise Refused(f"no such file (use the full path): {f}")
        if f.suffix.lower() not in AUDIO_EXT | VIDEO_EXT:
            raise Refused(f"not an audio file BetterCut reads: {f.name}")
        dst = proj / "assets" / f"music-{int(time.time())}{f.suffix.lower()}"
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(f, dst)
        spec = pipeline.load(proj)
        vol = args.get("volume")
        a = {**(spec.get("audio") or {}), "music": str(dst)}
        if isinstance(vol, (int, float)):
            a["musicVolume"] = round(min(1.0, max(0.0, float(vol))), 3)
        spec = render.with_beats({**spec, "audio": a}, log=lambda *_: None)
        srv.save_spec(proj, spec, "agent", f"Music: {f.name}")
        beats = spec["audio"].get("beats") or []
        gaps = [b - a for a, b in zip(beats, beats[1:])]
        beat = round(sorted(gaps)[len(gaps) // 2], 3) if gaps else None
        return json.dumps({"ok": True, "music": f.name, "beats": len(beats), "beatSeconds": beat, "firstBeats": beats[:16],
                           "note": "beats are OUTPUT seconds; cut on them (every beat, or every 2 or 4 for a calmer pace)"}, ensure_ascii=False)

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
        return _result(mid, {"protocolVersion": want if want in SUPPORTED else SUPPORTED[0], "capabilities": {"tools": {}, "prompts": {}},
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
            out, bad = call(str(name), args, base), False
        except Refused as e:
            out, bad = f"error: {e}", True
        except Exception as e:  # a bug or a failed step: tell the model plainly instead of dropping the call
            out, bad = f"error: {type(e).__name__}: {e}", True
        if isinstance(out, dict):  # a tool that returns pictures as well as text
            return _result(mid, {**out, "isError": False})
        bad = bad or out.startswith("error:")
        return _result(mid, {"content": [{"type": "text", "text": out}], "isError": bad})
    if method == "prompts/list":
        return _result(mid, {"prompts": prompts()})
    if method == "prompts/get":
        try:
            text = prompt_text(str(params.get("name") or ""), params.get("arguments") or {})
        except Refused as e:
            return _error(mid, -32602, str(e))
        return _result(mid, {"description": "BetterCut pipeline", "messages": [{"role": "user", "content": {"type": "text", "text": text}}]})
    if method == "resources/list":
        return _result(mid, {"resources": []})
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
    import shlex
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
        # every part shell-quoted: folder names often have spaces (and & in them)
        "claude_code_stdio": shlex.join(["claude", "mcp", "add", "bettercut", *[x for k, v in env.items() for x in ("-e", f"{k}={v}")], "--", sys.executable, *args]),
    }
