"""Raw clips -> spec.json. Every step caches into the project folder, so re-running is cheap."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Callable

from . import autocut, enrich, media, shape as shapes
from .spec import build_spec, load_brand

Log = Callable[[str], None]


def project_paths(project: Path) -> dict[str, Path]:
    return {
        "root": project,
        "assets": project / "assets",
        "work": project / "work",
        "renders": project / "renders",
        "source": project / "assets" / "source.mp4",
        "matte": project / "assets" / "matte.webm",
        "words": project / "work" / "words.raw.json",
        "spec": project / "spec.json",
    }


def make(
    project: Path,
    clips: list[str],
    look: str = "bold-pop",
    brand_file: str | None = None,
    names: list[str] | None = None,
    cutout: bool = False,
    hook: str | None = None,
    model: str = "small",
    language: str | None = None,
    newest: int | None = None,
    max_gap: float = 0.35,
    keep_takes: bool = False,
    reframe: bool = True,
    stabilize: bool = False,
    align: bool = True,
    shape: str = "auto",
    fps: float | str = "auto",
    log: Log = print,
) -> dict:
    """Make a project from raw clips. `shape` is "auto" (follow the first clip) or a shape id such as
    "9x16" or "16x9"; `fps` is "auto" (follow the first clip) or a frame rate."""
    P = project_paths(project)
    for k in ("assets", "work", "renders"):
        P[k].mkdir(parents=True, exist_ok=True)

    files = media.find_clips(clips, newest)
    if not files and not P["source"].exists():
        raise FileNotFoundError("no video clips found in: " + ", ".join(clips))
    if files:
        sid, width, height, rate = shapes.resolve(shape, fps, media.probe(files[0]))
        log(f"assembling {len(files)} clip(s) -> {sid.replace('x', ':')} {rate}fps")
        info = media.assemble(files, P["source"], width=width, height=height, fps=rate, stabilize=stabilize)
        (P["work"] / "clips.json").write_text(json.dumps(info, indent=2), encoding="utf-8")
    info = media.probe(P["source"])
    # re-running on an existing project keeps the footage as it was assembled
    width, height, rate = info.get("width") or 1080, info.get("height") or 1920, shapes.pick_rate(info.get("fps") or 30)

    if P["words"].exists() and not files:
        words = json.loads(P["words"].read_text(encoding="utf-8"))
        log("transcript: cached")
    else:
        log(f"transcribing with whisper {model} (first run downloads the model)")
        prompt = ", ".join(names) if names else None
        words = media.transcribe(P["source"], model_size=model, language=language, prompt=prompt, align=align, log=log)
        P["words"].write_text(json.dumps(words, indent=1), encoding="utf-8")
    silent = not words
    if silent:
        log("no speech found: keeping the whole clip, with no captions (add titles, music and effects in the editor)")

    sil = media.speech_gaps(P["source"])
    words = enrich.merge_split_tokens(words)
    words = enrich.fix_names(words, names or [])
    if not keep_takes:
        words = autocut.pick_takes(words)
    words = autocut.mark_fillers(words)
    words = enrich.pick_emphasis(words, keywords=names)
    words = enrich.attach_emoji(words)
    segments = autocut.build_segments(words, info["duration"], max_gap=max_gap, silences=sil)
    if silent:  # no voice (b-roll, music, screen recording): nothing to cut on, so keep all of it, one shot per clip
        segments = whole_clip_shots(clip_list(project), info["duration"])
    if reframe:
        from . import vision

        log("finding your face in every shot (framing + punch-in focus)")
        segments = vision.frame_segments(P["source"], segments)
    cut = [w for w in words if w.get("cut")]
    log(f"{len(words)} words, {len(cut)} cut (retakes/fillers), {len(segments)} segments")

    matte = None
    if cutout:
        if P["matte"].exists() and P["matte"].stat().st_mtime > P["source"].stat().st_mtime:
            log("cutout: cached")
        else:
            log("cutting the speaker out of the background (slow on first run)")
            media.cutout(P["source"], P["matte"])
        matte = str(P["matte"])

    hook_text = enrich.hook_text(words) if hook is None else hook
    source = {"src": str(P["source"]), "width": width, "height": height, "duration": info["duration"], "fps": rate}
    if matte:
        source["matte"] = matte
    brand = load_brand(brand_file)
    spec = build_spec(source, words, segments, look=look, brand=brand, hook=hook_text, title=project.name)
    spec.update({"width": width, "height": height, "fps": rate})  # the project plays in its footage's shape and rate
    P["spec"].write_text(json.dumps(spec, indent=2), encoding="utf-8")
    log(f"spec written: {P['spec']}")
    return spec


def add_clips(
    project: Path,
    clips: list[str],
    names: list[str] | None = None,
    model: str = "small",
    language: str | None = None,
    max_gap: float = 0.35,
    keep_takes: bool = False,
    reframe: bool = True,
    align: bool = True,
    log: Log = print,
) -> dict:
    """Append clips to an existing reel. Only the new footage is transcribed and cut; every edit already
    made to the reel is kept. The new shots land at the end of the timeline."""
    import time

    P = project_paths(project)
    spec = load(project)
    if spec["source"].get("matte"):
        raise RuntimeError("this reel uses a speaker cutout; adding clips to a cutout reel isn't supported yet")
    files = media.find_clips(clips, None)
    if not files:
        raise FileNotFoundError("no video clips found in: " + ", ".join(clips))
    old_src = Path(spec["source"]["src"])
    offset = media.probe(old_src)["duration"]

    log(f"adding {len(files)} clip(s)")
    add = P["work"] / "add.mp4"
    src = spec["source"]  # new footage is fitted to the project's own shape and frame rate
    info = media.assemble(files, add, width=int(src.get("width") or 1080), height=int(src.get("height") or 1920), fps=int(round(src.get("fps") or 30)))
    # a new file name, so players and caches never show the old footage under the same address
    new_src = P["assets"] / f"source-{int(time.time())}.mp4"
    media.concat([old_src, add], new_src)
    total = media.probe(new_src)["duration"]

    log(f"transcribing the new footage with whisper {model}")
    words = media.transcribe(add, model_size=model, language=language, prompt=", ".join(names) if names else None, align=align, log=log)
    raw = [{**w, "start": round(w["start"] + offset, 3), "end": round(w["end"] + offset, 3)} for w in words]
    if P["words"].exists():
        P["words"].write_text(json.dumps(json.loads(P["words"].read_text(encoding="utf-8")) + raw, indent=1), encoding="utf-8")

    if words:
        sil = media.speech_gaps(add)
        words = enrich.merge_split_tokens(words)
        words = enrich.fix_names(words, names or [])
        if not keep_takes:
            words = autocut.pick_takes(words)
        words = autocut.mark_fillers(words)
        words = enrich.pick_emphasis(words, keywords=names)
        words = enrich.attach_emoji(words)
        segments = autocut.build_segments(words, info["duration"], max_gap=max_gap, silences=sil)
    else:
        log("no speech in the new footage: keeping all of it, with no captions")
        segments = [{"start": 0.0, "end": round(info["duration"], 3)}]
    if reframe:
        from . import vision

        segments = vision.frame_segments(add, segments)

    used = {s.get("id") for s in spec.get("segments", [])}
    n = 0
    for seg in segments:
        n += 1
        while f"a{n}" in used:
            n += 1
        seg.update({"id": f"a{n}", "start": round(seg["start"] + offset, 3), "end": round(seg["end"] + offset, 3)})
        used.add(seg["id"])
    for w in words:
        w["start"], w["end"] = round(w["start"] + offset, 3), round(w["end"] + offset, 3)

    spec["words"] = spec.get("words", []) + words
    spec["segments"] = spec.get("segments", []) + segments
    spec["source"] = {**spec["source"], "src": str(new_src), "duration": total}
    for k in ("graded", "gradedMatte"):  # baked from the old footage: rebuilt on the next bake or render
        spec["source"].pop(k, None)
    (spec.get("grade") or {}).pop("baked", None)

    clips_file = P["work"] / "clips.json"
    if clips_file.exists():
        cm = json.loads(clips_file.read_text(encoding="utf-8"))
        cm["clips"] = cm.get("clips", []) + [{**c, "start": round(c["start"] + offset, 3)} for c in info.get("clips", [])]
        clips_file.write_text(json.dumps(cm, indent=2), encoding="utf-8")
    save(project, spec)
    log(f"added {len(segments)} shot(s), {len(words)} word(s); the reel's footage is now {total:.1f}s")
    return spec


def clip_list(project: Path) -> list[dict]:
    """The clips a project's footage was assembled from: name, where each starts in the footage, and its length."""
    f = project_paths(project)["work"] / "clips.json"
    if not f.exists():
        return []
    try:
        clips = json.loads(f.read_text(encoding="utf-8")).get("clips", [])
    except (ValueError, AttributeError):
        return []
    return [{"name": c.get("clip") or Path(str(c.get("path", "clip"))).name, "start": float(c.get("start", 0)), "seconds": float(c.get("duration", 0))} for c in clips]


def whole_clip_shots(clips: list[dict], duration: float) -> list[dict]:
    """Shots for footage with no speech: one per clip, so each clip can be moved, trimmed or removed on its own."""
    spans = [(round(c["start"], 3), round(min(duration, c["start"] + c["seconds"]), 3)) for c in clips if c["seconds"] > 0 and c["start"] < duration]
    if len(spans) < 2:
        return [{"id": "s1", "start": 0.0, "end": round(duration, 3)}]
    spans[-1] = (spans[-1][0], round(duration, 3))  # the last shot runs to the very end of the footage
    return [{"id": f"s{i + 1}", "start": a, "end": b} for i, (a, b) in enumerate(spans) if b > a]


def load(project: Path) -> dict:
    return json.loads(project_paths(project)["spec"].read_text(encoding="utf-8"))


def save(project: Path, spec: dict) -> None:
    project_paths(project)["spec"].write_text(json.dumps(spec, indent=2), encoding="utf-8")


def next_version(project: Path) -> int:
    r = project_paths(project)["renders"]
    nums = [int(p.stem.split("-v")[-1]) for p in r.glob("*-v*.mp4") if p.stem.split("-v")[-1].isdigit()]
    return max(nums, default=0) + 1
