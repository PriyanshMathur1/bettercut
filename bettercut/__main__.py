"""BetterCut CLI.

  python -m bettercut make <project> <clips or folder...> [--look bold-pop] [--cutout] [--names "Claude,Acme"]
  python -m bettercut look <project> <look-id>          re-style an existing project
  python -m bettercut render <project> [--quality draft|high|max]
  python -m bettercut still <project> <seconds> [--no-safe]
  python -m bettercut mimic <file-or-url> [--name NAME] [--out DIR]
  python -m bettercut looks | catalog | validate <project> | sfx | ui
"""
from __future__ import annotations

import argparse
import json
import sys
import os
from pathlib import Path

from . import catalog as cat
from . import pipeline, render
from .spec import apply_look, list_looks, validate

PROJECTS = Path(os.environ.get("BETTERCUT_PROJECTS", Path.home() / "bettercut-projects")).expanduser()


def _project(p: str) -> Path:
    path = Path(p).expanduser()
    if not path.is_absolute() and not path.exists():
        path = PROJECTS / p
    return path.resolve()


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="bettercut")
    sub = ap.add_subparsers(dest="cmd", required=True)

    m = sub.add_parser("make", help="raw clips -> spec.json")
    m.add_argument("project")
    m.add_argument("clips", nargs="*")
    m.add_argument("--look", default="bold-pop")
    m.add_argument("--shape", default="auto", help="auto (follow the first clip), 9x16, 4x5, 1x1 or 16x9")
    m.add_argument("--fps", default="auto", help="auto (follow the first clip) or a frame rate: 24, 25, 30, 50, 60")
    m.add_argument("--brand")
    m.add_argument("--names", default="", help="comma-separated names/keywords Whisper should spell right")
    m.add_argument("--cutout", action="store_true", help="cut the speaker out (behind-head words, greenscreen)")
    m.add_argument("--hook", help="hook title text ('' for none; default: first line)")
    m.add_argument("--model", default="small")
    m.add_argument("--language")
    m.add_argument("--newest", type=int)
    m.add_argument("--max-gap", type=float, default=0.35)
    m.add_argument("--keep-takes", action="store_true")
    m.add_argument("--render", action="store_true", help="render straight after")
    m.add_argument("--stabilize", action="store_true", help="stabilise shaky handheld clips")
    m.add_argument("--no-reframe", action="store_true", help="skip face-aware framing")
    m.add_argument("--no-align", action="store_true", help="skip whisperX forced alignment (keep Whisper timings)")

    lk = sub.add_parser("look")
    lk.add_argument("project")
    lk.add_argument("look")

    r = sub.add_parser("render")
    r.add_argument("project")
    r.add_argument("--quality", default="high", choices=["draft", "high", "max", "master"], help="master = ProRes HQ .mov")
    r.add_argument("--aspect", default="native", help="native (the project's own shape), 9x16, 4x5, 1x1, 16x9 or 'all'")
    r.add_argument("-o", "--out")

    s = sub.add_parser("still")
    s.add_argument("project")
    s.add_argument("at", type=float)
    s.add_argument("--no-safe", action="store_true")

    mm = sub.add_parser("mimic", help="make a Look from a reference reel")
    mm.add_argument("ref")
    mm.add_argument("--name")
    mm.add_argument("--out")
    mm.add_argument("--no-transcribe", action="store_true")

    b = sub.add_parser("broll", help="auto b-roll from Pexels for the punch words")
    b.add_argument("project")
    b.add_argument("--mode", default="card", choices=["full", "split", "pip", "card", "behind"])
    ex = sub.add_parser("export", help="SRT, VTT and FCPXML for the current edit")
    ex.add_argument("project")
    cl = sub.add_parser("colour", help="bake the colour grade / voice enhancement now")
    cl.add_argument("project")

    sub.add_parser("looks")
    sub.add_parser("catalog")
    v = sub.add_parser("validate")
    v.add_argument("project")
    sub.add_parser("sfx")
    u = sub.add_parser("ui", help="start the editor at http://localhost:4790")
    u.add_argument("--port", type=int, default=4790)
    c = sub.add_parser("cloud", help="start the multi-user hosted editor (sign-in, per-user projects, bring-your-own model)")
    c.add_argument("--port", type=int, default=4790)
    c.add_argument("--host", default="127.0.0.1", help="0.0.0.0 inside a container")

    a = ap.parse_args(argv)

    if a.cmd == "make":
        proj = _project(a.project)
        names = [n.strip() for n in a.names.split(",") if n.strip()]
        spec = pipeline.make(proj, a.clips, look=a.look, brand_file=a.brand, names=names, cutout=a.cutout, hook=a.hook,
                             model=a.model, language=a.language, newest=a.newest, max_gap=a.max_gap, keep_takes=a.keep_takes,
                             reframe=not a.no_reframe, stabilize=a.stabilize, align=not a.no_align, shape=a.shape, fps=a.fps)
        for i in validate(spec):
            print("note:", i)
        if a.render:
            return _render(proj, "high", None)
        return 0
    if a.cmd == "look":
        proj = _project(a.project)
        spec = apply_look(pipeline.load(proj), a.look, (pipeline.load(proj).get("hook") or {}).get("text", ""))
        pipeline.save(proj, spec)
        print(f"look -> {a.look}")
        return 0
    if a.cmd == "render":
        from . import shape as shapes

        aspects = shapes.aspects_for(pipeline.load(_project(a.project)), list(shapes.SHAPES) if a.aspect == "all" else [a.aspect])
        for asp in aspects:
            _render(_project(a.project), a.quality, a.out if len(aspects) == 1 else None, asp)
        return 0
    if a.cmd == "still":
        proj = _project(a.project)
        out = proj / "work" / f"still_{a.at:.2f}.png"
        render.still(pipeline.load(proj), proj, a.at, out, safe=not a.no_safe)
        print(out)
        return 0
    if a.cmd == "mimic":
        from .mimic import analyse

        out = Path(a.out).expanduser() if a.out else PROJECTS / "_references" / (a.name or Path(a.ref).stem or "ref")
        res = analyse(a.ref, out, a.name, transcribe=not a.no_transcribe)
        print(json.dumps({k: res[k] for k in ("look", "lookFile", "sheet", "shots", "colour")}, indent=2))
        return 0
    if a.cmd == "broll":
        from .broll import add_broll

        proj = _project(a.project)
        pipeline.save(proj, add_broll(pipeline.load(proj), proj, mode=a.mode))
        return 0
    if a.cmd == "export":
        from .export import write_all

        proj = _project(a.project)
        for p in write_all(pipeline.load(proj), proj / "renders", proj.name).values():
            print(p)
        return 0
    if a.cmd == "colour":
        proj = _project(a.project)
        render.prepare(pipeline.load(proj), proj)
        print("baked")
        return 0
    if a.cmd == "looks":
        for k, v in list_looks().items():
            print(f"{k:22} {v.get('name', ''):24} {v.get('description', '')}")
        return 0
    if a.cmd == "catalog":
        print(json.dumps(cat.catalog(), indent=1))
        return 0
    if a.cmd == "validate":
        issues = validate(pipeline.load(_project(a.project)))
        print("\n".join(issues) or "ok")
        return 1 if any("falls back" not in i for i in issues) else 0
    if a.cmd == "sfx":
        from .sfx_gen import generate

        print(len(generate()), "sounds")
        return 0
    if a.cmd == "ui":
        from .server import serve

        serve(a.port)
        return 0
    if a.cmd == "cloud":
        from .cloud.app import serve as serve_cloud

        serve_cloud(a.port, a.host)
        return 0
    return 1


