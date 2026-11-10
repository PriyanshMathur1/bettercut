"""Professional colour: LUTs, primary correction, auto white balance / exposure, shot matching, per-shot
grades and stabilisation, baked into the footage with ffmpeg (so the render is a true grade, not a CSS tint).

The baked file has exactly the source's timing, so segments/words never move. When the speaker cut-out
exists, its colour is rebuilt from the graded footage + the cut-out's alpha, so both layers match.
"""
from __future__ import annotations

import hashlib
import json
import subprocess
from pathlib import Path

import numpy as np

from . import media

HERE = Path(__file__).resolve().parent
LUT_DIR = HERE / "luts"
USER_LUTS = Path.home() / ".bettercut" / "luts"

# Manual controls and their neutral values. Ranges are what the UI exposes.
NEUTRAL = {
    "exposure": 0.0,      # EV, -2..2
    "temperature": 0.0,   # -100 (cool) .. 100 (warm)
    "tint": 0.0,          # -100 (green) .. 100 (magenta)
    "contrast": 0.0,      # -100..100
    "highlights": 0.0,    # -100..100
    "shadows": 0.0,       # -100..100
    "saturation": 0.0,    # -100..100
    "vibrance": 0.0,      # -100..100
    "sharpen": 0.0,       # 0..100
    "denoise": 0.0,       # 0..100
    "lutStrength": 1.0,   # 0..1
}
BAKE_KEYS = list(NEUTRAL) + ["lut", "autoWhiteBalance", "autoExposure", "matchClips", "log"]


# ---------------------------------------------------------------- LUT library (original looks)

def _s_curve(x, amount):
    return x + amount * (x - x * x) * (2 * x - 1) * -2  # smooth contrast around mid grey


def _luma(rgb):
    return rgb[..., 0] * 0.2126 + rgb[..., 1] * 0.7152 + rgb[..., 2] * 0.0722


def _sat(rgb, s):
    y = _luma(rgb)[..., None]
    return y + (rgb - y) * s


def _split_tone(rgb, shadow, highlight, amount):
    y = _luma(rgb)[..., None]
    sh = np.array(shadow) * (1 - y) * amount
    hi = np.array(highlight) * y * amount
    return rgb + sh + hi


LOOKS = {
    "cinematic-teal": lambda c: _split_tone(_s_curve(c, 0.25), (-0.06, 0.02, 0.07), (0.07, 0.02, -0.06), 1.0),
    "warm-film": lambda c: _sat(_split_tone(_s_curve(c * 0.97 + 0.02, 0.15), (0.02, 0.0, -0.03), (0.06, 0.03, -0.04), 1.0), 0.92),
    "cool-film": lambda c: _sat(_split_tone(_s_curve(c, 0.15), (-0.02, 0.01, 0.06), (-0.01, 0.02, 0.04), 1.0), 0.9),
    "golden-hour": lambda c: _sat(_split_tone(c, (0.03, 0.01, -0.04), (0.10, 0.05, -0.06), 1.0), 1.08),
    "bleach-bypass": lambda c: _sat(_s_curve(c, 0.45), 0.55),
    "faded-matte": lambda c: _sat(c * 0.86 + 0.07, 0.85),
    "punchy-pop": lambda c: _sat(_s_curve(c, 0.3), 1.3),
    "moody-green": lambda c: _sat(_split_tone(_s_curve(c * 0.92, 0.2), (-0.03, 0.04, 0.0), (0.03, 0.02, -0.03), 1.0), 0.8),
    "night-blue": lambda c: _sat(_split_tone(c * 0.9, (-0.04, 0.0, 0.08), (0.0, 0.02, 0.06), 1.0), 0.75),
    "pastel-dream": lambda c: _sat(_split_tone(c * 0.85 + 0.12, (0.04, 0.0, 0.05), (0.03, 0.01, 0.02), 1.0), 0.8),
    "mono-silver": lambda c: np.repeat(_s_curve(_luma(c), 0.3)[..., None], 3, axis=-1),
    "sunset-pink": lambda c: _sat(_split_tone(c, (0.05, -0.02, 0.05), (0.09, 0.02, 0.0), 1.0), 1.05),
    "clean-skin": lambda c: _sat(_split_tone(c * 0.98 + 0.015, (0.0, 0.0, 0.01), (0.025, 0.01, -0.01), 1.0), 0.97),
    "high-contrast-bw": lambda c: np.repeat(_s_curve(_luma(c), 0.6)[..., None], 3, axis=-1),
}


