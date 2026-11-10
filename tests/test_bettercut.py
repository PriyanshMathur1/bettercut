"""Unit tests for BetterCut's pure decision logic (no ffmpeg, whisper or node needed)."""
from __future__ import annotations

import json

import pytest

from bettercut import autocut, enrich, mimic, spec as specmod, timeline


def W(text, start, end, **kw):
    return {"text": text, "start": start, "end": end, **kw}


# ---- takes / fillers ---------------------------------------------------------

def test_pick_takes_keeps_last_complete_take():
    words = [
        W("This", 0.0, 0.2), W("is", 0.25, 0.4), W("the", 0.45, 0.6), W("hook.", 0.65, 0.9),
        W("This", 2.0, 2.2), W("is", 2.25, 2.4), W("the", 2.45, 2.6), W("real", 2.65, 2.9), W("hook.", 2.95, 3.2),
        W("Next", 4.0, 4.3), W("line.", 4.35, 4.6),
    ]
    out = autocut.pick_takes(words)
    assert [w["text"] for w in out if w.get("cut")] == ["This", "is", "the", "hook."]
    assert all(not w.get("cut") for w in out[4:])


def test_pick_takes_drops_false_start():
    words = [W("So", 0, 0.2), W("the", 0.25, 0.4), W("So", 1.5, 1.7), W("the", 1.75, 1.9), W("thing", 1.95, 2.2), W("is.", 2.25, 2.5)]
    out = autocut.pick_takes(words)
    assert [w.get("cut", False) for w in out] == [True, True, False, False, False, False]


def test_unrelated_lines_are_kept():
    words = [W("Money", 0, 0.3), W("matters.", 0.35, 0.8), W("Time", 2, 2.3), W("matters", 2.35, 2.7), W("more.", 2.75, 3.0)]
    assert not any(w.get("cut") for w in autocut.pick_takes(words))


def test_mark_fillers_and_stutter():
    words = [W("I", 0, 0.1), W("I", 0.15, 0.25), W("um", 0.3, 0.5), W("think", 0.55, 0.8)]
    out = autocut.mark_fillers(words)
    assert [w.get("cutReason") for w in out] == ["stutter", None, "filler", None]


# ---- segments ----------------------------------------------------------------

def test_build_segments_cuts_dead_air_and_pads():
    words = [W("a", 1.0, 1.3), W("b", 1.4, 1.7), W("c", 3.0, 3.4)]
    segs = autocut.build_segments(words, duration=5.0, max_gap=0.35)
    assert [(s["start"], s["end"]) for s in segs] == [(0.94, 1.8), (2.94, 3.5)]


def test_build_segments_ends_at_detected_silence():
    words = [W("a", 1.0, 1.6)]
    segs = autocut.build_segments(words, duration=5.0, silences=[(1.58, 2.5)])
    assert segs[0]["end"] == pytest.approx(1.62)


def test_cut_words_still_shape_segments_by_default():
    words = [W("a", 1.0, 1.3, cut=True), W("b", 1.4, 1.7)]
    assert autocut.build_segments(words, 5.0)[0]["start"] == pytest.approx(0.94)
    assert autocut.build_segments(words, 5.0, respect_cuts=True)[0]["start"] == pytest.approx(1.34)


# ---- enrichment --------------------------------------------------------------

def test_emphasis_prefers_numbers_and_respects_spacing():
    words = [W("I", 0, 0.1), W("made", 0.15, 0.3), W("$10,000", 0.35, 0.9), W("in", 0.95, 1.0), W("one", 1.05, 1.2), W("month.", 1.25, 1.6)]
    out = enrich.pick_emphasis(words)
    assert [w["text"] for w in out if w.get("emphasis")] == ["$10,000"]


def test_fix_names_snaps_mishearing():
    out = enrich.fix_names([W("Cloude,", 0, 0.3), W("skill", 0.4, 0.6)], ["Claude"])
    assert out[0]["text"] == "Claude,"
    assert out[1]["text"] == "skill"


def test_emoji_only_on_emphasis():
    out = enrich.attach_emoji([W("money", 0, 0.3, emphasis=True), W("money", 1, 1.3)])
    assert out[0].get("emoji") == "💰" and "emoji" not in out[1]


def test_hook_text_skips_cut_lines():
    words = [W("Um", 0, 0.2, cut=True), W("Three", 1, 1.2), W("rules", 1.3, 1.6), W("for", 1.7, 1.8), W("money.", 1.9, 2.2)]
    assert enrich.hook_text(words) == "Three rules for money"


