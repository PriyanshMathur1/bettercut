"""Forced alignment with whisperX (wav2vec2 CTC). Whisper's own word timestamps drift 100-300 ms; aligning the
transcript against the audio phonetically puts word edges within a frame or two, which makes cuts and karaoke
captions land on the syllable.

whisperX is optional: if it isn't installed, the language has no alignment model, or alignment fails, the
Whisper timings are kept unchanged.
"""
from __future__ import annotations

import re
from difflib import SequenceMatcher
from pathlib import Path

_MODELS: dict[str, tuple] = {}


def _norm(text: str) -> str:
    return re.sub(r"[^\w']+", "", text.lower())


def merge_alignment(words: list[dict], aligned: list[dict], max_shift: float = 0.6) -> tuple[list[dict], int]:
    """Copy aligned start/end onto Whisper words, matching by normalised text in order.

    Words the aligner skipped (numbers, symbols) or that moved more than `max_shift` seconds keep their Whisper
    timing. Ends never overlap the next word's start. Returns (new words, number of words re-timed)."""
    a_tokens = [_norm(w.get("word", "")) for w in aligned]
    w_tokens = [_norm(w["text"]) for w in words]
    out = [dict(w) for w in words]
    moved = 0
    sm = SequenceMatcher(a=w_tokens, b=a_tokens, autojunk=False)
    for block in sm.get_matching_blocks():
        for k in range(block.size):
            i, j = block.a + k, block.b + k
            a = aligned[j]
            if "start" not in a or "end" not in a or not w_tokens[i]:
                continue
            s, e = float(a["start"]), float(a["end"])
            if e <= s or abs(s - words[i]["start"]) > max_shift or abs(e - words[i]["end"]) > max_shift:
                continue
            out[i]["start"], out[i]["end"] = round(s, 3), round(e, 3)
            moved += 1
    for i in range(len(out) - 1):
        if out[i]["end"] > out[i + 1]["start"]:
            out[i]["end"] = out[i + 1]["start"]
        if out[i]["end"] <= out[i]["start"]:
            out[i]["end"] = round(out[i]["start"] + 0.02, 3)
    return out, moved


def pad_segments(segments: list[dict], duration: float, before: float = 0.3, after: float = 0.6) -> list[dict]:
    """Widen Whisper segment boxes into the surrounding silence (never into a neighbour). whisperX only
    searches inside each box, and Whisper tends to close a segment before the last word has finished."""
    out = []
    for i, sg in enumerate(segments):
        lo = segments[i - 1]["end"] if i else 0.0
        hi = segments[i + 1]["start"] if i + 1 < len(segments) else duration
        out.append({**sg, "start": max(lo, sg["start"] - before), "end": min(hi, sg["end"] + after)})
    return out


def _model(language: str):
    import whisperx

    if language not in _MODELS:
        _MODELS[language] = whisperx.load_align_model(language_code=language, device="cpu")
    return _MODELS[language]


def align(path: Path, words: list[dict], segments: list[dict], language: str, log=print) -> list[dict]:
    """Re-time `words` with whisperX. `segments` are Whisper segments {text, start, end}."""
    if not words or not segments:
        return words
    try:
        import whisperx

        model, meta = _model(language)
        audio = whisperx.load_audio(str(path))
        boxes = pad_segments(segments, len(audio) / whisperx.audio.SAMPLE_RATE)
        result = whisperx.align(boxes, model, meta, audio, "cpu", return_char_alignments=False)
        new, moved = merge_alignment(words, result.get("word_segments", []))
        log(f"aligned {moved}/{len(words)} words with whisperX ({language})")
        return new
    except ImportError:
        log("whisperX not installed: keeping Whisper word timings")
    except Exception as e:  # no model for this language, download failure, etc.
        log(f"alignment skipped ({type(e).__name__}: {e}); keeping Whisper word timings")
    return words
