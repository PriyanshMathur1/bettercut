"""Camera log footage -> normal (Rec.709) colour.

Log footage looks flat and grey until it is converted. Each profile here is built from the transfer function
and colour primaries the camera maker publishes: decode the log curve to scene-linear light, move to Rec.709
primaries, roll off the highlights, and encode for display. The result is written once as a .cube LUT.

These are our own conversions from the published maths, not copies of any vendor's LUT files.
"""
from __future__ import annotations

from pathlib import Path

import numpy as np

PROFILES = {
    "apple-log": "Apple Log (iPhone 15 Pro and later)",
    "slog3": "Sony S-Log3 / S-Gamut3.Cine",
    "vlog": "Panasonic V-Log / V-Gamut",
}

# camera primaries -> Rec.709 primaries (linear light). Each row sums to 1, so neutral greys stay neutral.
MATRIX = {
    "apple-log": np.array([[1.6605, -0.5876, -0.0728], [-0.1246, 1.1329, -0.0083], [-0.0182, -0.1006, 1.1187]]),  # Rec.2020
    "slog3": np.array([[1.6269, -0.5401, -0.0868], [-0.1785, 1.4179, -0.2394], [-0.0444, -0.1959, 1.2403]]),  # S-Gamut3.Cine
    "vlog": np.array([[1.806576, -0.695697, -0.110879], [-0.170090, 1.305955, -0.135865], [-0.025206, -0.154468, 1.179674]]),  # V-Gamut
}


def decode(profile: str, x):
    """Log code value (0..1) -> scene-linear light (0.18 = mid grey)."""
    x = np.asarray(x, dtype=np.float64)
    if profile == "apple-log":
        r0, rt, c, beta, gamma, delta = -0.05641088, 0.01, 47.28711236, 0.00964052, 0.08550479, 0.69336945
        pt = c * (rt - r0) ** 2
        return np.where(x >= pt, 2.0 ** ((x - delta) / gamma) - beta, np.where(x >= 0, np.sqrt(np.maximum(x, 0) / c) + r0, r0))
    if profile == "slog3":
        code = x * 1023.0
        knee = 171.2102946929
        return np.where(code >= knee, 10.0 ** ((code - 420.0) / 261.5) * 0.19 - 0.01, (code - 95.0) * 0.01125 / (knee - 95.0))
    if profile == "vlog":
        b, c, d = 0.00873, 0.241514, 0.598206
        return np.where(x < 0.181, (x - 0.125) / 5.6, 10.0 ** ((x - d) / c) - b)
    raise ValueError(f"unknown camera profile {profile}")


WHITE = 8.0  # scene-linear value that reaches display white (about 5.5 stops over mid grey)
_GAIN = 1.2145  # keeps mid grey at mid grey through the highlight roll-off below


def tone_map(lin):
    """Scene-linear -> display-linear 0..1: mid grey unchanged, highlights rolled off smoothly to white."""
    v = np.maximum(lin, 0.0) * _GAIN
    return np.clip(v * (1.0 + v / (WHITE * _GAIN) ** 2) / (1.0 + v), 0.0, 1.0)


def encode_709(lin):
    lin = np.clip(lin, 0.0, 1.0)
    return np.where(lin < 0.018, 4.5 * lin, 1.099 * np.power(lin, 0.45) - 0.099)


def to_rec709(profile: str, rgb):
    """Log RGB (N x 3, 0..1) -> display-ready Rec.709 RGB."""
    lin = decode(profile, rgb) @ MATRIX[profile].T
    return encode_709(tone_map(lin))


def lut_path(profile: str) -> Path:
    """The conversion as a .cube file (made on first use)."""
    from .colour import LUT_DIR, write_cube

    if profile not in PROFILES:
        raise ValueError(f"unknown camera profile {profile}")
    p = LUT_DIR / f"log-{profile}.cube"
    if not p.exists():
        write_cube(p, lambda rgb: to_rec709(profile, rgb), size=65, title=f"{PROFILES[profile]} to Rec.709")
    return p