def write_cube(path: Path, fn, size: int = 33, title: str = "") -> Path:
    g = np.linspace(0, 1, size)
    b, gg, r = np.meshgrid(g, g, g, indexing="ij")  # .cube order: red fastest
    rgb = np.stack([r, gg, b], axis=-1).reshape(-1, 3)
    out = np.clip(fn(rgb), 0, 1)
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(f'TITLE "{title or path.stem}"\nLUT_3D_SIZE {size}\nDOMAIN_MIN 0 0 0\nDOMAIN_MAX 1 1 1\n')
        f.writelines(f"{x:.6f} {y:.6f} {z:.6f}\n" for x, y, z in out)
    return path


def ensure_luts() -> dict[str, Path]:
    """Built-in LUTs (generated once) + the user's own .cube files."""
    luts = {}
    for name, fn in LOOKS.items():
        p = LUT_DIR / f"{name}.cube"
        if not p.exists():
            write_cube(p, fn, title=name)
        luts[name] = p
    if USER_LUTS.exists():
        for p in sorted(USER_LUTS.glob("*.cube")):
            luts[p.stem] = p
    return luts


# ---------------------------------------------------------------- measurement

def measure(path: Path, start: float = 0, end: float | None = None, n: int = 8) -> dict:
    """Mean luma and per-channel mean/std over sampled frames of [start, end]."""
    from PIL import Image

    info = media.probe(path)
    end = end if end is not None else info["duration"]
    samples = []
    for i in range(n):
        t = start + (end - start) * (i + 0.5) / n
        p = subprocess.run(
            ["ffmpeg", "-loglevel", "error", "-ss", f"{t:.3f}", "-i", str(path), "-frames:v", "1", "-vf", "scale=128:-2", "-f", "image2pipe", "-vcodec", "png", "-"],
            capture_output=True,
        )
        if p.stdout:
            import io

            samples.append(np.asarray(Image.open(io.BytesIO(p.stdout)).convert("RGB"), dtype=np.float32) / 255)
    if not samples:
        return {}
    px = np.concatenate([s.reshape(-1, 3) for s in samples])
    return {"luma": float(_luma(px).mean()), "mean": px.mean(0).tolist(), "std": px.std(0).tolist()}


def auto_exposure_ev(stats: dict, target: float = 0.47) -> float:
    """EV that brings mean luma to `target` (clamped to +-1.5)."""
    y = max(stats.get("luma", target), 1e-3)
    return float(np.clip(np.log2(target / y), -1.5, 1.5))


def match_gains(ref: dict, other: dict) -> tuple[list[float], list[float]]:
    """Per-channel gain/offset (Reinhard-style mean/std transfer in RGB) mapping `other` onto `ref`."""
    gains, offs = [], []
    for c in range(3):
        g = float(np.clip(ref["std"][c] / max(other["std"][c], 1e-3), 0.6, 1.6))
        o = float(np.clip(ref["mean"][c] - other["mean"][c] * g, -0.25, 0.25))
        gains.append(round(g, 4))
        offs.append(round(o, 4))
    return gains, offs


# ---------------------------------------------------------------- filter graph

def _primary(g: dict, enable: str | None = None) -> list[str]:
    """ffmpeg filters for primary correction. `enable` = timeline expression for per-shot grades."""
    en = f":enable='{enable}'" if enable else ""
    f: list[str] = []
    if g.get("exposure"):
        f.append(f"exposure=exposure={g['exposure']:.3f}{en}")
    if g.get("temperature") or g.get("tint"):
        # temperature: 6500K neutral, +-100 -> 3500K..9500K (warm = lower Kelvin target)
        if g.get("temperature"):
            k = 6500 + g["temperature"] * 30
            f.append(f"colortemperature=temperature={k:.0f}:mix={min(1.0, abs(g['temperature']) / 100 + 0.25):.2f}{en}")
        if g.get("tint"):
            m = g["tint"] / 100 * 0.08
            f.append(f"colorbalance=gm={-m:.3f}:gh={-m / 2:.3f}{en}")
    if g.get("highlights") or g.get("shadows"):
        sh = 0.25 + g.get("shadows", 0) / 100 * 0.12
        hi = 0.75 + g.get("highlights", 0) / 100 * 0.12
        f.append(f"curves=master='0/0 0.25/{sh:.3f} 0.75/{hi:.3f} 1/1'{en}")
    c = 1 + g.get("contrast", 0) / 100 * 0.5
    s = 1 + g.get("saturation", 0) / 100
    if c != 1 or s != 1:
        f.append(f"eq=contrast={c:.3f}:saturation={max(0, s):.3f}{en}")
    if g.get("vibrance"):
        f.append(f"vibrance=intensity={g['vibrance'] / 100 * 0.8:.3f}{en}")
    return f


