"""Media I/O: probing, assembling clips, silence detection, transcription, speaker cutout."""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
COMPOSER = ROOT / "composer"
VIDEO_EXT = {".mp4", ".mov", ".m4v", ".webm", ".mkv"}


def run(cmd: list[str], **kw) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, check=True, capture_output=True, text=True, **kw)


def node_env() -> dict:
    """Environment with a Node >= 22 first on PATH (Remotion / HyperFrames)."""
    env = dict(os.environ)
    for cand in ("/opt/homebrew/opt/node@24/bin", "/opt/homebrew/opt/node@22/bin", "/usr/local/opt/node@24/bin"):
        if Path(cand, "node").exists():
            env["PATH"] = cand + os.pathsep + env.get("PATH", "")
            break
    return env


def probe(path: str | Path) -> dict:
    out = run([
        "ffprobe", "-v", "error", "-select_streams", "v:0",
        "-show_entries", "stream=width,height,r_frame_rate,duration:stream_side_data=rotation:format=duration",
        "-of", "json", str(path),
    ]).stdout
    data = json.loads(out)
    st = (data.get("streams") or [{}])[0]
    w, h = int(st.get("width", 0)), int(st.get("height", 0))
    rot = 0
    for sd in st.get("side_data_list", []) or []:
        if "rotation" in sd:
            rot = int(sd["rotation"])
    if abs(rot) in (90, 270):
        w, h = h, w
    num, den = (st.get("r_frame_rate") or "30/1").split("/")
    fps = float(num) / float(den or 1)
    dur = float(st.get("duration") or data.get("format", {}).get("duration") or 0)
    return {"width": w, "height": h, "fps": round(fps, 3), "duration": round(dur, 3)}


def audio_seconds(path: str | Path) -> float:
    """Length of any media file (audio included), 0 when the file doesn't say."""
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)], capture_output=True, text=True).stdout
    try:
        return round(float(out.strip()), 3)
    except ValueError:
        return 0.0


def fix_recording(path: str | Path) -> Path:
    """Browser recordings (MediaRecorder) are written as a live stream with no length in the file, so
    players and this pipeline read them as 0 seconds long. Rewriting the container, without re-encoding,
    adds the length. Files that already have one are left alone."""
    path = Path(path)
    if audio_seconds(path) > 0:
        return path
    tmp = path.with_name(path.stem + ".fixed" + path.suffix)
    try:
        run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(path), "-c", "copy", str(tmp)])
        if audio_seconds(tmp) > 0:
            tmp.replace(path)
    finally:
        tmp.unlink(missing_ok=True)
    return path


def find_clips(paths: list[str], newest: int | None = None) -> list[Path]:
    files: list[Path] = []
    for p in paths:
        pp = Path(p).expanduser()
        if pp.is_dir():
            files += [f for f in pp.iterdir() if f.suffix.lower() in VIDEO_EXT]
        elif pp.exists():
            files.append(pp)
    files.sort(key=lambda f: f.stat().st_mtime)
    if newest:
        files = files[-newest:]
    return files


def assemble(clips: list[Path], out: Path, width: int = 1080, height: int = 1920, fps: int = 30, stabilize: bool = False) -> dict:
    """Normalise clips to one constant-frame-rate source of the given size (cover-crop), concatenated in order.

    A clip wider than the frame is cropped around the speaker's face; a taller one is cropped at its centre.

    Returns the clip map: where each original clip starts in the assembled source.
    """
    out.parent.mkdir(parents=True, exist_ok=True)
    clip_map = []
    t = 0.0
    inputs: list[str] = []
    filters = []
    for i, c in enumerate(clips):
        info = probe(c)
        inputs += ["-i", str(c)]
        crop = f"crop={width}:{height}"
        if info["width"] and info["height"] and info["width"] / info["height"] > width / height + 0.05:
            # wider than the frame: crop around the speaker's face instead of the centre (auto-reframe)
            fx = face_x(c, info["duration"])
            if fx is not None:
                sw = info["width"] * height / info["height"]
                x = int(min(max(fx * sw - width / 2, 0), sw - width))
                crop = f"crop={width}:{height}:{x}:0"
        filters.append(
            f"[{i}:v]{'deshake=rx=32:ry=32,' if stabilize else ''}scale={width}:{height}:force_original_aspect_ratio=increase,{crop},setsar=1,fps={fps},format=yuv420p[v{i}];"
            + (f"[{i}:a]aresample=48000,aformat=channel_layouts=stereo[a{i}];" if has_audio(c) else
             # silent clip (b-roll, GoPro, screen capture): pad with silence of the same length
             f"anullsrc=r=48000:cl=stereo,atrim=duration={info['duration']:.3f}[a{i}];")
        )
        clip_map.append({"clip": c.name, "path": str(c), "start": round(t, 3), "duration": info["duration"]})
        t += info["duration"]
    concat = "".join(f"[v{i}][a{i}]" for i in range(len(clips))) + f"concat=n={len(clips)}:v=1:a=1[v][a]"
    run([
        "ffmpeg", "-y", "-loglevel", "error", *inputs,
        "-filter_complex", "".join(filters) + concat,
        "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-preset", "fast", "-crf", "17",
        "-fps_mode", "cfr", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", str(out),
    ])
    return {"clips": clip_map, **probe(out)}


