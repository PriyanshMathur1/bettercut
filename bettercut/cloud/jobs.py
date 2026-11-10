"""Job queue in the database, run by worker threads in the API process.

Heavy work (make, render, bake) runs one job at a time per worker (WORKERS=1 on a small free server). Jobs
survive restarts: anything that was mid-run when the server stopped is marked failed with a clear message.
"""
from __future__ import annotations

import json
import re
import shutil
import threading
import time
import traceback
from pathlib import Path

from sqlalchemy import select, update

from .. import pipeline
from ..spec import DEFAULT_BRAND
from . import agent, db, guard, memory, storage, vault
from .config import settings

_wake = threading.Event()
_threads: list[threading.Thread] = []
_stop = threading.Event()

# fields a bake/prepare adds to the spec; copied onto the latest version so edits made meanwhile aren't lost
BAKED_FIELDS = (("source", "graded"), ("source", "gradedMatte"), ("grade", "baked"), ("audio", "beats"), ("audio", "beatsFor"),
               ("source", "matte"), ("source", "keyed"), ("source", "keyColor"))


def enqueue(user_id: str, project_id: str | None, kind: str, params: dict) -> str:
    with db.session() as s:
        j = db.Job(user_id=user_id, project_id=project_id, kind=kind, params=params)
        s.add(j)
        s.flush()
        jid = j.id
    _wake.set()
    return jid


def public(j: db.Job, position: int | None = None) -> dict:
    return {"id": j.id, "kind": j.kind, "project": j.project_id, "status": "running" if j.status == "queued" else j.status,
            "queued": j.status == "queued", "position": position, "progress": j.progress, "log": j.log or [], "result": j.result}


class Ctx:
    """What a handler gets: throttled progress/log writes back to the job row."""

    def __init__(self, job: db.Job):
        self.job_id, self.user_id, self.project_id, self.params = job.id, job.user_id, job.project_id, job.params or {}
        self._log: list[str] = []
        self._progress = 0.0
        self._last = 0.0

    def log(self, msg) -> None:
        msg = str(msg)
        if self.project_id:  # never show server paths to users
            msg = msg.replace(str(self.proj) + "/", "").replace(str(self.proj), "")
        self._log = (self._log + [msg])[-200:]
        self.flush()

    def progress(self, p: float) -> None:
        self._progress = round(max(0.0, min(1.0, p)), 3)
        self.flush()

    def flush(self, force: bool = False) -> None:
        if not force and time.time() - self._last < 0.7:
            return
        self._last = time.time()
        with db.session() as s:
            s.execute(update(db.Job).where(db.Job.id == self.job_id).values(log=self._log, progress=self._progress))

    @property
    def proj(self) -> Path:
        assert self.project_id
        return storage.project_dir(self.user_id, self.project_id)


# ---- spec helpers ------------------------------------------------------------------

def checkout(user_id: str, project_id: str) -> tuple[dict, Path]:
    """Latest spec with real paths, files present in the working folder, spec.json written for the pipeline."""
    proj = storage.project_dir(user_id, project_id)
    with db.session() as s:
        v = db.latest_spec(s, project_id)
        if v is None:
            raise RuntimeError("this reel has no edit yet")
        stored = v.spec
    missing = storage.sync_down(user_id, project_id, storage.referenced(stored))
    hard = [m for m in missing if m.startswith("assets/source")]
    if hard:
        raise RuntimeError("the source footage for this reel is no longer stored: upload the clips again")
    spec = storage.absolutise(stored, proj)
    proj.mkdir(parents=True, exist_ok=True)
    pipeline.save(proj, spec)
    return spec, proj


def add_version(project_id: str, spec: dict, author: str, summary: str = "") -> int:
    with db.session() as s:
        v = db.SpecVersion(project_id=project_id, spec=spec, author=author, summary=summary[:2000])
        s.add(v)
        p = s.get(db.Project, project_id)
        if p:
            p.updated = time.time()
        s.flush()
        vid = v.id
        # keep the last 60 versions per project
        old = list(s.scalars(select(db.SpecVersion.id).where(db.SpecVersion.project_id == project_id).order_by(db.SpecVersion.id.desc()).offset(60)))
        for oid in old:
            s.delete(s.get(db.SpecVersion, oid))
    return vid


def merge_baked(ctx: Ctx, prepared: dict) -> None:
    """Copy bake outputs from a prepared spec onto the *latest* stored spec."""
    rel = storage.relativise(prepared, ctx.proj)
    with db.session() as s:
        latest = db.latest_spec(s, ctx.project_id)
        cur = json.loads(json.dumps(latest.spec))
    changed = False
    for a, b in BAKED_FIELDS:
        new = (rel.get(a) or {}).get(b)
        if new is not None and (cur.get(a) or {}).get(b) != new:
            cur.setdefault(a, {})[b] = new
            changed = True
    # reversed-shot files: copy onto the same shot (same footage range) in the latest spec
    made = {(s["start"], s["end"]): s["reversed"] for s in rel.get("segments", []) if s.get("reverse") and s.get("reversed")}
    for s in cur.get("segments", []):
        new = made.get((s["start"], s["end"])) if s.get("reverse") else None
        if new and s.get("reversed") != new:
            s["reversed"] = new
            changed = True
        elif not s.get("reverse") and "reversed" in s:
            del s["reversed"]
            changed = True
    if changed:
        add_version(ctx.project_id, cur, "pipeline", "Baked colour and audio")


