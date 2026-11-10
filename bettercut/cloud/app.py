"""BetterCut Cloud API. Same routes as the local editor where they overlap, each scoped to the signed-in user.

Run: python -m bettercut cloud   (AUTH_MODE=dev by default: one local user, no login)
"""
from __future__ import annotations

import mimetypes
import re
import shutil
import time
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Depends, FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse, Response
from sqlalchemy import delete, func, select

from .. import catalog as cat
from ..media import COMPOSER, VIDEO_EXT, audio_seconds, fix_recording, probe
from ..spec import DEFAULT_BRAND, apply_look, list_looks, validate
from . import agent, connector, db, guard, jobs, memory, storage, vault
from .auth import Caller, caller
from .config import settings

UI_DIST = COMPOSER / "editor" / "dist"
ASSET_EXT = VIDEO_EXT | {".mp3", ".wav", ".m4a", ".aac", ".png", ".jpg", ".jpeg", ".webp", ".gif"}
ASPECTS = {"9x16", "4x5", "1x1", "16x9"}
QUALITIES = {"draft", "high", "max", "master"}


@asynccontextmanager
async def lifespan(_: FastAPI):
    settings().work_dir.mkdir(parents=True, exist_ok=True)
    db.engine()
    vault.master_key()
    jobs.start_workers()
    yield
    jobs.stop_workers()


app = FastAPI(title="BetterCut Cloud", lifespan=lifespan)


# ---- helpers -----------------------------------------------------------------------

def _project(s, pid: str, me: Caller) -> db.Project:
    p = s.get(db.Project, pid) if re.fullmatch(r"[0-9a-f]{32}", pid) else None
    if p is None or p.user_id != me.id:
        raise HTTPException(404, "no such reel")
    return p


def _issues(spec: dict) -> list[str]:
    return [i for i in validate(spec) if not i.startswith("source file missing")]


def _safe_name(name: str) -> str:
    return re.sub(r"[^\w.-]+", "_", Path(name or "file").name)[:120] or "file"


async def _save_upload(f: UploadFile, dst: Path, max_bytes: int) -> int:
    dst.parent.mkdir(parents=True, exist_ok=True)
    n = 0
    with open(dst, "wb") as fh:
        while chunk := await f.read(1 << 20):
            n += len(chunk)
            if n > max_bytes:
                fh.close()
                dst.unlink(missing_ok=True)
                raise HTTPException(413, f"{f.filename} is larger than the {max_bytes >> 20} MB limit")
            fh.write(chunk)
    return n


def _spec_payload(me: Caller, pid: str, v: db.SpecVersion) -> dict:
    return {"spec": v.spec, "issues": _issues(v.spec), "media": storage.media_urls(me.id, pid, v.spec), "version": v.id,
            "author": v.author, "summary": v.summary}


def _check_spec(new: dict, old: dict | None) -> None:
    if not isinstance(new, dict) or new.get("version") != 1 or "source" not in new:
        raise HTTPException(400, "not a reel spec")
    if old is not None and not guard.same_source(new, old):
        raise HTTPException(400, "the source footage of a reel can't be changed")
    bad = guard.spec_issues(new)
    if bad:
        raise HTTPException(400, bad[0])


# ---- public ------------------------------------------------------------------------

@app.get("/api/health")
def health():
    return {"ok": True, "mode": "cloud"}


@app.get("/api/config")
def config():
    s = settings()
    return {
        "mode": "cloud", "auth": s.auth_mode, "supabaseUrl": s.supabase_url, "supabaseAnonKey": s.supabase_anon_key, "providers_auth": s.auth_providers,
        "limits": {"uploadMb": s.max_upload_mb, "clipSeconds": s.max_clip_seconds, "projects": s.max_projects, "rendersPerDay": s.renders_per_day},
        "cutout": s.allow_cutout,
        "providers": [{"id": k, "label": v["label"], "example": v["example"], "needsBase": k == "openai_compatible"} for k, v in agent.PROVIDERS.items()],
    }


@app.get("/api/catalog")
def get_catalog():
    c = cat.catalog()
    c["looks"] = [v for v in list_looks().values() if not v.get("user")]
    return c