def build_filter(spec: dict, clip_stats: list[dict] | None = None, luts: dict[str, Path] | None = None) -> str:
    g = {**NEUTRAL, **(spec.get("grade") or {})}
    luts = luts or ensure_luts()
    chain: list[str] = []
    if g.get("denoise"):
        d = g["denoise"] / 100
        chain.append(f"hqdn3d={1.5 + 4 * d:.2f}:{1.2 + 3 * d:.2f}:{3 + 6 * d:.2f}:{3 + 6 * d:.2f}")
    if g.get("log"):
        # camera log footage: convert to normal colour first, so every later control works on a normal picture
        from .logprofile import PROFILES, lut_path

        if g["log"] in PROFILES:
            esc = str(lut_path(g["log"])).replace("\\", "/").replace(":", "\\:").replace("'", "\\'")
            chain.append(f"lut3d=file='{esc}':interp=tetrahedral")
    if g.get("autoWhiteBalance"):
        chain.append("format=gbrpf32le,grayworld,format=yuv420p")
    # shot matching across clips (from clips.json) as per-range RGB gain/offset
    for cs in clip_stats or []:
        if cs.get("gains"):
            (gr, gg, gb), (orr, og, ob) = cs["gains"], cs["offsets"]
            chain.append(
                f"lutrgb=r='clipval*{gr}+{orr * 255:.1f}':g='clipval*{gg}+{og * 255:.1f}':b='clipval*{gb}+{ob * 255:.1f}'"
                f":enable='between(t,{cs['start']:.3f},{cs['end']:.3f})'"
            )
    chain += _primary(g)
    for seg in spec.get("segments", []):
        if seg.get("grade"):
            chain += _primary(seg["grade"], f"between(t,{seg['start']:.3f},{seg['end']:.3f})")
    lut = g.get("lut")
    if lut:
        p = luts.get(lut) or (Path(lut).expanduser() if Path(lut).expanduser().exists() else None)
        if p:
            st = float(g.get("lutStrength", 1))
            esc = str(p).replace("\\", "/").replace(":", "\\:").replace("'", "\\'")
            if st >= 0.999:
                chain.append(f"lut3d=file='{esc}'")
            else:
                chain.append(f"split[a][b];[b]lut3d=file='{esc}'[l];[a][l]blend=all_mode=normal:all_opacity={st:.3f}")
    if g.get("sharpen"):
        chain.append(f"cas=strength={g['sharpen'] / 100 * 0.8:.3f}")
    chain.append("format=yuv420p")
    return ",".join(chain)


def bake_key(spec: dict) -> str:
    g = {k: (spec.get("grade") or {}).get(k) for k in BAKE_KEYS}
    segs = [s.get("grade") for s in spec.get("segments", [])]
    voice = bool((spec.get("audio") or {}).get("enhanceVoice"))
    return hashlib.sha1(json.dumps([g, segs, voice, spec["source"].get("src")], sort_keys=True).encode()).hexdigest()[:12]


def needs_video_bake(spec: dict) -> bool:
    g = spec.get("grade") or {}
    manual = any(g.get(k, v) != v for k, v in NEUTRAL.items() if k != "lutStrength")
    return bool(manual or g.get("lut") or g.get("log") or g.get("autoWhiteBalance") or g.get("autoExposure") or g.get("matchClips") or any(s.get("grade") for s in spec.get("segments", [])))


def needs_bake(spec: dict) -> bool:
    return needs_video_bake(spec) or bool((spec.get("audio") or {}).get("enhanceVoice"))


