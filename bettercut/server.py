"""BetterCut editor backend (FastAPI). Serves the editor UI, the projects and their media, and runs
pipeline / render / mimic / Claude-notes jobs in background threads.

Run: python -m bettercut ui   -> http://localhost:4790
"""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import threading
import time
import traceback
import uuid
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse, Response

from . import catalog as cat
from . import media, pipeline, render
from . import shape as shapes
from .media import COMPOSER, VIDEO_EXT
from .spec import BRAND_FILE, USER_DIR, apply_look, list_looks, load_brand, validate

PROJECTS = Path(os.environ.get("BETTERCUT_PROJECTS", Path.home() / "bettercut-projects")).expanduser()
UI_DIST = COMPOSER / "editor" / "dist"
CLAUDE = os.environ.get("CLAUDE_BIN") or shutil.which("claude") or "claude"
SKILL = Path(__file__).resolve().parent / "SKILL.md"

app = FastAPI(title="BetterCut")
JOBS: dict[str, dict] = {}
LOCK = threading.Lock()


# ---- helpers -------------------------------------------------------------------

def _proj(pid: str) -> Path:
    if not re.fullmatch(r"[\w.-]+", pid):
        raise HTTPException(400, "bad project id")
    p = PROJECTS / pid
    if not p.exists():
        raise HTTPException(404, "no such project")
    return p


def _slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")[:48] or "reel"


def _job(kind: str, project: str | None, fn) -> dict:
    jid = uuid.uuid4().hex[:10]
    job = {"id": jid, "kind": kind, "project": project, "status": "running", "progress": 0.0, "log": [], "result": None, "started": time.time()}
    with LOCK:
        JOBS[jid] = job

    def log(msg: str) -> None:
        job["log"] = (job["log"] + [str(msg)])[-300:]

    def runner() -> None:
        try:
            job["result"] = fn(job, log)
            job["status"] = "done"
            job["progress"] = 1.0
        except Exception as e:  # surfaced to the UI
            job["status"] = "error"
            log(f"ERROR: {e}")
            log(traceback.format_exc()[-2000:])

    threading.Thread(target=runner, daemon=True).start()
    return job


def _stack(project: Path, name: str) -> list[Path]:
    """Saved versions in work/<name>, oldest first."""
    return sorted((project / "work" / name).glob("spec-*.json"))


def _push(project: Path, name: str, spec: dict) -> None:
    d = project / "work" / name
    d.mkdir(parents=True, exist_ok=True)
    stamp = int(time.time() * 1000)
    while (d / f"spec-{stamp}.json").exists():  # two saves in the same millisecond keep their order
        stamp += 1
    (d / f"spec-{stamp}.json").write_text(json.dumps(spec), encoding="utf-8")
    for f in _stack(project, name)[:-50]:
        f.unlink()


def _history(project: Path, spec: dict, keep_redo: bool = False) -> None:
    """Remember `spec` so Undo can return to it. A new edit ends the chance to redo what was undone."""
    _push(project, "history", spec)
    if not keep_redo:
        for f in _stack(project, "redo"):
            f.unlink()


def _steps(project: Path) -> dict:
    """Whether there is anything to undo or redo, for the editor's buttons."""
    return {"canUndo": bool(_stack(project, "history")), "canRedo": bool(_stack(project, "redo"))}


# Who changed the reel last, so the open editor can pick up changes made elsewhere (Claude, a finished job)
# without reloading over its own saves. The version is the spec file's change time.

def version_of(project: Path) -> int | None:
    f = project / "spec.json"
    return f.stat().st_mtime_ns // 1000 if f.exists() else None  # microseconds: exact in the editor's JavaScript numbers