@app.get("/api/media/{key:path}")
def media(key: str, exp: str, sig: str, request: Request):
    """Signed media for the local storage backend, with byte ranges so the player can seek."""
    if not vault.verify(key, exp, sig):
        raise HTTPException(403, "link expired: reload the editor")
    st = storage.store()
    if st.kind != "local":
        raise HTTPException(404)
    try:
        path = st.path(key)
    except ValueError:
        raise HTTPException(404)
    if not path.is_file():
        raise HTTPException(404)
    size = path.stat().st_size
    ctype = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    rng = request.headers.get("range")
    if rng and rng.startswith("bytes="):
        a, _, b = rng[6:].partition("-")
        start = int(a) if a else 0
        end = min(int(b) if b else size - 1, size - 1, start + (8 << 20) - 1)
        if start >= size:
            return Response(status_code=416, headers={"Content-Range": f"bytes */{size}"})
        with open(path, "rb") as fh:
            fh.seek(start)
            data = fh.read(end - start + 1)
        return Response(data, status_code=206, media_type=ctype, headers={"Content-Range": f"bytes {start}-{end}/{size}", "Accept-Ranges": "bytes"})
    return FileResponse(path, media_type=ctype, headers={"Accept-Ranges": "bytes"})


# ---- account -----------------------------------------------------------------------

@app.get("/api/me")
def me_(me: Caller = Depends(caller)):
    s = settings()
    day = time.time() - 86400
    with db.session() as ses:
        projects = ses.scalar(select(func.count()).select_from(db.Project).where(db.Project.user_id == me.id))
        renders = ses.scalar(select(func.count()).select_from(db.Job).where(db.Job.user_id == me.id, db.Job.kind == "render", db.Job.created > day))
        has_model = ses.scalar(select(func.count()).select_from(db.ModelConnection).where(db.ModelConnection.user_id == me.id)) > 0
    return {"id": me.id, "email": me.email, "projects": projects, "rendersToday": renders, "hasModel": has_model,
            "storageBytes": storage.store().size(me.id + "/"),
            "limits": {"projects": s.max_projects, "rendersPerDay": s.renders_per_day}}


@app.get("/api/brand")
def get_brand(me: Caller = Depends(caller)):
    with db.session() as s:
        return {**DEFAULT_BRAND, **(s.get(db.User, me.id).brand or {})}


@app.put("/api/brand")
async def put_brand(req: Request, me: Caller = Depends(caller)):
    data = await req.json()
    clean = {k: str(v)[:200] for k, v in data.items() if k in DEFAULT_BRAND and isinstance(v, (str, int, float))}
    with db.session() as s:
        s.get(db.User, me.id).brand = clean
    return {**DEFAULT_BRAND, **clean}


# ---- model connections (bring your own model) ------------------------------------

def _conn_public(c: db.ModelConnection) -> dict:
    return {"id": c.id, "provider": c.provider, "model": c.model, "apiBase": c.api_base, "keyLast4": c.key_last4,
            "caps": c.caps or {}, "isDefault": c.is_default}


@app.get("/api/models")
def list_models(me: Caller = Depends(caller)):
    with db.session() as s:
        return [_conn_public(c) for c in s.scalars(select(db.ModelConnection).where(db.ModelConnection.user_id == me.id).order_by(db.ModelConnection.created))]


@app.post("/api/models")
async def add_model(req: Request, me: Caller = Depends(caller)):
    b = await req.json()
    provider, model = str(b.get("provider", "")), str(b.get("model", "")).strip()
    key, base = str(b.get("apiKey", "")).strip(), str(b.get("apiBase", "")).strip().rstrip("/")
    if provider not in agent.PROVIDERS or not model:
        raise HTTPException(400, "pick a provider and enter a model name")
    if provider != "openai_compatible":
        base = ""
        if not key:
            raise HTTPException(400, "paste your API key")
    else:
        issue = guard.public_url_issue(base, allow_private=settings().auth_mode == "dev")
        if issue:
            raise HTTPException(400, issue)
    caps = agent.test_connection(agent.litellm_complete(provider, model, key or "none", base, timeout=45), provider, model)
    if not caps["ok"]:
        raise HTTPException(400, caps["error"] or "the test edit failed")
    with db.session() as s:
        first = s.scalar(select(func.count()).select_from(db.ModelConnection).where(db.ModelConnection.user_id == me.id)) == 0
        c = db.ModelConnection(user_id=me.id, provider=provider, model=model, api_base=base,
                               key_enc=vault.encrypt(key, me.id) if key else "", key_last4=key[-4:] if len(key) >= 8 else "",
                               caps=caps, is_default=first)
        s.add(c)
        s.flush()
        return _conn_public(c)