def concat(files: list[Path], out: Path) -> Path:
    """Join files that were all written by `assemble` (same size, rate and codecs) without re-encoding."""
    listing = out.with_suffix(".concat.txt")
    listing.write_text("".join("file '" + str(f).replace("'", "'\\''") + "'\n" for f in files), encoding="utf-8")
    try:
        run(["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", str(listing), "-c", "copy", "-movflags", "+faststart", str(out)])
    finally:
        listing.unlink(missing_ok=True)
    return out


def reverse_span(src: Path, start: float, end: float, out: Path) -> Path:
    """Write [start, end] of `src` played backwards (picture and sound)."""
    out.parent.mkdir(parents=True, exist_ok=True)
    run([
        "ffmpeg", "-y", "-loglevel", "error", "-ss", f"{start:.3f}", "-t", f"{max(0.05, end - start):.3f}", "-i", str(src),
        "-vf", "reverse", "-af", "areverse", "-c:v", "libx264", "-preset", "fast", "-crf", "17", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", str(out),
    ])
    return out


def face_x(path: Path, duration: float, n: int = 7) -> float | None:
    """Median horizontal face position (0..1) across the clip, or None."""
    try:
        from .vision import _frame, detect_face
    except Exception:
        return None
    xs = []
    for i in range(n):
        img = _frame(path, duration * (i + 0.5) / n, width=480)
        f = detect_face(img) if img is not None else None
        if f:
            xs.append(f[0])
    if not xs:
        return None
    xs.sort()
    return xs[len(xs) // 2]


def has_audio(path: Path) -> bool:
    out = run(["ffprobe", "-v", "error", "-select_streams", "a", "-show_entries", "stream=index", "-of", "csv=p=0", str(path)]).stdout
    return bool(out.strip())


def silences(path: Path, noise_db: float = -38, min_d: float = 0.18) -> list[tuple[float, float]]:
    p = subprocess.run(
        ["ffmpeg", "-hide_banner", "-i", str(path), "-af", f"silencedetect=n={noise_db}dB:d={min_d}", "-f", "null", "-"],
        capture_output=True, text=True,
    )
    out, start = [], None
    for line in p.stderr.splitlines():
        m = re.search(r"silence_start: ([\d.]+)", line)
        if m:
            start = float(m.group(1))
        m = re.search(r"silence_end: ([\d.]+)", line)
        if m and start is not None:
            out.append((start, float(m.group(1))))
            start = None
    return out


# Whisper tends to drop disfluencies; a prompt written with them keeps "um"/"uh" in the transcript so the
# filler cutter can see them (widely used trick; no extra model needed).
FILLER_PROMPT = "Umm, so, uh, let me think, like, hmm... Okay, here's what I'm, uh, thinking."


def uncovered_speech(speech: list[tuple[float, float]], words: list[dict], min_len: float = 0.6, slack: float = 0.25) -> list[tuple[float, float]]:
    """Stretches of detected speech that no transcribed word overlaps (Whisper sometimes drops a whole
    segment, often the last line or a code-switched one). Adjacent leftovers closer than 0.5 s are merged."""
    holes: list[list[float]] = []
    spans = sorted((w["start"] - slack, w["end"] + slack) for w in words)
    for a, b in speech:
        cur = a
        for ws, we in spans:
            if we <= cur or ws >= b:
                continue
            if ws - cur >= min_len:
                holes.append([cur, ws])
            cur = max(cur, we)
        if b - cur >= min_len:
            holes.append([cur, b])
    merged: list[list[float]] = []
    for h in holes:
        if merged and h[0] - merged[-1][1] < 0.5:
            merged[-1][1] = h[1]
        else:
            merged.append(h)
    return [(round(a, 3), round(b, 3)) for a, b in merged]


def speech_spans(path: Path) -> list[tuple[float, float]]:
    from faster_whisper.audio import decode_audio
    from faster_whisper.vad import VadOptions, get_speech_timestamps

    audio = decode_audio(str(path), sampling_rate=16000)
    return [(s["start"] / 16000, s["end"] / 16000) for s in get_speech_timestamps(audio, VadOptions(threshold=0.5, min_silence_duration_ms=300, speech_pad_ms=30))]


def transcribe(path: Path, model_size: str = "small", language: str | None = None, prompt: str | None = None,
               keep_fillers: bool = True, align: bool = True, log=print) -> list[dict]:
    """Word-level transcript via faster-whisper (CPU, int8). Speech that Whisper skipped is found with
    Silero VAD and transcribed again on its own; then whisperX forced alignment fixes word edges."""
    from faster_whisper import WhisperModel
    from faster_whisper.audio import decode_audio

    model = WhisperModel(model_size, device="cpu", compute_type="int8")
    full_prompt = " ".join(x for x in ((FILLER_PROMPT if keep_fillers and (language in (None, "en")) else ""), (prompt or "")) if x) or None

    def run(audio, offset: float, initial_prompt, lang):
        segments, info = model.transcribe(
            audio, word_timestamps=True, language=lang, initial_prompt=initial_prompt, vad_filter=True,
            condition_on_previous_text=False,
        )
        ws, ss = [], []
        for seg in segments:
            ss.append({"text": seg.text, "start": seg.start + offset, "end": seg.end + offset})
            for w in seg.words or []:
                text = w.word.strip()
                if text:
                    ws.append({"text": text, "start": round(w.start + offset, 3), "end": round(w.end + offset, 3)})
        return ws, ss, info

    words, segs, info = run(str(path), 0.0, full_prompt, language)
    lang = language or info.language
    try:
        holes = uncovered_speech(speech_spans(path), words)
    except Exception:
        holes = []
    if holes:
        audio = decode_audio(str(path), sampling_rate=16000)
        rescued = 0
        for a, b in holes:
            a0, b0 = max(0.0, a - 0.2), b + 0.2
            ws, ss, _ = run(audio[int(a0 * 16000):int(b0 * 16000)], a0, prompt, lang)
            ws = [w for w in ws if not any(w["start"] < x["end"] and w["end"] > x["start"] for x in words)]
            if ws:
                words += ws
                segs += ss
                rescued += len(ws)
        words.sort(key=lambda w: w["start"])
        segs.sort(key=lambda s: s["start"])
        log(f"re-transcribed {len(holes)} skipped speech stretch(es): +{rescued} words")
    if align:
        from .align import align as force_align

        words = force_align(path, words, segs, lang, log=log)
    return words


def speech_gaps(path: Path, min_gap: float = 0.15) -> list[tuple[float, float]]:
    """Non-speech spans from Silero VAD (bundled with faster-whisper). Breaths and room noise count as
    non-speech here, unlike a dB threshold. Falls back to ffmpeg silencedetect."""
    try:
        from faster_whisper.audio import decode_audio
        from faster_whisper.vad import VadOptions, get_speech_timestamps

        audio = decode_audio(str(path), sampling_rate=16000)
        spans = get_speech_timestamps(audio, VadOptions(threshold=0.5, min_silence_duration_ms=int(min_gap * 1000), speech_pad_ms=60))
        dur = len(audio) / 16000
        gaps, t = [], 0.0
        for sp in spans:
            a, b = sp["start"] / 16000, sp["end"] / 16000
            if a - t >= min_gap:
                gaps.append((round(t, 3), round(a, 3)))
            t = b
        if dur - t >= min_gap:
            gaps.append((round(t, 3), round(dur, 3)))
        return gaps
    except Exception:
        return silences(path)


def cutout(src: Path, out: Path, device: str | None = None) -> Path:
    """Speaker cut-out (VP9 + alpha) with HyperFrames remove-background (Apache-2.0)."""
    cmd = ["npx", "--yes", "hyperframes@0.8.34", "remove-background", str(src), "-o", str(out)]
    if device:
        cmd += ["--device", device]
    subprocess.run(cmd, check=True, env=node_env())
    a, b = frame_count(src), frame_count(out)
    if abs(a - b) > 1:
        raise RuntimeError(f"cutout frame count {b} != source {a}: matte would drift")
    return out


def frame_count(path: Path) -> int:
    out = run(["ffprobe", "-v", "error", "-count_packets", "-select_streams", "v:0", "-show_entries", "stream=nb_read_packets", "-of", "csv=p=0", str(path)]).stdout
    return int(out.strip() or 0)


def contact_sheet(path: Path, out: Path, times: list[float], cols: int = 4, width: int = 270) -> Path:
    """Grid of frames at the given times (for Claude / the reviewer to look at)."""
    from PIL import Image

    tmp = out.parent / f".frames_{out.stem}"
    tmp.mkdir(parents=True, exist_ok=True)
    imgs = []
    for i, t in enumerate(times):
        f = tmp / f"{i:03d}.png"  # PNG: the JPEG encoder rejects limited-range (phone) video
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-ss", f"{max(0, t):.3f}", "-i", str(path), "-frames:v", "1", "-vf", f"scale={width}:-2", str(f)], check=False)
        if f.exists():
            imgs.append(Image.open(f).convert("RGB"))
    if not imgs:
        raise RuntimeError("no frames extracted")
    w, h = imgs[0].size
    rows = (len(imgs) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * w, rows * h), "black")
    for i, im in enumerate(imgs):
        sheet.paste(im.resize((w, h)), ((i % cols) * w, (i // cols) * h))
    sheet.save(out, quality=85)
    shutil.rmtree(tmp, ignore_errors=True)
    return out
