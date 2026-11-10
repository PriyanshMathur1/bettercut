"""Multi-camera: line up extra angles of the same shoot by their sound, and cut to whoever is talking.

Every angle keeps its own picture; the sound of the reel stays the main footage's. An angle is stored with
its `offset`: the moment `t` in the main footage is the moment `t + offset` in the angle's file.

Sync: each recording's loudness is turned into an onset signal (where sound starts), and the offset is the
shift at which the two line up best (cross-correlation by FFT). Onsets match across cameras even when one
mic is closer or louder, because they mark when sounds happen, not how loud they are.

Speaker: the camera whose own mic is loudest, relative to how loud that mic gets when its own person talks,
is the one pointed at whoever is talking. Switches need a clear margin and a minimum shot length, so the cut doesn't flicker.
"""
from __future__ import annotations

import json
import subprocess
from pathlib import Path

import numpy as np

RATE = 100  # envelope samples per second (10 ms)
TALK_DB = 12  # a mic is "talking" when it is at least this far above its own room noise
MATCH_OK = 10  # a sync this clear is trusted; real matches score far higher (30+), unrelated sound well below
_AUDIO_HZ = 8000


def audio_envelope(path: Path, rate: int = RATE) -> np.ndarray:
    """Loudness of a file's sound in dB, `rate` values a second. A file with no sound gives an empty array."""
    raw = subprocess.run(
        ["ffmpeg", "-loglevel", "error", "-i", str(path), "-vn", "-ac", "1", "-ar", str(_AUDIO_HZ), "-f", "s16le", "-"],
        capture_output=True,
    ).stdout
    x = np.frombuffer(raw, dtype=np.int16).astype(np.float64) / 32768.0
    hop = _AUDIO_HZ // rate
    n = len(x) // hop
    if n == 0:
        return np.zeros(0)
    frames = x[: n * hop].reshape(n, hop)
    rms = np.sqrt(np.mean(frames**2, axis=1))
    return 20 * np.log10(rms + 1e-5)


def onsets(env_db: np.ndarray) -> np.ndarray:
    """Where sound starts: the rise of the loudness, zero-mean and unit-size so mic level doesn't matter."""
    if len(env_db) < 2:
        return np.zeros(len(env_db))
    d = np.maximum(np.diff(env_db, prepend=env_db[0]), 0.0)
    d = d - d.mean()
    s = d.std()
    return d / s if s > 0 else d