@app.post("/api/models/{cid}/default")
def default_model(cid: str, me: Caller = Depends(caller)):
    with db.session() as s:
        rows = list(s.scalars(select(db.ModelConnection).where(db.ModelConnection.user_id == me.id)))
        if not any(c.id == cid for c in rows):
            raise HTTPException(404)
        for c in rows:
            c.is_default = c.id == cid
    return {"ok": True}


@app.delete("/api/models/{cid}")
def delete_model(cid: str, me: Caller = Depends(caller)):
    with db.session() as s:
        c = s.get(db.ModelConnection, cid)
        if c is None or c.user_id != me.id:
            raise HTTPException(404)
        was_default = c.is_default
        s.delete(c)
        s.flush()
        if was_default:
            nxt = s.scalars(select(db.ModelConnection).where(db.ModelConnection.user_id == me.id).limit(1)).first()
            if nxt:
                nxt.is_default = True
    return {"ok": True}


# ---- memory ------------------------------------------------------------------------

def _mem_public(m: db.Memory) -> dict:
    return {"id": m.id, "kind": m.kind, "text": m.text, "value": m.value, "status": m.status, "source": m.source, "created": m.created}


@app.get("/api/memory")
def list_memory(me: Caller = Depends(caller)):
    with db.session() as s:
        return [_mem_public(m) for m in s.scalars(select(db.Memory).where(db.Memory.user_id == me.id).order_by(db.Memory.created))]


@app.post("/api/memory")
async def add_memory(req: Request, me: Caller = Depends(caller)):
    b = await req.json()
    kind, text = b.get("kind"), str(b.get("text", "")).strip()[:500]
    if kind not in memory.KINDS or not text:
        raise HTTPException(400, "give a kind (spelling, preference, style) and some text")
    value = b.get("value") if isinstance(b.get("value"), dict) else None
    if value and guard.spec_issues(value):
        raise HTTPException(400, "that preference can't be saved")
    with db.session() as s:
        if s.scalar(select(func.count()).select_from(db.Memory).where(db.Memory.user_id == me.id)) >= 200:
            raise HTTPException(400, "memory is full (200 items): remove some first")
        m = db.Memory(user_id=me.id, kind=kind, text=text, value=value)
        s.add(m)
        s.flush()
        return _mem_public(m)


@app.patch("/api/memory/{mid}")
async def edit_memory(mid: str, req: Request, me: Caller = Depends(caller)):
    b = await req.json()
    with db.session() as s:
        m = s.get(db.Memory, mid)
        if m is None or m.user_id != me.id:
            raise HTTPException(404)
        if "text" in b and str(b["text"]).strip():
            m.text = str(b["text"]).strip()[:500]
        if b.get("status") == "active":
            m.status = "active"
        if "value" in b and (b["value"] is None or isinstance(b["value"], dict)):
            if b["value"] and guard.spec_issues(b["value"]):
                raise HTTPException(400, "that preference can't be saved")
            m.value = b["value"]
        return _mem_public(m)


@app.delete("/api/memory/{mid}")
def delete_memory(mid: str, me: Caller = Depends(caller)):
    with db.session() as s:
        m = s.get(db.Memory, mid)
        if m is None or m.user_id != me.id:
            raise HTTPException(404)
        s.delete(m)
    return {"ok": True}


# ---- projects ----------------------------------------------------------------------

@app.get("/api/projects")
def list_projects(me: Caller = Depends(caller)):
    st = storage.store()
    with db.session() as s:
        rows = list(s.scalars(select(db.Project).where(db.Project.user_id == me.id).order_by(db.Project.updated.desc())))
        renders = list(s.scalars(select(db.Render).where(db.Render.user_id == me.id).order_by(db.Render.id.desc())))
    by: dict[str, list] = {}
    for r in renders:
        by.setdefault(r.project_id, []).append({"name": r.name, "aspect": r.aspect, "quality": r.quality, "created": r.created, "url": st.url(r.key, 24 * 3600)})
    return [{"id": p.id, "title": p.title, "ready": p.status == "ready", "status": p.status, "updated": p.updated, "renders": by.get(p.id, [])[:12]} for p in rows]