def head_of(project: Path) -> dict:
    """{version, author, summary}: author is "user" (the editor), "agent" (Claude), or "job" (anything else)."""
    v = version_of(project)
    try:
        h = json.loads((project / "work" / "head.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        h = {}
    if h.get("version") == v:
        return {"version": v, "author": h.get("author", "job"), "summary": h.get("summary", "")}
    return {"version": v, "author": "job", "summary": ""}


def mark(project: Path, author: str, summary: str = "") -> None:
    d = project / "work"
    d.mkdir(parents=True, exist_ok=True)
    (d / "head.json").write_text(json.dumps({"version": version_of(project), "author": author, "summary": summary[:300]}), encoding="utf-8")


def save_spec(project: Path, spec: dict, author: str, summary: str = "") -> None:
    """Save a change as one Undo step and say who made it."""
    old = pipeline.load(project)
    if old != spec:
        _history(project, old)
        pipeline.save(project, spec)
        mark(project, author, summary)


def _allowed(path: Path) -> bool:
    rp = path.resolve()
    roots = [PROJECTS.resolve(), USER_DIR.resolve(), (COMPOSER / "public").resolve()]
    return any(str(rp).startswith(str(r) + os.sep) for r in roots)


# ---- API -----------------------------------------------------------------------

@app.get("/api/health")
def health():
    return {"ok": True, "app": "bettercut", "projects": str(PROJECTS), "claude": shutil.which(CLAUDE) is not None}


@app.get("/api/catalog")
def get_catalog():
    c = cat.catalog()
    c["looks"] = list(list_looks().values())
    return c


@app.get("/api/brand")
def get_brand():
    return load_brand()


@app.put("/api/brand")
async def put_brand(req: Request):
    data = await req.json()
    USER_DIR.mkdir(parents=True, exist_ok=True)
    BRAND_FILE.write_text(json.dumps(data, indent=2), encoding="utf-8")
    return load_brand()


@app.get("/api/projects")
def list_projects():
    PROJECTS.mkdir(parents=True, exist_ok=True)
    out = []
    for p in sorted(PROJECTS.iterdir(), key=lambda x: x.stat().st_mtime, reverse=True):
        if p.is_dir() and not p.name.startswith("_"):
            spec = p / "spec.json"
            renders = sorted((p / "renders").glob("*-v*.mp4")) if (p / "renders").exists() else []
            out.append({
                "id": p.name,
                "ready": spec.exists(),
                "updated": p.stat().st_mtime,
                "renders": [r.name for r in renders if not r.stem.endswith("-phone")],
            })
    return out


@app.post("/api/projects")
async def create_project(
    files: list[UploadFile] = File(...),
    name: str = Form("reel"),
    look: str = Form("bold-pop"),
    names: str = Form(""),
    cutout: bool = Form(False),
    hook: str | None = Form(None),
    model: str = Form("small"),
    shape: str = Form("auto"),
    zoom: bool = Form(False),
):
    """`zoom`: the clips are screen recordings; zoom in where something happens once the reel is made."""
    if shape != shapes.AUTO and shape not in shapes.SHAPES:
        raise HTTPException(400, "unknown shape")
    pid, proj = _new_project(name)
    inputs = proj / "inputs"
    inputs.mkdir(parents=True)
    saved = []
    for f in files:
        if Path(f.filename or "").suffix.lower() not in VIDEO_EXT:
            continue
        dst = inputs / Path(f.filename).name
        with open(dst, "wb") as fh:
            shutil.copyfileobj(f.file, fh)
        media.fix_recording(dst)  # recordings made in the browser carry no length
        saved.append(str(dst))
    if not saved:
        shutil.rmtree(proj)
        raise HTTPException(400, "upload at least one video file")
    return {"project": pid, "job": _make_job(pid, proj, saved, look=look, names=names, cutout=cutout, hook=hook, model=model, shape=shape, zoom=zoom)}


def _new_project(name: str) -> tuple[str, Path]:
    pid = _slug(name)
    base = pid
    i = 2
    while (PROJECTS / pid).exists():
        pid = f"{base}-{i}"
        i += 1
    proj = PROJECTS / pid
    proj.mkdir(parents=True)
    return pid, proj


def _make_job(pid: str, proj: Path, clips: list[str], look: str = "bold-pop", names: str = "", cutout: bool = False,
              hook: str | None = None, model: str = "small", shape: str = "auto", zoom: bool = False) -> str:
    def work(job, log):
        kw = {"names": [n.strip() for n in names.split(",") if n.strip()], "cutout": cutout, "model": model, "shape": shape, "log": log}
        if hook is not None:
            kw["hook"] = hook
        pipeline.make(proj, clips, look=look, **kw)
        if zoom:
            from . import screenzoom

            screenzoom.auto_zoom(proj, log=log)
        return {"project": pid}

    return _job("make", pid, work)["id"]


def new_project(name: str) -> tuple[str, Path]:
    """An empty project folder with a unique id made from the name: (id, folder)."""
    return _new_project(name)


def make_project(clips: list[str], name: str = "reel", look: str = "bold-pop", shape: str = "auto", zoom: bool = False) -> tuple[str, str]:
    """A new reel from files already on this computer (used by the Claude connection): (project id, job id)."""
    pid, proj = _new_project(name)
    return pid, _make_job(pid, proj, clips, look=look, shape=shape, zoom=zoom)


@app.post("/api/projects/{pid}/clips")
async def add_clips(pid: str, files: list[UploadFile] = File(...), names: str = Form(""), model: str = Form("small")):
    """Append more footage to a reel. Only the new clips are transcribed; existing edits are kept."""
    proj = _proj(pid)
    inputs = proj / "inputs" / f"add-{int(time.time())}"
    inputs.mkdir(parents=True)
    saved = []
    for f in files:
        if Path(f.filename or "").suffix.lower() not in VIDEO_EXT:
            continue
        dst = inputs / Path(f.filename).name
        with open(dst, "wb") as fh:
            shutil.copyfileobj(f.file, fh)
        media.fix_recording(dst)  # recordings made in the browser carry no length
        saved.append(str(dst))
    if not saved:
        raise HTTPException(400, "upload at least one video file")
    return {"job": add_clips_job(pid, saved, names=names, model=model)}


def add_clips_job(pid: str, clips: list[str], names: str = "", model: str = "small") -> str:
    proj = _proj(pid)

    def work(job, log):
        _history(proj, pipeline.load(proj))  # the old footage file is kept, so Undo brings the reel back
        spec = pipeline.add_clips(proj, clips, names=[n.strip() for n in names.split(",") if n.strip()], model=model, log=log)
        return {"project": pid, "shots": len(spec["segments"])}

    return _job("clips", pid, work)["id"]


@app.post("/api/projects/{pid}/angles")
async def add_angles(pid: str, files: list[UploadFile] = File(...), auto: bool = Form(True)):
    """Add other cameras of the same shoot. Each is synced to the main footage by sound; then, unless told
    not to, the reel cuts to whoever is talking."""
    from . import multicam

    proj = _proj(pid)
    inputs = proj / "inputs" / f"angles-{int(time.time())}"
    inputs.mkdir(parents=True)
    saved = []
    for f in files:
        if Path(f.filename or "").suffix.lower() not in VIDEO_EXT:
            continue
        dst = inputs / Path(f.filename).name
        with open(dst, "wb") as fh:
            shutil.copyfileobj(f.file, fh)
        media.fix_recording(dst)
        saved.append(str(dst))
    if not saved:
        raise HTTPException(400, "upload at least one video file")
    return {"job": add_angles_job(pid, saved, auto=auto)}


def add_angles_job(pid: str, clips: list[str], auto: bool = True) -> str:
    from . import multicam

    proj = _proj(pid)

    def work(job, log):
        _history(proj, pipeline.load(proj))
        spec = multicam.add_angles(proj, clips, log=log, auto=auto)
        return {"angles": len(spec.get("angles") or []), "switches": len(spec.get("cams") or [])}

    return _job("angles", pid, work)["id"]


@app.post("/api/projects/{pid}/autocam")
def auto_cams(pid: str):
    """Cut between the reel's cameras to whoever is talking (replaces the current camera switches)."""
    from . import multicam

    proj = _proj(pid)

    def work(job, log):
        _history(proj, pipeline.load(proj))
        spec = multicam.auto_switch(proj, log=log)
        return {"switches": len(spec.get("cams") or [])}

    return {"job": _job("autocam", pid, work)["id"]}


@app.post("/api/projects/{pid}/autozoom")
def auto_zooms(pid: str):
    """Zoom in where something happens on a screen recording (replaces the current zooms)."""
    from . import screenzoom

    proj = _proj(pid)

    def work(job, log):
        _history(proj, pipeline.load(proj))
        spec = screenzoom.auto_zoom(proj, log=log)
        return {"zooms": len(spec.get("zooms") or [])}

    return {"job": _job("autozoom", pid, work)["id"]}


@app.get("/api/projects/{pid}/spec")
def get_spec(pid: str):
    proj = _proj(pid)
    if not (proj / "spec.json").exists():
        raise HTTPException(409, "still processing")
    spec = pipeline.load(proj)
    return {"spec": spec, "issues": validate(spec), "clips": pipeline.clip_list(proj), "version": version_of(proj), **_steps(proj)}


@app.get("/api/projects/{pid}/head")
def get_head(pid: str):
    """Cheap poll for the editor: has the reel changed elsewhere (Claude, a finished job)? `pipeline` is when the
    reel's pipeline last changed, so the stage strip can refresh too."""
    from . import studio

    proj = _proj(pid)
    st = studio.state(proj)
    return {**head_of(proj), "pipeline": st.get("updated") if st else None}


@app.get("/api/pipelines")
def list_pipelines():
    from . import studio

    return [{"id": p["id"], "name": p["name"], "for": p["for"], "stages": [x["name"] for x in p["stages"]]} for p in studio.pipelines()]


@app.get("/api/projects/{pid}/pipeline")
def get_pipeline(pid: str):
    from . import studio

    return {"pipeline": studio.view(_proj(pid))}


@app.post("/api/projects/{pid}/pipeline/{action}")
async def pipeline_action(pid: str, action: str, req: Request):
    """The creator approves the waiting stage, or sends it back with a note."""
    from . import studio

    proj = _proj(pid)
    body = await req.json() if (await req.body()) else {}
    try:
        if action == "approve":
            studio.approve(proj, str(body.get("note") or ""))
        elif action == "send-back":
            studio.send_back(proj, str(body.get("note") or ""))
        else:
            raise HTTPException(404)
    except studio.StageError as e:
        raise HTTPException(409, str(e))
    return {"pipeline": studio.view(proj)}


@app.put("/api/projects/{pid}/spec")
async def put_spec(pid: str, req: Request):
    proj = _proj(pid)
    spec = await req.json()
    if spec.get("version") != 1 or "source" not in spec:
        raise HTTPException(400, "not a reel spec")
    save_spec(proj, spec, "user")  # saving the same thing again is not a step to undo
    return {"ok": True, "issues": validate(spec), **_steps(proj)}


@app.post("/api/projects/{pid}/undo")
def undo(pid: str):
    proj = _proj(pid)
    h = _stack(proj, "history")
    if not h:
        raise HTTPException(409, "nothing to undo")
    spec = json.loads(h[-1].read_text(encoding="utf-8"))
    _push(proj, "redo", pipeline.load(proj))  # what we are leaving, so Redo can come back to it
    h[-1].unlink()
    pipeline.save(proj, spec)
    mark(proj, "user")
    return {"spec": spec, **_steps(proj)}


@app.post("/api/projects/{pid}/redo")
def redo(pid: str):
    proj = _proj(pid)
    r = _stack(proj, "redo")
    if not r:
        raise HTTPException(409, "nothing to redo")
    spec = json.loads(r[-1].read_text(encoding="utf-8"))
    _history(proj, pipeline.load(proj), keep_redo=True)
    r[-1].unlink()
    pipeline.save(proj, spec)
    mark(proj, "user")
    return {"spec": spec, **_steps(proj)}


@app.post("/api/projects/{pid}/look")
async def set_look(pid: str, req: Request):
    proj = _proj(pid)
    body = await req.json()
    spec = pipeline.load(proj)
    _history(proj, spec)
    spec = apply_look(spec, body["look"], (spec.get("hook") or {}).get("text", ""))
    pipeline.save(proj, spec)
    return {"spec": spec}


@app.post("/api/projects/{pid}/upload")
async def upload_asset(pid: str, file: UploadFile = File(...)):
    proj = _proj(pid)
    d = proj / "assets" / "user"
    d.mkdir(parents=True, exist_ok=True)
    dst = d / re.sub(r"[^\w.-]+", "_", Path(file.filename or "file").name)
    with open(dst, "wb") as fh:
        shutil.copyfileobj(file.file, fh)
    media.fix_recording(dst)
    return {"path": str(dst), "seconds": media.audio_seconds(dst)}


@app.post("/api/projects/{pid}/render")
async def start_render(pid: str, req: Request):
    _proj(pid)
    body = await req.json() if (await req.body()) else {}
    return {"job": start_render_job(pid, body.get("quality", "high"), body.get("aspects"), bool(body.get("uhd")))}


def start_render_job(pid: str, quality: str = "high", aspects_asked: list[str] | None = None, uhd: bool = False) -> str:
    proj = _proj(pid)
    uhd = uhd and quality != "draft"
    aspects = shapes.aspects_for(pipeline.load(proj), aspects_asked)

    def work(job, log):
        from .export import write_all

        v = pipeline.next_version(proj)
        names = []
        report = {}
        for n, asp in enumerate(aspects):
            spec = pipeline.load(proj)
            tag = shapes.tag(spec, asp)
            dst = proj / "renders" / f"{pid}-v{v}{tag}{'-4k' if uhd else ''}{'.mov' if quality == 'master' else '.mp4'}"
            log(f"rendering {dst.name} ({quality})")
            render.render(spec, proj, dst, quality=quality, log=log, aspect=asp, uhd=uhd,
                          progress=lambda p, n=n: job.__setitem__("progress", round((n + p * 0.95) / len(aspects), 3)))
            if quality != "master":
                render.phone_copy(dst, dst.with_name(dst.stem + "-phone.mp4"))
            if n == 0:
                report = render.qa(pipeline.load(proj), dst, proj)
                for i in report.get("issues", []):
                    log("QA: " + i)
            names.append(dst.name)
        write_all(pipeline.load(proj), proj / "renders", f"{pid}-v{v}")
        log("exports: .srt .vtt .fcpxml")
        return {"render": names[0], "renders": names, "qa": report}

    return _job("render", pid, work)["id"]


@app.post("/api/projects/{pid}/notes")
async def send_notes(pid: str, req: Request):
    """Timestamped notes on the preview -> Claude edits spec.json (it re-renders only when asked)."""
    proj = _proj(pid)
    body = await req.json()
    notes = body.get("notes", [])
    if not notes:
        raise HTTPException(400, "no notes")
    lines = "\n".join(
        f"- at {n['t']:.1f}s (output time): {n['text']}" if n.get("t") is not None else f"- (whole reel): {n['text']}" for n in notes
    )
    prompt = (
        "You are editing a BetterCut reel. The whole edit is the JSON file spec.json in the current folder; "
        f"the renderer and every allowed value are documented in {SKILL}. Read that file first, then spec.json. "
        "Apply exactly these notes from the creator, nothing else:\n"
        f"{lines}\n\n"
        "Times in the notes are OUTPUT seconds of the preview. Words, segments, overlays and effects in spec.json use SOURCE "
        "seconds: map them with the segments (output time = sum of earlier kept segment lengths + offset). "
        "Edit spec.json in place with the Edit tool, keep it valid JSON, then reply with one short line per note saying what you changed."
    )

    def work(job, log):
        spec = pipeline.load(proj)
        _history(proj, spec)
        cmd = [CLAUDE, "-p", prompt, "--output-format", "stream-json", "--verbose", "--permission-mode", "acceptEdits",
               "--allowedTools", "Read Edit Write", "--add-dir", str(SKILL.parent)]
        p = subprocess.Popen(cmd, cwd=proj, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        final = ""
        for line in p.stdout:  # type: ignore[union-attr]
            try:
                ev = json.loads(line)
            except json.JSONDecodeError:
                continue
            if ev.get("type") == "assistant":
                for c in ev.get("message", {}).get("content", []):
                    if c.get("type") == "text" and c["text"].strip():
                        log(c["text"].strip())
                    elif c.get("type") == "tool_use":
                        log(f"→ {c.get('name')} {json.dumps(c.get('input', {}))[:140]}")
            elif ev.get("type") == "result":
                final = ev.get("result", "")
        if p.wait() != 0:
            raise RuntimeError("claude exited with an error")
        new = pipeline.load(proj)  # raises if Claude broke the JSON
        issues = validate(new)
        return {"summary": final, "issues": issues}

    return {"job": _job("notes", pid, work)["id"]}


@app.post("/api/projects/{pid}/bake")
def bake_now(pid: str):
    proj = _proj(pid)

    def work(job, log):
        spec = render.prepare(pipeline.load(proj), proj, log=log)
        return {"graded": spec["source"].get("graded"), "spec": spec}

    return {"job": _job("colour", pid, work)["id"]}


@app.get("/api/projects/{pid}/luts")
def luts(pid: str):
    from . import colour

    proj = _proj(pid)
    prev = colour.lut_previews(Path(pipeline.load(proj)["source"]["src"]), proj / "work" / "luts")
    return [{"id": k, "img": f"/api/file?p={v}"} for k, v in prev.items()]


@app.post("/api/projects/{pid}/broll")
def auto_broll(pid: str):
    from .broll import add_broll

    proj = _proj(pid)

    def work(job, log):
        spec = pipeline.load(proj)
        _history(proj, spec)
        pipeline.save(proj, add_broll(spec, proj, log=log))
        return {}

    return {"job": _job("broll", pid, work)["id"]}


@app.get("/api/projects/{pid}/export/{kind}")
def export_file(pid: str, kind: str):
    from . import export

    proj = _proj(pid)
    spec = pipeline.load(proj)
    if kind not in ("srt", "vtt", "fcpxml"):
        raise HTTPException(404)
    text = {"srt": export.srt, "vtt": export.vtt, "fcpxml": lambda s: export.fcpxml(s, pid)}[kind](spec)
    return Response(text, media_type="text/plain", headers={"Content-Disposition": f'attachment; filename="{pid}.{kind}"'})


@app.post("/api/mimic")
async def mimic_start(url: str = Form(""), name: str = Form(""), file: UploadFile | None = File(None)):
    from .mimic import analyse

    out = PROJECTS / "_references" / _slug(name or (file.filename if file else url) or "reference")
    out.mkdir(parents=True, exist_ok=True)
    ref = url
    if file is not None and file.filename:
        ref = str(out / Path(file.filename).name)
        with open(ref, "wb") as fh:
            shutil.copyfileobj(file.file, fh)
    if not ref:
        raise HTTPException(400, "give a file or a URL")

    def work(job, log):
        log("measuring cuts, colour and pace")
        res = analyse(ref, out, name or None)
        log(f"look saved: {res['look']}")
        return {"look": res["look"], "shots": res["shots"], "colour": res["colour"], "sheet": res["sheet"]}

    return {"job": _job("mimic", None, work)["id"]}


@app.get("/api/jobs")
def jobs(project: str | None = None):
    return [j for j in JOBS.values() if project is None or j["project"] == project][-20:]


@app.get("/api/jobs/{jid}")
def job(jid: str):
    if jid not in JOBS:
        raise HTTPException(404)
    return JOBS[jid]


@app.get("/api/file")
def file(p: str, request: Request):
    """Media for the in-browser preview, with byte ranges so the player can seek."""
    path = Path(p).expanduser()
    if not path.exists() or not _allowed(path):
        raise HTTPException(404)
    size = path.stat().st_size
    rng = request.headers.get("range")
    if rng and rng.startswith("bytes="):
        a, _, b = rng[6:].partition("-")
        start = int(a) if a else 0
        end = min(int(b) if b else size - 1, size - 1)
        with open(path, "rb") as fh:
            fh.seek(start)
            data = fh.read(end - start + 1)
        import mimetypes

        return Response(data, status_code=206, media_type=mimetypes.guess_type(path.name)[0] or "application/octet-stream",
                        headers={"Content-Range": f"bytes {start}-{end}/{size}", "Accept-Ranges": "bytes"})
    return FileResponse(path, headers={"Accept-Ranges": "bytes"})


@app.get("/api/projects/{pid}/renders/{name}")
def get_render(pid: str, name: str):
    f = _proj(pid) / "renders" / Path(name).name
    if not f.exists():
        raise HTTPException(404)
    return FileResponse(f)


# ---- review links ------------------------------------------------------------------
# The editor shares a project; anyone with the link watches its latest render and leaves comments pinned to
# a moment and a spot. Reviewers can only read the video and comments and add comments.

REVIEW_PAGE = Path(__file__).parent / "review.html"
_PRIVATE = {"Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex"}


def _review_info(proj: Path) -> dict:
    from . import review

    r = review.latest_render(proj)
    return {"token": review.load(proj)["token"], "comments": review.comments(proj), "render": r.name if r else None}


@app.get("/api/projects/{pid}/review")
def get_review(pid: str):
    return _review_info(_proj(pid))


@app.post("/api/projects/{pid}/review")
def share_review(pid: str):
    """Share the project for review (the same link each time until sharing is stopped)."""
    from . import review

    proj = _proj(pid)
    token = review.share(proj)
    return {**_review_info(proj), "path": f"/review/{token}"}


@app.delete("/api/projects/{pid}/review")
def stop_review(pid: str):
    """Stop sharing: the link stops working. Comments stay."""
    from . import review

    proj = _proj(pid)
    review.unshare(proj)
    return _review_info(proj)


@app.post("/api/projects/{pid}/review/comments/{cid}")
async def mark_comment(pid: str, cid: str, req: Request):
    from . import review

    proj = _proj(pid)
    body = await req.json()
    try:
        review.set_done(proj, cid, bool(body.get("done")))
    except KeyError:
        raise HTTPException(404, "no such comment")
    return _review_info(proj)


@app.delete("/api/projects/{pid}/review/comments/{cid}")
def remove_comment(pid: str, cid: str):
    from . import review

    proj = _proj(pid)
    try:
        review.delete_comment(proj, cid)
    except KeyError:
        raise HTTPException(404, "no such comment")
    return _review_info(proj)


def _reviewed(token: str) -> Path:
    from . import review

    proj = review.find(PROJECTS, token)
    if proj is None:
        raise HTTPException(404, "this review link doesn't work any more: ask for a new one")
    return proj


@app.get("/api/review/{token}")
def review_data(token: str):
    from . import review

    proj = _reviewed(token)
    r = review.latest_render(proj)
    spec = pipeline.load(proj) if (proj / "spec.json").exists() else {}
    title = (spec.get("hook") or {}).get("text") if isinstance(spec.get("hook"), dict) else None
    return JSONResponse({"title": title or proj.name.replace("-", " "), "version": r.name if r else None,
                         "width": spec.get("width"), "height": spec.get("height"), "comments": review.comments(proj)}, headers=_PRIVATE)


@app.get("/api/review/{token}/video")
def review_video(token: str):
    from . import review

    r = review.latest_render(_reviewed(token))
    if r is None:
        raise HTTPException(404, "nothing rendered yet")
    return FileResponse(r, media_type="video/mp4", headers={**_PRIVATE, "Accept-Ranges": "bytes"})


@app.post("/api/review/{token}/comments")
async def review_comment(token: str, req: Request):
    from . import review

    proj = _reviewed(token)
    try:
        body = await req.json()
        r = review.latest_render(proj)
        c = review.add_comment(proj, body.get("name", ""), body.get("text", ""), body.get("at", 0), body.get("x"), body.get("y"),
                               version=r.name if r else "")
    except (ValueError, TypeError, AttributeError) as e:
        raise HTTPException(400, str(e) or "bad comment")
    return JSONResponse(c, headers=_PRIVATE)


@app.get("/review/{token}")
def review_page(token: str):
    _reviewed(token)
    return FileResponse(REVIEW_PAGE, media_type="text/html", headers=_PRIVATE)


# ---- Claude (MCP) ----------------------------------------------------------------------

@app.post("/mcp")
async def mcp(request: Request):
    """Edit reels from Claude Desktop / Claude Code (see connect.py). Only answers this computer."""
    from . import connect

    if not connect.local_request(request.headers.get("host"), request.headers.get("origin")):
        return JSONResponse({"error": "BetterCut only answers apps on this computer"}, status_code=403)
    try:
        msg = await request.json()
    except Exception:
        return JSONResponse({"jsonrpc": "2.0", "id": None, "error": {"code": -32700, "message": "parse error"}}, status_code=400)
    base = f"http://{request.headers.get('host') or '127.0.0.1'}"
    import anyio

    if isinstance(msg, list):
        out = [r for r in [await anyio.to_thread.run_sync(connect.handle, m, base) for m in msg] if r is not None]
        return JSONResponse(out) if out else Response(status_code=202)
    reply = await anyio.to_thread.run_sync(connect.handle, msg, base)
    return JSONResponse(reply) if reply is not None else Response(status_code=202)


@app.get("/mcp")
def mcp_get():
    return Response(status_code=405, headers={"Allow": "POST"})


# ---- UI ----------------------------------------------------------------------------

@app.get("/{path:path}")
def ui(path: str):
    f = UI_DIST / path
    if path and f.is_file():
        return FileResponse(f)
    idx = UI_DIST / "index.html"
    if idx.exists():
        return FileResponse(idx)
    return JSONResponse({"error": "UI not built: cd composer && npx vite build --config editor/vite.config.ts"}, status_code=503)


def serve(port: int = 4790) -> None:
    import uvicorn

    PROJECTS.mkdir(parents=True, exist_ok=True)
    print(f"BetterCut editor: http://localhost:{port}   (projects in {PROJECTS})")
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="warning")
