"""Raw clips -> spec.json. Every step caches into the project folder, so re-running is cheap."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Callable

from . import autocut, enrich, media
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
    log: Log = print,
) -> dict:
    P = project_paths(project)
    for k in ("assets", "work", "renders"):
        P[k].mkdir(parents=True, exist_ok=True)

    files = media.find_clips(clips, newest)
    if not files and not P["source"].exists():
        raise FileNotFoundError("no video clips found in: " + ", ".join(clips))
    if files:
        log(f"assembling {len(files)} clip(s) -> 9:16 30fps")
        info = media.assemble(files, P["source"], stabilize=stabilize)
        (P["work"] / "clips.json").write_text(json.dumps(info, indent=2), encoding="utf-8")
    info = media.probe(P["source"])

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
    if silent:  # a reel with no voice (b-roll, music, screen recording): nothing to cut on, so keep all of it
        segments = [{"id": "s1", "start": 0.0, "end": round(info["duration"], 3)}]
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
    source = {"src": str(P["source"]), "width": 1080, "height": 1920, "duration": info["duration"], "fps": 30}
    if matte:
        source["matte"] = matte
    brand = load_brand(brand_file)
    spec = build_spec(source, words, segments, look=look, brand=brand, hook=hook_text, title=project.name)
    P["spec"].write_text(json.dumps(spec, indent=2), encoding="utf-8")
    log(f"spec written: {P['spec']}")
    return spec


def load(project: Path) -> dict:
    return json.loads(project_paths(project)["spec"].read_text(encoding="utf-8"))


def save(project: Path, spec: dict) -> None:
    project_paths(project)["spec"].write_text(json.dumps(spec, indent=2), encoding="utf-8")


def next_version(project: Path) -> int:
    r = project_paths(project)["renders"]
    nums = [int(p.stem.split("-v")[-1]) for p in r.glob("*-v*.mp4") if p.stem.split("-v")[-1].isdigit()]
    return max(nums, default=0) + 1