# ---- timeline parity with the TypeScript renderer --------------------------------

TS_WORDS = [
    W("Hello", 0.1, 0.4), W("um", 0.5, 0.7, cut=True), W("world.", 0.9, 1.3), W("Next", 3.0, 3.3), W("line", 3.4, 3.7),
]


def test_timeline_matches_ts_vectors():
    placed = timeline.place_segments({"segments": [{"start": 0, "end": 1.5}, {"start": 2.9, "end": 3.8}], "words": TS_WORDS})
    assert len(placed) == 3
    assert placed[1]["outStart"] == pytest.approx(0.48)
    assert placed[-1]["outEnd"] == pytest.approx(0.48 + (1.5 - 0.87) + 0.9)


def test_total_duration_includes_end_card():
    spec = {"segments": [{"start": 0, "end": 2}], "words": [], "endCard": {"enabled": True, "duration": 2.5}}
    assert timeline.total_duration(spec) == pytest.approx(4.5)


# ---- spec / looks --------------------------------------------------------------

def test_every_builtin_look_applies():
    looks = specmod.list_looks()
    assert len([k for k, v in looks.items() if not v["user"]]) >= 15
    base = specmod.build_spec({"src": "/x.mp4", "width": 1080, "height": 1920, "duration": 5, "fps": 30}, [], [], hook="Hi there")
    for look_id in looks:
        s = specmod.apply_look(base, look_id, "Hi there")
        assert s["look"] == look_id
        assert s["captions"]["style"]
        assert "$hook" not in json.dumps(s)


def test_behind_head_disabled_without_matte():
    base = specmod.build_spec({"src": "/x.mp4", "width": 1080, "height": 1920, "duration": 5, "fps": 30}, [], [], look="behind-head")
    assert base["captions"]["behindHead"] is False


def test_validate_flags_missing_source_and_matte():
    s = specmod.build_spec({"src": "/nope.mp4", "width": 1080, "height": 1920, "duration": 5, "fps": 30}, [], [], look="colour-pop")
    issues = specmod.validate(s)
    assert any("missing" in i for i in issues)
    assert any("needs a cutout" in i for i in issues)


def test_look_patch_merges_one_level():
    out = specmod.merge({"a": {"x": 1, "y": 2}, "b": [1]}, {"a": {"y": 3}, "b": [2]})
    assert out == {"a": {"x": 1, "y": 3}, "b": [2]}


# ---- mimic ---------------------------------------------------------------------

def test_mimic_fast_dark_reference():
    patch = mimic.choose_look({
        "shots": {"cutsPerMin": 40},
        "colour": {"brightness": 0.25, "saturation": 0.2, "warmth": 0, "contrast": 0.5, "palette": ["#111111", "#FF2244"]},
        "speech": {"wps": 3.6},
    })
    assert patch["motion"]["autoZoom"] == "punchy"
    assert patch["grade"]["preset"] == "editorial-dark"
    assert patch["captions"]["wordsPerPage"] == 2
    assert patch["brand"]["accent"] == "#FF2244"
    assert patch["progressBar"] is True


def test_mimic_slow_warm_reference():
    patch = mimic.choose_look({
        "shots": {"cutsPerMin": 4},
        "colour": {"brightness": 0.6, "saturation": 0.3, "warmth": 0.2, "contrast": 0.3, "palette": ["#C0A080"]},
        "speech": {"wps": 1.8},
    })
    assert patch["motion"]["camera"] == "slow-push"
    assert patch["grade"]["preset"] == "warm"
    assert patch["captions"]["wordsPerPage"] == 4
    assert "brand" not in patch


def test_shot_stats():
    st = mimic.shot_stats([1.0, 2.0, 4.0], 6.0)
    assert st["shots"] == 4 and st["cutsPerMin"] == 40.0 and st["avgShot"] == 1.5


def test_speed_ramp_python_twin():
    placed = timeline.place_segments({"segments": [{"start": 0, "end": 2, "speed": 2}, {"start": 3, "end": 4}], "words": []})
    assert placed[0]["outEnd"] == pytest.approx(1.0)
    assert timeline.to_output(placed, 1.0) == pytest.approx(0.5)


# ---- pro upgrades: colour, audio, export, vision, b-roll -----------------------------