@app.post("/api/projects")
async def create_project(
    files: list[UploadFile] = File(...),
    name: str = Form("reel"),
    look: str = Form("bold-pop"),
    names: str = Form(""),
    cutout: bool = Form(False),
    hook: str | None = Form(None),
    shape: str = Form("auto"),
    me: Caller = Depends(caller),
):
    if shape != "auto" and shape not in ASPECTS:
        raise HTTPException(400, "unknown shape")
    cfg = settings()
    with db.session() as s:
        if s.scalar(select(func.count()).select_from(db.Project).where(db.Project.user_id == me.id)) >= cfg.max_projects:
            raise HTTPException(400, f"you have {cfg.max_projects} reels, the limit for this beta: delete one first")
        p = db.Project(user_id=me.id, title=name.strip()[:200] or "reel")
        s.add(p)
        s.flush()
        pid = p.id
    proj = storage.project_dir(me.id, pid)
    saved: list[str] = []
    try:
        budget = cfg.max_upload_mb << 20
        for i, f in enumerate(files[:20]):
            if Path(f.filename or "").suffix.lower() not in VIDEO_EXT:
                continue
            dst = proj / "inputs" / f"{i:02d}_{_safe_name(f.filename)}"
            budget -= await _save_upload(f, dst, budget)
            fix_recording(dst)  # recordings made in the browser carry no length
            info = probe(dst)
            if not info.get("duration"):
                raise HTTPException(400, f"{f.filename} isn't a video this editor can read")
            if info["duration"] > cfg.max_clip_seconds:
                raise HTTPException(400, f"{f.filename} is {info['duration']:.0f} s long; the limit is {cfg.max_clip_seconds} s per clip")
            saved.append(str(dst.relative_to(proj)))
        if not saved:
            raise HTTPException(400, "upload at least one video file")
    except Exception:
        shutil.rmtree(proj, ignore_errors=True)
        with db.session() as s:
            s.execute(delete(db.Project).where(db.Project.id == pid))
        raise
    jid = jobs.enqueue(me.id, pid, "make", {"files": saved, "look": look, "names": [n.strip() for n in names.split(",") if n.strip()],
                                             "cutout": cutout, "hook": hook, "shape": shape})
    return {"project": pid, "job": jid}


@app.post("/api/projects/{pid}/clips")
async def add_clips(pid: str, files: list[UploadFile] = File(...), names: str = Form(""), me: Caller = Depends(caller)):
    """Append more footage to a reel. Same per-clip and upload limits as a new reel."""
    cfg = settings()
    with db.session() as s:
        _project(s, pid, me)
        if db.latest_spec(s, pid) is None:
            raise HTTPException(409, "still processing")
    proj = storage.project_dir(me.id, pid)
    folder = proj / "inputs" / f"add-{int(time.time())}"
    saved: list[str] = []
    try:
        budget = cfg.max_upload_mb << 20
        for i, f in enumerate(files[:20]):
            if Path(f.filename or "").suffix.lower() not in VIDEO_EXT:
                continue
            dst = folder / f"{i:02d}_{_safe_name(f.filename)}"
            budget -= await _save_upload(f, dst, budget)
            fix_recording(dst)  # recordings made in the browser carry no length
            info = probe(dst)
            if not info.get("duration"):
                raise HTTPException(400, f"{f.filename} isn't a video this editor can read")
            if info["duration"] > cfg.max_clip_seconds:
                raise HTTPException(400, f"{f.filename} is {info['duration']:.0f} s long; the limit is {cfg.max_clip_seconds} s per clip")
            saved.append(str(dst.relative_to(proj)))
        if not saved:
            raise HTTPException(400, "upload at least one video file")
    except Exception:
        shutil.rmtree(folder, ignore_errors=True)
        raise
    return _enqueue_for(pid, me, "clips", {"files": saved, "names": [n.strip() for n in names.split(",") if n.strip()]})


@app.delete("/api/projects/{pid}")
def delete_project(pid: str, me: Caller = Depends(caller)):
    with db.session() as s:
        p = _project(s, pid, me)
        busy = s.scalar(select(func.count()).select_from(db.Job).where(db.Job.project_id == pid, db.Job.status == "running"))
        if busy:
            raise HTTPException(409, "this reel is being processed: try again when it finishes")
        for model in (db.SpecVersion, db.Job, db.Render, db.Note, db.AgentRun):
            s.execute(delete(model).where(model.project_id == pid))
        s.delete(p)
    storage.store().delete_prefix(f"{me.id}/{pid}/")
    shutil.rmtree(storage.project_dir(me.id, pid), ignore_errors=True)
    return {"ok": True}