def _render(proj: Path, quality: str, out: str | None, aspect: str | None = None) -> int:
    from . import shape as shapes
    from .export import write_all

    spec = pipeline.load(proj)
    aspect = aspect or shapes.native(spec)
    v = pipeline.next_version(proj)
    slug = proj.name
    ext = ".mov" if quality == "master" else ".mp4"
    tag = shapes.tag(spec, aspect)
    dst = Path(out) if out else proj / "renders" / f"{slug}-v{v}{tag}{ext}"
    print(f"rendering {dst.name} ({quality})")
    shown = {-1}

    def tick(p: float) -> None:
        step = int(p * 10)
        if step not in shown:
            shown.add(step)
            print(f"{step * 10}%", end=" ", flush=True)

    render.render(spec, proj, dst, quality=quality, progress=tick, aspect=aspect)
    print()
    exports = write_all(pipeline.load(proj), proj / "renders", dst.stem)
    print("exports:", ", ".join(p.name for p in exports.values()))
    phone = render.phone_copy(dst, dst.with_name(dst.stem + "-phone.mp4"))
    report = render.qa(spec, dst, proj)
    print(json.dumps({"render": str(dst), "phone": str(phone), "qa": report.get("issues"), "cutSheet": report.get("cutSheet")}, indent=2))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (RuntimeError, FileNotFoundError) as e:
        print(f"bettercut: {e}", file=sys.stderr)
        sys.exit(1)