from bettercut import colour, export, vision, broll  # noqa: E402


def _spec(**kw):
    s = specmod.build_spec({"src": "/x.mp4", "width": 1080, "height": 1920, "duration": 10, "fps": 30}, [], [{"start": 0, "end": 4}, {"start": 5, "end": 9}])
    s.update(kw)
    return s


def test_neutral_grade_needs_no_bake():
    assert not colour.needs_bake(_spec())


def test_build_filter_orders_correction_then_lut():
    s = _spec()
    s["grade"].update({"exposure": 0.5, "temperature": 40, "lut": "cinematic-teal", "lutStrength": 1, "sharpen": 20})
    f = colour.build_filter(s)
    assert f.index("exposure=") < f.index("colortemperature") < f.index("lut3d") < f.index("cas=")
    assert colour.needs_bake(s)


def test_per_shot_grade_uses_timeline_enable():
    s = _spec()
    s["segments"][1]["grade"] = {"saturation": -50}
    assert "enable='between(t,5.000,9.000)'" in colour.build_filter(s)


def test_partial_lut_strength_blends():
    s = _spec()
    s["grade"].update({"lut": "warm-film", "lutStrength": 0.5})
    assert "blend=all_mode=normal:all_opacity=0.500" in colour.build_filter(s)


def test_bake_key_changes_with_settings_and_voice():
    a, b = _spec(), _spec()
    b["grade"]["exposure"] = 0.2
    c = _spec()
    c["audio"]["enhanceVoice"] = True
    assert len({colour.bake_key(a), colour.bake_key(b), colour.bake_key(c)}) == 3


def test_auto_exposure_and_match_gains():
    assert colour.auto_exposure_ev({"luma": 0.235}) == pytest.approx(1.0, abs=0.01)
    assert colour.auto_exposure_ev({"luma": 0.01}) == 1.5
    g, o = colour.match_gains({"mean": [0.5, 0.5, 0.5], "std": [0.2, 0.2, 0.2]}, {"mean": [0.4, 0.5, 0.6], "std": [0.1, 0.2, 0.4]})
    assert g == [1.6, 1.0, 0.6] and o[1] == 0.0


def test_generated_lut_is_valid_cube(tmp_path):
    p = colour.write_cube(tmp_path / "t.cube", colour.LOOKS["mono-silver"], size=5)
    lines = p.read_text().splitlines()
    assert "LUT_3D_SIZE 5" in lines
    assert len([ln for ln in lines if ln and ln[0].isdigit()]) == 125


def test_srt_vtt_and_fcpxml():
    s = _spec(words=[W("Hello", 0.5, 0.9), W("world.", 1.0, 1.4), W("Again", 5.5, 5.9)])
    srt = export.srt(s)
    assert srt.startswith("1\n00:00:00,500 --> 00:00:01,400\nHello world.")
    assert "00:00:04,500" in srt  # 5.5s source -> 4.5s output after the 4..5 gap is cut
    assert export.vtt(s).startswith("WEBVTT")
    x = export.fcpxml(s)
    assert x.count("<asset-clip") == 2 and 'offset="120/30s"' in x


def test_face_focus_point_keeps_headroom():
    cx, cy = vision.focus_point((0.4, 0.3, 0.2))
    assert cx == 0.4 and cy == pytest.approx(0.42)


def test_broll_keywords_spaced_and_meaningful():
    s = _spec(words=[W("money", 1, 1.3, emphasis=True), W("savings", 2, 2.4, emphasis=True), W("travel", 6, 6.4, emphasis=True), W("2024", 9, 9.3, emphasis=True)])
    assert [k["word"] for k in broll.keywords(s)] == ["money", "travel"]


def test_catalog_reads_every_style_from_the_renderer():
    from bettercut.catalog import counts

    c = counts()
    assert c["captionStyles"] >= 60 and c["formats"] >= 16 and c["effects"] >= 60
    assert c["titles"] >= 13 and c["overlays"] >= 19 and c["grades"] >= 17


