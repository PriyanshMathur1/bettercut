"""Render a spec with Remotion, plus QA (cut frames, safe zone stills, loudness) and a phone copy."""
from __future__ import annotations

import json
import mimetypes
import re
import subprocess
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import quote, unquote

from . import media
from .spec import blocking

COMPOSER = media.COMPOSER
ENTRY = "src/index.tsx"
COMP = "BetterCut"


MEDIA_KEYS = ("src", "matte", "graded", "gradedMatte", "music", "media", "background")


class AssetServer:
    """Serves the local files a spec references over http on 127.0.0.1 (Remotion's renderer only
    loads http(s) or bundled public assets). Range requests are supported so the editor can seek."""

    def __init__(self) -> None:
        self.files: dict[str, Path] = {}
        self.httpd = None

    def url_for(self, path: Path) -> str:
        key = f"{len(self.files)}/{quote(path.name)}"
        for k, v in self.files.items():
            if v == path:
                key = k
                break
        self.files[key] = path
        return f"http://127.0.0.1:{self.port}/a/{key}"

    def __enter__(self) -> "AssetServer":
        files = self.files

        class H(SimpleHTTPRequestHandler):
            def log_message(self, *a):  # quiet
                pass

            def do_GET(self):  # noqa: N802
                key = unquote(self.path.split("?")[0].removeprefix("/a/"))
                f = files.get(key) or files.get(quote(key, safe="/"))
                if not f or not f.exists():
                    self.send_error(404)
                    return
                size = f.stat().st_size
                rng = self.headers.get("Range")
                start, end = 0, size - 1
                if rng and rng.startswith("bytes="):
                    a, _, b = rng[6:].partition("-")
                    start = int(a) if a else 0
                    end = int(b) if b else size - 1
                    self.send_response(206)
                    self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
                else:
                    self.send_response(200)
                ctype = mimetypes.guess_type(f.name)[0] or "application/octet-stream"
                self.send_header("Content-Type", ctype)
                self.send_header("Accept-Ranges", "bytes")
                self.send_header("Content-Length", str(end - start + 1))
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                with open(f, "rb") as fh:
                    fh.seek(start)
                    left = end - start + 1
                    while left > 0:
                        chunk = fh.read(min(1 << 20, left))
                        if not chunk:
                            break
                        try:
                            self.wfile.write(chunk)
                        except (BrokenPipeError, ConnectionResetError):
                            return
                        left -= len(chunk)

        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), H)
        self.port = self.httpd.server_address[1]
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()
        return self

    def __exit__(self, *exc) -> None:
        if self.httpd:
            self.httpd.shutdown()


def localise(spec: dict, url_for) -> dict:
    """Rewrite every local media path in a spec with url_for(Path) (http server or editor API)."""

    def stage(path: str) -> str:
        if not isinstance(path, str) or not path or re.match(r"^(https?:|data:|#|rgb|linear-gradient|radial-gradient)", path):
            return path
        p = Path(path.replace("file://", "")).expanduser()
        if not p.is_absolute() or not p.exists():
            return path
        return url_for(p)

    def walk(v, key=None):
        if isinstance(v, dict):
            return {k: walk(x, k) for k, x in v.items()}
        if isinstance(v, list):
            return [walk(x, key) for x in v]
        if key in MEDIA_KEYS or key == "sound":
            return stage(v)
        return v

    return walk(spec)


def _props_file(spec: dict, project: Path, srv: AssetServer, extra: dict | None = None) -> Path:
    staged = localise(spec, srv.url_for)
    p = project / "work" / "props.json"
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps({**staged, **(extra or {})}), encoding="utf-8")
    return p


def prepare(spec: dict, project: Path, log=print) -> dict:
    """Bake colour/voice if the settings changed since the last bake; saves the spec when it changes."""
    from . import colour, pipeline

    a = spec.get("audio") or {}
    if a.get("music") and a.get("beatsFor") != a["music"] and Path(a["music"]).exists():
        # beats drive the timeline's beat markers and snapping as well as the beat pulse, so find them
        # whenever the music changes
        from . import timeline
        from .audio import beats, duration, tile_beats

        found = tile_beats(beats(Path(a["music"]), max_seconds=600), duration(Path(a["music"])), timeline.total_duration(spec))
        spec = {**spec, "audio": {**a, "beats": found, "beatsFor": a["music"]}}
        log(f"music: {len(found)} beats found")
        pipeline.save(project, spec)
    elif not a.get("music") and (a.get("beats") or a.get("beatsFor")):
        spec = {**spec, "audio": {k: v for k, v in a.items() if k not in ("beats", "beatsFor")}}
        pipeline.save(project, spec)
    from . import greenscreen, reverse

    if not greenscreen.is_current(spec):  # before colour: the graded cut-out is made from this one
        spec = greenscreen.bake(spec, project, log=log)
        pipeline.save(project, spec)
    if not colour.is_current(spec):
        spec = colour.bake(spec, project, log=log)
        pipeline.save(project, spec)
    if not reverse.is_current(spec):  # after colour: a reversed shot is cut from the graded footage
        spec = reverse.bake(spec, project, log=log)
        pipeline.save(project, spec)
    return spec


