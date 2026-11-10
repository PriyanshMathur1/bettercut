"""Face-aware framing (AutoFlip-style, simplified for talking heads).

For every segment: sample frames, detect the face (OpenCV YuNet, a 230 KB ONNX model fetched once from the
official opencv_zoo into ~/.bettercut/models; falls back to the Haar cascade on OpenCV 4), take the median position and snap to a static crop when the face barely moves. The result sets
segment cx/cy, which drives both the 9:16 crop of wider footage and the origin of punch-in zooms, so a
punch-in lands on the face instead of the frame centre.
"""
from __future__ import annotations

import statistics
import subprocess
from pathlib import Path

import numpy as np


def _frame(path: Path, t: float, width: int = 360):
    import cv2

    p = subprocess.run(
        ["ffmpeg", "-loglevel", "error", "-ss", f"{max(0, t):.3f}", "-i", str(path), "-frames:v", "1", "-vf", f"scale={width}:-2", "-f", "image2pipe", "-vcodec", "png", "-"],
        capture_output=True,
    )
    if not p.stdout:
        return None
    return cv2.imdecode(np.frombuffer(p.stdout, np.uint8), cv2.IMREAD_COLOR)


YUNET_URL = "https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx"
YUNET = Path.home() / ".bettercut" / "models" / "face_detection_yunet_2023mar.onnx"
_DETECTOR: dict = {}


def _yunet():
    import cv2

    if "yunet" not in _DETECTOR:
        det = None
        try:
            if not YUNET.exists():
                import urllib.request

                YUNET.parent.mkdir(parents=True, exist_ok=True)
                tmp = YUNET.with_suffix(".part")
                urllib.request.urlretrieve(YUNET_URL, tmp)
                if tmp.stat().st_size < 100_000:  # an LFS pointer or error page, not the model
                    raise RuntimeError("face model download incomplete")
                tmp.rename(YUNET)
            det = cv2.FaceDetectorYN.create(str(YUNET), "", (320, 320), 0.7, 0.3, 5000)
        except Exception as e:
            print(f"face detection: YuNet unavailable ({e})")
        _DETECTOR["yunet"] = det
    return _DETECTOR["yunet"]


def _haar():
    import cv2

    if "haar" not in _DETECTOR:
        _DETECTOR["haar"] = (cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")
                             if hasattr(cv2, "CascadeClassifier") else None)
    return _DETECTOR["haar"]


def detect_face(img) -> tuple[float, float, float] | None:
    """Largest face as (cx, cy, height) normalised to the frame, or None."""
    import cv2

    h, w = img.shape[:2]
    det = _yunet() if hasattr(cv2, "FaceDetectorYN") else None
    if det is not None:
        det.setInputSize((w, h))
        _, faces = det.detect(img)
        faces = [] if faces is None else [f[:4] for f in faces if f[3] >= h * 0.04]
    elif _haar() is not None:
        gray = cv2.equalizeHist(cv2.cvtColor(img, cv2.COLOR_BGR2GRAY))
        faces = list(_haar().detectMultiScale(gray, scaleFactor=1.1, minNeighbors=6, minSize=(int(w * 0.08), int(w * 0.08))))
    else:
        return None
    if len(faces) == 0:
        return None
    x, y, fw, fh = max(faces, key=lambda f: f[2] * f[3])
    return (float(x + fw / 2) / w, float(y + fh / 2) / h, float(fh) / h)


def focus_point(face: tuple[float, float, float]) -> tuple[float, float]:
    """Crop focus for a face: horizontally centred on it, eyes about a third from the top of the frame."""
    cx, cy, fh = face
    # the crop keeps the focus point at the box centre; aim slightly below the face so the head has headroom
    return round(cx, 3), round(min(0.8, cy + fh * 0.6), 3)


def frame_segments(src: Path, segments: list[dict], samples: int = 5, deadzone: float = 0.04) -> list[dict]:
    out = []
    last: tuple[float, float] | None = None
    for seg in segments:
        pts = []
        d = seg["end"] - seg["start"]
        for i in range(samples):
            img = _frame(src, seg["start"] + d * (i + 0.5) / samples)
            f = detect_face(img) if img is not None else None
            if f:
                pts.append(focus_point(f))
        seg = dict(seg)
        if pts:
            cx = statistics.median(p[0] for p in pts)
            cy = statistics.median(p[1] for p in pts)
            # dead zone: keep the previous framing when the face barely moved (no jittery crops)
            if last and abs(cx - last[0]) < deadzone and abs(cy - last[1]) < deadzone:
                cx, cy = last
            seg["cx"], seg["cy"] = round(cx, 3), round(cy, 3)
            last = (seg["cx"], seg["cy"])
        out.append(seg)
    return out
