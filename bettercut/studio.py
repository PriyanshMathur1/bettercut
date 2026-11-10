"""Pipeline mode: take a reel from brief to finished video in stages, with the creator's approval in between.

A pipeline (bettercut/pipelines/<id>.json) is a list of stages. Each stage has a goal, a guide for the AI that
does the work (Claude, through the connection in connect.py), a checklist, and whether the creator approves it
before the next stage starts. The reel remembers where it is in work/pipeline.json, and the editor shows it.

Stage status: "doing" (the AI is working on it), "review" (waiting for the creator), "done".
"""
from __future__ import annotations

import copy
import json
import shutil
import threading
import time
from pathlib import Path

HERE = Path(__file__).parent / "pipelines"
FILE = "pipeline.json"
_LOCK = threading.Lock()


class StageError(Exception):
    """A pipeline step that can't happen now; the message says why."""


def pipelines() -> list[dict]:
    out = []
    for f in sorted(HERE.glob("*.json")):
        out.append(json.loads(f.read_text(encoding="utf-8")))
    order = ["talking-head", "travel-montage", "screen-demo", "multicam", "clip-factory"]
    return sorted(out, key=lambda p: order.index(p["id"]) if p["id"] in order else len(order))


def get(pipeline_id: str) -> dict:
    for p in pipelines():
        if p["id"] == pipeline_id:
            return p
    raise StageError(f"no pipeline named {pipeline_id}: choose one of " + ", ".join(p["id"] for p in pipelines()))


def _path(project: Path) -> Path:
    return project / "work" / FILE


def state(project: Path) -> dict | None:
    try:
        return json.loads(_path(project).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def _save(project: Path, st: dict) -> dict:
    p = _path(project)
    p.parent.mkdir(parents=True, exist_ok=True)
    st["updated"] = time.time()
    tmp = p.with_suffix(".tmp")
    tmp.write_text(json.dumps(st, indent=1, ensure_ascii=False), encoding="utf-8")
    tmp.replace(p)
    return st


def start(project: Path, pipeline_id: str, brief: str = "", restart: bool = False) -> dict:
    p = get(pipeline_id)
    with _LOCK:
        old = state(project)
        if old and not old.get("finished") and not restart:
            raise StageError(f"this reel is already in the {old['name']} pipeline: carry on, or start again with restart")
        st = {
            "pipeline": p["id"], "name": p["name"], "brief": str(brief or "")[:4000], "started": time.time(), "stage": 0, "finished": False,
            "stages": [{"id": s["id"], "name": s["name"], "approve": bool(s.get("approve")), "status": "todo", "summary": "", "note": ""} for s in p["stages"]],
        }
        st["stages"][0]["status"] = "doing"
        return _save(project, st)


def _current(st: dict) -> dict:
    return st["stages"][st["stage"]]


def finish_stage(project: Path, summary: str) -> dict:
    """The AI says the current stage is done. It waits for the creator if the stage needs approval."""
    with _LOCK:
        st = state(project)
        if not st or st.get("finished"):
            raise StageError("no pipeline is running on this reel")
        cur = _current(st)
        if cur["status"] == "review":
            raise StageError(f"'{cur['name']}' is already waiting for the creator's approval")
        cur["summary"] = str(summary or "")[:2000]
        cur["note"] = ""
        if cur["approve"]:
            cur["status"] = "review"
            return _save(project, st)
        return _save(project, _advance(st))


def _advance(st: dict) -> dict:
    _current(st)["status"] = "done"
    if st["stage"] + 1 < len(st["stages"]):
        st["stage"] += 1
        _current(st)["status"] = "doing"
    else:
        st["finished"] = True
    return st


def approve(project: Path, note: str = "") -> dict:
    """The creator approves the stage that is waiting, and the next one starts."""
    with _LOCK:
        st = state(project)
        if not st or st.get("finished"):
            raise StageError("no pipeline is running on this reel")
        cur = _current(st)
        if cur["status"] != "review":
            raise StageError(f"'{cur['name']}' isn't waiting for approval yet")
        cur["note"] = str(note or "")[:2000]
        return _save(project, _advance(st))


def send_back(project: Path, note: str) -> dict:
    """The creator wants changes to the stage that is waiting."""
    if not str(note or "").strip():
        raise StageError("say what should change")
    with _LOCK:
        st = state(project)
        if not st or st.get("finished"):
            raise StageError("no pipeline is running on this reel")
        cur = _current(st)
        if cur["status"] != "review":
            raise StageError(f"'{cur['name']}' isn't waiting for approval")
        cur["status"] = "doing"
        cur["note"] = str(note)[:2000]
        return _save(project, st)


def view(project: Path) -> dict | None:
    """The state plus what to do now: the current stage's goal, guide and checklist, and any note from the creator."""
    st = state(project)
    if not st:
        return None
    out = copy.deepcopy(st)
    if st.get("finished"):
        out["now"] = {"status": "finished", "say": "The pipeline is finished. Offer further changes if the creator wants them."}
        return out
    p = get(st["pipeline"])
    cur = _current(st)
    stage = p["stages"][st["stage"]]
    now = {"stage": stage["id"], "name": stage["name"], "status": cur["status"], "goal": stage["goal"], "guide": stage["guide"],
           "checklist": stage.get("checklist", []), "needsApproval": bool(stage.get("approve"))}
    if cur["status"] == "review":
        now["say"] = "Waiting for the creator: ask them to approve this stage (in the editor, or by telling you) or say what to change. Don't start the next stage until they approve."
    elif cur.get("note"):
        now["say"] = "The creator sent this stage back with a note: do what it asks, then finish the stage again."
        now["creatorNote"] = cur["note"]
    else:
        now["say"] = "Do this stage, check every item on the checklist, then call finish_stage with a short summary for the creator."
    prev = st["stages"][st["stage"] - 1] if st["stage"] > 0 else None
    if prev and prev.get("note"):
        now["approvedWithNote"] = prev["note"]
    out["now"] = now
    return out


def copy_reel(src: Path, dst: Path, start: float, end: float, title: str = "") -> dict:
    """A new reel made of one stretch (SOURCE seconds) of another reel. The footage file is shared, not copied:
    the new reel plays the same source, keeping only the shots inside [start, end]."""
    from . import pipeline

    if end <= start:
        raise StageError("end must be after start")
    spec = pipeline.load(src)
    dur = float((spec.get("source") or {}).get("duration") or 0)
    if dur and (start >= dur or end <= 0):
        raise StageError(f"that stretch is outside the footage (0 to {dur:.1f} s)")
    segs = []
    for s in spec.get("segments") or []:
        a, b = max(float(s["start"]), start), min(float(s["end"]), end)
        if b - a >= 0.1:
            n = dict(s)
            n["start"], n["end"] = round(a, 3), round(b, 3)
            n.pop("reversed", None)  # a reversed copy was made for the old span
            segs.append(n)
    if not segs:
        raise StageError("no kept shots in that stretch: pick times from the reel's words or segments")
    new = copy.deepcopy(spec)
    new["segments"] = segs
    new["title"] = title or f"{spec.get('title') or src.name} {start:.0f}-{end:.0f}s"
    for k in ("broll",):  # b-roll placed for the whole reel rarely fits a clip
        new.pop(k, None)
    (dst / "work").mkdir(parents=True, exist_ok=True)
    (dst / "renders").mkdir(exist_ok=True)
    for f in ("words.raw.json", "clips.json"):
        if (src / "work" / f).exists():
            shutil.copy2(src / "work" / f, dst / "work" / f)
    pipeline.save(dst, new)
    return new
