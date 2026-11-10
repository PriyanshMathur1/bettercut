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
from . import pipeline, render
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


def _history(project: Path, spec: dict) -> None:
    h = project / "work" / "history"
    h.mkdir(parents=True, exist_ok=True)
    (h / f"spec-{int(time.time() * 1000)}.json").write_text(json.dumps(spec), encoding="utf-8")
    olds = sorted(h.glob("spec-*.json"))
    for f in olds[:-50]:
        f.unlink()


def _allowed(path: Path) -> bool:
    rp = path.resolve()
    roots = [PROJECTS.resolve(), USER_DIR.resolve(), (COMPOSER / "public").resolve()]
    return any(str(rp).startswith(str(r) + os.sep) for r in roots)


# ---- API -----------------------------------------------------------------------

@app.get("/api/health")
def health():
    return {"ok": True, "projects": str(PROJECTS), "claude": shutil.which(CLAUDE) is not None}


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
):
    pid = _slug(name)
    base = pid
    i = 2
    while (PROJECTS / pid).exists():
        pid = f"{base}-{i}"
        i += 1
    proj = PROJECTS / pid
    inputs = proj / "inputs"
    inputs.mkdir(parents=True)
    saved = []
    for f in files:
        if Path(f.filename or "").suffix.lower() not in VIDEO_EXT:
            continue
        dst = inputs / Path(f.filename).name
        with open(dst, "wb") as fh:
            shutil.copyfileobj(f.file, fh)
        saved.append(str(dst))
    if not saved:
        shutil.rmtree(proj)
        raise HTTPException(400, "upload at least one video file")

    def work(job, log):
        kw = {"names": [n.strip() for n in names.split(",") if n.strip()], "cutout": cutout, "model": model, "log": log}
        if hook is not None:
            kw["hook"] = hook
        pipeline.make(proj, saved, look=look, **kw)
        return {"project": pid}

    job = _job("make", pid, work)
    return {"project": pid, "job": job["id"]}


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
        saved.append(str(dst))
    if not saved:
        raise HTTPException(400, "upload at least one video file")

    def work(job, log):
        _history(proj, pipeline.load(proj))  # the old footage file is kept, so Undo brings the reel back
        spec = pipeline.add_clips(proj, saved, names=[n.strip() for n in names.split(",") if n.strip()], model=model, log=log)
        return {"project": pid, "shots": len(spec["segments"])}

    return {"job": _job("clips", pid, work)["id"]}


@app.get("/api/projects/{pid}/spec")
def get_spec(pid: str):
    proj = _proj(pid)
    if not (proj / "spec.json").exists():
        raise HTTPException(409, "still processing")
    spec = pipeline.load(proj)
    return {"spec": spec, "issues": validate(spec)}


@app.put("/api/projects/{pid}/spec")
async def put_spec(pid: str, req: Request):
    proj = _proj(pid)
    spec = await req.json()
    if spec.get("version") != 1 or "source" not in spec:
        raise HTTPException(400, "not a reel spec")
    _history(proj, pipeline.load(proj))
    pipeline.save(proj, spec)
    return {"ok": True, "issues": validate(spec)}


@app.post("/api/projects/{pid}/undo")
def undo(pid: str):
    proj = _proj(pid)
    h = sorted((proj / "work" / "history").glob("spec-*.json"))
    if not h:
        raise HTTPException(409, "nothing to undo")
    spec = json.loads(h[-1].read_text(encoding="utf-8"))
    h[-1].unlink()
    pipeline.save(proj, spec)
    return {"spec": spec}


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
    return {"path": str(dst)}


@app.post("/api/projects/{pid}/render")
async def start_render(pid: str, req: Request):
    proj = _proj(pid)
    body = await req.json() if (await req.body()) else {}
    quality = body.get("quality", "high")
    aspects = body.get("aspects") or ["9x16"]

    def work(job, log):
        from .export import write_all

        v = pipeline.next_version(proj)
        names = []
        report = {}
        for n, asp in enumerate(aspects):
            spec = pipeline.load(proj)
            tag = "" if asp == "9x16" else f"-{asp}"
            dst = proj / "renders" / f"{pid}-v{v}{tag}{'.mov' if quality == 'master' else '.mp4'}"
            log(f"rendering {dst.name} ({quality})")
            render.render(spec, proj, dst, quality=quality, log=log, aspect=asp,
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

    return {"job": _job("render", pid, work)["id"]}


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