# ---- handlers ------------------------------------------------------------------------

def h_make(ctx: Ctx) -> dict:
    cfg, p, proj = settings(), ctx.params, ctx.proj
    mems = memory.active(ctx.user_id)
    names = list(dict.fromkeys([*p.get("names", []), *memory.spellings(mems)]))
    files = [str(proj / f) for f in p["files"]]
    kw = {"names": names, "cutout": bool(p.get("cutout")) and cfg.allow_cutout, "model": cfg.whisper_model, "log": ctx.log}
    if p.get("hook") is not None:
        kw["hook"] = p["hook"]
    ctx.progress(0.05)
    pipeline.make(proj, files, look=p.get("look", "bold-pop"), shape=p.get("shape") or "auto", **kw)
    ctx.progress(0.9)
    spec = pipeline.load(proj)
    with db.session() as s:
        user = s.get(db.User, ctx.user_id)
        brand = dict(user.brand or {}) if user else {}
        pr = s.get(db.Project, ctx.project_id)
        if pr:  # the working folder is named after the id: show the reel's real name
            spec["title"] = pr.title
    if brand:
        spec["brand"] = {**DEFAULT_BRAND, **brand}
    spec = memory.apply_preferences(spec, mems)
    add_version(ctx.project_id, storage.relativise(spec, proj), "pipeline", "First cut")
    storage.sync_up(ctx.user_id, ctx.project_id)
    shutil.rmtree(proj / "inputs", ignore_errors=True)  # the assembled source is what's kept
    with db.session() as s:
        pr = s.get(db.Project, ctx.project_id)
        pr.status = "ready"
    return {"project": ctx.project_id, "words": len(spec.get("words", [])), "cut": sum(1 for w in spec.get("words", []) if w.get("cut"))}


def next_render_version(project_id: str) -> int:
    with db.session() as s:
        names = list(s.scalars(select(db.Render.name).where(db.Render.project_id == project_id)))
    vs = [int(m.group(1)) for n in names if (m := re.search(r"-v(\d+)", n))]
    return max(vs, default=0) + 1


def h_render(ctx: Ctx) -> dict:
    from .. import render
    from ..export import write_all

    started = time.time()
    quality = ctx.params.get("quality", "high")
    from .. import shape as shapes

    spec, proj = checkout(ctx.user_id, ctx.project_id)
    aspects = shapes.aspects_for(spec, ctx.params.get("aspects"))
    with db.session() as s:
        title = s.get(db.Project, ctx.project_id).title
    stem = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")[:40] or "reel"
    v = next_render_version(ctx.project_id)
    out_names, report = [], {}
    for n, asp in enumerate(aspects):
        tag = shapes.tag(spec, asp)
        dst = proj / "renders" / f"{stem}-v{v}{tag}{'.mov' if quality == 'master' else '.mp4'}"
        ctx.log(f"rendering {dst.name} ({quality})")
        render.render(pipeline.load(proj), proj, dst, quality=quality, log=ctx.log, aspect=asp,
                      progress=lambda p, n=n: ctx.progress((n + p * 0.95) / len(aspects)))
        if n == 0:
            report = render.qa(pipeline.load(proj), dst, proj)
            for i in report.get("issues", []):
                ctx.log("QA: " + i)
        out_names.append((dst.name, asp))
    write_all(pipeline.load(proj), proj / "renders", f"{stem}-v{v}")
    merge_baked(ctx, pipeline.load(proj))
    storage.sync_up(ctx.user_id, ctx.project_id, since=started - 1)
    with db.session() as s:
        for name, asp in out_names:
            s.add(db.Render(project_id=ctx.project_id, user_id=ctx.user_id, name=name, aspect=asp, quality=quality,
                            key=storage.key_for(ctx.user_id, ctx.project_id, f"renders/{name}")))
        for ext in ("srt", "vtt", "fcpxml"):
            if (proj / "renders" / f"{stem}-v{v}.{ext}").exists():
                s.add(db.Render(project_id=ctx.project_id, user_id=ctx.user_id, name=f"{stem}-v{v}.{ext}", aspect="export", quality=ext,
                                key=storage.key_for(ctx.user_id, ctx.project_id, f"renders/{stem}-v{v}.{ext}")))
    return {"render": out_names[0][0], "renders": [n for n, _ in out_names], "qa": {"issues": report.get("issues", [])}}


def h_bake(ctx: Ctx) -> dict:
    from .. import render

    started = time.time()
    spec, proj = checkout(ctx.user_id, ctx.project_id)
    prepared = render.prepare(spec, proj, log=ctx.log)
    merge_baked(ctx, prepared)
    storage.sync_up(ctx.user_id, ctx.project_id, since=started - 1)
    return {"baked": True}


