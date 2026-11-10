"""Catalog of everything a spec can name, read straight from the renderer's sources so it never drifts."""
from __future__ import annotations

import re

from .media import COMPOSER
from .spec import list_looks

SRC = COMPOSER / "src" / "reel"


def _read(rel: str) -> str:
    return (SRC / rel).read_text(encoding="utf-8")


def catalog() -> dict:
    styles = [
        {"id": m[0], "name": m[1], "group": m[2]}
        for m in re.findall(r'\bs\("([\w-]+)", "([^"]+)", "(\w+)"', _read("captions/styles.ts"))
    ]
    effects = [
        {"id": m[0], "name": m[1], "family": m[2]}
        for m in re.findall(r'\bE\("([\w-]+)", "([^"]+)", "(\w+)"', _read("motion/effects.ts"))
    ]
    fmt_src = _read("formats.tsx")
    formats = [
        {"id": m[0], "name": m[1], "description": m[2]}
        for m in re.findall(r'id: "([\w-]+)",\s*(?:verticalOnly: true,\s*)?name: "([^"]+)",\s*description: "([^"]+)"', fmt_src)
    ]
    titles = [{"id": m[0], "name": m[1]} for m in re.findall(r'id: "([\w-]+)",\s*name: "([^"]+)",\s*render:', _read("titles.tsx"))]
    grades = [{"id": m[0], "name": m[1]} for m in re.findall(r'\{ id: "([\w-]+)", name: "([^"]+)"', _read("grade.tsx"))]
    overlays = re.findall(r'^  (\w+): (?:\(p\)|\(\{)', _read("overlays.tsx"), flags=re.M)
    end_cards = re.findall(r'"([\w-]+)"', re.search(r"END_CARD_STYLES = \[([^\]]+)\]", _read("titles.tsx")).group(1))
    looks = [{"id": k, "name": v.get("name", k), "description": v.get("description", ""), "user": v.get("user", False)} for k, v in list_looks().items()]
    return {
        "looks": looks,
        "captionStyles": styles,
        "formats": formats,
        "effects": effects,
        "titles": titles,
        "endCards": end_cards,
        "grades": grades,
        "overlays": overlays,
        "sfx": sorted(p.stem for p in (COMPOSER / "public" / "reel-sfx").glob("*.wav")),
        "fonts": re.findall(r'^  "?([\w ]+?)"?: \{ (?:mod|weights)', _read("fonts.ts"), flags=re.M),
    }


def counts() -> dict:
    c = catalog()
    return {k: len(v) for k, v in c.items()}