@app.patch("/api/projects/{pid}")
async def rename_project(pid: str, req: Request, me: Caller = Depends(caller)):
    b = await req.json()
    with db.session() as s:
        p = _project(s, pid, me)
        if str(b.get("title", "")).strip():
            p.title = str(b["title"]).strip()[:200]
        return {"id": p.id, "title": p.title}


@app.get("/api/projects/{pid}/spec")
def get_spec(pid: str, me: Caller = Depends(caller)):
    with db.session() as s:
        _project(s, pid, me)
        v = db.latest_spec(s, pid)
        if v is None:
            raise HTTPException(409, "still processing")
        return _spec_payload(me, pid, v)


@app.put("/api/projects/{pid}/spec")
async def put_spec(pid: str, req: Request, me: Caller = Depends(caller)):
    spec = await req.json()
    with db.session() as s:
        _project(s, pid, me)
        v = db.latest_spec(s, pid)
        if v is None:
            raise HTTPException(409, "still processing")
        _check_spec(spec, v.spec)
        if v.spec == spec:
            return {"ok": True, "issues": _issues(spec), "version": v.id}
        # typing in the editor autosaves every second: fold those into one version
        if v.author == "user" and time.time() - v.created < 45:
            v.spec = spec
            s.get(db.Project, pid).updated = time.time()
            return {"ok": True, "issues": _issues(spec), "version": v.id}
    vid = jobs.add_version(pid, spec, "user")
    return {"ok": True, "issues": _issues(spec), "version": vid}


@app.post("/api/projects/{pid}/undo")
def undo(pid: str, me: Caller = Depends(caller)):
    with db.session() as s:
        _project(s, pid, me)
        vs = list(s.scalars(select(db.SpecVersion).where(db.SpecVersion.project_id == pid).order_by(db.SpecVersion.id.desc()).limit(2)))
        if len(vs) < 2:
            raise HTTPException(409, "nothing to undo")
        s.delete(vs[0])
        return _spec_payload(me, pid, vs[1])


@app.get("/api/projects/{pid}/history")
def history(pid: str, me: Caller = Depends(caller)):
    with db.session() as s:
        _project(s, pid, me)
        vs = s.scalars(select(db.SpecVersion).where(db.SpecVersion.project_id == pid).order_by(db.SpecVersion.id.desc()).limit(40))
        return [{"version": v.id, "author": v.author, "summary": v.summary, "created": v.created} for v in vs]


@app.post("/api/projects/{pid}/look")
async def set_look(pid: str, req: Request, me: Caller = Depends(caller)):
    body = await req.json()
    if body.get("look") not in list_looks():
        raise HTTPException(400, "no such look")
    with db.session() as s:
        _project(s, pid, me)
        cur = db.latest_spec(s, pid).spec
    new = apply_look(cur, body["look"], (cur.get("hook") or {}).get("text", ""))
    _check_spec(new, cur)
    jobs.add_version(pid, new, "user", f"Look: {body['look']}")
    with db.session() as s:
        return _spec_payload(me, pid, db.latest_spec(s, pid))


@app.post("/api/projects/{pid}/upload")
async def upload_asset(pid: str, file: UploadFile = File(...), me: Caller = Depends(caller)):
    with db.session() as s:
        _project(s, pid, me)
    if Path(file.filename or "").suffix.lower() not in ASSET_EXT:
        raise HTTPException(400, "upload a video, image or audio file")
    rel = f"assets/user/{_safe_name(file.filename)}"
    dst = storage.project_dir(me.id, pid) / rel
    await _save_upload(file, dst, settings().max_upload_mb << 20)
    fix_recording(dst)
    key = storage.key_for(me.id, pid, rel)
    st = storage.store()
    st.put(key, dst)
    return {"path": storage.TOKEN + rel, "url": st.url(key), "seconds": audio_seconds(dst)}


def _enqueue_for(pid: str, me: Caller, kind: str, params: dict) -> dict:
    with db.session() as s:
        _project(s, pid, me)
        if db.latest_spec(s, pid) is None:
            raise HTTPException(409, "still processing")
        dup = s.scalars(select(db.Job).where(db.Job.project_id == pid, db.Job.kind == kind, db.Job.status.in_(("queued", "running")))).first()
        if dup:
            return {"job": dup.id}
    return {"job": jobs.enqueue(me.id, pid, kind, params)}


