"""Audio for reels: voice enhancement (baked into the footage audio), two-pass loudness normalisation of the
final render, and music beat detection for beat-synced motion.

Voice chain (ffmpeg only, no extra models): rumble cut -> FFT denoise -> mud cut -> presence -> de-ess ->
compressor -> limiter. Final master: EBU R128 loudnorm, two passes, -14 LUFS / -1 dBTP (Reels/TikTok/Shorts).
"""
from __future__ import annotations

import json
import re
import subprocess
from pathlib import Path

VOICE_CHAIN = ",".join([
    "highpass=f=80",
    "afftdn=nr=12:nf=-40:tn=1",
    "equalizer=f=250:t=q:w=1.2:g=-2.5",
    "equalizer=f=4200:t=q:w=1.0:g=3",
    "deesser=i=0.35:f=0.55",
    "acompressor=threshold=-20dB:ratio=3:attack=8:release=120:makeup=2",
    "alimiter=limit=0.95",
])


def enhance_voice(src: Path, out: Path) -> Path:
    """Same video stream, enhanced voice track."""
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-i", str(src), "-c:v", "copy", "-af", VOICE_CHAIN, "-c:a", "aac", "-b:a", "256k", str(out)],
        check=True,
    )
    return out


def measure_loudness(path: Path, target: float = -14.0, tp: float = -1.0, lra: float = 9.0) -> dict:
    p = subprocess.run(
        ["ffmpeg", "-hide_banner", "-i", str(path), "-af", f"loudnorm=I={target}:TP={tp}:LRA={lra}:print_format=json", "-f", "null", "-"],
        capture_output=True, text=True,
    )
    m = re.search(r"\{[^{}]*\"input_i\"[^{}]*\}", p.stderr, re.S)
    if not m:
        raise RuntimeError("loudnorm measurement failed")
    return json.loads(m.group(0))


def normalise(path: Path, target: float = -14.0, tp: float = -1.0, lra: float = 9.0) -> dict:
    """Two-pass loudnorm in place (video copied). Returns before/after integrated loudness."""
    m = measure_loudness(path, target, tp, lra)
    if m.get("input_i") in ("-inf", None):
        return {"skipped": "silent"}
    tmp = path.with_name(path.stem + ".norm" + path.suffix)
    af = (
        f"loudnorm=I={target}:TP={tp}:LRA={lra}:measured_I={m['input_i']}:measured_TP={m['input_tp']}:"
        f"measured_LRA={m['input_lra']}:measured_thresh={m['input_thresh']}:offset={m['target_offset']}:linear=true,aresample=48000"
    )
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(path), "-c:v", "copy", "-af", af, "-c:a", "aac", "-b:a", "256k", "-movflags", "+faststart", str(tmp)], check=True)
    tmp.replace(path)
    after = measure_loudness(path, target, tp, lra)
    return {"before": float(m["input_i"]), "after": float(after["input_i"]), "truePeak": float(after["input_tp"])}


def beats(music: Path, max_seconds: float | None = None) -> list[float]:
    """Beat times (seconds from the start of the music file) with librosa (ISC licence)."""
    import librosa

    y, sr = librosa.load(str(music), sr=22050, mono=True, duration=max_seconds)
    _tempo, frames = librosa.beat.beat_track(y=y, sr=sr, units="frames")
    return [round(float(t), 3) for t in librosa.frames_to_time(frames, sr=sr)]