def test_alignment_merge_retimes_matching_words_only():
    from bettercut.align import merge_alignment

    words = [
        {"text": "Hello,", "start": 0.10, "end": 0.50},
        {"text": "2024", "start": 0.55, "end": 1.00},
        {"text": "world.", "start": 1.05, "end": 1.60},
        {"text": "again", "start": 1.70, "end": 2.00},
    ]
    aligned = [
        {"word": "Hello,", "start": 0.22, "end": 0.48},
        {"word": "2024"},                                   # aligner skipped (digits)
        {"word": "world.", "start": 1.12, "end": 1.75},     # end overlaps next word -> clipped
        {"word": "again", "start": 3.50, "end": 3.90},      # shifted > max_shift -> ignored
    ]
    out, moved = merge_alignment(words, aligned)
    assert moved == 2
    assert (out[0]["start"], out[0]["end"]) == (0.22, 0.48)
    assert (out[1]["start"], out[1]["end"]) == (0.55, 1.00)
    assert out[2]["start"] == 1.12 and out[2]["end"] == 1.70
    assert (out[3]["start"], out[3]["end"]) == (1.70, 2.00)
    assert words[0]["start"] == 0.10  # input not mutated


def test_alignment_merge_survives_text_mismatch():
    from bettercut.align import merge_alignment

    words = [{"text": t, "start": i * 0.5, "end": i * 0.5 + 0.4} for i, t in enumerate(["so", "um", "the", "plan"])]
    aligned = [{"word": "so", "start": 0.05, "end": 0.3}, {"word": "the", "start": 1.02, "end": 1.2}, {"word": "plan", "start": 1.55, "end": 1.9}]
    out, moved = merge_alignment(words, aligned)
    assert moved == 3
    assert out[1] == words[1]  # "um" missing from aligner keeps Whisper timing


def test_alignment_boxes_pad_into_silence_not_neighbours():
    from bettercut.align import pad_segments

    segs = [{"text": "a", "start": 0.2, "end": 1.0}, {"text": "b", "start": 1.3, "end": 2.0}]
    out = pad_segments(segs, duration=2.2)
    assert out[0]["start"] == 0.0 and out[0]["end"] == 1.3
    assert out[1]["start"] == 1.0 and out[1]["end"] == 2.2
    assert segs[0]["end"] == 1.0


def test_contact_sheet_handles_limited_range_phone_video(tmp_path):
    import subprocess
    from bettercut import media

    clip = tmp_path / "phone.mp4"
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=s=320x568:r=30:d=2",
                    "-pix_fmt", "yuv420p", "-color_range", "tv", "-c:v", "libx264", str(clip)], check=True)
    out = media.contact_sheet(clip, tmp_path / "sheet.jpg", [0.5, 1.5], cols=2, width=120)
    assert out.exists() and out.stat().st_size > 0


def test_assemble_mixes_silent_and_voiced_clips(tmp_path):
    import subprocess
    from bettercut import media

    silent, voiced = tmp_path / "silent.mp4", tmp_path / "voiced.mp4"
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=s=180x320:r=30:d=1",
                    "-c:v", "libx264", "-pix_fmt", "yuv420p", str(silent)], check=True)
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=s=180x320:r=30:d=1",
                    "-f", "lavfi", "-i", "sine=f=440:d=1", "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p",
                    "-c:a", "aac", str(voiced)], check=True)
    info = media.assemble([silent, voiced], tmp_path / "out.mp4", width=180, height=320)
    assert media.has_audio(tmp_path / "out.mp4")
    assert abs(info["duration"] - 2.0) < 0.15
    assert [c["start"] for c in info["clips"]] == [0.0, 1.0]


def test_split_number_tokens_are_rejoined_and_never_cut_as_stutters():
    from bettercut import autocut, enrich

    raw = [("That's", 8.45, 8.70), ("3", 8.74, 8.86), (".3", 8.88, 9.18), ("%", 9.20, 9.48), ("back", 9.51, 9.75),
           ("10", 21.56, 21.68), (",000", 21.70, 22.20), ("rupees.", 22.31, 22.8), ("add", 23.0, 23.2), ("-on", 23.22, 23.4),
           ("cards", 23.45, 23.8)]
    words = [{"text": t, "start": a, "end": b} for t, a, b in raw]
    merged = autocut.mark_fillers(enrich.merge_split_tokens(words))
    assert [w["text"] for w in merged] == ["That's", "3.3%", "back", "10,000", "rupees.", "add-on", "cards"]
    assert not any(w.get("cut") for w in merged)
    assert merged[1]["start"] == 8.74 and merged[1]["end"] == 9.48