@app.post("/api/projects/{pid}/render")
async def start_render(pid: str, req: Request, me: Caller = Depends(caller)):
    body = await req.json() if (await req.body()) else {}
    quality = body.get("quality", "high")
    aspects = [a for a in (body.get("aspects") or []) if a in ASPECTS] or ["native"]  # native: the project's own shape
    if quality not in QUALITIES:
        raise HTTPException(400, "unknown quality")
    cfg = settings()
    with db.session() as s:
        today = s.scalar(select(func.count()).select_from(db.Job).where(db.Job.user_id == me.id, db.Job.kind == "render", db.Job.created > time.time() - 86400))
    if today >= cfg.renders_per_day:
        raise HTTPException(429, f"you've used today's {cfg.renders_per_day} renders: try again tomorrow")
    return _enqueue_for(pid, me, "render", {"quality": quality, "aspects": aspects})


@app.post("/api/projects/{pid}/bake")
def bake_now(pid: str, me: Caller = Depends(caller)):
    return _enqueue_for(pid, me, "bake", {})


@app.post("/api/projects/{pid}/notes")
async def send_notes(pid: str, req: Request, me: Caller = Depends(caller)):
    body = await req.json()
    notes = [{"at": n.get("t", n.get("at")), "text": str(n.get("text", "")).strip()[:1000]} for n in body.get("notes", []) if str(n.get("text", "")).strip()]
    if not notes:
        raise HTTPException(400, "no notes")
    with db.session() as s:
        q = select(db.ModelConnection).where(db.ModelConnection.user_id == me.id)
        conn = s.get(db.ModelConnection, body["connection"]) if body.get("connection") else s.scalars(q.order_by(db.ModelConnection.is_default.desc()).limit(1)).first()
        if conn is None or conn.user_id != me.id:
            raise HTTPException(400, "connect your AI model first (Settings, then Model)")
        cid = conn.id
    return _enqueue_for(pid, me, "notes", {"notes": notes[:30], "connection": cid})


@app.get("/api/projects/{pid}/notes")
def list_notes(pid: str, me: Caller = Depends(caller)):
    with db.session() as s:
        _project(s, pid, me)
        ns = s.scalars(select(db.Note).where(db.Note.project_id == pid).order_by(db.Note.id.desc()).limit(50))
        return [{"at": n.at, "text": n.text, "reply": n.reply, "created": n.created} for n in ns]


@app.get("/api/projects/{pid}/luts")
def luts(pid: str, me: Caller = Depends(caller)):
    from .. import colour

    with db.session() as s:
        _project(s, pid, me)
    spec, proj = jobs.checkout(me.id, pid)
    prev = colour.lut_previews(Path(spec["source"]["src"]), proj / "assets" / "luts")
    st = storage.store()
    out = []
    for name, path in prev.items():
        key = storage.key_for(me.id, pid, str(Path(path).relative_to(proj)))
        if st.kind != "local" and not st.exists(key):
            st.put(key, Path(path))
        out.append({"id": name, "img": st.url(key)})
    return out


@app.get("/api/projects/{pid}/export/{kind}")
def export_file(pid: str, kind: str, me: Caller = Depends(caller)):
    from .. import export

    if kind not in ("srt", "vtt", "fcpxml"):
        raise HTTPException(404)
    with db.session() as s:
        title = _project(s, pid, me).title
        spec = db.latest_spec(s, pid).spec
    text = {"srt": export.srt, "vtt": export.vtt, "fcpxml": lambda sp: export.fcpxml(sp, title)}[kind](spec)
    return Response(text, media_type="text/plain", headers={"Content-Disposition": f'attachment; filename="{_safe_name(title)}.{kind}"'})


# ---- connector (MCP) ---------------------------------------------------------------

def _base(request: Request) -> str:
    import os

    return settings().public_url if os.environ.get("PUBLIC_URL") else str(request.base_url).rstrip("/")


def _connector_public(request: Request, me: Caller) -> dict:
    c = connector.current(me.id)
    if c is None:
        return {"on": False, "url": "", "lastUsed": None}
    return {"on": True, "url": f"{_base(request)}/mcp/{c['token']}", "lastUsed": c["lastUsed"]}


