"""ReelSpec assembly: defaults + brand + look + transcript decisions -> spec.json.

The TypeScript twin of these defaults lives in composer/src/reel/defaults.ts.
"""
from __future__ import annotations

import copy
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
LOOKS_DIR = HERE / "looks"
USER_DIR = Path.home() / ".bettercut"
USER_LOOKS = USER_DIR / "looks"
BRAND_FILE = USER_DIR / "brand.json"

DEFAULT_BRAND = {
    "name": "Your Name",
    "handle": "yourhandle",
    "primary": "#3D5AFE",
    "accent": "#FFD23F",
    "text": "#FFFFFF",
    "ink": "#0E0F13",
    "background": "#F4F1EA",
    "headingFont": "Montserrat",
    "bodyFont": "Inter",
    "serifFont": "Instrument Serif",
}

DEFAULT_SPEC = {
    "version": 1,
    "title": "Untitled reel",
    "look": "bold-pop",
    "source": {"src": "", "width": 1080, "height": 1920, "duration": 0, "fps": 30},
    "segments": [],
    "words": [],
    "brand": DEFAULT_BRAND,
    "format": {"id": "full"},
    "captions": {"enabled": True, "style": "bold-pop", "position": "lower", "scale": 1, "wordsPerPage": 3, "behindHead": False},
    "overlays": [],
    "broll": [],
    "motion": {"autoZoom": "alternate", "cutTransition": "punch-in", "camera": "none", "events": []},
    "grade": {"preset": "clean", "vignette": 0.25, "grain": 0},
    "audio": {"musicVolume": 0.22, "duck": True, "sfx": True, "sfxVolume": 0.45, "voiceVolume": 1},
    "progressBar": False,
    "safeGuide": False,
    "fps": 30,
    "width": 1080,
    "height": 1920,
}

NEEDS_MATTE_FORMATS = {"greenscreen", "head-breakout", "colour-pop"}


def merge(base: dict, patch: dict | None) -> dict:
    """Objects merge one level down; arrays and scalars replace (same rule as mergeSpec in TS)."""
    out = copy.deepcopy(base)
    for k, v in (patch or {}).items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = {**out[k], **v}
        else:
            out[k] = copy.deepcopy(v)
    return out


def list_looks() -> dict[str, dict]:
    looks: dict[str, dict] = {}
    for d in (LOOKS_DIR, USER_LOOKS):
        if d.exists():
            for f in sorted(d.glob("*.json")):
                data = json.loads(f.read_text(encoding="utf-8"))
                data.setdefault("id", f.stem)
                data["user"] = d == USER_LOOKS
                looks[data["id"]] = data
    return looks


def load_brand(path: str | Path | None = None) -> dict:
    p = Path(path).expanduser() if path else BRAND_FILE
    if p.exists():
        return {**DEFAULT_BRAND, **json.loads(p.read_text(encoding="utf-8"))}
    return dict(DEFAULT_BRAND)


def _fill_tokens(value, ctx: dict):
    if isinstance(value, str) and value.startswith("$") and value[1:] in ctx:
        return ctx[value[1:]]
    if isinstance(value, dict):
        return {k: _fill_tokens(v, ctx) for k, v in value.items()}
    return value


def apply_look(spec: dict, look_id: str, hook: str = "") -> dict:
    """Apply a look's patch. Keeps transcript, segments, overlays, b-roll and brand."""
    looks = list_looks()
    look = looks.get(look_id)
    if not look:
        raise KeyError(f"unknown look '{look_id}'. Available: {', '.join(sorted(looks))}")
    patch = _fill_tokens(look.get("patch", {}), {"hook": hook or spec.get("hook", {}).get("text", ""), "name": spec["brand"].get("name", "")})
    out = merge(spec, patch)
    out["look"] = look_id
    if "hook" in patch:
        out["hook"] = {"text": hook or spec.get("hook", {}).get("text", ""), **patch["hook"]}
    if "endCard" not in patch:
        out.pop("endCard", None)
    # looks that need a cutout degrade gracefully without one
    if not out["source"].get("matte"):
        if out["captions"].get("behindHead"):
            out["captions"]["behindHead"] = False
    return out


def build_spec(
    source: dict,
    words: list[dict],
    segments: list[dict],
    look: str = "bold-pop",
    brand: dict | None = None,
    hook: str = "",
    title: str = "",
) -> dict:
    spec = merge(DEFAULT_SPEC, {"source": source, "words": words, "segments": segments, "brand": brand or DEFAULT_BRAND})
    spec["title"] = title or hook or "Untitled reel"
    spec["hook"] = {"text": hook, "style": "slam", "duration": 2.2}
    spec = apply_look(spec, look, hook)
    if not hook:
        spec.pop("hook", None)
    return spec


def validate(spec: dict) -> list[str]:
    """Problems that would make a render fail or look broken."""
    issues = []
    src = spec.get("source", {}).get("src")
    if not src:
        issues.append("source.src is empty")
    elif not src.startswith("http") and not Path(src).exists():
        issues.append(f"source file missing: {src}")
    if not spec.get("segments"):
        issues.append("no segments: nothing would be shown")
    if spec.get("format", {}).get("id") in NEEDS_MATTE_FORMATS and not spec["source"].get("matte"):
        issues.append(f"format '{spec['format']['id']}' needs a cutout (run with --cutout); it falls back to a plain layout")
    for i, s in enumerate(spec.get("segments", [])):
        if s["end"] <= s["start"]:
            issues.append(f"segment {i} has end <= start")
    for o in spec.get("overlays", []):
        if o.get("end", 0) <= o.get("start", 0):
            issues.append(f"overlay {o.get('kind')} has end <= start")
    brand = spec.get("brand", {})
    uses_brand = spec.get("endCard", {}).get("enabled") or any(o.get("kind") in ("followButton", "notification", "commentReply") for o in spec.get("overlays", []))
    if uses_brand and (brand.get("handle") in (None, "", DEFAULT_BRAND["handle"]) or brand.get("name") == DEFAULT_BRAND["name"]):
        issues.append("brand is still the placeholder (Your Name / @yourhandle) and the end card shows it: "
                      "set your name and handle in the Brand tab")
    return issues


ADVISORY = ("falls back", "placeholder")


def blocking(spec: dict) -> list[str]:
    """The issues that must stop a render (validate() also returns advice, which must not)."""
    return [i for i in validate(spec) if not any(a in i for a in ADVISORY)]