def is_current(spec: dict) -> bool:
    """True when source.graded matches the current grade settings (or no bake is needed)."""
    if not needs_bake(spec):
        return not spec["source"].get("graded")
    g = spec["source"].get("graded")
    return bool(g and Path(g).exists() and (spec.get("grade") or {}).get("baked") == bake_key(spec))


def bake(spec: dict, project: Path, log=print) -> dict:
    """Write assets/graded-<key>.mp4 (+ graded matte) and point spec.source at them."""
    src = Path(spec["source"]["src"])
    key = bake_key(spec)
    spec = json.loads(json.dumps(spec))
    g = spec.setdefault("grade", {})
    if not needs_bake(spec):
        spec["source"].pop("graded", None)
        spec["source"].pop("gradedMatte", None)
        g.pop("baked", None)
        return spec
    if g.get("autoExposure"):
        st = measure(src)
        g["exposure"] = round(g.get("exposure", 0) + auto_exposure_ev(st), 3)
        log(f"auto exposure: {g['exposure']:+.2f} EV")
    clip_stats = None
    clips_file = project / "work" / "clips.json"
    if g.get("matchClips") and clips_file.exists():
        clips = json.loads(clips_file.read_text(encoding="utf-8")).get("clips", [])
        if len(clips) > 1:
            stats = [measure(src, c["start"], c["start"] + c["duration"], n=6) for c in clips]
            ref = max(range(len(stats)), key=lambda i: clips[i]["duration"])
            clip_stats = []
            for c, st in zip(clips, stats):
                gains, offs = match_gains(stats[ref], st) if st is not stats[ref] else ([1, 1, 1], [0, 0, 0])
                clip_stats.append({"start": c["start"], "end": c["start"] + c["duration"], "gains": gains, "offsets": offs})
            log(f"matched {len(clips)} clips to '{clips[ref]['clip']}'")
    out = project / "assets" / f"graded-{key}.mp4"
    if not out.exists():
        from .audio import VOICE_CHAIN

        video = ["-vf", build_filter(spec, clip_stats), "-c:v", "libx264", "-preset", "medium", "-crf", "15"] if needs_video_bake(spec) else ["-c:v", "copy"]
        voice = ["-af", VOICE_CHAIN, "-c:a", "aac", "-b:a", "256k"] if (spec.get("audio") or {}).get("enhanceVoice") else ["-c:a", "copy"]
        log("baking " + " + ".join(x for x, on in (("colour grade", needs_video_bake(spec)), ("voice enhancement", voice[0] == "-af")) if on))
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(src), *video, *voice, "-movflags", "+faststart", str(out)], check=True)
    spec["source"]["graded"] = str(out)
    matte = spec["source"].get("matte")
    if matte and Path(matte).exists() and needs_video_bake(spec):
        mout = project / "assets" / f"graded-matte-{key}.webm"
        if not mout.exists():
            log("rebuilding the cut-out from the graded footage")
            subprocess.run(
                ["ffmpeg", "-y", "-loglevel", "error", "-i", str(out), "-c:v", "libvpx-vp9", "-i", str(matte),
                 "-filter_complex", "[1:v]alphaextract[a];[0:v][a]alphamerge,format=yuva420p",
                 "-an", "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-b:v", "0", "-crf", "28", "-row-mt", "1", str(mout)],
                check=True,
            )
        spec["source"]["gradedMatte"] = str(mout)
    g["baked"] = key
    for old in (project / "assets").glob("graded-*"):
        if key not in old.name:
            old.unlink(missing_ok=True)
    return spec


def lut_previews(src: Path, out_dir: Path, at: float | None = None) -> dict[str, Path]:
    """One graded thumbnail per LUT from a frame of the footage (for the LUT picker)."""
    luts = ensure_luts()
    out_dir.mkdir(parents=True, exist_ok=True)
    frame = out_dir / "_frame.png"
    if not frame.exists():
        t = at if at is not None else media.probe(src)["duration"] * 0.35
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-ss", f"{t:.2f}", "-i", str(src), "-frames:v", "1", "-vf", "scale=180:-2", str(frame)], check=True)
    res = {"none": frame}
    for name, p in luts.items():
        o = out_dir / f"{name}.jpg"
        if not o.exists():
            esc = str(p).replace(":", "\\:").replace("'", "\\'")
            subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(frame), "-vf", f"lut3d=file='{esc}'", str(o)], check=False)
        res[name] = o
    return res