def test_numbers_are_not_stutters_but_words_are():
    from bettercut import autocut

    ws = [{"text": t, "start": i, "end": i + 0.5} for i, t in enumerate(["I", "I", "think", "2", "2", "options"])]
    out = autocut.mark_fillers(ws)
    assert [w.get("cut", False) for w in out] == [True, False, False, False, False, False]


def test_uncovered_speech_finds_dropped_lines():
    from bettercut.media import uncovered_speech

    words = [{"text": "a", "start": 0.2, "end": 0.6}, {"text": "b", "start": 0.7, "end": 1.4},
             {"text": "c", "start": 24.9, "end": 26.3}]
    speech = [(0.15, 1.5), (24.5, 31.0), (40.0, 40.3)]
    # the CTA at 26.3-31.0 was dropped; the 0.3 s blip at 40 s is too short to matter
    assert uncovered_speech(speech, words) == [(26.55, 31.0)]
    assert uncovered_speech([(0.15, 1.5)], words) == []


def test_validate_flags_placeholder_brand_on_end_card():
    from bettercut.spec import DEFAULT_BRAND, validate

    spec = {"source": {"src": "http://x/a.mp4"}, "segments": [{"start": 0, "end": 1}],
            "endCard": {"enabled": True}, "brand": dict(DEFAULT_BRAND)}
    assert any("placeholder" in i for i in validate(spec))
    spec["brand"] = {**DEFAULT_BRAND, "name": "Asha", "handle": "asha"}
    assert not any("placeholder" in i for i in validate(spec))


def test_placeholder_brand_is_advice_and_never_blocks_a_render():
    from bettercut.spec import DEFAULT_BRAND, blocking, validate

    spec = {"source": {"src": "http://x/a.mp4"}, "segments": [{"start": 0, "end": 1}],
            "endCard": {"enabled": True}, "brand": dict(DEFAULT_BRAND)}
    assert validate(spec) and blocking(spec) == []
    spec["segments"] = []
    assert any("no segments" in i for i in blocking(spec))


def test_a_clip_with_no_speech_becomes_a_whole_clip_reel(tmp_path, monkeypatch):
    """B-roll, music or screen recordings: nothing to cut on, so keep everything and show no captions."""
    from bettercut import media, pipeline

    src = tmp_path / "p" / "assets" / "source.mp4"
    monkeypatch.setattr(media, "find_clips", lambda clips, newest=None: ["clip.mp4"])
    monkeypatch.setattr(media, "assemble", lambda files, out, stabilize=False: (out.parent.mkdir(parents=True, exist_ok=True), out.write_bytes(b"x"), [])[2])
    monkeypatch.setattr(media, "probe", lambda p: {"duration": 13.5, "width": 1080, "height": 1920})
    monkeypatch.setattr(media, "transcribe", lambda *a, **k: [])
    monkeypatch.setattr(media, "speech_gaps", lambda p: [(0.0, 13.5)])
    logs = []
    spec = pipeline.make(tmp_path / "p", ["clip.mp4"], reframe=False, log=logs.append)
    assert spec["words"] == [] and not (spec.get("hook") or {}).get("text")
    assert [(s["start"], s["end"]) for s in spec["segments"]] == [(0.0, 13.5)]
    assert any("no speech" in m for m in logs)
    from bettercut.spec import blocking
    assert blocking(spec) == []
    assert src.exists()


def test_shots_play_in_listed_order_with_freeze_frames_and_joins():
    """Python twin of composer/tests/reel/edit.test.ts: reorder, hold and join."""
    from bettercut import timeline as tl

    words = [{"text": "first", "start": 1, "end": 1.5}, {"text": "second", "start": 6, "end": 6.5}]
    spec = {"segments": [{"id": "s2", "start": 5, "end": 9}, {"id": "s1", "start": 0, "end": 4}], "words": words}
    placed = tl.place_segments(spec)
    assert [(p["id"], p["outStart"], p["outEnd"]) for p in placed] == [("s2", 0, 4), ("s1", 4, 8)]
    assert [w["text"] for w in tl.output_words(spec)] == ["second", "first"]

    spec = {"segments": [{"start": 0, "end": 2, "hold": 1.5}, {"start": 2, "end": 4, "join": True}, {"start": 5, "end": 9}], "words": []}
    placed = tl.place_segments(spec)
    assert placed[-1]["outEnd"] == 9.5
    assert [p["shot"] for p in placed] == [0, 0, 1]
    assert tl.to_output(placed, 3) == 4.5  # after the 1.5 s freeze