def render(spec: dict, project: Path, out: Path, quality: str = "high", progress=None, log=print, master: bool = True, aspect: str | None = None) -> Path:
    issues = blocking(spec)
    if issues:
        raise ValueError("spec problems: " + "; ".join(issues))
    spec = prepare(spec, project, log)
    if aspect and aspect != "9x16":
        from .export import ASPECTS

        w, h = ASPECTS[aspect]
        spec = {**spec, "width": w, "height": h}
    out.parent.mkdir(parents=True, exist_ok=True)
    crf = {"draft": 28, "high": 18, "max": 14, "master": 14}.get(quality, 18)
    with AssetServer() as srv:
        props = _props_file(spec, project, srv)
        cmd = [
            "npx", "remotion", "render", ENTRY, COMP, str(out),
            f"--props={props}", f"--crf={crf}", "--concurrency=50%", "--log=info",
        ]
        if quality == "draft":
            cmd += ["--scale=0.5"]
        if quality == "master":
            cmd = [c for c in cmd if not c.startswith("--crf")] + ["--codec=prores", "--prores-profile=hq"]
        proc = subprocess.Popen(cmd, cwd=COMPOSER, env=media.node_env(), stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        tail: list[str] = []
        for line in proc.stdout:  # type: ignore[union-attr]
            tail = (tail + [line.rstrip()])[-40:]
            if progress:
                m = re.search(r"Rendered (\d+)/(\d+)", line)
                if m:
                    progress(int(m.group(1)) / max(1, int(m.group(2))))
        if proc.wait() != 0:
            raise RuntimeError("remotion render failed:\n" + "\n".join(tail))
    if master:
        from .audio import normalise

        target = float((spec.get("audio") or {}).get("loudness", -14))
        res = normalise(out, target=target)
        if "after" in res:
            log(f"loudness {res['before']:.1f} -> {res['after']:.1f} LUFS (true peak {res['truePeak']:.1f} dBTP)")
    return out


def still(spec: dict, project: Path, at: float, out: Path, safe: bool = True) -> Path:
    spec = prepare(spec, project, log=lambda *_: None)
    frame = int(round(at * spec.get("fps", 30)))
    with AssetServer() as srv:
        props = _props_file(spec, project, srv, {"safeGuide": safe})
        p = subprocess.run(
            ["npx", "remotion", "still", ENTRY, COMP, str(out), f"--props={props}", f"--frame={frame}", "--scale=0.5"],
            cwd=COMPOSER, env=media.node_env(), capture_output=True, text=True,
        )
    if p.returncode != 0:
        raise RuntimeError("remotion still failed:\n" + (p.stdout + p.stderr)[-3000:])
    return out


def phone_copy(src: Path, out: Path) -> Path:
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-i", str(src), "-vf", "scale=720:-2", "-c:v", "libx264", "-crf", "26", "-preset", "fast", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", str(out)],
        check=True,
    )
    return out


def loudness(path: Path) -> dict:
    p = subprocess.run(["ffmpeg", "-hide_banner", "-i", str(path), "-af", "volumedetect", "-f", "null", "-"], capture_output=True, text=True)
    mx = re.search(r"max_volume: ([-\d.]+) dB", p.stderr)
    mean = re.search(r"mean_volume: ([-\d.]+) dB", p.stderr)
    return {"maxDb": float(mx.group(1)) if mx else None, "meanDb": float(mean.group(1)) if mean else None}


def qa(spec: dict, rendered: Path, project: Path) -> dict:
    """Review pass on the FINAL render: frames right after every cut, loudness, duration."""
    from .timeline import place_segments

    placed = place_segments(spec)
    cut_ts = [s["outStart"] + 0.04 for s in placed[1:] if not s.get("join")][:24]
    report: dict = {"render": str(rendered), "probe": media.probe(rendered), "loudness": loudness(rendered), "cuts": len(cut_ts)}
    if cut_ts:
        report["cutSheet"] = str(media.contact_sheet(rendered, project / "work" / "cut_check.jpg", cut_ts, cols=6, width=180))
    issues = []
    ld = report["loudness"]
    if ld["maxDb"] is not None and ld["maxDb"] > -0.5:
        issues.append(f"audio peaks at {ld['maxDb']} dB (clipping risk): lower sfxVolume or musicVolume")
    if ld["meanDb"] is not None and ld["meanDb"] < -30:
        issues.append(f"audio is quiet (mean {ld['meanDb']} dB): raise voiceVolume")
    report["issues"] = issues
    (project / "work" / "qa.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    return report