def find_offset(ref_db: np.ndarray, angle_db: np.ndarray, rate: int = RATE, max_shift: float = 120.0) -> tuple[float, float]:
    """The offset (seconds) where `angle` lines up with `ref`, and how sure that is (0 = no match, higher = clearer).

    A positive offset means the angle started recording before the reference: reference time t is angle
    time t + offset.
    """
    r, a = onsets(ref_db), onsets(angle_db)
    if len(r) < rate or len(a) < rate:
        return 0.0, 0.0
    size = 1 << int(np.ceil(np.log2(len(r) + len(a))))
    corr = np.fft.irfft(np.fft.rfft(a, size) * np.conj(np.fft.rfft(r, size)), size)
    lim = int(max_shift * rate)
    lags = np.concatenate([np.arange(0, min(lim, len(a)) + 1), np.arange(-min(lim, len(r)), 0)])
    vals = corr[lags % size]
    best = int(np.argmax(vals))
    peak = vals[best]
    # how far the best match stands out from the rest of the possible shifts
    others = np.delete(vals, slice(max(0, best - rate // 2), best + rate // 2))
    spread = others.std() if len(others) > 1 else 0.0
    score = float((peak - others.mean()) / spread) if spread > 0 else 0.0
    return float(lags[best]) / rate, round(score, 2)


def choose_speakers(levels: dict[str, np.ndarray], rate: int = RATE, window: float = 0.5, margin_db: float = 4.0, min_shot: float = 1.5) -> list[dict]:
    """Camera cuts from each camera's mic level over main-footage time.

    `levels[id]` is that camera's loudness in dB at `rate` per second, already lined up with the main footage
    (NaN where the camera wasn't recording). Returns [{"at": seconds, "angle": id}], starting at 0.
    """
    ids = list(levels)
    if not ids:
        return []
    n = max(len(v) for v in levels.values())
    step = max(1, int(window * rate))
    nwin = max(1, int(np.ceil(n / step)))
    # Each mic relative to its own talking level (its loud end), so a hot mic doesn't win every window. Not
    # the median: a mic whose person talks most of the time would then sit at 0 dB even when silent.
    # A window only counts as talking when it is well above that mic's own room noise; otherwise a mic that
    # never hears its own person (a listener's camera) would look like it is always at its talking level.
    table = np.full((len(ids), nwin), np.nan)
    for i, cid in enumerate(ids):
        v = levels[cid]
        if not np.isfinite(v).any():
            continue
        ref = np.nanpercentile(v, 90)
        floor = np.nanpercentile(v, 10)
        for w in range(nwin):
            seg = v[w * step : (w + 1) * step]
            seg = seg[np.isfinite(seg)]
            if len(seg):
                lvl = float(np.mean(seg))
                table[i, w] = lvl - ref if lvl - floor >= TALK_DB else -100.0 + (lvl - floor)
    cuts: list[dict] = []
    cur = None
    held = 0.0
    for w in range(nwin):
        col = table[:, w]
        if not np.isfinite(col).any():
            continue
        if np.nanmax(col) < -50:
            # nobody is talking: keep whichever camera is on, and don't pick one yet at the very start, or a
            # moment of silence would lock in an arbitrary camera for the minimum shot length
            if cur is not None and not np.isfinite(col[cur]):
                cur = int(np.nanargmax(col))  # the camera on stopped recording: move to one that still is
                cuts.append({"at": round(w * window, 3), "angle": ids[cur]})
                held = 0.0
            if cur is not None:
                held += window
            continue
        best = int(np.nanargmax(col))
        if cur is None:
            cur = best
            cuts.append({"at": 0.0, "angle": ids[cur]})  # whoever talks first is on from the start
            held = 0.0
        elif best != cur:
            here = col[cur]
            if not np.isfinite(here) or (col[best] - here >= margin_db and held >= min_shot):
                cur = best
                cuts.append({"at": round(w * window, 3), "angle": ids[cur]})
                held = 0.0
        held += window
    if not cuts:  # nobody ever talks: stay on the main footage
        cuts.append({"at": 0.0, "angle": "main" if "main" in ids else ids[0]})
    return cuts


def aligned_levels(main_db: np.ndarray, angle_db: np.ndarray, offset: float, rate: int = RATE) -> np.ndarray:
    """The angle's loudness on the main footage's clock (NaN where the angle has no recording)."""
    out = np.full(len(main_db), np.nan)
    shift = int(round(offset * rate))
    for t in range(len(main_db)):
        j = t + shift
        if 0 <= j < len(angle_db):
            out[t] = angle_db[j]
    return out


# ---- on a project -----------------------------------------------------------------------------

def add_angles(project: Path, clips: list[str], log=print, auto: bool = True) -> dict:
    """Add camera angles to a reel: each is prepared like the main footage, synced by sound, and stored on the
    spec; then (by default) the reel cuts to whoever is talking."""
    from . import media, pipeline

    spec = pipeline.load(project)
    main = Path(spec["source"]["src"])
    main_db = audio_envelope(main)
    if len(main_db) < RATE:
        raise RuntimeError("the main footage has no usable sound to sync angles to")
    angles = list(spec.get("angles") or [])
    for c in clips:
        n = len(angles) + 1
        while any(a.get("id") == f"cam{n}" for a in angles):
            n += 1
        cid = f"cam{n}"
        out = project / "assets" / f"angle-{cid}.mp4"
        log(f"preparing angle {cid} ({Path(c).name})")
        media.assemble([Path(c)], out)
        db = audio_envelope(out)
        if len(db) < RATE:
            raise RuntimeError(f"{Path(c).name} has no sound, so it can't be synced; record every angle with sound on")
        offset, score = find_offset(main_db, db)
        log(f"{cid}: synced at {offset:+.2f}s (match strength {score})")
        if score < MATCH_OK:
            log(f"{cid}: the match is weak; check it lines up, or re-record with a clap at the start")
        angles.append({"id": cid, "name": Path(c).stem[:40], "src": str(out), "offset": round(offset, 3),
                       "duration": round(media.probe(out)["duration"], 3), "match": score})
    spec["angles"] = angles
    if auto:
        spec["cams"] = auto_cams(spec)
        log(f"cut to the speaker: {len(spec['cams'])} camera switches")
    pipeline.save(project, spec)
    return spec


def auto_cams(spec: dict) -> list[dict]:
    """Camera cuts for a spec's angles, by who is talking. The main footage counts as the camera "main"."""
    main_db = audio_envelope(Path(spec["source"]["src"]))
    levels = {"main": main_db}
    for a in spec.get("angles") or []:
        levels[a["id"]] = aligned_levels(main_db, audio_envelope(Path(a["src"])), a.get("offset", 0.0))
    return choose_speakers(levels)


def auto_switch(project: Path, log=print) -> dict:
    from . import pipeline

    spec = pipeline.load(project)
    if not spec.get("angles"):
        raise RuntimeError("add camera angles first")
    spec["cams"] = auto_cams(spec)
    log(f"cut to the speaker: {len(spec['cams'])} camera switches")
    pipeline.save(project, spec)
    return spec