@app.get("/api/connector")
def get_connector(request: Request, me: Caller = Depends(caller)):
    return _connector_public(request, me)


@app.post("/api/connector")
def make_connector(request: Request, me: Caller = Depends(caller)):
    """Create the personal link, or replace it (the old link stops working)."""
    connector.create(me.id)
    return _connector_public(request, me)


@app.delete("/api/connector")
def delete_connector(me: Caller = Depends(caller)):
    connector.revoke(me.id)
    return {"ok": True}


@app.get("/api/projects/{pid}/head")
def head(pid: str, me: Caller = Depends(caller)):
    """Cheap poll for the editor: has the reel changed (e.g. edited from the user's AI app)?"""
    with db.session() as s:
        _project(s, pid, me)
        v = db.latest_spec(s, pid)
        return {"version": v.id if v else None, "author": v.author if v else "", "summary": v.summary if v else ""}


async def _mcp(request: Request, user_id: str) -> Response:
    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"jsonrpc": "2.0", "id": None, "error": {"code": -32700, "message": "parse error"}}, status_code=400)
    base = _base(request)
    if isinstance(body, list):
        out = [r for r in (connector.handle(user_id, m, base) for m in body[:20]) if r is not None]
        return JSONResponse(out) if out else Response(status_code=202)
    r = connector.handle(user_id, body, base)
    return JSONResponse(r) if r is not None else Response(status_code=202)


@app.post("/mcp")
async def mcp_local(request: Request):
    """No-token endpoint, only for the single local user (AUTH_MODE=dev)."""
    if settings().auth_mode != "dev":
        raise HTTPException(401, "use your personal connector link from Settings > Connect")
    origin = request.headers.get("origin")
    if origin and origin.rstrip("/") != str(request.base_url).rstrip("/"):  # a web page must not drive the local editor
        raise HTTPException(403, "cross-site requests are not allowed")
    return await _mcp(request, caller(request).id)


@app.post("/mcp/{token}")
async def mcp_personal(token: str, request: Request):
    user_id = connector.user_for(token)
    if user_id is None:
        raise HTTPException(401, "this connector link is not valid: copy a new one from Settings > Connect")
    return await _mcp(request, user_id)


@app.get("/mcp")
@app.get("/mcp/{token}")
def mcp_get(token: str = ""):
    return Response(status_code=405, headers={"Allow": "POST"})  # no server-initiated stream


# ---- jobs --------------------------------------------------------------------------

def _position(s, j: db.Job) -> int | None:
    if j.status != "queued":
        return None
    return s.scalar(select(func.count()).select_from(db.Job).where(db.Job.status.in_(("queued", "running")), db.Job.created < j.created)) + 1


@app.get("/api/jobs/{jid}")
def job(jid: str, me: Caller = Depends(caller)):
    with db.session() as s:
        j = s.get(db.Job, jid)
        if j is None or j.user_id != me.id:
            raise HTTPException(404)
        return jobs.public(j, _position(s, j))


@app.get("/api/jobs")
def list_jobs(project: str | None = None, me: Caller = Depends(caller)):
    with db.session() as s:
        q = select(db.Job).where(db.Job.user_id == me.id)
        if project:
            q = q.where(db.Job.project_id == project)
        return [jobs.public(j, _position(s, j)) for j in s.scalars(q.order_by(db.Job.created.desc()).limit(20))]


# ---- UI ----------------------------------------------------------------------------

@app.get("/{path:path}")
def ui(path: str):
    if path.startswith("api/"):
        raise HTTPException(404)
    f = (UI_DIST / path).resolve()
    if path and f.is_file() and str(f).startswith(str(UI_DIST.resolve())):
        return FileResponse(f)
    idx = UI_DIST / "index.html"
    if idx.exists():
        return FileResponse(idx, headers={"Cache-Control": "no-cache"})
    return JSONResponse({"error": "UI not built: cd composer && npx vite build --config editor/vite.config.ts"}, status_code=503)


def serve(port: int = 4790, host: str = "127.0.0.1") -> None:
    import uvicorn

    s = settings()
    print(f"BetterCut Cloud: http://{host}:{port}   auth={s.auth_mode} storage={s.storage} data={s.data_dir}")
    uvicorn.run(app, host=host, port=port, log_level="warning")