def h_clips(ctx: Ctx) -> dict:
    """Append uploaded clips to the reel (only the new footage is transcribed)."""
    started = time.time()
    cfg = settings()
    spec, proj = checkout(ctx.user_id, ctx.project_id)
    names = list(dict.fromkeys([*ctx.params.get("names", []), *memory.spellings(memory.active(ctx.user_id))]))
    ctx.progress(0.05)
    new = pipeline.add_clips(proj, [str(proj / f) for f in ctx.params["files"]], names=names, model=cfg.whisper_model, log=ctx.log)
    add_version(ctx.project_id, storage.relativise(new, proj), "pipeline", "Added clips")
    storage.sync_up(ctx.user_id, ctx.project_id, since=started - 1)
    for f in ctx.params["files"]:
        shutil.rmtree((proj / f).parent, ignore_errors=True)
    return {"project": ctx.project_id, "shots": len(new["segments"])}


def h_notes(ctx: Ctx, complete: agent.Complete | None = None) -> dict:
    notes = ctx.params["notes"]
    with db.session() as s:
        conn = s.get(db.ModelConnection, ctx.params["connection"])
        if conn is None or conn.user_id != ctx.user_id:
            raise RuntimeError("connect a model first (Settings > Model)")
        provider, model, base, enc = conn.provider, conn.model, conn.api_base, conn.key_enc
        stored = db.latest_spec(s, ctx.project_id).spec
    if complete is None:
        key = vault.decrypt(enc, ctx.user_id) if enc else ""
        complete = agent.litellm_complete(provider, model, key, base)
    mems = memory.active(ctx.user_id)
    ctx.log(f"editing with {model}")
    try:
        res = agent.run(stored, notes, complete, memory_text=memory.prompt_block(mems),
                        remember=lambda k, t, v: memory.propose(ctx.user_id, k, t, v),
                        max_steps=settings().agent_max_steps, log=ctx.log, check=guard.spec_issues)
    except Exception as e:
        raise RuntimeError("the model call failed: " + agent._clean_error(e))
    if res["changed"]:
        add_version(ctx.project_id, res["spec"], "agent", res["summary"])
    with db.session() as s:
        s.add(db.AgentRun(project_id=ctx.project_id, provider=provider, model=model, tokens_in=res["tokens_in"],
                          tokens_out=res["tokens_out"], steps=res["steps"], summary=res["summary"]))
        for n in notes:
            s.add(db.Note(project_id=ctx.project_id, at=n.get("at"), text=n["text"], reply=res["summary"], job_id=ctx.job_id))
    return {"summary": res["summary"], "changed": res["changed"], "proposals": res["proposals"],
            "tokens": res["tokens_in"] + res["tokens_out"]}


HANDLERS = {"make": h_make, "render": h_render, "bake": h_bake, "notes": h_notes, "clips": h_clips}


# ---- worker ----------------------------------------------------------------------------

def claim() -> db.Job | None:
    with db.session() as s:
        j = s.scalars(select(db.Job).where(db.Job.status == "queued").order_by(db.Job.created).limit(1)).first()
        if j is None:
            return None
        got = s.execute(update(db.Job).where(db.Job.id == j.id, db.Job.status == "queued").values(status="running", started=time.time()))
        if got.rowcount != 1:
            return None
        s.refresh(j)
        return j


def run_job(j: db.Job) -> None:
    ctx = Ctx(j)
    try:
        result = HANDLERS[j.kind](ctx)
        status = "done"
        ctx._progress = 1.0
    except Exception as e:
        result, status = None, "error"
        ctx._log.append(f"ERROR: {e}")
        print(f"[job {j.id} {j.kind}] {traceback.format_exc()[-1500:]}")
        if j.kind == "make" and j.project_id:
            with db.session() as s:
                p = s.get(db.Project, j.project_id)
                if p:
                    p.status = "error"
    with db.session() as s:
        s.execute(update(db.Job).where(db.Job.id == j.id).values(status=status, result=result, log=ctx._log, progress=ctx._progress, finished=time.time()))


def run_pending(limit: int = 50) -> int:
    """Run queued jobs in this thread (tests, and `bettercut cloud --drain`)."""
    n = 0
    while n < limit and (j := claim()) is not None:
        run_job(j)
        n += 1
    return n


def _loop() -> None:
    while not _stop.is_set():
        j = claim()
        if j is None:
            _wake.wait(2.0)
            _wake.clear()
            continue
        run_job(j)


def start_workers() -> None:
    with db.session() as s:  # anything left "running" died with the previous process
        s.execute(update(db.Job).where(db.Job.status == "running").values(
            status="error", finished=time.time(), log=["ERROR: the server restarted while this was running. Start it again."]))
    _stop.clear()
    for i in range(max(1, settings().workers)):
        t = threading.Thread(target=_loop, name=f"bettercut-worker-{i}", daemon=True)
        t.start()
        _threads.append(t)


def stop_workers() -> None:
    _stop.set()
    _wake.set()
