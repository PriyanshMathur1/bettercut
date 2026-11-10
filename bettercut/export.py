"""Exports beyond the MP4: subtitles (SRT/VTT), an FCPXML timeline so a pro can finish the cut in
Final Cut / DaVinci Resolve / Premiere (via XML import), and the aspect presets used for multi-format renders."""
from __future__ import annotations

from fractions import Fraction
from pathlib import Path
from xml.sax.saxutils import escape

from .timeline import output_words, place_segments

from .shape import SHAPES as ASPECTS  # noqa: E402  (kept under its old name for callers)


def _ts(t: float, sep: str) -> str:
    ms = int(round(t * 1000))
    h, ms = divmod(ms, 3_600_000)
    m, ms = divmod(ms, 60_000)
    s, ms = divmod(ms, 1000)
    return f"{h:02d}:{m:02d}:{s:02d}{sep}{ms:03d}"


def cues(spec: dict, max_words: int = 7, max_chars: int = 42, max_gap: float = 0.6) -> list[tuple[float, float, str]]:
    """Subtitle cues (output time) from kept words: sentence / pause / length aware."""
    words = output_words(spec)
    out, cur = [], []
    for w in words:
        if cur and (w["outStart"] - cur[-1]["outEnd"] > max_gap or len(" ".join(x["text"] for x in cur + [w])) > max_chars or len(cur) >= max_words):
            out.append(cur)
            cur = []
        cur.append(w)
        if w["text"].rstrip().endswith((".", "!", "?")):
            out.append(cur)
            cur = []
    if cur:
        out.append(cur)
    return [(c[0]["outStart"], c[-1]["outEnd"], " ".join(x["text"] for x in c)) for c in out]


def srt(spec: dict) -> str:
    return "\n".join(f"{i}\n{_ts(a, ',')} --> {_ts(b, ',')}\n{text}\n" for i, (a, b, text) in enumerate(cues(spec), 1))


def vtt(spec: dict) -> str:
    return "WEBVTT\n\n" + "\n".join(f"{_ts(a, '.')} --> {_ts(b, '.')}\n{text}\n" for a, b, text in cues(spec))


def fcpxml(spec: dict, name: str = "BetterCut edit") -> str:
    """FCPXML 1.9: the cut (kept segments from the original source) on a 1080x1920 timeline.

    Captions/graphics stay in the BetterCut render; this hands a pro the clean A-roll edit to finish."""
    fps = int(spec.get("fps", 30))
    fd = Fraction(1, fps)

    def rt(sec: float) -> str:
        frames = int(round(sec * fps))
        return f"{frames}/{fps}s" if frames else "0s"

    src = Path(spec["source"]["src"])
    dur = spec["source"].get("duration", 0)
    placed = place_segments(spec)
    total = placed[-1]["outEnd"] if placed else 0
    clips = []
    for s in placed:
        clips.append(
            f'        <asset-clip ref="r2" name="{escape(src.stem)}" offset="{rt(s["outStart"])}" start="{rt(s["start"])}" '
            f'duration="{rt(s["end"] - s["start"])}" tcFormat="NDF"/>'
        )
    w, h = spec.get("width", 1080), spec.get("height", 1920)
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE fcpxml>
<fcpxml version="1.9">
  <resources>
    <format id="r1" name="FFVideoFormat{h}p{fps}" frameDuration="{fd.numerator}/{fd.denominator}s" width="{w}" height="{h}"/>
    <asset id="r2" name="{escape(src.stem)}" start="0s" duration="{rt(dur)}" hasVideo="1" hasAudio="1" format="r1">
      <media-rep kind="original-media" src="{escape(src.resolve().as_uri())}"/>
    </asset>
  </resources>
  <library>
    <event name="BetterCut">
      <project name="{escape(name)}">
        <sequence format="r1" duration="{rt(total)}" tcStart="0s" tcFormat="NDF">
          <spine>
{chr(10).join(clips)}
          </spine>
        </sequence>
      </project>
    </event>
  </library>
</fcpxml>
"""


def write_all(spec: dict, out_dir: Path, stem: str) -> dict[str, Path]:
    out_dir.mkdir(parents=True, exist_ok=True)
    files = {
        "srt": out_dir / f"{stem}.srt",
        "vtt": out_dir / f"{stem}.vtt",
        "fcpxml": out_dir / f"{stem}.fcpxml",
    }
    files["srt"].write_text(srt(spec), encoding="utf-8")
    files["vtt"].write_text(vtt(spec), encoding="utf-8")
    files["fcpxml"].write_text(fcpxml(spec, stem), encoding="utf-8")
    return files
